import {
  type Action,
  applyAction,
  cellName,
  createGame,
  defaultRules,
  eloChanges,
  type GameConfig,
  type GameMode,
  type GameState,
  type GameView,
  type InterferenceKind,
  parseCellName,
  type PlayerId,
  type PlayerInfo,
  type Rules,
  tick,
  toView,
} from '@sudoku-fight/engine';

import type { AvatarIdOrNone } from '../../avatars';
import { DEMO_PUZZLE, demoAnswer, demoBoard, demoWrong } from '../board/demo';
import type { Gender } from '../player/wording';

/**
 * Game states for the design-system screen (components.md §18), all made by the real engine: createGame,
 * applyAction, tick and toView. Nothing here is drawn by hand, so every card, bar, strip, board and keypad the
 * page shows is one the rules can reach. Times are engine milliseconds from 0; locks are 12 s ('normal', as on
 * Dir-C-Game).
 */

export const ME: PlayerId = 'moshe';
export const NINA: PlayerId = 'nina';
export const AIKO: PlayerId = 'aiko';
export const OMAR: PlayerId = 'omar';
export const BOT: PlayerId = 'bot';

/** Seat order: MosheG is seat 0, and this phone is his. */
export const DS_PLAYERS: Readonly<Record<PlayerId, PlayerInfo>> = {
  [ME]: { id: ME, name: 'MosheG', rating: 1287, ratedGames: 42 },
  [NINA]: { id: NINA, name: 'NinaVolt', rating: 1305, ratedGames: 61 },
  [AIKO]: { id: AIKO, name: 'Aiko_M', rating: 1318, ratedGames: 7 },
  [OMAR]: { id: OMAR, name: 'OmarK', rating: 1271, ratedGames: 23 },
  [BOT]: { id: BOT, isBot: true },
};

/** What the profile adds to a player (stage 8 will bring it from the server). */
export interface DsProfile {
  avatar: AvatarIdOrNone;
  /** ISO alpha-2. */
  country: string | null;
  gender?: Gender;
}

export const DS_PROFILES: Readonly<Record<PlayerId, DsProfile>> = {
  [ME]: { avatar: 'lava-lamp', country: 'IL' },
  [NINA]: { avatar: 'maya', country: 'DE', gender: 'female' },
  [AIKO]: { avatar: 'hourglass', country: 'JP', gender: 'female' },
  [OMAR]: { avatar: 'sudoku-board', country: 'BR' },
  [BOT]: { avatar: 'furry-monster', country: null },
};

export const DS_AVATARS: Readonly<Record<PlayerId, AvatarIdOrNone>> = Object.fromEntries(
  Object.entries(DS_PROFILES).map(([id, p]) => [id, p.avatar]),
);

export interface FixtureOptions {
  mode?: GameMode;
  rules?: Partial<Rules>;
  /** Start the game (default true). */
  start?: boolean;
}

/** One engine game with its own clock. Every step throws if the engine refuses it. */
export class FixtureGame {
  state: GameState;
  now = 0;

