import {
  type AwardKind,
  cellName,
  type Digit,
  evolve,
  formatScoreLine,
  type GameEvent,
  type GameMode,
  type GameResult,
  type GameState,
  type GameType,
  type LeaveGuardReason,
  type PlayerId,
  type PlayerInfo,
  type PlayerStats,
  type PlayerStatus,
  type RatingChange,
  statsFor,
} from '@sudoku-fight/engine';

import { type AvatarIdOrNone, NO_AVATAR_ID, normalizeAvatarId } from '../../avatars';
import { colorIndexFor } from '../../components/player';
import type { PracticeGame, PracticeRepo } from '../../game/practiceRepo';
import type { PracticeSession } from '../../game/session';
import { playerIdentity } from '../game/identity';

/**
 * The basic results of a game (spec §12): a practice alone or against a bot, or a ranked game on the server
 * (work plan stage 7). The final score, the mistakes, the move of the game with its calculation, the time, the
 * correct moves, the average think time, and how it ended; with an opponent also the outcome (win, loss or
 * tie), the opponent's score and mistakes, and the game's awards. Practice never changes a rating (spec §6.6);
 * a ranked game's rating change is the engine's (GameResult.ratingChanges): mine and each opponent's. A game
 * of 3–4 players also gets the full ranking, for the podium (stage 11). Pure: it reads a saved game [D25] (or,
 * when nothing could be saved, or the game was on the server, the session that just ended). Every number comes
 * from the engine (its GameResult, or its own stats over the saved log); nothing is worked out here.
 */

/** How a practice ended: the whole board, "סיום אימון", or the app went away mid-game. */
export type PracticeEnd = 'completed' | 'ended' | 'interrupted';

/**
 * How a ranked game ended other than with a full board (spec §6.6, §6.7, §16.2): I surrendered, or stayed away
 * past the grace; or the (last) opponent to leave surrendered, or left (abandonment: "ניצחת בנטישה").
 */
export type RankedEnd = 'surrendered' | 'abandoned' | 'opponentSurrendered' | 'opponentLeft';

export type GameEnd = PracticeEnd | RankedEnd;

export interface BestMoveModel {
  /** "C3". */
  cell: string;
  digit: Digit;
  points: number;
  /** The engine's calculation: "points = 9 − 4 + (9 − 2) / 2 = 8.5" (spec §6.4, §13.2). */
  line: string;
}

/** My place against the others (spec §6.7): first alone, first with someone, or behind. */
export type Outcome = 'win' | 'loss' | 'tie';

/** An opponent's row (spec §12 "יריבים"). */
export interface OpponentResult {
  playerId: PlayerId;
  /** Null: the screen's word for an unnamed player. */
  name: string | null;
  avatar: AvatarIdOrNone;
  isBot: boolean;
  /** Their colour as this phone shows them (0 is me, so 1–3). */
  colorIndex: number;
  score: number;
  mistakes: number;
  /** Null when the game did not finish. */
  place: number | null;
  /** Surrendered or abandoned. */
  left: boolean;
  /** Their rating change in a ranked game; null when there is none. */
  rating: RatingResult | null;
}

/** A rating change (spec §11.2): before, after, and the difference, as the engine computed them. */
export interface RatingResult {
  before: number;
  after: number;
  delta: number;
  /** Still in the first 10 games of this rating key: K counts double (spec §11.2). */
  provisional: boolean;
}

/** A row of the full ranking of a 3–4 player game (spec §12: a podium and 4th place). */
export interface RankingRow {
  playerId: PlayerId;
  /** Null: the screen's word for an unnamed player ("אני" for me). */
  name: string | null;
  avatar: AvatarIdOrNone;
  isBot: boolean;
  isMe: boolean;
  colorIndex: number;
  place: number;
  score: number;
  mistakes: number;
  left: boolean;
  rating: RatingResult | null;
}

/**
 * My rating change against one opponent of a 3–4 player ranked game (Results-4P: "מחושב מול כל יריב בנפרד"):
 * the engine's GameResult.ratingPairs, in tenths, adding up to my change.
 */
