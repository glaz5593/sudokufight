/* Test-only tap level fixtures (staged practice, 1.0.2): find, findDuel and spotError on bank puzzle #1. */
import {
  applyFind,
  createFind,
  type FindAction,
  type FindDeps,
  type FindState,
  findView,
  replayFind,
  tickFind,
} from '../levels/find';
import type {
  FindScope,
  FindTarget,
  LevelEvent,
  LevelEventType,
  LevelSpecOf,
  TargetTier,
} from '../levels/spec';
import type { RejectReason } from '../game/types';
import type { GameView } from '../game/view';
import { CELL_COUNT, type Digit, parseCellName } from '../sudoku/board';
import { ManualClock } from '../util/clock';
import { seedFromString } from '../util/random';
import { PUZZLE } from './game';
import { ME } from './levels';

/*
 * The targets below are singles of bank puzzle #1 that the tests know by heart (each digit has one place in
 * its scope on the givens). They are not built levels: levels:validate checks the builder's; these only play
 * the rules of the tap engine.
 */

const board = { grid: PUZZLE.givens, solution: PUZZLE.solution };

/** "Where must the digit go?" in a box, row or column: its one cell. */
export function target(
  digit: Digit,
  kind: Exclude<FindScope['kind'], 'board'>,
  index: number,
  cell: string,
  tier: TargetTier = 'single',
): FindTarget {
  const c = parseCellName(cell);
  return { digit, scope: { kind, index }, cell: c, accept: [c], tier };
}

/** Scope 'board': every empty cell whose answer is the digit is right (plan §2.1). */
export function boardTarget(digit: Digit, cells: readonly string[]): FindTarget {
  return { digit, scope: { kind: 'board' }, cell: null, accept: cells.map(parseCellName), tier: 'single' };
}

