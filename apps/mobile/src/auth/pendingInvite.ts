import { isFriendCode } from '@sudoku-fight/protocol';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { LINKS_UI, type LinksUiSettings } from '../config/links';

/**
 * A room link's way into the app (1.0.4; docs/handoff/2026-10-19/friends-room.md §6.5, §6.6, D88), kept on the
 * phone:
 *
 * - The pending invite: the code of a room link the player opened. Signed out, mid-registration, or before a
 *   new name (spec §3.5), it waits here, through an app closed meanwhile, and the sign-in then goes straight
 *   into the room instead of Home (auth/redirect.ts). Opened mid-game, it waits for the game's end (§6.6).
 *   Used up once a room screen is reached (auth/useAuthGate.ts); forgotten after LINKS_UI.pendingInviteTtlMs.
 * - The current room: the friends room this phone is in, and whose account it is, so the next start goes back
 *   to it, to the same seat, when the app was closed in it (Android closes apps in the background). Kept while
 *   the game store holds the room (auth/InviteLinkPrompt.tsx follows it); out on purpose, put out, or past its
 *   game, it is forgotten.
 * - The arrival (not on disk): a link that came while the app was running (app/+native-intent.tsx), until
 *   InviteLinkPrompt goes in or asks first (§6.6).
 *
 * Read and written synchronously (expo-sqlite's key-value store, like the settings): the gate has it from the
 * first render, and a code is on disk before the app can be closed in the registration. No account data: a
 * code, the account's id for the current room, and times.
 */

/** A room link's code, waiting for the player to be able to go in. */
export interface PendingInvite {
  code: string;
  /** When the link was opened (epoch ms). */
  at: number;
}

/** The friends room this phone is in. */
export interface CurrentRoom {
  code: string;
  /** The account (Firebase uid) in it: another account signed in on this phone does not go back to it. */
  owner: string;
  /** When the phone was last in it (epoch ms). */
  at: number;
}

/** A room link that came while the app was running. `seq` tells two links to the same room apart. */
export interface LinkArrival {
  code: string;
  seq: number;
}

export interface PendingInviteState {
  invite: PendingInvite | null;
  room: CurrentRoom | null;
  arrival: LinkArrival | null;
  /**
   * The auth gate settled this run's start, and went back to the current room if there was one to go back to
   * (not on disk): until then nothing asks about a waiting invite, which that return may use up.
   */
  started: boolean;
  /** The question on screen (auth/InviteLinkPrompt.tsx; not on disk); `open` false while it leaves. */
  prompt: LinkPrompt | null;
  /** On the way into this room (InviteLinkPrompt: Home first, then the room; not on disk). */
  going: string | null;
}

/** A question about a room link (§6.6), and whether it is still open (false: its dialog is leaving). */
export interface LinkPrompt {
  question: LinkQuestion;
  code: string;
  open: boolean;
}

type Saved = Pick<PendingInviteState, 'invite' | 'room'>;

/** Synchronous, so the store is filled before the first render (state/settings.ts does the same). */
const syncStorage: StateStorage = {
  getItem: (name) => Storage.getItemSync(name),
  setItem: (name, value) => Storage.setItemSync(name, value),
  removeItem: (name) => void Storage.removeItemSync(name),
};

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** What was saved, kept only when it is what this file writes: a 6-digit code, a time, an account id. */
export function sanitizeSaved(saved: unknown): Partial<Saved> {
  if (!isRecord(saved)) return {};
  const out: Partial<Saved> = {};
  const { invite, room } = saved;
  if (isRecord(invite) && isFriendCode(invite.code) && isTime(invite.at))
    out.invite = { code: invite.code, at: invite.at };
  if (
    isRecord(room) &&
    isFriendCode(room.code) &&
    isTime(room.at) &&
    typeof room.owner === 'string' &&
    room.owner.length > 0 &&
    room.owner.length <= 128
  )
    out.room = { code: room.code, owner: room.owner, at: room.at };
  return out;
}

