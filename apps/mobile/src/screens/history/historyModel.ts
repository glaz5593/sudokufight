import type { GameMode, GameResult, GameType, PlayerId } from '@sudoku-fight/engine';
import { HISTORY_PAGE_SIZE, type HistoryGame } from '@sudoku-fight/protocol';

import { type AvatarId, EMPTY_AVATAR } from '../../assets/avatars';
import { colorIndexFor } from '../../components/player';
import type { PracticeGameRecord } from '../../game/practiceRepo';
import { playerIdentity } from '../game/identity';

/**
 * The history screen's cards (spec §14.1), from the two places games live: ranked games on the server
 * (protocol HistoryGame) and practices on the phone [D25] (the practice database's rows). Pure: places,
 * scores and rating changes are the engine's, as the server or the saved game keep them; this only picks
 * and orders them. Every card opens the game's replay.
 */

export type HistoryFilter = 'all' | 'ranked' | 'practice';
export const HISTORY_FILTERS: readonly HistoryFilter[] = ['all', 'ranked', 'practice'];

/** The result stripe: a game with opponents ends in a win, a loss or a tie; a solo practice in how it ended. */
export type HistoryOutcome = 'win' | 'loss' | 'tie' | 'completed' | 'ended' | 'interrupted';

export interface HistoryOpponent {
  id: PlayerId;
  /** Null: the screen's word for an unnamed (or deleted) player. */
  name: string | null;
  avatar: AvatarId;
  isBot: boolean;
  country: string | null;
  /** As this phone shows them: 1–3 (0 is me). */
  colorIndex: number;
}

export interface HistoryEntry {
  id: string;
  /** Where it lives, and where its replay comes from. */
  source: 'ranked' | 'practice';
  mode: GameMode;
  gameType: GameType;
  startedAt: number;
  outcome: HistoryOutcome;
  /** My place among the players (spec §6.7); null for a solo practice or a game that did not finish. */
  place: number | null;
  playerCount: number;
  /** In seat order. */
  opponents: HistoryOpponent[];
  myScore: number | null;
  /** With one opponent: their score, for "84.5 : 62". */
  opponentScore: number | null;
  /** A ranked game's rating change for me; null when it moved none (and for practice, spec §6.6). */
  ratingDelta: number | null;
}

const outcomeOfPlace = (place: number | null, players: readonly { place: number | null }[]) =>
  place === null
    ? null
    : place !== 1
      ? 'loss'
      : players.filter((p) => p.place === 1).length > 1
        ? 'tie'
        : 'win';

/** A ranked game from the server, as its card shows it. */
export function rankedEntry(game: HistoryGame): HistoryEntry {
  const me = game.players.find((p) => p.seat === game.mySeat);
  const seats = game.players.map((p) => p.seat);
  const others = game.players.filter((p) => p.seat !== game.mySeat);
  const place = me?.place ?? null;
  return {
    id: game.id,
    source: 'ranked',
    mode: game.mode,
    gameType: game.gameType,
    startedAt: game.startedAt,
    outcome: outcomeOfPlace(place, game.players) ?? 'interrupted',
    place,
    playerCount: game.playerCount,
    opponents: others.map((p) => ({
      id: p.userId ?? `seat-${p.seat}`,
      name: p.displayName,
      avatar: p.avatarId ?? EMPTY_AVATAR,
      isBot: p.userId === null,
      country: p.country,
      colorIndex: colorIndexFor(p.seat, game.mySeat, seats),
    })),
    myScore: me?.score ?? null,
    opponentScore: others.length === 1 ? (others[0]!.score ?? null) : null,
    ratingDelta:
      me?.ratingBefore != null && me.ratingAfter != null
        ? Math.round(me.ratingAfter - me.ratingBefore)
        : null,
  };
}

/**
 * A practice saved on the phone. `result` (the saved GameResult, when the game finished) gives the bot's
 * score for the card; without it the card shows mine only.
 */
export function practiceEntry(record: PracticeGameRecord, result: GameResult | null = null): HistoryEntry {
  const seats = [0, ...record.opponents.map((_, k) => k + 1)];
  const outcome: HistoryOutcome =
    record.status !== 'finished'
      ? 'interrupted'
      : (record.outcome ?? (record.endReason === 'boardComplete' ? 'completed' : 'ended'));
  const theirs =
    result && record.opponents.length === 1
      ? (result.ranking.find((r) => r.playerId === record.opponents[0]!.id)?.score ?? null)
      : null;
  return {
    id: record.id,
    source: 'practice',
    mode: record.mode,
    gameType: record.gameType,
    startedAt: record.startedAt,
    outcome,
    place: record.place,
    playerCount: 1 + record.opponents.length,
    opponents: record.opponents.map((o, k) => {
      const who = playerIdentity(o);
      return {
        id: o.id,
        name: who.name,
        avatar: who.avatar,
        isBot: who.isBot,
        country: null,
        colorIndex: colorIndexFor(seats[k + 1]!, 0, seats),
      };
    }),
    myScore: record.score,
    opponentScore: theirs,
    ratingDelta: null,
  };
}

const inFilter = (filter: HistoryFilter, e: HistoryEntry): boolean =>
  filter === 'all' || (filter === 'ranked') === (e.source === 'ranked');

/** Both lists, newest first (equal times: ranked first, then by id), in the filter, the first `count`. */
export function mergeEntries(
  ranked: readonly HistoryEntry[],
  practice: readonly HistoryEntry[],
  filter: HistoryFilter,
  count: number,
): HistoryEntry[] {
  return [...ranked, ...practice]
    .filter((e) => inFilter(filter, e))
    .sort(
      (a, b) =>
        b.startedAt - a.startedAt ||
        (a.source === b.source ? 0 : a.source === 'ranked' ? -1 : 1) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    )
    .slice(0, count);
}

/** "היום", "אתמול", or the date ("6 באוק׳"), in the phone's time zone. */
export function dayOf(at: number, now: number): 'today' | 'yesterday' | null {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : null;
}

export function shortDate(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

export const PAGE_SIZE = HISTORY_PAGE_SIZE;
