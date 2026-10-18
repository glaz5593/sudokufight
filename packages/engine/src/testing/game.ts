/* Test-only helpers for game tests: a known puzzle, configs, and a driver with its own clock. */
import type { GameType } from '../gameType';
import { applyAction, createGame, nextDeadline, tick } from '../game/engine';
import { defaultRules, type GameMode, type Rules } from '../game/rules';
import type {
  Action,
  GameConfig,
  GameEvent,
  GameEventType,
  GameState,
  PlayerInfo,
  RejectReason,
} from '../game/types';
import type { ClientAction } from '../game/host';
import { type GameView, replay, toView } from '../game/view';
import { type CellIndex, type Digit, parseCellName } from '../sudoku/board';

/** Bank puzzle #1: 36 givens, a unique solution. */
export const PUZZLE = {
  id: 'test-1',
  givens: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
  solution: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
};

/** The solution digit of a cell, and a wrong one for it. */
export const answer = (cell: string | CellIndex): Digit =>
  Number(PUZZLE.solution[typeof cell === 'string' ? parseCellName(cell) : cell]) as Digit;
export const wrongDigit = (cell: string | CellIndex, skip: number[] = []): Digit => {
  const right = answer(cell);
  for (let d = 1; d <= 9; d++) if (d !== right && !skip.includes(d)) return d as Digit;
  throw new Error('no wrong digit left');
};

/** Empty cells of PUZZLE, by name. */
export const EMPTY = [...PUZZLE.givens].map((c, i) => (c === '0' ? i : -1)).filter((i) => i >= 0);

export interface ConfigOptions {
  mode?: GameMode;
  gameType?: GameType;
  players?: number | PlayerInfo[];
  rules?: Partial<Rules>;
  puzzle?: { id: string; givens: string; solution: string };
}

export function makeConfig(o: ConfigOptions = {}): GameConfig {
  const mode = o.mode ?? (typeof o.players === 'number' && o.players === 1 ? 'solo' : 'ranked');
  const gameType = o.gameType ?? 'fast';
  const players: PlayerInfo[] = Array.isArray(o.players)
    ? o.players
    : Array.from({ length: o.players ?? 2 }, (_, k) => ({ id: `p${k + 1}`, name: `P${k + 1}` }));
  return {
    id: 'game-1',
    mode,
    gameType,
    puzzle: o.puzzle ?? PUZZLE,
    players,
    rules: defaultRules(mode, gameType, o.rules),
  };
}

/** Drives a game through the pure API with a clock of its own (ms from 0). */
export class GameDriver {
  state: GameState;
  readonly log: GameEvent[] = [];
  now: number;
  lastRejected: RejectReason | undefined;

  constructor(config: GameConfig, { start = true, at = 0 } = {}) {
    this.now = at;
    const created = createGame(config, at);
    this.state = created.state;
    this.log.push(...created.events);
    if (start) this.act({ type: 'start' });
  }

  static of(o: ConfigOptions = {}, opts?: { start?: boolean; at?: number }): GameDriver {
    return new GameDriver(makeConfig(o), opts);
  }

  /** Applies an action now (or at `at`); returns the new events. Throws if refused unless `expectReject`. */
  act(action: Action, at?: number): GameEvent[] {
    if (at !== undefined) this.now = at;
    const r = applyAction(this.state, action, this.now);
    this.state = r.state;
    this.log.push(...r.events);
    this.lastRejected = r.rejected;
    if (r.rejected) throw new Error(`Refused ${action.type}: ${r.rejected}`);
    return r.events;
  }

  /** Applies an action that must be refused; returns the reason and checks nothing of it was logged. */
  reject(action: Action, at?: number): RejectReason {
    if (at !== undefined) this.now = at;
    const before = this.state;
    const r = applyAction(this.state, action, this.now);
    this.state = r.state;
    this.log.push(...r.events);
    if (!r.rejected)
      throw new Error(`Expected ${action.type} to be refused, got ${r.events.map((e) => e.type).join(', ')}`);
    if (!r.events.length && r.state !== before) throw new Error('A refused action changed the state');
    return r.rejected;
  }

