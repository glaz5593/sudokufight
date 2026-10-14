import type { BlockedPlayer, ReportReason } from '@sudoku-fight/protocol';
import { create } from 'zustand';

import type { AccountFetch } from '../api/accountApi';
import {
  createModerationApi,
  isModerationApiError,
  isModerationOffline,
  type ModerationApi,
  ModerationApiError,
  type ReportOutcome,
} from '../api/moderationApi';
import { authDeps, refreshMe, useAuth } from '../auth/authStore';
import { accountConfig } from '../config/account';
import { httpBaseUrl } from '../config/server';
import { track } from '../services/analytics';

/**
 * Reporting and blocking players, wired to the phone (spec §3.5; protocol moderation.ts). The blocks of the
 * signed-in player are read from the server when a screen needs them (the blocked list, a player card, a ranked
 * game), and kept here for this run, so "חסום" / "בטל חסימה" says the right thing everywhere. They belong to one
 * account: another sign-in reads its own (the list says whose it is).
 *
 * A suspended account (403 `suspended`) can't report: the profile is read again, so the app shows the
 * suspension (Me.suspended) everywhere at once.
 */

export type BlocksStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

export interface BlocksState {
  /** Whose list this is (Me.id); null before any. */
  owner: string | null;
  status: BlocksStatus;
  /** Newest first. */
  blocks: readonly BlockedPlayer[];
  /** MAX_BLOCKS, from the server. */
  max: number | null;
  /** The last failure's code, for the support line. */
  error: string | null;
}

const EMPTY: BlocksState = { owner: null, status: 'idle', blocks: [], max: null, error: null };

export const useBlocks = create<BlocksState>()(() => EMPTY);

/** Tests: a fresh store. */
export function resetBlocks(): void {
  useBlocks.setState(EMPTY, true);
}

// ---------------------------------------------------------------------------------------------------------
// The API

/**
 * The fetch the moderation routes go through. Under Jest (NODE_ENV 'test') there is none unless a test sets one:
 * every call is "no connection", so no test reaches for a real server by accident.
 */
const defaultFetch = (): AccountFetch | null =>
  process.env.NODE_ENV === 'test' ? null : (url, init) => fetch(url, init);

let moderationFetch: AccountFetch | null = defaultFetch();
let apiOverride: (() => ModerationApi | null) | null = null;

/** Tests: the fetch to use instead (null: the default again). */
export function setModerationFetch(next: AccountFetch | null): void {
  moderationFetch = next ?? defaultFetch();
}

/** Tests: the API to use instead of the server's (null: the server's again). */
export function setModerationApi(make: (() => ModerationApi | null) | null): void {
  apiOverride = make;
}

const noConnection: AccountFetch = () => Promise.reject(new TypeError('Network request failed'));

/** The moderation API for whoever is signed in now; null when nobody is. */
export function moderationApi(): ModerationApi | null {
  if (apiOverride) return apiOverride();
  if (useAuth.getState().user === null) return null;
  return createModerationApi({
    baseUrl: httpBaseUrl(),
    getToken: async (forceRefresh) => {
      const { provider } = authDeps();
      return provider.currentUser() ? provider.getIdToken(forceRefresh) : null;
    },
    fetch: (url, init) => (moderationFetch ?? noConnection)(url, init),
    timeoutMs: accountConfig.requestTimeoutMs,
  });
}

/** The signed-in player's public id, or null. */
const meId = (): string | null => {
  const { status, me } = useAuth.getState();
  return status === 'ready' && me ? me.id : null;
};

const signedOut = (): ModerationApiError => new ModerationApiError('signedOut');

/** The suspension shows at once: Me.suspended comes with the profile. */
function onRefused(error: unknown): void {
  if (isModerationApiError(error) && error.code === 'suspended') void refreshMe();
}

// ---------------------------------------------------------------------------------------------------------
// Blocks

const NONE: readonly BlockedPlayer[] = [];

