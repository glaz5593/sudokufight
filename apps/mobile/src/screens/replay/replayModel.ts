import {
  type CellIndex,
  cellName,
  type Digit,
  evolve,
  explain,
  type Explanation,
  formatExplanation,
  formatScoreLine,
  formatWrong,
  type GameEvent,
  type GameMode,
  type GameResult,
  type GameState,
  type GameType,
  type GameView,
  type Grid,
  type InterferenceKind,
  type Lang,
  missedPoints,
  type MoveScore,
  parseGrid,
  type PlayerId,
  rankPlayers,
  type ReleaseReason,
  replay as replayStates,
  type ScoreY,
  type Technique,
  techniqueName,
  toView,
  whyWrong,
} from '@sudoku-fight/engine';

import { type AvatarIdOrNone } from '../../avatars';
import { colorIndexFor } from '../../components/player';
import { playerIdentity } from '../game/identity';

/**
 * The replay of a game (spec §13; work plan stage 11), from its event log: the steps, the state before and
 * after each (rebuilt by the engine's replay()), what to draw, an explanation for every player at every step,
 * the timeline and the key moments. Pure: no React, no clock; every rule and every explanation is the
 * engine's (replay, rankPlayers, toView, explain, whyWrong, formatScoreLine). The log is a practice's from the
 * phone [D25] or a ranked game's from the server (both with the solution once the game is over, spec §21).
 *
 * Steps (spec §13.1, "שלב אחד הוא פעולה אחת"; original §21): one per action, plus the start.
 * - start: the board before anyone played (gameCreated, gameStarted and the first turn, if any);
 * - select (cellLocked) · correct (placedCorrect) · wrong (placedWrong) · interference;
 * - a state change: offline (a lost connection's soft phase [D42]) · disconnect · reconnect · surrender ·
 *   abandon · release (a lock let go by "ביטול בחירה", or one that ran out of time).
 *   A digit entered offline and sent on the return (placed* with `offline`) is a correct or wrong step like any
 *   other, marked `offline`.
 * Events that are part of an action join its step instead of making their own:
 * - after it, at the same moment: the release after a mistake or a disconnect, a freeze and a resume (the
 *   game froze because someone disconnected; it goes on because they came back or left), a new turn, a
 *   reaction, and gameOver;
 * - before it: the release of the lock a player switches away from (it comes with the new cellLocked), the
 *   release of a player who surrenders or leaves, and the end of an interference (a timer: from the next step
 *   on the player is free; until then the screen still shows it, as the game did).
 *
 * Explanations (spec §13.2) [D26 is not approved: a full explanation for EVERY player at every step]. At a
 * step, each player is shown the cell they last chose (their latest select, correct or wrong move so far):
 * the digit the logic puts there, why, and the logical explanation, computed on the board BEFORE that move.
 * Teaching mode (the default) shows the answer even while the player is still choosing. A correct move also
 * gets its score line, and a wrong one says why the digit was wrong.
 */

export type StepKind =
  | 'start'
  | 'select'
  | 'release'
  | 'correct'
  | 'wrong'
  | 'interference'
  /** The connection was lost: the soft phase began, the game went on [D42]. */
  | 'offline'
  | 'disconnect'
  | 'reconnect'
  | 'surrender'
  | 'abandon';

export interface ReplayStep {
  index: number;
  kind: StepKind;
  /** Who acted (the sender of an interference); null for the start. */
  playerId: PlayerId | null;
  cell: CellIndex | null;
  /** The digit placed: right or wrong. */
  digit: Digit | null;
  /** The right digit of `cell`, when the solution is known. */
  answer: Digit | null;
  points: number | null;
  breakdown: MoveScore | null;
  /** A correct move's calculation (spec §13.2): "points = 9 − 7 + (9 − 6) / 2 = 3.5". */
  scoreLine: string | null;
  penalty: number | null;
  /** An interference: on whom, which, and what it cost the sender. */
  targetId: PlayerId | null;
  interference: InterferenceKind | null;
  cost: number | null;
  /** A release: why ('cancel' or 'timeout'). */
  releaseReason: ReleaseReason | null;
  /** A digit entered while the connection was lost, sent when it was back [D42]. */
  offline: boolean;
  /** The game ended with this step. */
  ends: boolean;
  /** The events this step covers: log[from..to]; `main` is its own event (null for the start). */
  from: number;
  to: number;
  main: number | null;
  /** When it happened (the engine's clock), and the game clock then (ms since the start). */
  t: number;
  clockMs: number;
}

