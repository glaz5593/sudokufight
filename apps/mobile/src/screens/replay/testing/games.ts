/* Test-only: real engine games (solo, against a bot, four players) whose logs the replay tests read. */
import {
  type Action,
  applyAction,
  attachBot,
  botPlayer,
  type CellIndex,
  createGame,
  createRng,
  defaultRules,
  type Digit,
  type GameConfig,
  type GameEvent,
  type GameMode,
  type GameState,
  type InterferenceKind,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
  type PlayerInfo,
  type Rules,
  tick,
} from '@sudoku-fight/engine';

import { answerIn, emptyCellsOf, PUZZLE, wrongIn } from '../../../game/testing/practice';

export const T0 = 1_760_000_000_000;

/** Drives a game through the engine's pure API on a clock of its own; keeps the whole log. */
export class Table {
  state: GameState;
  readonly log: GameEvent[] = [];
  now: number;
  /** The puzzle's empty cells at the start, in board order. */
  readonly cells: CellIndex[];

  constructor(
    readonly config: GameConfig,
    at = T0,
  ) {
    this.now = at;
    this.cells = emptyCellsOf(config.puzzle);
    const created = createGame(config, at);
    this.state = created.state;
    this.log.push(...created.events);
    this.act({ type: 'start' });
  }

  act(action: Action): void {
    const r = applyAction(this.state, action, this.now);
    this.state = r.state;
    this.log.push(...r.events);
    if (r.rejected) throw new Error(`Refused ${action.type}: ${r.rejected}`);
  }

  /** Moves the clock on and runs the timers. */
  wait(ms: number): void {
    this.now += ms;
    const r = tick(this.state, this.now);
    this.state = r.state;
    this.log.push(...r.events);
  }

  answer = (cell: CellIndex): Digit => answerIn(this.config.puzzle, cell);
  wrong = (cell: CellIndex): Digit =>
    wrongIn(
      this.config.puzzle,
      cell,
      this.state.wrong[cell]!.map((w) => w.digit),
    );

  select(playerId: string, cell: CellIndex): void {
    this.act({ type: 'select', playerId, cell });
  }

  /** Locks, thinks `thinkMs`, places the answer (or `digit`), then 300 ms pass. */
  move(playerId: string, cell: CellIndex, thinkMs = 2_000, digit?: Digit): void {
    this.select(playerId, cell);
    this.wait(thinkMs);
    this.act({ type: 'place', playerId, cell, digit: digit ?? this.answer(cell) });
    this.wait(300);
  }

  miss(playerId: string, cell: CellIndex, thinkMs = 1_500): Digit {
    const digit = this.wrong(cell);
    this.move(playerId, cell, thinkMs, digit);
    this.wait(1_000); // the re-lock wait [D2]
    return digit;
  }

  interfere(playerId: string, targetId: string, kind: InterferenceKind = 'cats'): void {
    this.act({ type: 'interfere', playerId, targetId, kind });
  }

  /** The empty cells left, in board order. */
  empty(): CellIndex[] {
    return this.state.grid.flatMap((v, i) => (v === 0 ? [i] : []));
  }
}

export function configOf(
  mode: GameMode,
  players: PlayerInfo[],
  { id = 'replay-game', rules = {} }: { id?: string; rules?: Partial<Rules> } = {},
): GameConfig {
  return {
    id,
    mode,
    gameType: 'fast',
    puzzle: { id: PUZZLE.id, givens: PUZZLE.givens, solution: PUZZLE.solution },
    players,
    rules: defaultRules(mode, 'fast', rules),
    seed: 1,
  };
}

/**
 * A solo practice: two correct moves, a mistake, a choice let go of ("ביטול בחירה"), a choice that runs out
 * of time, another correct move, then "סיום אימון".
 */
export function soloGame({ id = 'replay-game', at = T0 }: { id?: string; at?: number } = {}): Table {
  const table = new Table(configOf('solo', [{ id: 'me', name: 'Moshe' }], { id }), at);
  const [a, b, c, d, e, f] = table.cells as [CellIndex, ...CellIndex[]];
  table.move('me', a, 2_000);
  table.move('me', b!, 3_000);
  table.miss('me', c!);
  table.select('me', d!);
  table.wait(1_000);
  table.act({ type: 'release', playerId: 'me' });
  table.wait(500);
  table.select('me', e!);
  table.wait(table.config.rules.thinkTimeMs + 10); // runs out [D2]
  table.move('me', f!, 1_000);
  table.act({ type: 'surrender', playerId: 'me' }); // "סיום אימון"
  return table;
}