export interface RatingPairRow {
  playerId: PlayerId;
  /** Null: the screen's word for an unnamed player. */
  name: string | null;
  avatar: AvatarIdOrNone;
  isBot: boolean;
  colorIndex: number;
  delta: number;
  /** Why this pair is 0: a leave guard held it (spec §11.2). Null for a pair that moved by place. */
  guard: LeaveGuardReason | null;
}

/**
 * One of my pairs a leave guard held at 0 (spec §11.2), for the caption under the rating change: "מול נינה:
 * הדירוג לא ירד, כי יצאת לפני המהלך הראשון שלך". `name` null: the screen's word for an unnamed player.
 */
export interface RatingGuardRow {
  playerId: PlayerId;
  name: string | null;
  isBot: boolean;
  reason: LeaveGuardReason;
}

/** A game award (spec §12) and who won it; `value` is the engine's (points, mistakes, ms). */
export interface AwardResult {
  kind: AwardKind;
  winners: { playerId: PlayerId; name: string | null; mine: boolean }[];
  value: number;
}

export interface ResultsModel {
  gameId: string;
  mode: GameMode;
  gameType: GameType;
  /** 1 for a solo practice. */
  players: number;
  end: GameEnd;
  /** A win because the opponent did not come back in time (spec §12: the "ניצחת בנטישה" variant). */
  abandonWin: boolean;
  /** My place and what it means, for a game with opponents that finished; null otherwise. */
  outcome: Outcome | null;
  place: number | null;
  /** In seat order. Empty for a solo practice. */
  opponents: OpponentResult[];
  /** Everyone by place, me included: only for a finished game of 3–4 players (the podium). */
  ranking: RankingRow[];
  /** My rating change in a ranked game; null for practice, or a game that moved no rating. */
  rating: RatingResult | null;
  /**
   * My change split by opponent, in the order of the ranking: only for a rated game of 3–4 players (with 2,
   * the one pair is the change itself), and empty for a result stored before the engine had the split.
   */
  ratingPairs: RatingPairRow[];
  /**
   * My pairs a leave guard held at 0 (spec §11.2), for any number of players (with 2 too: the one pair), in
   * the order of the ranking. Empty when no guard held, and for a result stored without ratingPairs.
   */
  ratingGuards: RatingGuardRow[];
  awards: AwardResult[];
  score: number;
  mistakes: number;
  correct: number;
  /** Null when the saved log is too short to tell. */
  durationMs: number | null;
  /** Average think time of the correct moves; null without any. */
  avgThinkMs: number | null;
  bestMove: BestMoveModel | null;
  startedAt: number;
  /** False when the practice database was unavailable and the numbers come from the session itself. */
  saved: boolean;
}

function bestMoveOf(stats: PlayerStats | undefined): BestMoveModel | null {
  const best = stats?.bestMove;
  if (!best) return null;
  return {
    cell: cellName(best.cell),
    digit: best.digit,
    points: best.points,
    line: formatScoreLine(best.breakdown),
  };
}

/** The state a saved log reaches, as far as it replays (a damaged tail is skipped). */
function replay(events: readonly GameEvent[]): GameState | null {
  let state: GameState | null = null;
  for (const e of events) {
    try {
      state = evolve(state, e);
    } catch {
      break;
    }
  }
  return state;
}

/** How the game ended, for me. A practice ends 'ended' whoever gave up; a ranked game says who and how. */
function endOf(mode: GameMode, result: GameResult, myId: PlayerId): GameEnd {
  if (result.reason === 'boardComplete') return 'completed';
  if (mode !== 'ranked') return 'ended';
  const me = result.ranking.find((r) => r.playerId === myId);
  if (me?.status === 'surrendered') return 'surrendered';
  if (me?.status === 'abandoned') return 'abandoned';
  // The last one out ended it: those who left rank behind the players still in, the last to leave first.
  const last = result.ranking
    .filter((r) => r.playerId !== myId && r.status !== 'active')
    .sort((a, b) => a.place - b.place)[0];
  if (last?.status === 'surrendered') return 'opponentSurrendered';
  if (last?.status === 'abandoned') return 'opponentLeft';
  return 'ended';
}

