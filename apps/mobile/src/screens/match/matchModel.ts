import type { GameType, PlayerId } from '@sudoku-fight/engine';
import { COUNTDOWN_STEP_MS, MATCH_RANGE, parseQueueKey, type QueueKey } from '@sudoku-fight/protocol';

import { type AvatarIdOrNone, normalizeAvatarId } from '../../avatars';
import type { MatchmakingFailureCode, MatchmakingInfo } from '../../net/matchmaking';

/**
 * What the match screens show (work plan stage 9, spec §10; Match-Search, Match-Found, Match-Countdown,
 * Match-Timeout), as a pure function of the search (net/matchmaking.ts) and the time. No rules here: the
 * server matches, ranges and counts down; this only says which screen, and with what.
 *
 * - search: connecting, then searching: the search time, my rating, the range (rating ± range, as the server
 *   widens it; "keep searching" lifts the cap), the empty seats, and a line when a match fell through.
 *   `alone`: the server says nobody (not enough players, at a table of 3–4) this player could meet is
 *   searching now (`nextRange` null): the screen says so instead of the range, and offers a bot meanwhile.
 *   Never while connecting, nor with an older server that does not say.
 * - found: the VS: every player (me in P1's colour and ●, the others ▲ ■ ◆ in seat order), ready or still
 *   connecting (D37: connected = ready), whether we met lately.
 * - countdown: 3 · 2 · 1 · GO at the server's time; after GO "GO!" holds until the board is here.
 * - timeout: how long it searched and in what range (spec §10: keep searching, a bot, home); `alone` when
 *   nobody else was searching at all.
 * - failed / cancelled / play: an error to show, a screen to leave, the game to open.
 */

export interface MatchHeader {
  gameType: GameType;
  players: number;
}

export interface RatingRange {
  low: number;
  high: number;
  /** Half-width: ratings within rating ± half. */
  half: number;
  /** "Keep searching": no cap. */
  extended: boolean;
  /** 0–1: how far the range has widened toward its cap (the bar's dashed ends). */
  widened: number;
}

/** A player at the table, as the VS and the countdown show them. */
export interface SeatModel {
  id: PlayerId;
  name: string;
  avatarId: AvatarIdOrNone;
  country: string | null;
  rating: number;
  provisional: boolean;
  isMe: boolean;
  /** The palette on this phone: me 0 (P1, ●), the others 1–3 in seat order. */
  colorIndex: number;
  ready: boolean;
}

/** Me while searching: the account's look, and the rating once the server said. */
export interface SelfModel {
  name: string | null;
  avatarId: AvatarIdOrNone;
  rating: number | null;
}

export type CountdownStep = 3 | 2 | 1 | 'go';

export type MatchScreenModel =
  | {
      kind: 'search';
      header: MatchHeader;
      /** Getting into the queue: no rating or range yet. */
      connecting: boolean;
      elapsedMs: number;
      me: SelfModel;
      range: RatingRange | null;
      /** Opponents still to find (1 in a 2-player queue). */
      openSeats: number;
      /** Back at the head of the queue after a match fell through. */
      requeued: boolean;
      /** Nobody else to meet is searching now (the server's nextRange is null). */
      alone: boolean;
    }
  | {
      kind: 'timeout';
      header: MatchHeader;
      elapsedMs: number;
      range: RatingRange | null;
      /** Nobody else to meet was searching at the timeout. */
      alone: boolean;
    }
  | {
      kind: 'found';
      header: MatchHeader;
      seats: SeatModel[];
      readyCount: number;
      allReady: boolean;
      rematch: boolean;
    }
  | {
      kind: 'countdown';
      header: MatchHeader;
      seats: SeatModel[];
      step: CountdownStep;
      /** Until GO (0 after it). */
      remainingMs: number;
    }
  | { kind: 'failed'; header: MatchHeader; code: MatchmakingFailureCode; supportCode: string }
  | { kind: 'cancelled' }
  /** The board is here: open the game. */
  | { kind: 'play' };

