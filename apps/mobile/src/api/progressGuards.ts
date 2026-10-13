import {
  INTERFERENCE_KINDS,
  type InterferenceKind,
  isGameType,
  type League,
  LEAGUES,
} from '@sudoku-fight/engine';
import {
  isCountryCode,
  type FavoriteInterference,
  type Leaderboard,
  type LeaderboardEntry,
  LEADERBOARD_TABS,
  type LeaderboardTab,
  type MyProgress,
  normalizeAvatarId,
  type PlayerCard,
  type PlayerStats,
  type PracticeResultsResponse,
  type PublicPlayer,
  type RatingSummary,
  type RecentOutcome,
  type RecentResult,
} from '@sudoku-fight/protocol';

/**
 * The progress answers (@sudoku-fight/protocol progress.ts) read from JSON the app can't trust as is: an old
 * cache, a proxy's page, a newer server. Each reader returns the typed value or null. They are lenient where a
 * newer server may say more than this app knows (an avatar it doesn't have yet shows the empty one, an unknown
 * country no flag, an unknown league none) and strict where the screen needs the value (ids, numbers).
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : isNum(v) ? v : undefined);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** An old pack's id (an old cache) as its replacement; one this app doesn't have as the placeholder. */
const avatarOf = (v: unknown): PublicPlayer['avatarId'] => normalizeAvatarId(v);
const countryOf = (v: unknown): PublicPlayer['country'] => (isCountryCode(v) ? v : null);
const leagueOf = (v: unknown): League | null => (LEAGUES.includes(v as League) ? (v as League) : null);

/** Every item `read` accepts; the others are dropped (one bad row must not hide the board). */
function listOf<T>(v: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(read).filter((x): x is T => x !== null);
}

export function readPublicPlayer(v: unknown): PublicPlayer | null {
  if (!isObj(v) || !isStr(v.id) || v.id === '' || !isStr(v.displayName) || !isNum(v.level)) return null;
  return {
    id: v.id,
    displayName: v.displayName,
    avatarId: avatarOf(v.avatarId),
    country: countryOf(v.country),
    league: leagueOf(v.league),
    level: Math.max(1, Math.floor(v.level)),
  };
}

export function readLeaderboardEntry(v: unknown): LeaderboardEntry | null {
  const player = readPublicPlayer(v);
  if (!player || !isObj(v)) return null;
  if (!isNum(v.rank) || !isNum(v.rating) || typeof v.provisional !== 'boolean' || !isNum(v.games))
    return null;
  return { ...player, rank: v.rank, rating: v.rating, provisional: v.provisional, games: v.games };
}

const isTab = (v: unknown): v is LeaderboardTab => LEADERBOARD_TABS.includes(v as LeaderboardTab);
const isTableSize = (v: unknown): v is 2 | 3 | 4 => v === 2 || v === 3 || v === 4;

export function readLeaderboard(v: unknown): Leaderboard | null {
  if (!isObj(v) || !isTab(v.tab)) return null;
  const entries = listOf(v.entries, readLeaderboardEntry);
  if (!entries) return null;
  if (v.ratingKey !== null && !isStr(v.ratingKey)) return null;
  if (v.players !== null && v.players !== undefined && !isTableSize(v.players)) return null;
  if (v.nextCursor !== null && v.nextCursor !== undefined && !isStr(v.nextCursor)) return null;
  const me = v.me === null || v.me === undefined ? null : readLeaderboardEntry(v.me);
  let friends: Leaderboard['friends'] = null;
  if (isObj(v.friends)) {
    const recentOpponents = listOf(v.friends.recentOpponents, readLeaderboardEntry);
    if (!recentOpponents) return null;
    const inviteUrl = isStr(v.friends.inviteUrl) && v.friends.inviteUrl !== '' ? v.friends.inviteUrl : null;
    friends = { recentOpponents, inviteUrl };
  }
  return {
    tab: v.tab,
    ratingKey: v.ratingKey,
    players: isTableSize(v.players) ? v.players : null,
    entries,
    me,
    nextCursor: isStr(v.nextCursor) && v.nextCursor !== '' ? v.nextCursor : null,
    friends,
  };
}

export function readRatingSummary(v: unknown): RatingSummary | null {
  if (!isObj(v) || !isStr(v.key) || !isNum(v.rating) || !isNum(v.peak) || !isNum(v.games)) return null;
  if (typeof v.provisional !== 'boolean') return null;
  const trend = Array.isArray(v.trend) ? v.trend.filter(isNum) : [];
  return { key: v.key, rating: v.rating, peak: v.peak, games: v.games, provisional: v.provisional, trend };
}