  constructor(players: readonly PlayerId[], { mode = 'ranked', rules, start = true }: FixtureOptions = {}) {
    const config: GameConfig = {
      id: `ds-${players.length}p-${mode}`,
      mode,
      gameType: 'normal',
      puzzle: { ...DEMO_PUZZLE },
      players: players.map((id) => ({ ...DS_PLAYERS[id]!, id })),
      rules: defaultRules(mode, 'normal', rules),
      seed: 1,
    };
    this.state = createGame(config, 0).state;
    if (start) this.act({ type: 'start' });
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

  /** Lock a cell and place its right digit. */
  solve(playerId: PlayerId, cell: string, at?: number): this {
    this.select(playerId, cell, at);
    return this.act({ type: 'place', playerId, cell: parseCellName(cell), digit: demoAnswer(cell) });
  }

  /** Lock a cell and place a digit nobody has tried there yet, which is wrong. */
  miss(playerId: PlayerId, cell: string, at?: number): this {
    const tried = this.state.wrong[parseCellName(cell)]!.map((w) => w.digit);
    this.select(playerId, cell, at);
    return this.act({
      type: 'place',
      playerId,
      cell: parseCellName(cell),
      digit: demoWrong(cell, tried),
    });
  }

  interfere(playerId: PlayerId, targetId: PlayerId, at?: number, kind: InterferenceKind = 'fireworks'): this {
    return this.act({ type: 'interfere', playerId, targetId, kind }, at);
  }

  /** Moves the clock to `at` and runs the timers that are due (lock expiry, end of grace). */
  wait(at: number): this {
    this.now = at;
    this.state = tick(this.state, at).state;
    return this;
  }

  /** What `viewer` sees now. */
  snap(viewer: PlayerId = ME): Snapshot {
    const view = toView(this.state, viewer, this.now);
    const me = view.players.find((p) => p.id === viewer);
    return { view, now: this.now, mySeat: me ? me.seat : null };
  }
}

/** A view and the time it was taken at: what the view-model mappers (cardModel, boardModel …) need. */
export interface Snapshot {
  view: GameView;
  now: number;
  mySeat: number | null;
}

/** How a player's score moved between two views of the same game, for the "+3.5" / "−2" slot. */
export function scoreChange(before: GameView, after: GameView, playerId: PlayerId): number {
  const score = (v: GameView) => v.players.find((p) => p.id === playerId)?.score ?? 0;
  return score(after) - score(before);
}

// ---------------------------------------------------------------------------------------------------------
// Two players (Dir-C-Game)

/**
 * MosheG solves A1, C1 and B4 and misses D2 once, NinaVolt solves A2 and B1, and at 6 s I take F8. I lead
 * (16 to 11.5) even after the mistake, which costs what D2's digit was worth there (spec §6.5).
 */
function twoPlayerBase(): FixtureGame {
  return new FixtureGame([ME, NINA])
    .solve(ME, 'A1', 1000)
    .solve(NINA, 'A2', 2000)
    .solve(ME, 'C1', 3000)
    .solve(ME, 'B4', 3500)
    .miss(ME, 'D2', 4000)
    .solve(NINA, 'B1', 5000)
    .select(ME, 'F8', 6000);
}

/**
 * The opening of a two-player game, as on Dir-C-Game: after the base moves NinaVolt takes A8 at 8 s, so at
 * 11 s my lock has 7 s left and hers 9 s.
 */
export function twoPlayerOpening(): FixtureGame {
  return twoPlayerBase().select(NINA, 'A8', 8000);
}

export interface TwoPlayerScenes {
  /** Both lock: me on F8 (7 s), NinaVolt on A8 (9 s). */
  locking: Snapshot;
  /** NinaVolt between cells: "חושבת…". */
  thinking: Snapshot;
  /** I sent fireworks at NinaVolt: her lock stops, the hit chip counts down, ⚡ is busy. */
  hit: Snapshot;
  /** I lost my connection: the game froze, her lock stands still, my card shows me reconnecting. */
  frozen: Snapshot;
  /** NinaVolt lost her connection: 11 s of grace left, the reconnect pill replaces ⚡. */
  reconnecting: Snapshot;
  /** NinaVolt's grace ran out: she left and the game is over. */
  left: Snapshot;
  /** NinaVolt surrendered. */
  surrendered: Snapshot;
  /** NinaVolt just solved A8. */
  correct: Snapshot;
  correctDelta: number;
  /** I just missed F8: a second mistake. */
  wrong: Snapshot;
  wrongDelta: number;
  /** I sent a reaction a moment ago: the button rests [D19]. */
  reacted: Snapshot;
  /** Fresh game, 0 : 0: a tie, and ⚡ short of points. */
  start: Snapshot;
  /** NinaVolt ahead. */
  behind: Snapshot;
  /** My score under zero (D15 allows it). */
  negative: Snapshot;
  /** My lock in its last 2 seconds. */
  urgent: Snapshot;
  /** NinaVolt hit me while I hold F8: my timer stops. */
  myLockPaused: Snapshot;
  /** Before the start: ⚡ is not available yet. */
  waiting: Snapshot;
}

export function twoPlayerScenes(): TwoPlayerScenes {
  const opening = () => twoPlayerOpening();

  const beforeCorrect = opening().wait(12000);
  const correctBefore = beforeCorrect.snap();
  beforeCorrect.act({ type: 'place', playerId: NINA, cell: parseCellName('A8'), digit: demoAnswer('A8') });
  const correct = beforeCorrect.snap();

  const beforeWrong = opening().wait(12000);
  const wrongBefore = beforeWrong.snap();
  const tried = beforeWrong.state.wrong[parseCellName('F8')]!.map((w) => w.digit);
  beforeWrong.act({ type: 'place', playerId: ME, cell: parseCellName('F8'), digit: demoWrong('F8', tried) });
  const wrong = beforeWrong.snap();

  const behind = new FixtureGame([ME, NINA])
    .solve(NINA, 'A2', 1000)
    .solve(NINA, 'B1', 2000)
    .solve(ME, 'A1', 3000)
    .solve(NINA, 'B2', 4000)
    .wait(5000);

  const negative = new FixtureGame([ME, NINA])
    .miss(ME, 'D2', 1000)
    .miss(ME, 'D2', 2500)
    .solve(NINA, 'A2', 3000)
    .wait(4000);

  const myLockPaused = new FixtureGame([ME, NINA])
    .solve(NINA, 'A2', 1000)
    .solve(NINA, 'B1', 2000)
    .select(ME, 'F8', 6000)
    .interfere(NINA, ME, 9000)
    .wait(11000);

  const grace = defaultRules('ranked', 'normal').graceMs;

  return {
    locking: opening().wait(11000).snap(),
    thinking: twoPlayerBase().wait(11000).snap(),
    hit: opening().interfere(ME, NINA, 10000).wait(11000).snap(),
    frozen: opening().act({ type: 'disconnect', playerId: ME }, 10000).wait(11000).snap(),
    reconnecting: opening().act({ type: 'disconnect', playerId: NINA }, 10000).wait(14000).snap(),
    left: opening()
      .act({ type: 'disconnect', playerId: NINA }, 10000)
      .wait(10000 + grace + 1)
      .snap(),
    surrendered: opening().act({ type: 'surrender', playerId: NINA }, 10000).wait(11000).snap(),
    correct,
    correctDelta: scoreChange(correctBefore.view, correct.view, NINA),
    wrong,
    wrongDelta: scoreChange(wrongBefore.view, wrong.view, ME),
    reacted: opening().act({ type: 'react', playerId: ME, emoji: '🔥' }, 10500).wait(11000).snap(),
    start: new FixtureGame([ME, NINA]).wait(1000).snap(),
    behind: behind.snap(),
    negative: negative.snap(),
    urgent: opening().wait(16000).snap(),
    myLockPaused: myLockPaused.snap(),
    waiting: new FixtureGame([ME, NINA], { start: false }).snap(),
  };
}

/**
 * The rating change the surrender dialog estimates (spec §6.6, "שינוי דירוג משוער"): the engine's Elo for a loss
 * to NinaVolt, with both players' ratings and game counts.
 */
export function surrenderRatingChange(): number {
  const [me, nina] = [DS_PLAYERS[ME]!, DS_PLAYERS[NINA]!];
  const change = eloChanges([
    { id: ME, rating: me.rating ?? 0, games: me.ratedGames ?? 0, place: 2 },
    { id: NINA, rating: nina.rating ?? 0, games: nina.ratedGames ?? 0, place: 1 },
  ]);
  return change[0]?.delta ?? 0;
}

/** Practice against a bot (spec §6.6): "סיום אימון" on my card, ⚡ against the bot, no ratings. */
export function botScene(): Snapshot {
  return new FixtureGame([ME, BOT], { mode: 'bot' })
    .solve(ME, 'A1', 1000)
    .solve(BOT, 'A2', 2000)
    .solve(ME, 'C1', 3000)
    .select(BOT, 'B2', 5000)
    .wait(7000)
    .snap();
}

// ---------------------------------------------------------------------------------------------------------
// Three and four players (Game-3P, Game-4P)

/** Three players: Aiko_M leads and holds D4, NinaVolt reconnects (3P goes on without a freeze). */
export function threePlayerScene(): Snapshot {
  return new FixtureGame([ME, NINA, AIKO])
    .solve(AIKO, 'A2', 1000)
    .solve(ME, 'A1', 2000)
    .solve(AIKO, 'B1', 3000)
    .solve(NINA, 'B2', 4000)
    .miss(NINA, 'E5', 5000)
    .select(AIKO, 'D4', 7000)
    .select(ME, 'F8', 8000)
    .act({ type: 'disconnect', playerId: NINA }, 9000)
    .wait(11000)
    .snap();
}

/**
 * Four players, places #1–#4 all different: Aiko_M leads and is under my fireworks (her lock stopped, the hit
 * chip counting down), OmarK holds H5, NinaVolt has five mistakes (the "×5" pips), and my next ⚡ costs 4.
 */
export function fourPlayerScene(): Snapshot {
  return new FixtureGame([ME, NINA, AIKO, OMAR])
    .solve(AIKO, 'A2', 1000)
    .solve(ME, 'A1', 1500)
    .solve(AIKO, 'B1', 2000)
    .solve(ME, 'C1', 2500)
    .solve(OMAR, 'B2', 3000)
    .solve(NINA, 'A5', 3500)
    .miss(NINA, 'E5', 4000)
    .miss(NINA, 'E5', 5100)
    .miss(NINA, 'E5', 6200)
    .miss(NINA, 'E5', 7300)
    .miss(NINA, 'E5', 8400)
    .select(AIKO, 'D4', 9000)
    .select(OMAR, 'H5', 9500)
    .interfere(ME, AIKO, 10000)
    .wait(11000)
    .snap();
}

/** A snapshot right after a move, with how the mover's score changed (the "+2.5" gain float). */
export interface MoveSnapshot extends Snapshot {
  mover: PlayerId;
  change: number;
}

/**
 * Four players after OmarK surrendered (D36): his card dims and reads "נכנע". Aiko_M has just solved C1, so her
 * card floats the gain; NinaVolt holds D4.
 */
export function fourPlayerSurrenderScene(): MoveSnapshot {
  const g = new FixtureGame([ME, NINA, AIKO, OMAR])
    .solve(AIKO, 'A2', 1000)
    .solve(ME, 'A1', 2000)
    .solve(NINA, 'B1', 3000)
    .act({ type: 'surrender', playerId: OMAR }, 4000)
    .select(NINA, 'D4', 5000)
    .wait(7000);
  const before = g.snap();
  g.solve(AIKO, 'C1', 7500).wait(8000);
  const after = g.snap();
  return { ...after, mover: AIKO, change: scoreChange(before.view, after.view, AIKO) };
}

// ---------------------------------------------------------------------------------------------------------
// Board (components.md §11.3)

/**
 * The board area's demo game (board/demo.ts: four players, every cell state at once) `offsetMs` after its
 * moment on Dir-C-Game (my F8 lock at 7 s). Moving the clock on runs the engine's timers: my lock turns urgent
 * at 3 s and is released at 0, NinaVolt's stopped lock runs again once my interference ends.
 */
export function boardScene(offsetMs = 0): Snapshot {
  const { game } = demoBoard();
  const at = game.now + Math.max(0, offsetMs);
  game.now = at;
  game.state = tick(game.state, at).state;
  return { view: game.view(ME), now: at, mySeat: game.seatOf(ME) };
}

// ---------------------------------------------------------------------------------------------------------
// Keypad (components.md §12.1)

export interface KeypadScenes {
  /** I hold H2: keys armed; one digit complete; one digit already tried wrongly in H2 [D12]. */
  armed: Snapshot;
  /** No lock: the row is idle (the complete digit stays complete). */
  idle: Snapshot;
  /** The digit that has all nine on the board. */
  completeDigit: number;
}

/**
 * Completes one digit (the one with the most givens) by solving its missing cells, then NinaVolt misses H2
 * and I lock H2, so the keypad shows armed, complete and tried keys at once.
 */
export function keypadScenes(): KeypadScenes {
  const counts = Array.from({ length: 10 }, (_, d) =>
    d === 0 ? -1 : [...DEMO_PUZZLE.givens].filter((ch) => Number(ch) === d).length,
  );
  const completeDigit = counts.indexOf(Math.max(...counts));

  const g = new FixtureGame([ME, NINA]);
  let at = 1000;
  for (let i = 0; i < 81; i++) {
    if (DEMO_PUZZLE.givens[i] !== '0' || Number(DEMO_PUZZLE.solution[i]) !== completeDigit) continue;
    g.solve(at % 2000 === 0 ? NINA : ME, cellName(i), at);
    at += 500;
  }
  // H2 must stay empty and must not hold the complete digit.
  const target = 'H2';
  g.wait(at);
  const idle = g.snap();
  g.miss(NINA, target, at + 500)
    .select(ME, target, at + 2000)
    .wait(at + 3000);
  return { armed: g.snap(), idle, completeDigit };
}