export interface ReplayPlayer {
  id: PlayerId;
  seat: number;
  /** Null: the screen's word for an unnamed player. */
  name: string | null;
  isBot: boolean;
  avatar: AvatarIdOrNone;
  /** As this phone shows them: 0 = me (P1, ●), then P2–P4 by seat (▲ ■ ◆). */
  colorIndex: number;
  isMe: boolean;
}

/** A mark on the timeline (spec §13.1: "נקודות בצבעי השחקנים: נכון, שגוי, הפרעה"). */
export interface TimelineDot {
  step: number;
  kind: 'correct' | 'wrong' | 'interference';
  playerId: PlayerId;
  colorIndex: number;
}

/** Spec §13.1: "רגעי מפתח". Step indexes. */
export interface KeyMoments {
  /** The highest-scoring single move (the first of equals). */
  bestMove: number | null;
  mistakes: number[];
  interferences: number[];
  /** The last time the lead changed hands; null when it never did (or there is nobody to lead). */
  turningPoint: number | null;
}

export interface Replay {
  gameId: string;
  mode: GameMode;
  gameType: GameType;
  /** When the game started (or was created, if it never did). */
  startedAt: number;
  durationMs: number;
  players: ReplayPlayer[];
  /** The viewer; null for someone who did not play. */
  me: PlayerId | null;
  /** The log as far as it replays (in seq order, without repeats or a damaged tail). */
  events: GameEvent[];
  /** states[k] follows events[k]. */
  states: GameState[];
  steps: ReplayStep[];
  /** The solution (shown in the explanations); null when the log does not carry it. */
  solution: Grid | null;
  /** The log runs to gameOver. */
  complete: boolean;
  result: GameResult | null;
  timeline: TimelineDot[];
  keyMoments: KeyMoments;
  /** subjects[step][seat]: the step of the move each player is explained by then (spec §13.2). */
  subjects: (number | null)[][];
  /** The single leader after each step (spec §6.7 ranking), for the turning point. */
  leaders: (PlayerId | null)[];
  /**
   * Every mistake of this game was charged as missed points (spec §6.5, Moshe's decision of 2026-10-15): its
   * penalty is what the right digit would have scored there, so a wrong move can show its calculation. False
   * for a game played before that rule, under the 1, 2, 4, 8 ladder: each player's first mistake there cost 1,
   * which missed points never are (1.5 at least). Its wrong moves keep their recorded penalties and show no
   * penalty line. True for a game without mistakes.
   */
  penaltiesAreMissedPoints: boolean;
  /** Explanations already worked out, by the step of their move. */
  cache: Map<number, Explanation | null>;
}

export type ExplanationStatus = 'none' | 'choosing' | 'released' | 'correct' | 'wrong';

/** One player's explanation at a step (spec §13.2). */
export interface PlayerExplanation {
  playerId: PlayerId;
  status: ExplanationStatus;
  /** The step of the move explained; null without one yet. */
  stepIndex: number | null;
  /** This player acted in the step on screen. */
  live: boolean;
  cell: CellIndex | null;
  /** "D5", always LTR. */
  cellName: string | null;
  /** The digit that belongs there. */
  answer: Digit | null;
  /** The digit the player put there (right or wrong). */
  played: Digit | null;
  technique: Technique | 'chain' | 'beyond' | null;
  techniqueName: string | null;
  /** The logical explanation, in `lang` (cells and formulas isolated LTR in Hebrew). */
  text: string | null;
  /** A wrong move: why that digit could not go there. */
  wrongText: string | null;
  points: number | null;
  penalty: number | null;
  scoreLine: string | null;
  /**
   * A wrong move (spec §6.5, §13.2): its penalty's calculation, i.e. what the right digit would have scored
   * there, "points = 9 − 4 + (9 − 3) / 2 = 8". Null for a game played before that rule (see
   * `Replay.penaltiesAreMissedPoints`), and when the log has no solution.
   */
  penaltyLine: string | null;
  /** A choice that was let go of: why. */
  releaseReason: ReleaseReason | null;
}