const abandonWinOf = (end: GameEnd, outcome: Outcome | null): boolean =>
  end === 'opponentLeft' && outcome === 'win';

/** A player of the game as its config describes them, with their seat. */
type SeatedPlayer = PlayerInfo & { seat: number };

/** The players of a saved game, from its first event (gameCreated carries the config); null without it. */
function playersOf(events: readonly GameEvent[]): SeatedPlayer[] | null {
  const created = events[0];
  return created?.type === 'gameCreated' ? created.config.players.map((p, seat) => ({ ...p, seat })) : null;
}

/** Where each player ended up, as the rows need it: from the result, or from the state a log reached. */
interface Standing {
  playerId: PlayerId;
  seat: number;
  score: number;
  mistakes: number;
  place: number | null;
  status: PlayerStatus;
}

const standingsOf = (result: GameResult): Standing[] =>
  result.ranking.map((r) => ({
    playerId: r.playerId,
    seat: r.seat,
    score: r.score,
    mistakes: r.mistakes,
    place: r.place,
    status: r.status,
  }));

const standingsOfState = (state: GameState): Standing[] =>
  state.players.map((p) => ({
    playerId: p.id,
    seat: p.seat,
    score: p.score,
    mistakes: p.mistakes,
    place: null,
    status: p.status,
  }));

/** Players' avatars by id, when the game knows them (a ranked match's profiles). */
type AvatarsById = Readonly<Partial<Record<PlayerId, { avatarId?: string | null } | null>>>;

/** The others' rows, my outcome and the awards (spec §12); nothing of it for a solo practice. */
function versusOf(
  myId: PlayerId,
  standings: readonly Standing[],
  infos: readonly SeatedPlayer[] | null,
  result: GameResult | null,
  avatars: AvatarsById | null = null,
): Pick<
  ResultsModel,
  | 'players'
  | 'outcome'
  | 'place'
  | 'opponents'
  | 'awards'
  | 'ranking'
  | 'rating'
  | 'ratingPairs'
  | 'ratingGuards'
> {
  const players = Math.max(1, standings.length, infos?.length ?? 0);
  const mine = standings.find((s) => s.playerId === myId);
  const seats = standings.map((s) => s.seat);
  const info = (id: PlayerId) => infos?.find((p) => p.id === id) ?? { id };
  // A known avatar (a ranked opponent's own) before the default (a bot's by its level, else the empty one).
  const avatarOf = (id: PlayerId, fallback: AvatarIdOrNone): AvatarIdOrNone => {
    const own = normalizeAvatarId(avatars?.[id]?.avatarId);
    return own !== NO_AVATAR_ID ? own : fallback;
  };
  const ratingOf = (id: PlayerId) => ratingResult(result?.ratingChanges.find((c) => c.playerId === id));

  const opponents = standings
    .filter((s) => s.playerId !== myId)
    .sort((a, b) => a.seat - b.seat)
    .map((s): OpponentResult => {
      const who = playerIdentity(info(s.playerId));
      return {
        playerId: s.playerId,
        name: who.name,
        avatar: avatarOf(s.playerId, who.avatar),
        isBot: who.isBot,
        colorIndex: colorIndexFor(s.seat, mine?.seat ?? null, seats),
        score: s.score,
        mistakes: s.mistakes,
        place: s.place,
        left: s.status !== 'active',
        rating: ratingOf(s.playerId),
      };
    });

  const place = players > 1 && result ? (mine?.place ?? null) : null;
  const firsts = result ? result.ranking.filter((r) => r.place === 1).length : 0;
  const outcome: Outcome | null = place === null ? null : place !== 1 ? 'loss' : firsts > 1 ? 'tie' : 'win';
  const awards = (result?.awards ?? []).map((a): AwardResult => ({
    kind: a.kind,
    winners: a.playerIds.map((id) => ({
      playerId: id,
      name: id === myId ? null : playerIdentity(info(id)).name,
      mine: id === myId,
    })),
    value: a.value,
  }));
  // 3–4 players (spec §12): everyone by place, for the podium and the 4th row.
  const ranking =
    result && players >= 3
      ? standings
          .filter((s) => s.place !== null)
          .sort((a, b) => a.place! - b.place! || a.seat - b.seat)
          .map((s): RankingRow => {
            const who = playerIdentity(info(s.playerId));
            return {
              playerId: s.playerId,
              name: s.playerId === myId ? null : who.name,
              avatar: avatarOf(s.playerId, who.avatar),
              isBot: who.isBot,
              isMe: s.playerId === myId,
              colorIndex: colorIndexFor(s.seat, mine?.seat ?? null, seats),
              place: s.place!,
              score: s.score,
              mistakes: s.mistakes,
              left: s.status !== 'active',
              rating: ratingOf(s.playerId),
            };
          })
      : [];
  const seatOf = (id: PlayerId) => standings.find((s) => s.playerId === id)?.seat ?? null;
  const allMyPairs = result?.ratingPairs?.find((p) => p.playerId === myId)?.pairs ?? [];
  const ratingPairs = (players >= 3 ? allMyPairs : []).map((pair): RatingPairRow => {
    const who = playerIdentity(info(pair.opponentId));
    const seat = seatOf(pair.opponentId);
    return {
      playerId: pair.opponentId,
      name: who.name,
      avatar: avatarOf(pair.opponentId, who.avatar),
      isBot: who.isBot,
      colorIndex: seat === null ? 1 : colorIndexFor(seat, mine?.seat ?? null, seats),
      delta: pair.delta,
      guard: pair.guard ?? null,
    };
  });
  // Any number of players: with 2 the pair rows are not shown, but a guarded 0 still needs its reason.
  const ratingGuards = allMyPairs.flatMap((pair): RatingGuardRow[] => {
    if (!pair.guard) return [];
    const who = playerIdentity(info(pair.opponentId));
    return [{ playerId: pair.opponentId, name: who.name, isBot: who.isBot, reason: pair.guard }];
  });
  return {
    players,
    outcome,
    place,
    opponents,
    awards,
    ranking,
    rating: ratingOf(myId),
    ratingPairs,
    ratingGuards,
  };
}