export const usePendingInvite = create<PendingInviteState>()(
  persist(
    (): PendingInviteState => ({
      invite: null,
      room: null,
      arrival: null,
      started: false,
      prompt: null,
      going: null,
    }),
    {
      name: 'friends-links',
      version: 1,
      storage: createJSONStorage(() => syncStorage),
      partialize: ({ invite, room }): Saved => ({ invite, room }),
      merge: (saved, current) => ({ ...current, ...sanitizeSaved(saved) }),
    },
  ),
);

// ---------------------------------------------------------------------------------------------------------
// The pending invite

/** The invite's code while it is still good (LINKS_UI.pendingInviteTtlMs), else null. */
export function inviteCodeOf(
  invite: PendingInvite | null,
  now: number,
  settings: Pick<LinksUiSettings, 'pendingInviteTtlMs'> = LINKS_UI,
): string | null {
  if (!invite) return null;
  const age = now - invite.at;
  return age >= 0 && age < settings.pendingInviteTtlMs ? invite.code : null;
}

/** A room link was opened: its code waits until the player can go in (a newer link replaces it). */
export function rememberInvite(code: string, now: number = Date.now()): void {
  if (!isFriendCode(code)) return;
  usePendingInvite.setState({ invite: { code, at: now } });
}

/** The pending invite's code, if one is still good. */
export const pendingInviteCode = (now: number = Date.now()): string | null =>
  inviteCodeOf(usePendingInvite.getState().invite, now);

/** The pending invite's code for a screen (null once it is used up or too old). */
export const usePendingInviteCode = (): string | null =>
  usePendingInvite((s) => inviteCodeOf(s.invite, Date.now()));

/** The invite is used up (a room screen was reached) or turned down. */
export function forgetInvite(): void {
  if (usePendingInvite.getState().invite !== null) usePendingInvite.setState({ invite: null });
}

// ---------------------------------------------------------------------------------------------------------
// The current room

/** The phone is in this friends room, signed in as `owner`. */
export function rememberRoom(code: string, owner: string, now: number = Date.now()): void {
  if (!isFriendCode(code) || owner === '') return;
  usePendingInvite.setState({ room: { code, owner, at: now } });
}

/** The phone is out of its friends room (on purpose, put out, or past its game). */
export function forgetRoom(): void {
  if (usePendingInvite.getState().room !== null) usePendingInvite.setState({ room: null });
}

/** The room to go back to at a start, for this account: in it within LINKS_UI.currentRoomTtlMs. */
export function roomToResumeOf(
  room: CurrentRoom | null,
  owner: string | null,
  now: number,
  settings: Pick<LinksUiSettings, 'currentRoomTtlMs'> = LINKS_UI,
): string | null {
  if (!room || owner === null || room.owner !== owner) return null;
  const age = now - room.at;
  return age >= 0 && age < settings.currentRoomTtlMs ? room.code : null;
}

export const roomToResume = (owner: string | null, now: number = Date.now()): string | null =>
  roomToResumeOf(usePendingInvite.getState().room, owner, now);

// ---------------------------------------------------------------------------------------------------------
// A link while the app runs (§6.6)

/** A room link came while the app was running: InviteLinkPrompt goes in, or asks first. */
export function announceLink(code: string): void {
  if (!isFriendCode(code)) return;
  const seq = (usePendingInvite.getState().arrival?.seq ?? 0) + 1;
  usePendingInvite.setState({ arrival: { code, seq } });
}

/** The arrival was handled (gone in, or asked and answered). */
export function clearArrival(): void {
  if (usePendingInvite.getState().arrival !== null) usePendingInvite.setState({ arrival: null });
}

/** The auth gate's start is over (auth/useAuthGate.ts): a waiting invite may ask now. */
export function markStarted(): void {
  if (!usePendingInvite.getState().started) usePendingInvite.setState({ started: true });
}

/** Asks `question` about the room `code` (one question at a time: a newer one replaces it). */
export function askAboutLink(question: LinkQuestion, code: string): void {
  usePendingInvite.setState({ prompt: { question, code, open: true } });
}