const OUTCOMES: readonly RecentOutcome[] = ['win', 'loss', 'tie'];

export function readRecentResult(v: unknown): RecentResult | null {
  if (!isObj(v) || !isStr(v.gameId) || !isGameType(v.gameType)) return null;
  if (!isNum(v.players) || !isNum(v.place) || !isNum(v.score) || !isNum(v.endedAt)) return null;
  if (!OUTCOMES.includes(v.outcome as RecentOutcome)) return null;
  const ratingDelta = numOrNull(v.ratingDelta ?? null);
  if (ratingDelta === undefined) return null;
  return {
    gameId: v.gameId,
    gameType: v.gameType,
    players: v.players,
    place: v.place,
    outcome: v.outcome as RecentOutcome,
    score: v.score,
    ratingDelta,
    endedAt: v.endedAt,
  };
}

export function readPlayerStats(v: unknown): PlayerStats | null {
  if (!isObj(v) || !isNum(v.games) || !isNum(v.wins) || !isNum(v.losses)) return null;
  if (!isNum(v.streak) || !isNum(v.bestStreak)) return null;
  const winRate = numOrNull(v.winRate ?? null);
  const avgMistakes = numOrNull(v.avgMistakes ?? null);
  if (winRate === undefined || avgMistakes === undefined) return null;
  const move = v.bestMove;
  const bestMove =
    isObj(move) && isNum(move.points) && isStr(move.gameId)
      ? { points: move.points, gameId: move.gameId }
      : null;
  return {
    games: v.games,
    wins: v.wins,
    losses: v.losses,
    winRate,
    streak: v.streak,
    bestStreak: v.bestStreak,
    bestMove,
    avgMistakes,
  };
}

/** The favourite interference; null without one, or for a kind this app does not know (a newer server). */
export function readFavoriteInterference(v: unknown): FavoriteInterference | null {
  if (!isObj(v) || !isNum(v.count) || v.count < 1) return null;
  if (!INTERFERENCE_KINDS.includes(v.kind as InterferenceKind)) return null;
  return { kind: v.kind as InterferenceKind, count: Math.floor(v.count) };
}

export function readPlayerCard(v: unknown): PlayerCard | null {
  const player = readPublicPlayer(v);
  if (!player || !isObj(v) || !isNum(v.xp)) return null;
  const ratings = listOf(v.ratings, readRatingSummary);
  const stats = readPlayerStats(v.stats);
  const recent = listOf(v.recent, readRecentResult);
  const achievements = listOf(v.achievements, (a) =>
    isObj(a) && isStr(a.key) && isNum(a.earnedAt) ? { key: a.key, earnedAt: a.earnedAt } : null,
  );
  if (!ratings || !stats || !recent || !achievements) return null;
  return {
    ...player,
    // Lenient: an older server (or a card an older app saved) has neither.
    joinedAt: isNum(v.joinedAt) && v.joinedAt > 0 ? v.joinedAt : null,
    xp: Math.max(0, v.xp),
    ratings,
    stats,
    favoriteInterference: readFavoriteInterference(v.favoriteInterference),
    recent,
    achievements,
  };
}

export function readMyProgress(v: unknown): MyProgress | null {
  if (!isObj(v) || !isNum(v.xp) || !isNum(v.level) || !isNum(v.xpIntoLevel) || !isNum(v.xpForNext))
    return null;
  const leagueRating = numOrNull(v.leagueRating ?? null);
  if (leagueRating === undefined) return null;
  return {
    xp: Math.max(0, v.xp),
    level: Math.max(1, Math.floor(v.level)),
    xpIntoLevel: Math.max(0, v.xpIntoLevel),
    xpForNext: Math.max(1, v.xpForNext),
    league: leagueOf(v.league),
    leagueRating,
  };
}

export function readPracticeResultsResponse(v: unknown): PracticeResultsResponse | null {
  if (!isObj(v) || !isNum(v.accepted) || !isNum(v.duplicates)) return null;
  const progress = readMyProgress(v.progress);
  if (!progress) return null;
  const answer: PracticeResultsResponse = { accepted: v.accepted, duplicates: v.duplicates, progress };
  // The results the server refused as implausible (optional: an older server doesn't say).
  if (isNum(v.rejected)) answer.rejected = v.rejected;
  return answer;
}
