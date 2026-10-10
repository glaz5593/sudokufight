import {
  cellName,
  type CellIndex,
  type GameView,
  type InterferenceKind,
  mistakePenalty,
  type PlayerId,
  type PlayerView,
  type TimerView,
} from '@sudoku-fight/engine';

import { tokens } from '../../theme';
import { secondsOf } from './format';

/**
 * Pure view models for the player components (components.md §3–§10). They read the engine's GameView, which
 * already holds every rule (place, leader, lock timers, who can take an interference), and turn it into what
 * a card draws. No game logic: only selection, ordering and time arithmetic. `now` is in the clock the view was
 * made in (the engine's), so the screen re-runs these as time passes; the components themselves keep no clock.
 */

// ---------------------------------------------------------------------------------------------------------
// Types

export type Presence = 'online' | 'reconnecting' | 'left';

export interface LockActivity {
  kind: 'locking';
  /** "A8": always LTR. */
  cell: string;
  cellIndex: CellIndex;
  remainingMs: number;
  /** The full think time (8, 12 or 18 s from the rules) [D2]. */
  totalMs: number;
  secondsLeft: number;
  /** Stopped: under interference, or the game is frozen (§6.2.7) [D11]. */
  paused: boolean;
  /** 'turns' model [D1]: "התור שלה · A8" instead of "בוחרת · A8". */
  turn: boolean;
}

export type Activity =
  | LockActivity
  /** Playing, without a lock: "חושב…". */
  | { kind: 'thinking' }
  /** 'turns' model, the turn holder before picking a cell. */
  | { kind: 'turn'; secondsLeft: number }
  /** Disconnected, inside the grace period (§16.2) [D4]. */
  | { kind: 'reconnecting'; secondsLeft: number }
  | { kind: 'left' }
  | { kind: 'surrendered' }
  /** Before the start and after the end: nothing to say. */
  | { kind: 'idle' };

/** The ⚡ button on an opponent card (§8.1), from view.interference.targets[].blockedBy [D10, D11]. */
export type InterferenceModel =
  | { kind: 'available'; cost: number }
  /** Not enough points: "חסרות 3 נק׳". */
  | { kind: 'points'; cost: number; missing: number }
  /** Under interference or in the second of immunity after it; `secondsLeft` until it can take one. */
  | { kind: 'busy'; cost: number; secondsLeft: number }
  /** The game has not started, is frozen or is over. */
  | { kind: 'notRunning'; cost: number }
  /** Hidden: the reconnect pill takes its place. */
  | { kind: 'disconnected'; cost: number }
  /** Hidden: the player left or surrendered. */
  | { kind: 'out'; cost: number };

export interface HitModel {
  fromId: PlayerId;
  kind: InterferenceKind;
  secondsLeft: number;
  paused: boolean;
}

/** What only my own card has (§3.2, §8.2, §8.3). */
export interface MyActions {
  /** Practice (solo or bot): "סיום אימון" instead of "כניעה" (§6.6). */
  practice: boolean;
  canSurrender: boolean;
  /** False during the reaction cooldown [D19]. */
  reactionReady: boolean;
}

export interface MistakePips {
  /** Five or more mistakes: "×n" first. */
  overflow: number | null;
  /** The penalties of the last two mistakes, oldest first (−1, −2, −4 …). */
  penalties: number[];
}

export interface CardModel {
  playerId: PlayerId;
  seat: number;
  /** Palette index as this phone shows it: 0 = me (P1, ●), then P2–P4 by seat (▲ ■ ◆). */
  colorIndex: number;
  isMe: boolean;
  name: string | null;
  isBot: boolean;
  /** In this game's rating key; null outside ranked games. */
  rating: number | null;
  score: number;
  mistakes: number;
  pips: MistakePips;
  /** 1–4, shared on a tie. */
  place: number;
  isLeader: boolean;
  presence: Presence;
  out: 'surrendered' | 'abandoned' | null;
  activity: Activity;
  hit: HitModel | null;
  /** Opponents only, and only when I can send interferences at all. */
  interference: InterferenceModel | null;
  /** My card only. */
  mine: MyActions | null;
}

// ---------------------------------------------------------------------------------------------------------
// Helpers

/** Time left on an engine timer at `now`: the stored remainder while it is stopped. */
export function timeLeft(timer: TimerView, now: number): number {
  return timer.expiresAt === null ? Math.max(0, timer.remainingMs) : Math.max(0, timer.expiresAt - now);
}

const PALETTE_SIZE = tokens.color.players.length;

/**
 * The palette index of a seat on this phone: "me" is always 0 (P1), the others take 1–3 in seat order, as
 * theme.paletteForSeat does. A spectator (mySeat null) sees seats as they are.
 */
