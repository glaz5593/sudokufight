import type { GameType, PlayerId } from '@sudoku-fight/engine';

import { type AvatarId, EMPTY_AVATAR, isAvatarId } from '../../../assets/avatars';
import { CONNECTING_STEPS, type ConnectingStep } from './connectionModel';

/**
 * The loading card of a ranked match's room (Loading.dc.html): who plays, with their ratings, the tag
 * "מדורג · <type>", how far the loading is, who is ready, and a tip. Pure: the players come from the match's
 * "found" (the session's profiles: name, avatar, country, rating), the steps from the connection.
 *
 * - A room by code (dev) has no such profiles: no card extras (null).
 * - Ready (D37: connected = ready): me once my phone is in the room (the 'sync' step: the snapshot is on its
 *   way); the others are in their match's room already (this card shows when the phone comes back into a
 *   match that started without it: "נסה שוב" after a lost connection).
 * - Percent: the steps done so far, of the three (0, 33, 67): the card goes once the game is here.
 * - The tip: one of LOADING_TIPS, picked by a stable hash of `seed` (the same game shows the same tip on every
 *   render); every number in it comes from the rules below, not from the text.
 */

/** A player as "found" gave them (game/onlineSession OnlineProfile). */
export interface LoadingProfile {
  avatarId: string | null;
  country: string | null;
  name?: string;
  rating?: number;
  provisional?: boolean;
}

export interface LoadingPlayer {
  id: PlayerId;
  name: string;
  avatarId: AvatarId;
  country: string | null;
  rating: number | null;
  provisional: boolean;
  isMe: boolean;
  /** Me 0 (P1, ●), the others 1–3 in the match's order. */
  colorIndex: number;
  ready: boolean;
}

export const LOADING_TIPS = ['score', 'lastCell', 'mistakes', 'interference'] as const;
export type LoadingTip = (typeof LOADING_TIPS)[number];

/**
 * Spec §6.4: a move is worth 1.5 to 13.5 in theory, but in the current bank of 690 boards at most 10.5 (the
 * design's tip said 13.5). Change it with the bank.
 */
export const TOP_MOVE_POINTS = 10.5;
/** Spec §6.4: the last cell of a board always sees 8 · 8 · 8 · 8: 9 − 8 + (9 − 8) / 2. */
export const LAST_CELL_POINTS = 1.5;

export interface MatchLoading {
  gameType: GameType;
  /** Me first, then the others in the match's order. */
  players: LoadingPlayer[];
  /** 0–100. */
  percent: number;
  tip: LoadingTip;
}

/** How much of the loading is done at a step: the steps before it, of all of them. */
export const connectingPercent = (step: ConnectingStep): number =>
  Math.round((Math.max(0, CONNECTING_STEPS.indexOf(step)) / CONNECTING_STEPS.length) * 100);

/** A stable pick from LOADING_TIPS: the same seed, the same tip. */
export function tipOf(seed: string): LoadingTip {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return LOADING_TIPS[h % LOADING_TIPS.length]!;
}

export interface MatchLoadingInput {
  profiles: Readonly<Partial<Record<PlayerId, LoadingProfile | null>>> | null;
  /** My id in the match (my account's id); null when unknown. */
  myId: PlayerId | null;
  gameType: GameType;
  step: ConnectingStep;
  seed: string;
}

export function matchLoadingOf({
  profiles,
  myId,
  gameType,
  step,
  seed,
}: MatchLoadingInput): MatchLoading | null {
  const named = Object.entries(profiles ?? {}).flatMap(([id, p]) =>
    p && typeof p.name === 'string' && p.name !== '' ? [{ id, ...p, name: p.name }] : [],
  );
  if (named.length < 2) return null;
  const mine = named.filter((p) => p.id === myId);
  const others = named.filter((p) => p.id !== myId);
  const players = [...mine, ...others].map((p, k): LoadingPlayer => ({
    id: p.id,
    name: p.name,
    avatarId: isAvatarId(p.avatarId) ? p.avatarId : EMPTY_AVATAR,
    country: p.country,
    rating: typeof p.rating === 'number' && Number.isFinite(p.rating) ? p.rating : null,
    provisional: p.provisional ?? false,
    isMe: p.id === myId,
    // Me first: P1 (cyan ●); the others 1–3. Without my id, by order (as colorIndexFor without a seat).
    colorIndex: k,
    ready: p.id === myId ? step === 'sync' : true,
  }));
  return { gameType, players, percent: connectingPercent(step), tip: tipOf(seed) };
}