export interface StepView {
  step: ReplayStep;
  /** 1-based, for "שלב 7 מתוך 94". */
  number: number;
  total: number;
  /** The game after this step, and as the viewer's screen draws it (at the step's moment). */
  state: GameState;
  view: GameView;
  /** In seat order. */
  explanations: PlayerExplanation[];
  leaderId: PlayerId | null;
}

export interface ReplayOptions {
  /** The player on this phone. */
  me?: PlayerId | null;
  /** Avatars by player (a profile's); bots get their level's, everyone else the empty one. */
  avatars?: Readonly<Partial<Record<PlayerId, AvatarIdOrNone>>>;
  /** Names to show instead of the ones in the log (a ranked game's current display names). */
  names?: Readonly<Partial<Record<PlayerId, string | null>>>;
}

// ---------------------------------------------------------------------------------------------------------
// The log

/** In seq order without repeats, and only as far as the engine can replay it (a damaged tail is dropped). */
function cleanLog(events: readonly GameEvent[]): GameEvent[] {
  const sorted = [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e, k, all) => k === 0 || e.seq !== all[k - 1]!.seq);
  let state: GameState | null = null;
  let ok = 0;
  for (const e of sorted) {
    try {
      state = evolve(state, e);
    } catch {
      break;
    }
    ok++;
  }
  return sorted.slice(0, ok);
}

type Role = 'step' | 'lead' | 'trail';

/** Whether an event is a step of its own, joins the next step (lead) or the one before (trail). */
function roleOf(e: GameEvent): Role {
  switch (e.type) {
    case 'cellLocked':
    case 'placedCorrect':
    case 'placedWrong':
    case 'interference':
    case 'playerConnectionLost':
    case 'playerDisconnected':
    case 'playerReconnected':
    case 'playerSurrendered':
    case 'playerAbandoned':
      return 'step';
    case 'cellReleased':
      if (e.reason === 'cancel' || e.reason === 'timeout') return 'step';
      return e.reason === 'mistake' || e.reason === 'disconnect' ? 'trail' : 'lead';
    case 'interferenceEnded':
      return 'lead';
    default:
      return 'trail';
  }
}

interface Group {
  from: number;
  to: number;
  main: number | null;
}

