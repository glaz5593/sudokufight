import {
  eloChanges,
  type EloPlayer,
  eloPairs,
  type PairGuard,
  type RatingChange,
  type RatingPairs,
} from '../rating';
import { levelResultOf } from './level';
import { playedMs } from './played';
import type {
  Award,
  EndReason,
  GameResult,
  GameState,
  LeaveStanding,
  PlayerId,
  PlayerState,
  PlayerStats,
  RankEntry,
} from './types';

/**
 * End of game (spec §6.7, §11.2, §12): ranking, rating changes (with the leave guards), awards and per-player
 * numbers.
 */

/**
 * Players still in the game, by score; equal scores by the tie-break [D16], and still equal means a shared
 * place. Then everyone who left: the later they went out, the higher; for an abandonment the moment of leaving
 * is the end of the grace period (spec §6.7). With [D36] 'byScore' whoever surrendered stays in the table
 * by score (abandonment still ranks last).
 */
export function rankPlayers(state: GameState): RankEntry[] {
  const rules = state.config.rules;
  const key = (p: PlayerState): number =>
    rules.tieBreak === 'fewerMistakes' ? p.mistakes : (p.lastCorrectAt ?? Number.MAX_SAFE_INTEGER);
  // [D36] is about 3–4 players; with 2, a surrender is always a loss (spec §6.6).
  const byScore = rules.surrenderRanking === 'byScore' && state.players.length >= 3;
  const ranked = (p: PlayerState) => p.status === 'active' || (p.status === 'surrendered' && byScore);
  const inGame = state.players
    .filter(ranked)
    .sort((a, b) => b.score - a.score || key(a) - key(b) || a.seat - b.seat);
  const out = state.players.filter((p) => !ranked(p)).sort((a, b) => (b.outOrder ?? 0) - (a.outOrder ?? 0));

  const entry = (p: PlayerState, place: number): RankEntry => ({
    playerId: p.id,
    seat: p.seat,
    place,
    score: p.score,
    mistakes: p.mistakes,
    correct: p.correct,
    status: p.status,
  });
  const ranking: RankEntry[] = [];
  inGame.forEach((p, k) => {
    const prev = inGame[k - 1];
    const tied = prev && prev.score === p.score && key(prev) === key(p);
    ranking.push(entry(p, tied ? ranking[k - 1]!.place : k + 1));
  });
  out.forEach((p, k) => ranking.push(entry(p, inGame.length + k + 1)));
  return ranking;
}

/**
 * Ranked games where every player came with a rating get Elo changes by place (spec §11.2) [D31, D32, D8];
 * others get none. A surrender or an abandonment is a normal loss and a full win for whoever stays, except in
 * a pair a leave guard holds (leaveGuardsFor). An abandoning player also loses rules.rating.abandonPenalty
 * (the [D32] alternative; 0 by default), unless guard (a) held him harmless against everyone (penaltyFor).
 */
export function ratingChangesFor(state: GameState, ranking: RankEntry[]): RatingChange[] {
  const guards = leaveGuardsFor(state);
  const input = eloInput(state, ranking, guards);
  if (!input) return [];
  return eloChanges(input, state.config.rules.rating).map((c) => {
    const penalty = penaltyFor(state, c.playerId, guards);
    if (!penalty) return c;
    const delta = c.delta - penalty;
    return { ...c, delta, after: c.before + delta };
  });
}

/** The Elo input of a game whose rating moves (ranked, every player with a rating), by place; else null. */
function eloInput(
  state: GameState,
  ranking: RankEntry[],
  guards: ReadonlyMap<PlayerId, PairGuard[]>,
): EloPlayer[] | null {
  const { mode, players } = state.config;
  if (mode !== 'ranked' || players.length < 2 || players.some((p) => p.rating === undefined)) return null;
  return ranking.map((r) => {
    const info = players[r.seat]!;
    const mine = guards.get(r.playerId);
    return {
      id: r.playerId,
      rating: info.rating!,
      games: info.ratedGames ?? 0,
      place: r.place,
      abandoned: r.status === 'abandoned',
      ...(mine?.length ? { guards: mine } : null),
    };
  });
}