/** A practice against the level-3 bot, played by the engine's own bot to the end; I play the first move. */
export function botGame(level: 1 | 2 | 3 | 4 | 5 = 3): {
  host: LocalGameHost;
  events: readonly GameEvent[];
  botId: string;
} {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const bot = botPlayer(level);
  const config = configOf('bot', [{ id: 'me', name: 'Moshe' }, bot]);
  const host = new LocalGameHost({ config, playerId: 'me', clock, scheduler });
  attachBot(host, { botId: bot.id, level, clock, scheduler, rng: createRng(7) });
  const first = emptyCellsOf(config.puzzle)[0]!;
  host.select(first);
  scheduler.advance(1_500);
  host.place(first, answerIn(config.puzzle, first));
  for (let k = 0; k < 2_000 && host.state.status !== 'over'; k++) scheduler.advance(1_000);
  host.close();
  return { host, events: host.events, botId: bot.id };
}

/**
 * Four players, ranked (with ratings): moves by everyone, the lead changing hands, a mistake, an
 * interference, a disconnect and a return (3–4 players: the game goes on), a surrender, an abandonment (the
 * grace runs out), and then two players fill the board.
 */
export function fourPlayerGame(): Table {
  const players: PlayerInfo[] = ['p1', 'p2', 'p3', 'p4'].map((id, k) => ({
    id,
    name: id.toUpperCase(),
    rating: 1200 + k * 10,
    ratedGames: 12,
  }));
  const table = new Table(configOf('ranked', players, { id: 'four' }));
  const cells = () => table.empty();
  table.move('p1', cells()[0]!, 2_000);
  table.move('p2', cells()[0]!, 2_000);
  table.move('p2', cells()[0]!, 2_000);
  table.miss('p3', cells()[0]!);
  table.move('p3', cells()[0]!, 2_000);
  table.interfere('p2', 'p1');
  table.wait(table.config.rules.interferenceMs + 100);
  table.move('p1', cells()[0]!, 1_000);
  table.move('p1', cells()[0]!, 1_000);
  table.move('p1', cells()[0]!, 1_000);
  // p4 chooses a cell, drops out and comes back: the game goes on without a freeze.
  table.select('p4', cells()[0]!);
  table.act({ type: 'disconnect', playerId: 'p4' });
  table.wait(2_000);
  table.act({ type: 'reconnect', playerId: 'p4' });
  table.move('p4', cells()[1]!, 2_000);
  table.act({ type: 'surrender', playerId: 'p3' });
  table.act({ type: 'disconnect', playerId: 'p4' });
  table.wait(table.config.rules.graceMs + 10); // p4 does not come back: abandonment
  let k = 0;
  while (table.state.status === 'running') {
    table.move(k % 3 === 0 ? 'p2' : 'p1', cells()[0]!, 1_000);
    k++;
  }
  return table;
}

/**
 * A ranked duel with a lost connection in its soft phase [D42]: NinaVolt's connection drops, the game goes on
 * (I play), she is back within the soft phase and sends two digits entered offline (one right, one wrong);
 * then the board is filled.
 */
export function softDropDuel(id = 'ranked-soft', at?: number): Table {
  const players: PlayerInfo[] = [
    { id: 'me', name: 'Moshe', rating: 1287, ratedGames: 12 },
    { id: 'nina', name: 'NinaVolt', rating: 1305, ratedGames: 12 },
  ];
  const table = new Table(configOf('ranked', players, { id }), at);
  table.move('me', table.empty()[0]!, 1_000);
  table.act({ type: 'disconnect', playerId: 'nina', soft: true });
  table.move('me', table.empty()[0]!, 1_000);
  table.wait(1_000);
  table.act({ type: 'reconnect', playerId: 'nina' });
  const right = table.empty()[0]!;
  table.act({
    type: 'offlineMove',
    playerId: 'nina',
    cell: right,
    digit: table.answer(right),
    thinkMs: 1_500,
  });
  const wrong = table.empty()[0]!;
  table.act({ type: 'offlineMove', playerId: 'nina', cell: wrong, digit: table.wrong(wrong), thinkMs: 800 });
  table.wait(1_000);
  let k = 0;
  while (table.state.status === 'running') {
    table.move(k % 4 === 3 ? 'nina' : 'me', table.empty()[0]!, 1_000);
    k++;
  }
  return table;
}
