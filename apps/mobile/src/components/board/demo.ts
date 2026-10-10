import {
  type Action,
  applyAction,
  createGame,
  defaultRules,
  type Digit,
  type GameConfig,
  type GameMode,
  type GameState,
  type GameType,
  type GameView,
  parseCellName,
  type PlayerId,
  type PlayerInfo,
  type Rules,
  toView,
} from '@sudoku-fight/engine';

/**
 * Real game states for the board's tests and the design-system screen: a game driven through the engine itself
 * (createGame / applyAction / toView), so every state the board draws is one the rules can reach.
 */

/** Bank puzzle #1: 35 givens, a unique solution. */
export const DEMO_PUZZLE = {
  id: 'demo-1',
  givens: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
  solution: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
} as const;

export const DEMO_PLAYERS: readonly PlayerInfo[] = [
  { id: 'moshe', name: 'MosheG' },
  { id: 'nina', name: 'NinaVolt' },
  { id: 'aiko', name: 'Aiko_M' },
  { id: 'omar', name: 'OmarK' },
];

export interface DemoOptions {
  players?: number;
  mode?: GameMode;
  /** 'normal' by default: a 12 s lock, as on Dir-C-Game. */
  gameType?: GameType;
  rules?: Partial<Rules>;
  /** Start the game (default true). */
  start?: boolean;
}

export function demoConfig({
  players = 2,
  mode = 'ranked',
  gameType = 'normal',
  rules,
}: DemoOptions = {}): GameConfig {
  return {
    id: 'demo-game',
    mode,
    gameType,
    puzzle: { ...DEMO_PUZZLE },
    players: DEMO_PLAYERS.slice(0, players).map((p) => ({ ...p })),
    rules: defaultRules(mode, gameType, rules),
  };
}

/** The solution digit of a cell ("D5" → 9). */
export const demoAnswer = (cell: string): Digit => Number(DEMO_PUZZLE.solution[parseCellName(cell)]) as Digit;

/** A digit that is wrong for the cell, skipping `skip`. */
export function demoWrong(cell: string, skip: readonly number[] = []): Digit {
  const right = demoAnswer(cell);
  for (let d = 1; d <= 9; d++) if (d !== right && !skip.includes(d)) return d as Digit;
  throw new Error(`No wrong digit left for ${cell}`);
}

/** A game with its own clock (ms from 0). Every method throws if the engine refuses the action. */
export class DemoGame {
  state: GameState;
  now = 0;

  constructor(options: DemoOptions = {}) {
    this.state = createGame(demoConfig(options), 0).state;
    if (options.start !== false) this.act({ type: 'start' });
  }

  act(action: Action, at?: number): this {
    if (at !== undefined) this.now = at;
    const r = applyAction(this.state, action, this.now);
    if (r.rejected) throw new Error(`The engine refused ${action.type}: ${r.rejected}`);
    this.state = r.state;
    return this;
  }

  select(playerId: PlayerId, cell: string, at?: number): this {
    return this.act({ type: 'select', playerId, cell: parseCellName(cell) }, at);
  }

  place(playerId: PlayerId, cell: string, digit: number, at?: number): this {
    return this.act({ type: 'place', playerId, cell: parseCellName(cell), digit: digit as Digit }, at);
  }

  /** Lock and place the right digit. */
  solve(playerId: PlayerId, cell: string, at?: number): this {
    return this.select(playerId, cell, at).place(playerId, cell, demoAnswer(cell));
  }

  /** Lock and place a wrong digit. */
  miss(playerId: PlayerId, cell: string, digit?: number, at?: number): this {
    const tried = this.state.wrong[parseCellName(cell)]!.map((w) => w.digit);
    return this.select(playerId, cell, at).place(playerId, cell, digit ?? demoWrong(cell, tried));
  }

  /** Moves the clock on (timers fire on the next action). */
  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  view(viewer: PlayerId | null): GameView {
    return toView(this.state, viewer, this.now);
  }

  seatOf(playerId: PlayerId): number {
    return this.state.players.find((p) => p.id === playerId)!.seat;
  }
}

/**
 * A four-player board with every cell state at once (components.md §18 "Board"): givens; cells solved by each
 * seat; my lock (with wrong digits under it, so the keypad shows a tried digit); two opponents' locks, one
 * stopped by an interference; and wrong digits on an empty cell and on a solved one. Seen by MosheG (seat 0).
 */
export function demoBoard(): { game: DemoGame; view: GameView; mySeat: number; now: number } {
  const g = new DemoGame({ players: 4 });
  g.solve('moshe', 'A1', 1000)
    .solve('nina', 'A2', 2000)
    .solve('aiko', 'B1', 3000)
    .solve('omar', 'B2', 4000)
    .solve('moshe', 'C1', 5000)
    // Wrong digits: on an empty cell (E5), on a cell solved later (A5 → NinaVolt), under my lock (F8).
    .miss('nina', 'E5', undefined, 6000)
    .miss('aiko', 'E5', undefined, 7000)
    .miss('omar', 'A5', undefined, 8000)
    .solve('nina', 'A5', 9000)
    .miss('aiko', 'F8', undefined, 10000)
    // Locks: mine on F8, Aiko's on A8, and NinaVolt's on D4, stopped by my interference a second later.
    .select('moshe', 'F8', 11000)
    .select('aiko', 'A8', 11000)
    .select('nina', 'D4', 11000)
    .act({ type: 'interfere', playerId: 'moshe', targetId: 'nina', kind: 'fireworks' }, 12000);
  // 12 s locks taken at 11 s: 7 s left at 16 s, as on Dir-C-Game. NinaVolt's stopped with 11 s left.
  g.now = 16000;
  return { game: g, view: g.view('moshe'), mySeat: 0, now: g.now };
}