/** find, chapter 1 (plan §2.1): the 9 of box 5 (D5), 5 / 10 / 20 s. */
export const FIND_LEVEL: LevelSpecOf<'find'> = {
  id: 'L001',
  rev: 1,
  chapter: 1,
  slot: 1,
  kind: 'find',
  boss: false,
  seed: seedFromString('L001:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 20000,
  targets: { target: target(9, 'box', 4, 'D5') },
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

/** find over the whole board, chapter 30: the 9 is right in C1, D5, F7 and G3; 3 / 10 / 20 s. */
export const FIND_BOARD_LEVEL: LevelSpecOf<'find'> = {
  ...FIND_LEVEL,
  id: 'L291',
  chapter: 30,
  seed: seedFromString('L291:r1'),
  targets: { target: boardTarget(9, ['C1', 'D5', 'F7', 'G3']) },
  stars: { by: 'timeMs', three: 3000, two: 10000, one: 20000 },
};

/** The race's five spots, in order: F1 (2, box 4), F8 (1, box 6), G5 (3, box 8), H9 (4, box 9), I6 (6, row I). */
export const RACE_SPOTS: readonly FindTarget[] = [
  target(2, 'box', 3, 'F1'),
  target(1, 'box', 5, 'F8'),
  target(3, 'box', 7, 'G5'),
  target(4, 'box', 8, 'H9'),
  target(6, 'row', 8, 'I6'),
];

/** findDuel, chapter 1 (plan §2.2): five spots against Pip in 30 s; ★★★ 4–5 spots, ★★ 3, ★ 2. */
export const FIND_DUEL_LEVEL: LevelSpecOf<'findDuel'> = {
  id: 'L003',
  rev: 1,
  chapter: 1,
  slot: 3,
  kind: 'findDuel',
  boss: false,
  seed: seedFromString('L003:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 30000,
  targets: { spots: RACE_SPOTS },
  stars: { by: 'spots', three: 4, two: 3, one: 2 },
  bot: {
    level: 1,
    pace: 1,
    findMs: RACE_SPOTS.map(() => [8000, 12000] as const),
    missShare: 0.15,
    reactShare: 0.1,
  },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

/**
 * The race with Pip's search pinned: it taps spot k right `ms[k]` after the spot is shown (min = max), never
 * misses and never reacts unless told to.
 */
export function pinnedRace(
  ms: readonly number[],
  { missShare = 0, reactShare = 0 }: { missShare?: number; reactShare?: number } = {},
): LevelSpecOf<'findDuel'> {
  return {
    ...FIND_DUEL_LEVEL,
    bot: { level: 1, pace: 1, findMs: ms.map((m) => [m, m] as const), missShare, reactShare },
  };
}

/** An 81-character grid from a map like { A1: 8, D5: 6 } (0 elsewhere). */
function gridOf(cells: Record<string, number>): string {
  const grid = new Array<number>(CELL_COUNT).fill(0);
  for (const [name, v] of Object.entries(cells)) grid[parseCellName(name)] = v;
  return grid.join('');
}

/**
 * spotError, chapter 8 (plan Idea-1, the design's level 77): sixteen of "my" digits around the givens, two of
 * them wrong: D5 shows 6 (a visible error: the given 6 of D3 is in its row) and B2 shows 3 (a silent one: it
 * clashes with nothing, only the logic says 2). 12 / 20 / 30 s.
 */
export const SPOT_ERROR_LEVEL: LevelSpecOf<'spotError'> = {
  id: 'L077',
  rev: 1,
  chapter: 8,
  slot: 7,
  kind: 'spotError',
  boss: false,
  seed: seedFromString('L077:r1'),
  gameType: 'fast',
  board: {
    ...board,
    mine: gridOf({
      A1: 8,
      A2: 6,
      B4: 8,
      C6: 5,
      C7: 8,
      D7: 5,
      E4: 6,
      E9: 2,
      F3: 7,
      G2: 8,
      G8: 2,
      H1: 7,
      H5: 2,
      I8: 7,
      D5: 6,
      B2: 3,
    }),
  },
  timeLimitMs: 30000,
  targets: {
    errors: [
      { cell: parseCellName('D5'), digit: 6, visible: true },
      { cell: parseCellName('B2'), digit: 3, visible: false },
    ],
  },
  stars: { by: 'timeMs', three: 12000, two: 20000, one: 30000 },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

export type TapLevel = LevelSpecOf<'find'> | LevelSpecOf<'findDuel'> | LevelSpecOf<'spotError'>;

export interface FindDriverOptions extends Partial<Omit<FindDeps, 'clock'>> {
  at?: number;
  start?: boolean;
}

/** Drives a tap level through the pure API (find.ts) with a clock of its own (ms from 0), as GameDriver does. */
export class FindDriver {
  state: FindState;
  readonly log: LevelEvent[] = [];
  now: number;
  lastRejected: RejectReason | undefined;
  readonly botId: string | undefined;

  constructor(spec: TapLevel, { at = 0, start = true, attempt = 1, ...deps }: FindDriverOptions = {}) {
    this.now = at;
    const created = createFind(
      { id: `${spec.id}-a${attempt}`, spec, player: ME },
      { clock: new ManualClock(at), attempt, ...deps },
    );
    this.state = created.state;
    this.log.push(...created.events);
    this.botId = this.state.players.find((p) => p.isBot)?.id;
    if (start) this.act({ type: 'start' });
  }

  /** Applies an action now (or at `at`); returns the new events. Throws if refused. */
  act(action: FindAction, at?: number): LevelEvent[] {
    if (at !== undefined) this.now = at;
    const r = applyFind(this.state, action, this.now);
    this.state = r.state;
    this.log.push(...r.events);
    this.lastRejected = r.rejected;
    if (r.rejected) throw new Error(`Refused ${action.type}: ${r.rejected}`);
    return r.events;
  }

  /** Applies an action that must be refused; returns the reason. Timers that ran before it are kept. */
  reject(action: FindAction, at?: number): RejectReason {
    if (at !== undefined) this.now = at;
    const r = applyFind(this.state, action, this.now);
    this.state = r.state;
    this.log.push(...r.events);
    if (!r.rejected)
      throw new Error(`Expected ${action.type} to be refused, got ${r.events.map((e) => e.type).join(', ')}`);
    return r.rejected;
  }

  /** My tap on a cell, by name. */
  tap(cell: string, at?: number): LevelEvent[] {
    return this.act({ type: 'tap', playerId: ME.id, cell: parseCellName(cell) }, at);
  }

  tapRefused(cell: string, at?: number): RejectReason {
    return this.reject({ type: 'tap', playerId: ME.id, cell: parseCellName(cell) }, at);
  }

  /** Moves time to `at` (absolute) and runs the timers. */
  tickTo(at: number): LevelEvent[] {
    this.now = at;
    const r = tickFind(this.state, at);
    this.state = r.state;
    this.log.push(...r.events);
    return r.events;
  }

  advance(ms: number): LevelEvent[] {
    return this.tickTo(this.now + ms);
  }

  view(id: string | null = ME.id): GameView {
    return findView(this.state, id, this.now);
  }

  types(events: readonly LevelEvent[] = this.log): LevelEventType[] {
    return events.map((e) => e.type);
  }

  last<T extends LevelEventType>(type: T): Extract<LevelEvent, { type: T }> | undefined {
    for (let k = this.log.length - 1; k >= 0; k--) {
      const e = this.log[k]!;
      if (e.type === type) return e as Extract<LevelEvent, { type: T }>;
    }
    return undefined;
  }

  all<T extends LevelEventType>(type: T): Extract<LevelEvent, { type: T }>[] {
    return this.log.filter((e): e is Extract<LevelEvent, { type: T }> => e.type === type);
  }

  /** The replay of the log must land exactly on the current state. */
  replayMatches(): boolean {
    return JSON.stringify(replayFind(this.log)) === JSON.stringify(this.state);
  }
}