/** My blocks in a state: empty when it is another account's (the same empty list, so a selector can return it). */
export const blocksOf = (s: BlocksState, owner: string | null): readonly BlockedPlayer[] =>
  owner !== null && s.owner === owner ? s.blocks : NONE;

/** Whether I blocked `playerId` (as far as this run knows). */
export function useIsBlocked(playerId: string | null): boolean {
  const owner = useAuth((s) => (s.status === 'ready' ? (s.me?.id ?? null) : null));
  return useBlocks((s) => playerId !== null && blocksOf(s, owner).some((b) => b.id === playerId));
}

/** The ids I blocked (for a game's opponents), outside React. */
export const blockedIds = (): ReadonlySet<string> =>
  new Set(blocksOf(useBlocks.getState(), meId()).map((b) => b.id));

/**
 * Reads my blocks from the server. Without `force`, a list already read for this account stays. Never throws:
 * the status says how it went.
 */
export async function loadBlocks({ force = false }: { force?: boolean } = {}): Promise<void> {
  const owner = meId();
  const api = moderationApi();
  if (!owner || !api) return;
  const current = useBlocks.getState();
  if (!force && current.owner === owner && (current.status === 'ready' || current.status === 'loading'))
    return;
  // Another account's list goes at once; this account's stays on screen while it is read again.
  useBlocks.setState(
    current.owner === owner
      ? { status: 'loading', error: null }
      : { owner, status: 'loading', blocks: [], max: null, error: null },
  );
  try {
    const list = await api.blocks();
    if (meId() !== owner) return;
    useBlocks.setState({ owner, status: 'ready', blocks: list.blocks, max: list.max, error: null });
  } catch (error) {
    if (meId() !== owner) return;
    const code = isModerationApiError(error) ? error.code : 'unexpected';
    useBlocks.setState({ status: isModerationOffline(error) ? 'offline' : 'error', error: code });
  }
}

/** Blocks a player (POST /v1/me/blocks). Throws ModerationApiError; the list has them first on success. */
export async function blockPlayer(playerId: string): Promise<BlockedPlayer> {
  const owner = meId();
  const api = moderationApi();
  if (!owner || !api) throw signedOut();
  const blocked = await api.block(playerId);
  if (meId() !== owner) return blocked;
  const s = useBlocks.getState();
  const mine = s.owner === owner;
  useBlocks.setState({
    owner,
    // A list not read yet stays "not read" (the blocked list reads it all); this player is known blocked now.
    status: mine ? s.status : 'idle',
    blocks: [blocked, ...(mine ? s.blocks : []).filter((b) => b.id !== blocked.id)],
  });
  return blocked;
}

/** Lifts a block (DELETE /v1/me/blocks/:id). Throws ModerationApiError; the list loses them on success. */
export async function unblockPlayer(playerId: string): Promise<void> {
  const owner = meId();
  const api = moderationApi();
  if (!owner || !api) throw signedOut();
  await api.unblock(playerId);
  const s = useBlocks.getState();
  if (s.owner === owner) useBlocks.setState({ blocks: s.blocks.filter((b) => b.id !== playerId) });
}

// ---------------------------------------------------------------------------------------------------------
// Reports

export interface ReportInput {
  playerId: string;
  reason: ReportReason;
  /** The ranked game it is about (kept by the server only when both sat in it). */
  gameId?: string | null;
}

/**
 * Reports a player (POST /v1/reports). Resolves for a new report and for one that was open already (both get
 * the thank-you); `report_sent {reason}` is counted for a new one only (spec §22: no ids). Throws
 * ModerationApiError (rateLimited with retryAt, suspended, self, notFound, offline…).
 */
export async function reportPlayer({ playerId, reason, gameId }: ReportInput): Promise<ReportOutcome> {
  const api = moderationApi();
  if (!meId() || !api) throw signedOut();
  try {
    const outcome = await api.report({ playerId, reason, ...(gameId ? { gameId } : null) });
    if (!outcome.duplicate) track('report_sent', { reason });
    return outcome;
  } catch (error) {
    onRefused(error);
    throw error;
  }
}