export function colorIndexFor(seat: number, mySeat: number | null, seats: readonly number[]): number {
  if (mySeat === null) return seat % PALETTE_SIZE;
  if (seat === mySeat) return 0;
  const others = seats.filter((s) => s !== mySeat).sort((a, b) => a - b);
  const i = others.indexOf(seat);
  return i < 0 ? seat % PALETTE_SIZE : Math.min(1 + i, PALETTE_SIZE - 1);
}

/** The penalty pips of the compact card (§7.2): the last two, and "×n" from five mistakes on. */
export function mistakePips(mistakes: number): MistakePips {
  const penalties: number[] = [];
  for (let k = Math.max(1, mistakes - 1); k <= mistakes; k++) penalties.push(mistakePenalty(k));
  return { overflow: mistakes >= 5 ? mistakes : null, penalties };
}

function activityOf(view: GameView, p: PlayerView, now: number): Activity {
  if (p.status === 'abandoned') return { kind: 'left' };
  if (p.status === 'surrendered') return { kind: 'surrendered' };
  if (!p.connected) {
    return { kind: 'reconnecting', secondsLeft: p.graceEndsAt === null ? 0 : secondsOf(p.graceEndsAt - now) };
  }
  const isTurn = view.rules.turnModel === 'turns' && view.turn?.playerId === p.id;
  if (p.lock) {
    const remainingMs = timeLeft(p.lock, now);
    return {
      kind: 'locking',
      cell: cellName(p.lock.cell),
      cellIndex: p.lock.cell,
      remainingMs,
      totalMs: view.rules.thinkTimeMs,
      secondsLeft: secondsOf(remainingMs),
      paused: p.lock.expiresAt === null,
      turn: isTurn,
    };
  }
  if (view.status === 'waiting' || view.status === 'over') return { kind: 'idle' };
  if (isTurn && view.turn) return { kind: 'turn', secondsLeft: secondsOf(timeLeft(view.turn, now)) };
  return { kind: 'thinking' };
}

function interferenceOf(view: GameView, p: PlayerView, now: number): InterferenceModel | null {
  const info = view.interference;
  if (!info) return null;
  const target = info.targets.find((x) => x.playerId === p.id);
  if (!target) return null;
  const cost = info.nextCost;
  switch (target.blockedBy) {
    case null:
      return { kind: 'available', cost };
    case 'points':
      return { kind: 'points', cost, missing: info.missingPoints };
    case 'busy':
      return { kind: 'busy', cost, secondsLeft: secondsOf((target.busyUntil ?? now) - now) };
    case 'notRunning':
      return { kind: 'notRunning', cost };
    case 'disconnected':
      return { kind: 'disconnected', cost };
    case 'out':
      return { kind: 'out', cost };
  }
}

// ---------------------------------------------------------------------------------------------------------
// The card

/** One player's card as the viewer in `mySeat` sees it. */
export function cardModel(view: GameView, playerId: PlayerId, mySeat: number | null, now: number): CardModel {
  const p = view.players.find((x) => x.id === playerId);
  if (!p) throw new RangeError(`No player ${playerId} in game ${view.gameId}`);
  const isMe = mySeat !== null && p.seat === mySeat;
  const seats = view.players.map((x) => x.seat);
  return {
    playerId: p.id,
    seat: p.seat,
    colorIndex: colorIndexFor(p.seat, mySeat, seats),
    isMe,
    name: p.name,
    isBot: p.isBot,
    rating: p.rating,
    score: p.score,
    mistakes: p.mistakes,
    pips: mistakePips(p.mistakes),
    place: p.place,
    isLeader: p.isLeader,
    presence: p.status === 'abandoned' ? 'left' : p.connected ? 'online' : 'reconnecting',
    out: p.status === 'active' ? null : p.status,
    activity: activityOf(view, p, now),
    hit: p.hitBy && {
      fromId: p.hitBy.fromId,
      kind: p.hitBy.kind,
      secondsLeft: secondsOf(timeLeft(p.hitBy, now)),
      paused: p.hitBy.expiresAt === null,
    },
    interference: isMe ? null : interferenceOf(view, p, now),
    mine: isMe
      ? {
          practice: view.mode !== 'ranked',
          canSurrender: p.status === 'active' && view.status !== 'over' && view.status !== 'waiting',
          reactionReady: view.reactionReadyAt <= now,
        }
      : null,
  };
}

/** Every card, in seat order (spec §6.8: the order never changes, so interference targets never move). */
export function cardModels(view: GameView, mySeat: number | null, now: number): CardModel[] {
  return [...view.players].sort((a, b) => a.seat - b.seat).map((p) => cardModel(view, p.id, mySeat, now));
}