export function headerOf(queueKey: QueueKey): MatchHeader {
  const spec = parseQueueKey(queueKey);
  return { gameType: spec?.gameType ?? 'normal', players: spec?.players ?? 2 };
}

/** rating ± half, and how far it has widened toward the cap. */
export function rangeOf(rating: number, half: number, extended: boolean): RatingRange {
  const span = MATCH_RANGE.cap - MATCH_RANGE.initial;
  const widened = extended ? 1 : Math.min(1, Math.max(0, (half - MATCH_RANGE.initial) / span));
  return { low: rating - half, high: rating + half, half, extended, widened };
}

/** The seats in seat order, me in P1's colour and the others after it. */
export function seatsOf(info: MatchmakingInfo): SeatModel[] {
  const match = info.match;
  if (!match) return [];
  let next = 1;
  return match.players.map((p) => {
    const isMe = p.id === match.me;
    return {
      id: p.id,
      name: p.name,
      avatarId: normalizeAvatarId(p.avatarId),
      country: p.country,
      rating: p.rating,
      provisional: p.provisional,
      isMe,
      colorIndex: isMe ? 0 : next++,
      ready: match.ready.includes(p.id),
    };
  });
}

/** 3 · 2 · 1 by the second, then GO at `goAt`. */
export function countdownStep(remainingMs: number): CountdownStep {
  if (remainingMs <= 0) return 'go';
  const step = Math.ceil(remainingMs / COUNTDOWN_STEP_MS);
  return step >= 3 ? 3 : step === 2 ? 2 : 1;
}

/** m:ss, for the search time ("0:14", "1:00"). */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function matchScreenModel(
  info: MatchmakingInfo,
  self: Omit<SelfModel, 'rating'>,
  now: number,
): MatchScreenModel {
  const header = headerOf(info.queueKey);
  switch (info.phase) {
    case 'connecting':
    case 'searching': {
      const search = info.search;
      return {
        kind: 'search',
        header,
        connecting: search === null,
        elapsedMs: search ? Math.max(0, now - search.startedAt) : 0,
        me: { ...self, rating: search?.rating ?? null },
        range: search ? rangeOf(search.rating, search.range, search.extended) : null,
        openSeats: Math.max(1, header.players - 1),
        requeued: info.fellThrough !== null || (search?.requeued ?? false),
        alone: search !== null && search.nextRange === null,
      };
    }
    case 'timeout': {
      const t = info.timeout;
      const rating = info.search?.rating;
      return {
        kind: 'timeout',
        header,
        elapsedMs: t?.elapsedMs ?? 0,
        range: t && rating !== undefined ? rangeOf(rating, t.range, t.extended) : null,
        alone: t?.nextRange === null,
      };
    }
    case 'found': {
      if (info.hasGame) return { kind: 'play' };
      const seats = seatsOf(info);
      const readyCount = seats.filter((s) => s.ready).length;
      return {
        kind: 'found',
        header,
        seats,
        readyCount,
        allReady: seats.length > 0 && readyCount === seats.length,
        rematch: info.match?.rematch ?? false,
      };
    }
    case 'countdown':
    case 'started': {
      if (info.hasGame) return { kind: 'play' };
      const goAt = info.match?.goAt ?? null;
      const remainingMs = info.phase === 'started' || goAt === null ? 0 : Math.max(0, goAt - now);
      // Ready by now, whatever the last `ready` said: the countdown starts only when everyone is in.
      const seats = seatsOf(info).map((s) => ({ ...s, ready: true }));
      return { kind: 'countdown', header, seats, step: countdownStep(remainingMs), remainingMs };
    }
    case 'failed':
      return {
        kind: 'failed',
        header,
        code: info.error?.code ?? 'unknown',
        supportCode: info.error?.supportCode ?? 'unknown',
      };
    case 'cancelled':
      return { kind: 'cancelled' };
  }
}