function ratingResult(change: RatingChange | undefined): RatingResult | null {
  if (!change) return null;
  return {
    before: change.before,
    after: change.after,
    delta: change.delta,
    provisional: change.provisional,
  };
}

/**
 * The results of a saved practice. A finished game has the engine's GameResult. An interrupted one (or one
 * still marked playing) has only its row, so its best move and think time come from replaying its saved log
 * through the engine. The log's first event also names the players of a game with opponents.
 */
export function resultsModel(game: PracticeGame, events: readonly GameEvent[] = []): ResultsModel {
  const base = {
    gameId: game.id,
    mode: game.mode,
    gameType: game.gameType,
    startedAt: game.startedAt,
    saved: true,
  };
  const result = game.result;
  const infos = playersOf(events);
  if (result) {
    const me = result.ranking.find((r) => r.playerId === game.playerId);
    const stats = result.stats.find((s) => s.playerId === game.playerId);
    const versus = versusOf(game.playerId, standingsOf(result), infos, result);
    const end = endOf(game.mode, result, game.playerId);
    return {
      ...base,
      ...versus,
      end,
      abandonWin: abandonWinOf(end, versus.outcome),
      score: me?.score ?? game.score ?? 0,
      mistakes: me?.mistakes ?? game.mistakes ?? 0,
      correct: me?.correct ?? game.correct ?? 0,
      durationMs: result.durationMs,
      avgThinkMs: stats?.avgThinkMs ?? null,
      bestMove: bestMoveOf(stats),
    };
  }
  const state = replay(events);
  const player = state?.players.find((p) => p.id === game.playerId);
  const stats = state ? statsFor(state).find((s) => s.playerId === game.playerId) : undefined;
  const replayedMs = state ? Math.max(0, state.lastEventAt - (state.startedAt ?? state.createdAt)) : null;
  return {
    ...base,
    ...versusOf(game.playerId, state ? standingsOfState(state) : [], infos, null),
    end: 'interrupted',
    abandonWin: false,
    score: game.score ?? player?.score ?? 0,
    mistakes: game.mistakes ?? player?.mistakes ?? 0,
    correct: game.correct ?? player?.correct ?? 0,
    durationMs: game.durationMs ?? replayedMs,
    avgThinkMs: stats?.avgThinkMs ?? null,
    bestMove: bestMoveOf(stats),
  };
}

