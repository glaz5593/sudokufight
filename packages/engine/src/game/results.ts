import { eloChanges, type RatingChange } from '../rating';
import type { Award, EndReason, GameResult, GameState, PlayerState, PlayerStats, RankEntry } from './types';

/**
 * End of game (spec §6.7, §11.2, §12): ranking, rating changes, awards and per-player numbers.
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
 * others get none. An abandoning player also loses rules.rating.abandonPenalty (the [D32] alternative; 0 by
 * default).
 */
export function ratingChangesFor(state: GameState, ranking: RankEntry[]): RatingChange[] {
  const { mode, players, rules } = state.config;
  if (mode !== 'ranked' || players.length < 2 || players.some((p) => p.rating === undefined)) return [];
  const changes = eloChanges(
    ranking.map((r) => {
      const info = players[r.seat]!;
      return {
        id: r.playerId,
        rating: info.rating!,
        games: info.ratedGames ?? 0,
        place: r.place,
        abandoned: r.status === 'abandoned',
      };
    }),
    rules.rating,
  );
  const penalty = rules.rating.abandonPenalty;
  if (!penalty) return changes;
  return changes.map((c) => {
    if (ranking.find((r) => r.playerId === c.playerId)?.status !== 'abandoned') return c;
    const delta = c.delta - penalty;
    return { ...c, delta, after: c.before + delta };
  });
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
  return {
    reason,
    durationMs: Math.max(0, at - (state.startedAt ?? at)),
    ranking,
    ratingChanges: ratingChangesFor(state, ranking),
    awards: awardsFor(state, ranking),
    stats: statsFor(state),
  };
}