// ---------------------------------------------------------------------------------------------------------
// The lead bar (§9)

export interface LeadSegment {
  playerId: PlayerId;
  colorIndex: number;
  /** Fraction of the bar, 0–1. */
  share: number;
}

export interface LeadModel {
  /** 2 players: mine first (it sits under my card, at the start edge). 3–4: by place, 1st first. */
  segments: LeadSegment[];
  /** Where the tag sits: the end of the first segment, as a fraction of the bar. */
  splitShare: number;
  /** Null on a tie. */
  leader: { playerId: PlayerId; colorIndex: number; name: string | null; gap: number } | null;
}

const SHARE_MIN = tokens.motion.limits.dominanceShareMin;

/**
 * Each score's share of the bar: max(0, score) ÷ the sum, every share at least 6 % (so 2 players stay between
 * 6 % and 94 %); all at zero split evenly (§9.1, D15 allows negative scores).
 */
export function barShares(scores: readonly number[], min: number = SHARE_MIN): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const clamped = scores.map((s) => Math.max(0, s));
  const sum = clamped.reduce((a, b) => a + b, 0);
  let shares = sum > 0 ? clamped.map((s) => s / sum) : clamped.map(() => 1 / n);
  if (min * n >= 1) return scores.map(() => 1 / n);
  // Raise the small ones to the minimum and take it from the others in proportion, until nothing is under it.
  const fixed = new Array<boolean>(n).fill(false);
  for (let round = 0; round < n; round++) {
    const low = shares.map((s, i) => fixed[i] || s < min);
    if (low.every((l, i) => l === fixed[i])) break;
    low.forEach((l, i) => (fixed[i] = l));
    const free = 1 - min * fixed.filter(Boolean).length;
    const restSum = shares.reduce((a, s, i) => (fixed[i] ? a : a + s), 0);
    const restCount = fixed.filter((f) => !f).length;
    shares = shares.map((s, i) => (fixed[i] ? min : restSum > 0 ? (s / restSum) * free : free / restCount));
  }
  return shares;
}

export function leadModel(view: GameView, mySeat: number | null): LeadModel {
  const seats = view.players.map((p) => p.seat);
  const ordered =
    view.players.length === 2
      ? [...view.players].sort((a, b) =>
          mySeat === null ? a.seat - b.seat : (a.seat === mySeat ? 0 : 1) - (b.seat === mySeat ? 0 : 1),
        )
      : [...view.players].sort((a, b) => a.place - b.place || a.seat - b.seat);
  const shares = barShares(ordered.map((p) => p.score));
  const segments = ordered.map((p, i) => ({
    playerId: p.id,
    colorIndex: colorIndexFor(p.seat, mySeat, seats),
    share: shares[i] ?? 0,
  }));

  const leaders = view.players.filter((p) => p.isLeader);
  let leader: LeadModel['leader'] = null;
  const top = leaders.length === 1 ? leaders[0] : undefined;
  if (top) {
    const others = view.players.filter((p) => p.id !== top.id);
    const rivals = others.some((p) => p.status === 'active')
      ? others.filter((p) => p.status === 'active')
      : others;
    const gap = rivals.length ? top.score - Math.max(...rivals.map((p) => p.score)) : 0;
    if (gap > 0) {
      leader = { playerId: top.id, colorIndex: colorIndexFor(top.seat, mySeat, seats), name: top.name, gap };
    }
  }
  return { segments, splitShare: segments[0]?.share ?? 0.5, leader };
}

// ---------------------------------------------------------------------------------------------------------
// My lock strip (§10)

export type LockStripModel =
  | { kind: 'none' }
  | {
      kind: 'locked';
      cell: string;
      cellIndex: CellIndex;
      remainingMs: number;
      totalMs: number;
      secondsLeft: number;
      paused: boolean;
      /** The last 3 seconds of a running lock (motion.md `lock.urgent`); never while it is stopped. */
      urgent: boolean;
    };

export function lockModel(view: GameView, now: number): LockStripModel {
  const me = view.players.find((p) => p.id === view.me);
  if (!me?.lock) return { kind: 'none' };
  const remainingMs = timeLeft(me.lock, now);
  const secondsLeft = secondsOf(remainingMs);
  const paused = me.lock.expiresAt === null;
  return {
    kind: 'locked',
    cell: cellName(me.lock.cell),
    cellIndex: me.lock.cell,
    remainingMs,
    totalMs: view.rules.thinkTimeMs,
    secondsLeft,
    paused,
    urgent: !paused && secondsLeft > 0 && secondsLeft <= tokens.motion.limits.lockUrgentSeconds,
  };
}