/** The question was answered: its dialog leaves (clearPrompt once it has). */
export function closePrompt(): void {
  const { prompt } = usePendingInvite.getState();
  if (prompt?.open) usePendingInvite.setState({ prompt: { ...prompt, open: false } });
}

/** The answered question's dialog is gone. */
export function clearPrompt(): void {
  const { prompt } = usePendingInvite.getState();
  if (prompt && !prompt.open) usePendingInvite.setState({ prompt: null });
}

/** On the way into the room `code` (null: there, or given up). */
export function setGoing(code: string | null): void {
  if (usePendingInvite.getState().going !== code) usePendingInvite.setState({ going: code });
}

/**
 * What the player is in the middle of when a link comes (§6.6):
 * - practice: a practice game or a stage (leaving it is saved like any way out of it);
 * - search: looking for a ranked opponent;
 * - room: a friends room before its game (`code`: that room's);
 * - game: an online game under way (ranked or with friends), its 3… 2… 1… included;
 * - idle: anything else (Home, the menus, a game's results, a room that put me out).
 */
export type LinkActivity =
  | { kind: 'idle' }
  | { kind: 'practice' }
  | { kind: 'search' }
  | { kind: 'room'; code: string }
  | { kind: 'game' };

/** The parts of the game store the activity is read from (game/gameStore.ts; plain objects in tests). */
export interface ActivitySources {
  /** The screen, as the auth gate's paths ('game', 'levels/play', 'match', '' for Home …). */
  path: string;
  /** A practice (game/session.ts PracticeSession). */
  session: { getView(): { status: string } } | null;
  /** A game on the server (game/onlineSession.ts OnlineSession). */
  online: {
    readonly hasGame: boolean;
    getView(): { status: string };
    /** `startsAt`: GO, once the room's host started (its 3… 2… 1…, before the board comes). */
    readonly online: { readonly status: string; readonly startsAt?: number | null };
  } | null;
  /** A ranked search. */
  match: object | null;
  /** The friends room the store holds, still in it (net/friendsDevice.ts currentFriendsRoomCode). */
  friendsRoom: string | null;
}

export function activityOf({ path, session, online, match, friendsRoom }: ActivitySources): LinkActivity {
  if (path === 'levels/play') return { kind: 'practice' };
  if (online) {
    // A friends room before its start; once the host started (3… 2… 1…), it is a game.
    if (friendsRoom !== null && !online.hasGame && online.online.startsAt == null)
      return { kind: 'room', code: friendsRoom };
    const over = online.hasGame && online.getView().status === 'over';
    if (!over && online.online.status !== 'closed') return { kind: 'game' };
    return { kind: 'idle' };
  }
  if (match) return { kind: 'search' };
  if (session && path === 'game' && session.getView().status !== 'over') return { kind: 'practice' };
  return { kind: 'idle' };
}

/** The question a link asks first (§6.6), or `invite`: the one a waiting invite asks when the game is over. */
export type LinkQuestion = 'leavePractice' | 'cancelSearch' | 'switchRoom' | 'inGame' | 'invite';

/**
 * What a link to room `code` does (§6.6): go in; nothing (`here`: already in that room); or ask first. In a
 * running game it only says the room waits for the game's end ("אפשר להצטרף אחריו").
 */
export type LinkStep = { kind: 'enter' } | { kind: 'here' } | { kind: 'ask'; question: LinkQuestion };

export function linkStepOf(activity: LinkActivity, code: string): LinkStep {
  switch (activity.kind) {
    case 'idle':
      return { kind: 'enter' };
    case 'practice':
      return { kind: 'ask', question: 'leavePractice' };
    case 'search':
      return { kind: 'ask', question: 'cancelSearch' };
    case 'room':
      return activity.code === code ? { kind: 'here' } : { kind: 'ask', question: 'switchRoom' };
    case 'game':
      return { kind: 'ask', question: 'inGame' };
  }
}