/**
 * Each player's rating change of ratingChangesFor, split by opponent (Results-4P: "מחושב מול כל יריב
 * בנפרד"): the rating module's eloPairs over the same input, plus an abandoning player's penalty, so that a
 * player's Σ pairs − penalty is their RatingChange delta. A pair a leave guard held is 0 and carries the
 * guard's reason. Empty when ratingChangesFor is.
 */
export function ratingPairsFor(state: GameState, ranking: RankEntry[]): RatingPairs[] {
  const guards = leaveGuardsFor(state);
  const input = eloInput(state, ranking, guards);
  if (!input) return [];
  return eloPairs(input, state.config.rules.rating).map((p) => {
    const penalty = penaltyFor(state, p.playerId, guards);
    return penalty ? { ...p, penalty } : p;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Leave guards (spec §11.2; [D32] and [D8] as amended by Moshe, 2026-10-15)

/**
 * Guard (a), for the player who left: he loses nothing to `stayer` if he had not placed a digit yet, or if
 * `stayer` was not ahead of him (equal scores included). Both standings are taken at the moment he left.
 */
export function leaverGuardReason(
  leaver: LeaveStanding,
  stayer: LeaveStanding,
): 'leftBeforeMoving' | 'leftNotBehind' | null {
  if (leaver[1] === 0) return 'leftBeforeMoving';
  if (stayer[0] <= leaver[0]) return 'leftNotBehind';
  return null;
}

/**
 * Guard (b), for the player who stayed: he gains nothing from `leaver` if he himself had not placed a digit
 * yet, or if `leaver` was ahead of him. Both standings are taken at the moment `leaver` left.
 */
export function stayerGuardReason(
  stayer: LeaveStanding,
  leaver: LeaveStanding,
): 'opponentLeftBeforeMyMove' | 'opponentLeftAhead' | null {
  if (stayer[1] === 0) return 'opponentLeftBeforeMyMove';
  if (leaver[0] > stayer[0]) return 'opponentLeftAhead';
  return null;
}

/** Out of the game (surrendered or abandoned) in the order of leaving; null while still in it. */
const outAt = (p: PlayerState): number | null => (p.status === 'active' ? null : (p.outOrder ?? 0));

/**
 * Every pair with at least one player out of the game, judged at the moment the first of the two left (the
 * leaver of the pair; the other one is its stayer, even if he left later): guard (a) for the leaver and guard
 * (b) for the stayer, each when its rules.rating switch is on and its condition held then. By player id, the
 * guards on that player's pairs. A pair whose leaver has no standings (a state from an older engine) gets none.
 */
export function leaveGuardsFor(state: GameState): Map<PlayerId, PairGuard[]> {
  const { leaverGuard, stayerGuard } = state.config.rules.rating;
  const guards = new Map<PlayerId, PairGuard[]>();
  const add = (id: PlayerId, guard: PairGuard) => guards.set(id, [...(guards.get(id) ?? []), guard]);
  const players = state.players;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const outA = outAt(a);
      const outB = outAt(b);
      if (outA === null && outB === null) continue;
      const [leaver, stayer] = outB === null || (outA !== null && outA < outB) ? [a, b] : [b, a];
      const standings = leaver.leaveStandings;
      const mine = standings?.[leaver.seat];
      const theirs = standings?.[stayer.seat];
      if (!mine || !theirs) continue;
      const a1 = leaverGuard ? leaverGuardReason(mine, theirs) : null;
      if (a1) add(leaver.id, { opponentId: stayer.id, kind: 'noLoss', reason: a1 });
      const b1 = stayerGuard ? stayerGuardReason(theirs, mine) : null;
      if (b1) add(stayer.id, { opponentId: leaver.id, kind: 'noGain', reason: b1 });
    }
  }
  return guards;
}

/**
 * rules.rating.abandonPenalty for a player who abandoned, unless guard (a) held him harmless against every
 * opponent still in the game when he left (the pairs judged at his own leaving); else 0. Surrenders never pay.
 */
function penaltyFor(
  state: GameState,
  playerId: PlayerId,
  guards: ReadonlyMap<PlayerId, PairGuard[]>,
): number {
  const penalty = state.config.rules.rating.abandonPenalty;
  const me = state.players.find((p) => p.id === playerId);
  if (!penalty || me?.status !== 'abandoned') return 0;
  const myOut = outAt(me) ?? 0;
  const stillIn = state.players.filter((p) => p !== me && (outAt(p) ?? Infinity) > myOut);
  const harmless = new Set(
    (guards.get(playerId) ?? []).filter((g) => g.kind === 'noLoss').map((g) => g.opponentId),
  );
  return stillIn.length > 0 && stillIn.every((p) => harmless.has(p.id)) ? 0 : penalty;
}

export function statsFor(state: GameState): PlayerStats[] {
  return state.players.map((p) => ({
    playerId: p.id,
    correct: p.correct,
    mistakes: p.mistakes,
    pointsGained: p.pointsGained,
    interferencesSent: p.interferencesSent,
    bestMove: p.bestMove,
    avgThinkMs: p.correct ? Math.round(p.thinkMsTotal / p.correct) : null,
  }));
}

/** Everyone tied at the best value of `value` among `players` (lower is better when `low`). */
function best(players: PlayerState[], value: (p: PlayerState) => number, low = false): PlayerState[] {
  if (!players.length) return [];
  const target = low ? Math.min(...players.map(value)) : Math.max(...players.map(value));
  return players.filter((p) => value(p) === target);
}

export const FASTEST_MIN_MOVES = 5;
export const COMEBACK_DEFICIT = 15;

/**
 * Game awards (spec §12); only for games with opponents. "Fewest mistakes" and "fastest" go only to players
 * who were still in the game at the end, so leaving early never wins them.
 */
export function awardsFor(state: GameState, ranking: RankEntry[]): Award[] {
  const players = state.players;
  const stayed = players.filter((p) => p.status === 'active');
  if (players.length < 2) return [];
  const awards: Award[] = [];
  const add = (kind: Award['kind'], winners: PlayerState[], value: number) => {
    if (winners.length) awards.push({ kind, playerIds: winners.map((p) => p.id), value });
  };

  // The best move: the highest score of a single move.
  const movers = players.filter((p) => p.bestMove);
  const bestMove = best(movers, (p) => p.bestMove!.points);
  add('bestMove', bestMove, bestMove[0]?.bestMove?.points ?? 0);

  // Fewest mistakes; equal → the higher score.
  const fewest = best(
    best(stayed, (p) => p.mistakes, true),
    (p) => p.score,
  );
  add('fewestMistakes', fewest, fewest[0]?.mistakes ?? 0);

  // Fastest: the lowest average think time of correct moves, with at least 5 of them.
  const avg = (p: PlayerState) => p.thinkMsTotal / p.correct;
  const fastest = best(
    stayed.filter((p) => p.correct >= FASTEST_MIN_MOVES),
    avg,
    true,
  );
  add('fastest', fastest, fastest[0] ? Math.round(avg(fastest[0])) : 0);

  // Comeback: won after trailing by 15 or more at some point.
  const winners = ranking.filter((r) => r.place === 1 && r.status === 'active').map((r) => players[r.seat]!);
  const comeback = winners.filter((p) => p.maxDeficit >= COMEBACK_DEFICIT);
  add('comeback', comeback, Math.max(0, ...comeback.map((p) => p.maxDeficit)));

  // Most points: the highest sum of correct moves, before penalties.
  const most = best(
    players.filter((p) => p.pointsGained > 0),
    (p) => p.pointsGained,
  );
  add('mostPoints', most, most[0]?.pointsGained ?? 0);
  return awards;
}

export function gameResult(state: GameState, reason: EndReason, at: number): GameResult {
  const ranking = rankPlayers(state);
  const ratingChanges = ratingChangesFor(state, ranking);
  return {
    reason,
    // The time played: the phone's own freezes left out [D65] (played.ts); a disconnect's counts.
    durationMs: playedMs(state, at),
    ranking,
    ratingChanges,
    // Only when a rating moved, so a practice's result keeps its shape.
    ...(ratingChanges.length > 0 ? { ratingPairs: ratingPairsFor(state, ranking) } : null),
    awards: awardsFor(state, ranking),
    stats: statsFor(state),
    // Only in a level's game, so every other result keeps its shape.
    ...(state.config.level ? { level: levelResultOf(state, reason, at) } : null),
  };
}