function groupsOf(events: readonly GameEvent[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { from: 0, to: -1, main: null };
  let leadFrom: number | null = null;
  events.forEach((e, i) => {
    const role = roleOf(e);
    if (role === 'step') {
      groups.push(current);
      current = { from: leadFrom ?? i, to: i, main: i };
      leadFrom = null;
    } else if (role === 'lead') {
      leadFrom ??= i;
    } else if (leadFrom === null) {
      current.to = i;
    }
  });
  // Lead events with no step after them stay with the last one.
  if (leadFrom !== null) current.to = events.length - 1;
  groups.push(current);
  return groups.filter((g) => g.to >= g.from);
}

const KIND_OF: Partial<Record<GameEvent['type'], StepKind>> = {
  cellLocked: 'select',
  cellReleased: 'release',
  placedCorrect: 'correct',
  placedWrong: 'wrong',
  interference: 'interference',
  playerConnectionLost: 'offline',
  playerDisconnected: 'disconnect',
  playerReconnected: 'reconnect',
  playerSurrendered: 'surrender',
  playerAbandoned: 'abandon',
};

function stepOf(
  index: number,
  g: Group,
  events: readonly GameEvent[],
  startedAt: number | null,
  solution: Grid | null,
): ReplayStep {
  const e = g.main === null ? null : events[g.main]!;
  const last = events[g.to]!;
  const t = e?.t ?? last.t;
  const answerOf = (cell: CellIndex): Digit | null => {
    const d = solution?.[cell];
    return d ? (d as Digit) : null;
  };
  const step: ReplayStep = {
    index,
    kind: e ? (KIND_OF[e.type] ?? 'start') : 'start',
    playerId: null,
    cell: null,
    digit: null,
    answer: null,
    points: null,
    breakdown: null,
    scoreLine: null,
    penalty: null,
    targetId: null,
    interference: null,
    cost: null,
    releaseReason: null,
    offline: false,
    ends: events.slice(g.from, g.to + 1).some((x) => x.type === 'gameOver'),
    from: g.from,
    to: g.to,
    main: g.main,
    t,
    clockMs: startedAt === null ? 0 : Math.max(0, t - startedAt),
  };
  if (!e) return step;
  switch (e.type) {
    case 'cellLocked':
      return { ...step, playerId: e.playerId, cell: e.cell, answer: answerOf(e.cell) };
    case 'cellReleased':
      return {
        ...step,
        playerId: e.playerId,
        cell: e.cell,
        releaseReason: e.reason,
        answer: answerOf(e.cell),
      };
    case 'placedCorrect':
      return {
        ...step,
        playerId: e.playerId,
        cell: e.cell,
        digit: e.digit,
        answer: e.digit,
        points: e.points,
        breakdown: e.breakdown,
        scoreLine: formatScoreLine(e.breakdown),
        offline: e.offline === true,
      };
    case 'placedWrong':
      return {
        ...step,
        playerId: e.playerId,
        cell: e.cell,
        digit: e.digit,
        answer: answerOf(e.cell),
        penalty: e.penalty,
        offline: e.offline === true,
      };
    case 'interference':
      return {
        ...step,
        playerId: e.fromId,
        targetId: e.targetId,
        interference: e.kind,
        cost: e.cost,
      };
    case 'playerConnectionLost':
    case 'playerDisconnected':
    case 'playerReconnected':
    case 'playerSurrendered':
    case 'playerAbandoned':
      return { ...step, playerId: e.playerId };
    default:
      return step;
  }
}

/** The single player at place 1 still in the game (engine ranking, spec §6.7); null on a tie or alone. */
function leaderOf(state: GameState): PlayerId | null {
  if (state.players.length < 2) return null;
  const firsts = rankPlayers(state).filter((r) => r.place === 1 && r.status === 'active');
  return firsts.length === 1 ? firsts[0]!.playerId : null;
}

function keyMomentsOf(steps: readonly ReplayStep[], leaders: readonly (PlayerId | null)[]): KeyMoments {
  let bestMove: number | null = null;
  for (const s of steps)
    if (s.kind === 'correct' && (bestMove === null || s.points! > steps[bestMove]!.points!))
      bestMove = s.index;
  let held: PlayerId | null = null;
  let turningPoint: number | null = null;
  leaders.forEach((leader, k) => {
    if (leader === null) return;
    if (held !== null && leader !== held) turningPoint = k;
    held = leader;
  });
  return {
    bestMove,
    mistakes: steps.filter((s) => s.kind === 'wrong').map((s) => s.index),
    interferences: steps.filter((s) => s.kind === 'interference').map((s) => s.index),
    turningPoint,
  };
}

/**
 * The replay of a game from its log. Throws when the log does not even hold the game's creation.
 */
export function buildReplay(events: readonly GameEvent[], options: ReplayOptions = {}): Replay {
  const log = cleanLog(events);
  const created = log[0];
  if (created?.type !== 'gameCreated') throw new RangeError('A replay needs the log from gameCreated on');
  const states = replayStates(log);
  const config = created.config;
  const solutionText = config.puzzle.solution;
  const solution = /^[1-9]{81}$/.test(solutionText) ? parseGrid(solutionText) : null;
  const final = states[states.length - 1]!;
  const startedAt = final.startedAt;

  const me = options.me !== undefined && config.players.some((p) => p.id === options.me) ? options.me : null;
  const mySeat = me === null ? null : config.players.findIndex((p) => p.id === me);
  const seats = config.players.map((_, seat) => seat);
  const players: ReplayPlayer[] = config.players.map((p, seat) => {
    const who = playerIdentity(p);
    const name = options.names?.[p.id];
    return {
      id: p.id,
      seat,
      name: name === undefined ? who.name : name,
      isBot: who.isBot,
      avatar: options.avatars?.[p.id] ?? who.avatar,
      colorIndex: colorIndexFor(seat, mySeat, seats),
      isMe: p.id === me,
    };
  });

  const steps = groupsOf(log).map((g, k) => stepOf(k, g, log, startedAt, solution));
  const penaltiesAreMissedPoints = steps.every(
    (s) => s.kind !== 'wrong' || missedPointsOf(states, s, config.rules.scoreY)?.points === s.penalty,
  );
  const seatOf = new Map(players.map((p) => [p.id, p.seat]));

  // Each player's move to explain, step by step.
  const subjects: (number | null)[][] = [];
  let carry: (number | null)[] = players.map(() => null);
  for (const s of steps) {
    if ((s.kind === 'select' || s.kind === 'correct' || s.kind === 'wrong') && s.playerId !== null) {
      carry = carry.slice();
      carry[seatOf.get(s.playerId)!] = s.index;
    }
    subjects.push(carry);
  }
  const leaders = steps.map((s) => leaderOf(states[s.to]!));
  const colorOf = new Map(players.map((p) => [p.id, p.colorIndex]));
  const timeline = steps.flatMap((s): TimelineDot[] =>
    (s.kind === 'correct' || s.kind === 'wrong' || s.kind === 'interference') && s.playerId !== null
      ? [{ step: s.index, kind: s.kind, playerId: s.playerId, colorIndex: colorOf.get(s.playerId) ?? 0 }]
      : [],
  );

  const result = final.result;
  const lastT = log[log.length - 1]!.t;
  return {
    gameId: config.id,
    mode: config.mode,
    gameType: config.gameType,
    startedAt: startedAt ?? final.createdAt,
    durationMs: result?.durationMs ?? (startedAt === null ? 0 : Math.max(0, lastT - startedAt)),
    players,
    me,
    events: log,
    states,
    steps,
    solution,
    complete: final.status === 'over',
    result,
    timeline,
    keyMoments: keyMomentsOf(steps, leaders),
    subjects,
    leaders,
    penaltiesAreMissedPoints,
    cache: new Map(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// One step

/** The grid just before step `s`'s own event: the board its explanation is worked out on (spec §13.2). */
function gridBeforeIn(states: readonly GameState[], s: ReplayStep): Grid {
  const main = s.main ?? s.from;
  return states[Math.max(0, main - 1)]!.grid;
}

function gridBefore(replay: Replay, s: ReplayStep): Grid {
  return gridBeforeIn(replay.states, s);
}

/**
 * What step `s`'s cell was worth to the right digit on the board before it (spec §6.5): a wrong move's
 * penalty under the missed-points rule. Null without the solution or a cell to score.
 */
function missedPointsOf(states: readonly GameState[], s: ReplayStep, y: ScoreY): MoveScore | null {
  if (s.cell === null || s.answer === null) return null;
  const grid = gridBeforeIn(states, s);
  return grid[s.cell] === 0 ? missedPoints(grid, s.cell, s.answer, y) : null;
}

/** The engine's explanation of the cell of step `s`, on the board before it; null when it can't be made. */
function explanationFor(replay: Replay, s: ReplayStep): Explanation | null {
  if (replay.cache.has(s.index)) return replay.cache.get(s.index)!;
  let found: Explanation | null = null;
  const grid = gridBefore(replay, s);
  if (s.cell !== null && grid[s.cell] === 0) {
    try {
      found = explain(grid, s.cell, replay.solution ?? undefined);
    } catch {
      found = null; // a board without a solution: nothing to explain
    }
  }
  replay.cache.set(s.index, found);
  return found;
}

function explanationOf(replay: Replay, k: number, seat: number, lang: Lang): PlayerExplanation {
  const player = replay.players[seat]!;
  const subject = replay.subjects[k]?.[seat] ?? null;
  const live = replay.steps[k]?.playerId === player.id;
  const none: PlayerExplanation = {
    playerId: player.id,
    status: 'none',
    stepIndex: null,
    live,
    cell: null,
    cellName: null,
    answer: null,
    played: null,
    technique: null,
    techniqueName: null,
    text: null,
    wrongText: null,
    points: null,
    penalty: null,
    scoreLine: null,
    penaltyLine: null,
    releaseReason: null,
  };
  if (subject === null) return none;
  const s = replay.steps[subject]!;
  const cell = s.cell!;
  const after = replay.states[replay.steps[k]!.to]!;

  let status: ExplanationStatus;
  let releaseReason: ReleaseReason | null = null;
  if (s.kind === 'correct') status = 'correct';
  else if (s.kind === 'wrong') status = 'wrong';
  else if (after.locks.some((l) => l.playerId === player.id && l.cell === cell)) status = 'choosing';
  else {
    status = 'released';
    // Why it was let go of: the first release of that lock after the choice, up to this step.
    for (let i = s.to + 1; i <= replay.steps[k]!.to; i++) {
      const e = replay.events[i]!;
      if (e.type === 'cellReleased' && e.playerId === player.id) {
        releaseReason = e.reason;
        break;
      }
    }
  }

  const expl = explanationFor(replay, s);
  const grid = gridBefore(replay, s);
  let wrongText: string | null = null;
  if (s.kind === 'wrong' && s.digit !== null && grid[cell] === 0) {
    try {
      wrongText = formatWrong(whyWrong(grid, cell, s.digit, replay.solution ?? undefined), lang);
    } catch {
      wrongText = null;
    }
  }
  let penaltyLine: string | null = null;
  if (s.kind === 'wrong' && replay.penaltiesAreMissedPoints) {
    const missed = missedPointsOf(replay.states, s, after.config.rules.scoreY);
    penaltyLine = missed ? formatScoreLine(missed) : null;
  }
  return {
    ...none,
    status,
    stepIndex: subject,
    cell,
    cellName: cellName(cell),
    answer: s.answer ?? expl?.digit ?? null,
    played: s.digit,
    technique: expl?.technique ?? null,
    techniqueName: expl ? techniqueName(expl.technique, lang) : null,
    text: expl ? formatExplanation(expl, lang) : null,
    wrongText,
    points: s.points,
    penalty: s.penalty,
    scoreLine: s.scoreLine,
    penaltyLine,
    releaseReason,
  };
}

/** Everything to draw at step `k` (0-based, clamped to the replay). */
export function stepView(replay: Replay, k: number, lang: Lang): StepView {
  const index = Math.max(0, Math.min(replay.steps.length - 1, Math.floor(k)));
  const step = replay.steps[index]!;
  const state = replay.states[step.to]!;
  return {
    step,
    number: index + 1,
    total: replay.steps.length,
    state,
    view: toView(state, replay.me, step.t),
    explanations: replay.players.map((p) => explanationOf(replay, index, p.seat, lang)),
    leaderId: replay.leaders[index] ?? null,
  };
}

/** The next (or previous) step of a kind of key moment, from step `from`, round the list. */
export function nextMoment(list: readonly number[], from: number, direction: 1 | -1 = 1): number | null {
  if (!list.length) return null;
  if (direction === 1) return list.find((s) => s > from) ?? list[0]!;
  return [...list].reverse().find((s) => s < from) ?? list[list.length - 1]!;
}

/** The step nearest to a point of the timeline (0 = the start, 1 = the end). */
export function stepAtFraction(replay: Pick<Replay, 'steps'>, fraction: number): number {
  const n = replay.steps.length;
  if (n <= 1) return 0;
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(f * (n - 1));
}