  select(playerId: string, cell: string, at?: number): GameEvent[] {
    return this.act({ type: 'select', playerId, cell: parseCellName(cell) }, at);
  }

  place(playerId: string, cell: string, digit: number, at?: number): GameEvent[] {
    return this.act({ type: 'place', playerId, cell: parseCellName(cell), digit: digit as Digit }, at);
  }

  /** Locks and places the right digit. */
  solve(playerId: string, cell: string, at?: number): GameEvent[] {
    return [...this.select(playerId, cell, at), ...this.place(playerId, cell, answer(cell))];
  }

  /** Locks and places a wrong digit (the first one not tried in that cell yet). */
  miss(playerId: string, cell: string, at?: number): GameEvent[] {
    const tried = this.state.wrong[parseCellName(cell)]!.map((w) => w.digit);
    return [...this.select(playerId, cell, at), ...this.place(playerId, cell, wrongDigit(cell, tried))];
  }

  playerAct(playerId: string, action: ClientAction, at?: number): GameEvent[] {
    return this.act({ ...action, playerId }, at);
  }

  /** A connection report: `soft` for a connection that dropped (the soft phase [D42]), hard by default. */
  disconnect(playerId: string, { soft = false, at }: { soft?: boolean; at?: number } = {}): GameEvent[] {
    return this.act(soft ? { type: 'disconnect', playerId, soft } : { type: 'disconnect', playerId }, at);
  }

  reconnect(playerId: string, at?: number): GameEvent[] {
    return this.act({ type: 'reconnect', playerId }, at);
  }

  /** A move made offline and sent on the return [D42]: `digit` defaults to the right one. */
  offlineMove(
    playerId: string,
    cell: string,
    { digit = answer(cell), thinkMs = 2000, at }: { digit?: number; thinkMs?: number; at?: number } = {},
  ): GameEvent[] {
    return this.act(
      { type: 'offlineMove', playerId, cell: parseCellName(cell), digit: digit as Digit, thinkMs },
      at,
    );
  }

  /** Moves time to `at` (absolute) and runs the timers. */
  tickTo(at: number): GameEvent[] {
    this.now = at;
    const r = tick(this.state, at);
    this.state = r.state;
    this.log.push(...r.events);
    return r.events;
  }

  advance(ms: number): GameEvent[] {
    return this.tickTo(this.now + ms);
  }

  get deadline(): number | null {
    return nextDeadline(this.state);
  }

  player(id: string) {
    return this.state.players.find((p) => p.id === id)!;
  }

  score(id: string): number {
    return this.player(id).score;
  }

  lock(id: string) {
    return this.state.locks.find((l) => l.playerId === id);
  }

  view(id: string | null): GameView {
    return toView(this.state, id, this.now);
  }

  types(events: GameEvent[] = this.log): GameEventType[] {
    return events.map((e) => e.type);
  }

  last<T extends GameEventType>(type: T): Extract<GameEvent, { type: T }> | undefined {
    for (let k = this.log.length - 1; k >= 0; k--) {
      const e = this.log[k]!;
      if (e.type === type) return e as Extract<GameEvent, { type: T }>;
    }
    return undefined;
  }

  /** The replay of the log must land exactly on the current state. */
  replayMatches(): boolean {
    const states = replay(this.log);
    return JSON.stringify(states[states.length - 1]) === JSON.stringify(this.state);
  }
}

/** Solves every remaining cell for `playerId` (fills the board). */
export function solveAll(g: GameDriver, playerId: string): void {
  for (const cell of EMPTY) if (g.state.grid[cell] === 0) g.solve(playerId, nameOf(cell));
}

const nameOf = (i: number): string => 'ABCDEFGHI'[Math.floor(i / 9)]! + String((i % 9) + 1);
export { nameOf as cellNameOf };