/**
 * What the results need of a session that just ended: a practice's, or an online game's (OnlineSession, whose
 * `profiles` give a ranked match's opponents their own avatars).
 */
export type ResultsSession = Pick<PracticeSession, 'id' | 'mode' | 'gameType' | 'playerId' | 'getView'> & {
  readonly profiles?: AvatarsById | null;
};

/**
 * The results of a session that just ended: a practice that could not be saved, or a ranked game (the server
 * keeps it; the phone has its final state). Null while it still runs.
 */
export function sessionResultsModel(session: ResultsSession): ResultsModel | null {
  const view = session.getView();
  const result = view.result;
  if (view.status !== 'over' || !result) return null;
  const me = result.ranking.find((r) => r.playerId === session.playerId);
  const stats = result.stats.find((s) => s.playerId === session.playerId);
  const infos = view.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    ...(p.name === null ? null : { name: p.name }),
    isBot: p.isBot,
  }));
  const versus = versusOf(session.playerId, standingsOf(result), infos, result, session.profiles ?? null);
  const end = endOf(session.mode, result, session.playerId);
  return {
    gameId: session.id,
    mode: session.mode,
    gameType: session.gameType,
    ...versus,
    end,
    abandonWin: abandonWinOf(end, versus.outcome),
    score: me?.score ?? 0,
    mistakes: me?.mistakes ?? 0,
    correct: me?.correct ?? 0,
    durationMs: result.durationMs,
    avgThinkMs: stats?.avgThinkMs ?? null,
    bestMove: bestMoveOf(stats),
    startedAt: view.startedAt ?? 0,
    saved: false,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Loading

/**
 * The results of an online game (work plan stage 7): from the game store's online session, which holds the
 * final state the server sent (nothing is saved on the phone; stage 9 keeps ranked games on the server).
 * Missing when the session is another game's, is gone (the app restarted), or has no result.
 */
export function loadOnlineResults(id: string, session: ResultsSession | null): ResultsLoad {
  let model: ResultsModel | null = null;
  try {
    model = session && session.id === id ? sessionResultsModel(session) : null;
  } catch {
    model = null; // no game in the session
  }
  return model ? { kind: 'found', model } : { kind: 'missing' };
}

export type ResultsLoad =
  | { kind: 'found'; model: ResultsModel }
  /** No such game on this phone. */
  | { kind: 'missing' }
  /** The practice database could not be read. */
  | { kind: 'unavailable' };

export interface ResultsSource {
  /** The practice database, or null when it can't open. */
  repo(): Promise<PracticeRepo | null>;
  /** The session in the game store, if any: the game that just ended, still being written. */
  session(): PracticeSession | null;
}

/**
 * Reads a practice's results from the phone [D25]: after an app restart too, since it reads the database. A
 * game that just ended may still be on its way to the disk, so its session's writes are awaited first.
 */
export async function loadPracticeResults(id: string, source: ResultsSource): Promise<ResultsLoad> {
  const current = source.session();
  const live = current?.id === id ? current : null;
  try {
    if (live) await live.flush();
    const repo = await source.repo();
    if (repo) {
      const game = await repo.getGame(id);
      if (game) {
        // A finished game's numbers are in its row. Its log is read for an unfinished one (to replay it), and
        // for a game with opponents (their names are in its first event).
        const events = game.result && game.mode === 'solo' ? [] : await repo.loadEvents(id);
        return { kind: 'found', model: resultsModel(game, events) };
      }
    }
    const unsaved = live ? sessionResultsModel(live) : null;
    if (unsaved) return { kind: 'found', model: unsaved };
    return repo ? { kind: 'missing' } : { kind: 'unavailable' };
  } catch (error) {
    console.warn('[practice] could not read the results', error);
    const unsaved = live ? sessionResultsModel(live) : null;
    return unsaved ? { kind: 'found', model: unsaved } : { kind: 'unavailable' };
  }
}
