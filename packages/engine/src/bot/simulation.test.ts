import { createHash } from 'node:crypto';

import { LocalGameHost } from '../game/host';
import { defaultRules, INTERFERENCE_KINDS } from '../game/rules';
import type { Action, GameConfig, GameEvent, GameState } from '../game/types';
import { replay } from '../game/view';
import { GAME_TYPES, type GameType } from '../gameType';
import { type CellIndex, type Digit, DIGITS, missingDigits, unitsOf } from '../sudoku/board';
import {
  bankPuzzles,
  type BotGame,
  botGame,
  eventsOf,
  HUMAN,
  runUntilOver,
  scriptHuman,
} from '../testing/bot';
import { ManualClock } from '../util/clock';
import { createRng, pick, type Rng } from '../util/random';
import { ManualScheduler } from '../util/scheduler';
import {
  adaptationFactor,
  canInterfere,
  cellDifficulties,
  cellDifficulty,
  eligibleCells,
  isEligibleCell,
  plausibleWrongDigits,
} from './brain';
import {
  BOT_CONFIG,
  BOT_LEVEL_IDS,
  BOT_LEVELS,
  BOT_PACE,
  type BotLevel,
  CELL_TECHNIQUES,
  type CellTechnique,
} from './levels';
import { type MovePace, movePace, type PaceGame, paceFromHistory } from './pace';
import { attachBot } from './runner';
import { stealthBotConfig, stealthBotLevel } from './stealth';

/*
 * The statistical check of work plan stage 5 ("done when"): a simulation on an injected clock and RNG with
 * fixed seeds. Each level plays GAMES_PER_TYPE games of each game type, alone against an idle human, through
 * the real runner and LocalGameHost. Then, from the event log only:
 *   (a) its mistake rate is within 3 standard deviations (binomial) of the table's rate;
 *   (b) every move took "base × cell difficulty (× pace, × adaptation)" with the base inside the level's range,
 *       and the base averages to the middle of that range per game type and per difficulty (the deduction
 *       the move needed);
 *   (c) its locks almost never run out: only the deliberate ~2%, and at most 5%.
 * The results are in the test names (run with --verbose to see the table).
 */

const GAMES_PER_TYPE = 16;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Whether some wrong digit fits at least one of the cell's units and was not tried there (spec §9, [D12]). */
function mistakePossible(s: GameState, cell: CellIndex): boolean {
  const right = Number(s.config.puzzle.solution[cell]);
  const tried = new Set<number>(s.wrong[cell]!.map((w) => w.digit));
  return DIGITS.some(
    (d) => d !== right && !tried.has(d) && unitsOf(cell).some((u) => missingDigits(s.grid, u).includes(d)),
  );
}

interface Move {
  gameType: GameType;
  technique: CellTechnique;
  factor: number;
  /** From the moment it could plan to its digit. */
  ms: number;
  /** ms / (pace × difficulty × adaptation): must be a draw from the level's base range. */
  base: number;
}

interface LevelRun {
  level: BotLevel;
  games: number;
  finished: number;
  digits: number;
  /** Digits where a plausible mistake was possible, and the mistakes among them. */
  attempts: number;
  mistakes: number;
  /** Mistakes where none was possible (must stay 0). */
  impossibleMistakes: number;
  locks: number;
  expired: number;
  moves: Move[];
  /** Refused actions and errors the bot reported (must stay 0). */
  problems: number;
}

/** Reads one finished game into `run`. */
function analyze(g: BotGame, run: LevelRun): void {
  const events = g.host.events;
  const states = replay(events);
  const level = run.level;
  const gameType = g.config.gameType;
  const isMine = (e: GameEvent) => 'playerId' in e && e.playerId === g.botId;

  // When the bot could start thinking about its next move, and what it saw then.
  let planAt = 0;
  let planState: GameState | null = null;
  const resolve = (k: number) => {
    let j = k;
    while (j + 1 < events.length && events[j + 1]!.t === events[k]!.t) j++; // the rest of that batch
    const s = states[j]!;
    const t = events[k]!.t;
    // With every free cell in its own re-lock wait [D2], it can only start when the first wait ends.
    const waits = s.cooldowns.filter((c) => c.playerId === g.botId && c.until > t).map((c) => c.until);
    planAt = eligibleCells(s, g.botId, t).length || !waits.length ? t : Math.min(...waits);
    planState = s;
  };

  events.forEach((e, k) => {
    if (e.type === 'gameStarted') resolve(k);
    if (!isMine(e)) return;
    if (e.type === 'cellLocked') run.locks++;
    if (e.type === 'cellReleased') {
      if (e.reason === 'timeout') run.expired++;
      resolve(k); // a mistake or a lock that ran out ends the move
    }
    if (e.type === 'placedCorrect' || e.type === 'placedWrong') {
      run.digits++;
      const wrong = e.type === 'placedWrong';
      if (mistakePossible(states[k - 1]!, e.cell)) {
        run.attempts++;
        if (wrong) run.mistakes++;
      } else if (wrong) run.impossibleMistakes++;

      const d = cellDifficulty(planState!, e.cell);
      const adapt = adaptationFactor(planState!, g.botId, level);
      const ms = e.t - planAt;
      run.moves.push({
        gameType,
        technique: d.technique,
        factor: d.factor,
        ms,
        base: ms / (BOT_PACE[gameType] * d.factor * adapt),
      });
      if (e.type === 'placedCorrect') resolve(k);
    }
  });
}

function simulate(level: BotLevel): LevelRun {
  const run: LevelRun = {
    level,
    games: 0,
    finished: 0,
    digits: 0,
    attempts: 0,
    mistakes: 0,
    impossibleMistakes: 0,
    locks: 0,
    expired: 0,
    moves: [],
    problems: 0,
  };
  GAME_TYPES.forEach((gameType, ti) => {
    bankPuzzles(gameType, GAMES_PER_TYPE).forEach((puzzle, k) => {
      const g = botGame({ level: level.level, gameType, puzzle, seed: 10_000 * level.level + 100 * ti + k });
      runUntilOver(g);
      run.games++;
      if (g.host.state.result?.reason === 'boardComplete') run.finished++;
      run.problems += g.traces.filter(
        (t) => t.type === 'error' || (t.type === 'action' && t.rejected),
      ).length;
      analyze(g, run);
    });
  });
  return run;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 3σ of the mean of n uniform draws from the level's base range. */
const baseTolerance = (level: BotLevel, n: number) =>
  (3 * (level.thinkMs.max - level.thinkMs.min)) / Math.sqrt(12 * n);
const baseMid = (level: BotLevel) => (level.thinkMs.min + level.thinkMs.max) / 2;

describe('bot simulation: 5 levels × 3 game types × 16 games (work plan stage 5)', () => {
  const runs = BOT_LEVELS.map(simulate);

  const titled = runs.map((run) => {
    const { level } = run;
    const name = `L${level.level} ${level.name}`;
    const p = level.mistakeRate;
    const sd = Math.sqrt((p * (1 - p)) / run.attempts);
    const byType = GAME_TYPES.map(
      (t) => `${t} ${sec(mean(run.moves.filter((m) => m.gameType === t).map((m) => m.ms)))}`,
    );
    const byTechnique = CELL_TECHNIQUES.map((t) => {
      const ms = run.moves.filter((m) => m.technique === t);
      return `${t} ×${ms.length ? mean(ms.map((m) => m.factor)).toFixed(2) : '–'} (n=${ms.length})`;
    });
    const linger = BOT_CONFIG.lingerShare;
    const lsd = Math.sqrt((linger * (1 - linger)) / run.locks);
    return {
      run,
      games: `${name}: ${run.finished}/${run.games} games finished, ${run.digits} digits, ${run.problems} refusals or errors`,
      mistakes:
        `${name}: mistakes ${pct(run.mistakes / run.attempts)} of ${run.attempts} digits that allowed one ` +
        `(table ${pct(p)}, 3σ ${pct(p - 3 * sd)}–${pct(p + 3 * sd)}; ${pct(run.attempts / run.digits)} of all digits)`,
      think:
        `${name}: base ${sec(mean(run.moves.map((m) => m.base)))} (table ${sec(level.thinkMs.min)}–${sec(level.thinkMs.max)}); ` +
        `a move takes ${byType.join(' · ')}; ${byTechnique.join(' · ')}`,
      expired:
        `${name}: ${pct(run.expired / run.locks)} of ${run.locks} locks ran out ` +
        `(deliberate ${pct(linger)}, 3σ ${pct(Math.max(0, linger - 3 * lsd))}–${pct(linger + 3 * lsd)}, at most 5%)`,
      sd,
      lsd,
    };
  });

  it.each(titled)('$games', ({ run }) => {
    expect(run.finished).toBe(run.games);
    expect(run.problems).toBe(0);
    expect(run.digits).toBeGreaterThan(2000);
  });

  it.each(titled)('(a) $mistakes', ({ run, sd }) => {
    expect(Math.abs(run.mistakes / run.attempts - run.level.mistakeRate)).toBeLessThanOrEqual(3 * sd);
    expect(run.impossibleMistakes).toBe(0);
    // A plausible mistake is possible almost everywhere (not in the last gap of a row, column and box).
    expect(run.attempts / run.digits).toBeGreaterThan(0.9);
  });

  it.each(titled)('(b) $think', ({ run }) => {
    const { level } = run;
    // Every move: base × pace × difficulty × adaptation, the base drawn from the table's range (±1 ms rounding).
    for (const m of run.moves) {
      expect(m.base).toBeGreaterThanOrEqual(level.thinkMs.min - 1);
      expect(m.base).toBeLessThanOrEqual(level.thinkMs.max + 1);
    }
    // Centred on the middle of the range, in every game type and for every kind of cell.
    for (const group of [
      ...GAME_TYPES.map((t) => run.moves.filter((m) => m.gameType === t)),
      ...CELL_TECHNIQUES.map((t) => run.moves.filter((m) => m.technique === t)),
    ]) {
      if (group.length < 30) continue;
      expect(Math.abs(mean(group.map((m) => m.base)) - baseMid(level))).toBeLessThanOrEqual(
        baseTolerance(level, group.length),
      );
    }
    // So a move is slower on a harder game type and on a harder cell.
    const typeMs = GAME_TYPES.map((t) => mean(run.moves.filter((m) => m.gameType === t).map((m) => m.ms)));
    expect(typeMs[0]).toBeLessThan(typeMs[1]!);
    expect(typeMs[1]).toBeLessThan(typeMs[2]!);
    const easy = run.moves.filter((m) => m.technique === 'nakedSingle');
    const hidden = run.moves.filter((m) => m.technique === 'hiddenSingle');
    expect(mean(hidden.map((m) => m.ms / BOT_PACE[m.gameType]))).toBeGreaterThan(
      mean(easy.map((m) => m.ms / BOT_PACE[m.gameType])),
    );
  });

  it.each(titled)('(c) $expired', ({ run, lsd }) => {
    const share = run.expired / run.locks;
    expect(share).toBeLessThanOrEqual(0.05);
    expect(Math.abs(share - BOT_CONFIG.lingerShare)).toBeLessThanOrEqual(3 * lsd);
  });

  it('prefers easy cells: most digits go into the simplest (a last gap or a naked single), nearly all into singles', () => {
    const singles: readonly CellTechnique[] = ['lastGap', 'nakedSingle', 'hiddenSingle'];
    for (const { run } of titled) {
      const easy = run.moves.filter((m) => m.technique === 'lastGap' || m.technique === 'nakedSingle').length;
      expect(easy / run.moves.length).toBeGreaterThan(0.6);
      const single = run.moves.filter((m) => singles.includes(m.technique)).length;
      expect(single / run.moves.length).toBeGreaterThan(0.95);
    }
  });
});

/*
 * How long a game against the slowest bot takes (Moshe, 2026-10-14: the Novice thinks 15–25 s a move), on
 * the first 16 "fast" boards of the bank: alone (the human idle: the longest it can be), and against a
 * human who makes a move every 8 s (locks a cell, its digit 2 s later; every 6th digit wrong).
 */
describe('a game against the Novice still ends in a reasonable time', () => {
  const novice = BOT_LEVELS[0]!;
  const puzzles = bankPuzzles('fast', GAMES_PER_TYPE);
  const min = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
  const play = (withHuman: boolean) =>
    puzzles.map((puzzle, k) => {
      const g = botGame({ level: 1, gameType: 'fast', puzzle, seed: 500 + k });
      if (withHuman) scriptHuman(g, { everyMs: 8000, missEvery: 6 });
      const ms = runUntilOver(g, 2 * 3600_000, 1000);
      const bot = eventsOf(g.host.events, 'placedCorrect', g.botId).length;
      const human = eventsOf(g.host.events, 'placedCorrect', HUMAN).length;
      return { g, ms, bot, human, over: g.host.state.result?.reason };
    });
  const alone = play(false);
  const duel = play(true);
  const stats = (games: typeof alone) => {
    const ms = games.map((x) => x.ms);
    const share = mean(games.map((x) => x.bot / (x.bot + x.human)));
    return { mean: mean(ms), max: Math.max(...ms), share };
  };
  const a = stats(alone);
  const d = stats(duel);
  const perMove = mean(alone.map((x) => x.ms / eventsOf(x.g.host.events, 'placedCorrect', x.g.botId).length));

  it(`alone: ${min(a.mean)} on average, ${min(a.max)} at most; ${sec(perMove)} per solved cell (mistakes and adapting included)`, () => {
    for (const x of alone) expect(x.over).toBe('boardComplete');
    // About 33 gaps (a fast board starts with 45–50 givens) at 15–25 s, a last gap quicker, a mistake now and
    // then: well under half an hour.
    expect(a.max).toBeLessThan(30 * 60_000);
    expect(perMove).toBeGreaterThan(novice.thinkMs.min);
    expect(perMove).toBeLessThan(novice.thinkMs.max * BOT_CONFIG.adaptation.slowdown * 1.25);
  });

  it(`against a human at 8 s a move: ${min(d.mean)} on average, ${min(d.max)} at most; the Novice solves ${pct(d.share)} of the cells`, () => {
    for (const x of duel) expect(x.over).toBe('boardComplete');
    expect(d.max).toBeLessThan(10 * 60_000);
    // It still plays: a fair share of the board, less than the quicker human.
    expect(d.share).toBeGreaterThan(0.15);
    expect(d.share).toBeLessThan(0.5);
  });
});

/*
 * The five levels did not change with the stealth bot (stealth-bot plan §12): the same seed plays exactly the same
 * game as before (fingerprints of the event logs recorded on 2026-10-20, before the retaliation policy, the
 * general host and the built levels went in). The first scenario has interferences on, mine at the bot every
 * 15 s (so its interferenceEnded events now reach the runner), its own interferences and its reactions; the
 * second a hard board alone.
 */
describe('the five levels play exactly as before the stealth bot (regression)', () => {
  const fingerprint = (events: readonly GameEvent[]) =>
    createHash('sha256').update(JSON.stringify(events)).digest('hex').slice(0, 16);
  const BEFORE: Record<string, string> = {
    'L1 ranked-like': '8b12e5b9d7a4b830',
    'L1 hard alone': '9d32ac420c0aa829',
    'L2 ranked-like': '5d4f07b9fa843af9',
    'L2 hard alone': 'cfa3ddc318cd426a',
    'L3 ranked-like': 'df496a79312bf397',
    'L3 hard alone': '5908d042b957191f',
    'L4 ranked-like': '38cfdd71f9230314',
    'L4 hard alone': 'f77b77ecb97c82b6',
    'L5 ranked-like': '6e6e2fca7a83f61d',
    'L5 hard alone': 'c69955c71acd5272',
  };

  it.each(BOT_LEVEL_IDS.map((level) => ({ level })))(
    'L$level: the same events, seed for seed',
    ({ level }) => {
      const hit = botGame({ level, seed: 900 + level, rules: { interferences: true } });
      scriptHuman(hit, { missEvery: 4 });
      let k = 0;
      const interfere = () => {
        if (hit.host.state.status === 'over') return;
        if (canInterfere(hit.host.state, HUMAN, hit.botId, hit.clock.now()))
          hit.host.interfere(hit.botId, INTERFERENCE_KINDS[k++ % INTERFERENCE_KINDS.length]!);
        hit.scheduler.setTimeout(interfere, 15_000);
      };
      hit.scheduler.setTimeout(interfere, 15_000);
      runUntilOver(hit);
      // Mine reached it, and ended: what the stealth bot answers. The five levels do not.
      expect(eventsOf(hit.host.events, 'interferenceEnded').some((e) => e.targetId === hit.botId)).toBe(true);
      expect(hit.traces.some((t) => t.type === 'retaliation')).toBe(false);
      expect(fingerprint(hit.host.events)).toBe(BEFORE[`L${level} ranked-like`]);

      const alone = botGame({
        level,
        gameType: 'hard',
        puzzle: bankPuzzles('hard', 1)[0],
        seed: 950 + level,
      });
      runUntilOver(alone);
      expect(fingerprint(alone.host.events)).toBe(BEFORE[`L${level} hard alone`]);
    },
  );
});

// ---------------------------------------------------------------------------------------------------------
// The stealth bot's pace, closed loop (stealth-bot plan §5.1, §12)

/**
 * A model of a person, written apart from the bot's runner. He looks for a cell less surely the easiest one than
 * the bot does (a softmax over the cells' difficulty at `temperature`, the bot's is 0.15), thinks his base × the
 * cell's difficulty × 0.7–1.3, locks the cell when he has worked it out and enters the digit a little later (a
 * plausible wrong one at `mistakeRate`). When someone takes or solves the cell he was thinking about, he looks
 * again, and the time spent on it is lost. He never interferes.
 */
class ModelPlayer {
  private timer: unknown = null;
  private plan: { cell: CellIndex; phase: 'think' | 'type'; typeMs: number } | null = null;
  private acting = false;

  constructor(
    private readonly g: { host: LocalGameHost; clock: ManualClock; scheduler: ManualScheduler },
    private readonly id: string,
    private readonly o: { baseMs: number; temperature: number; mistakeRate: number; rng: Rng },
  ) {
    g.host.subscribe(() => {
      if (!this.acting) this.review();
    });
    this.review();
  }

  private review(): void {
    const s = this.g.host.state;
    const now = this.g.clock.now();
    if (s.status !== 'running') return this.cancel();
    const lock = s.locks.find((l) => l.playerId === this.id);
    if (this.plan?.phase === 'type' && lock?.cell === this.plan.cell && this.timer !== null) return;
    if (
      this.plan?.phase === 'think' &&
      this.timer !== null &&
      isEligibleCell(s, this.id, this.plan.cell, now)
    )
      return;
    this.think(s, now);
  }

  private think(s: GameState, now: number): void {
    this.cancel();
    const cells = eligibleCells(s, this.id, now);
    if (!cells.length) {
      const waits = s.cooldowns.filter((c) => c.playerId === this.id && c.until > now).map((c) => c.until);
      if (waits.length) this.arm(Math.min(...waits) - now, () => this.review());
      return;
    }
    const diffs = cellDifficulties(s);
    const factors = cells.map((c) => diffs[c]!.factor);
    const easiest = Math.min(...factors);
    const weights = factors.map((f) => Math.exp(-(f - easiest) / this.o.temperature));
    let r = this.o.rng.next() * weights.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < cells.length - 1 && (r -= weights[k]!) >= 0) k++;
    const cell = cells[k]!;
    const totalMs = this.o.baseMs * factors[k]! * (0.7 + 0.6 * this.o.rng.next());
    const typeMs = Math.min(totalMs * 0.2, 0.5 * s.config.rules.thinkTimeMs);
    this.plan = { cell, phase: 'think', typeMs };
    this.arm(totalMs - typeMs, () => this.lock());
  }

  private lock(): void {
    const plan = this.plan!;
    const s = this.g.host.state;
    if (s.status !== 'running' || !isEligibleCell(s, this.id, plan.cell, this.g.clock.now()))
      return this.review();
    this.act({ type: 'select', playerId: this.id, cell: plan.cell });
    this.plan = { ...plan, phase: 'type' };
    this.arm(plan.typeMs, () => this.type());
  }

  private type(): void {
    const plan = this.plan!;
    const s = this.g.host.state;
    this.plan = null;
    if (s.status === 'running' && s.locks.some((l) => l.playerId === this.id && l.cell === plan.cell)) {
      const right = Number(s.config.puzzle.solution[plan.cell]) as Digit;
      const wrong = plausibleWrongDigits(s, plan.cell);
      const digit = this.o.rng.next() < this.o.mistakeRate && wrong.length ? pick(this.o.rng, wrong) : right;
      this.act({ type: 'place', playerId: this.id, cell: plan.cell, digit });
    }
    this.review();
  }

  private act(action: Action): void {
    this.acting = true;
    try {
      this.g.host.dispatch(action);
    } finally {
      this.acting = false;
    }
  }

  private arm(ms: number, fn: () => void): void {
    this.timer = this.g.scheduler.setTimeout(
      () => {
        this.timer = null;
        fn();
      },
      Math.max(0, Math.round(ms)),
    );
  }

  private cancel(): void {
    if (this.timer !== null) this.g.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Seats of a ranked two-player game: the model player, and his opponent (another model, or the stealth bot). */
function rankedGame(
  gameType: GameType,
  puzzle: ReturnType<typeof bankPuzzles>[number],
  seed: number,
  players: string[],
) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const config: GameConfig = {
    id: `closed-loop-${seed}`,
    mode: 'ranked',
    gameType,
    puzzle,
    players: players.map((id) => ({ id })),
    rules: defaultRules('ranked', gameType),
    seed,
  };
  const host = new LocalGameHost({ config, playerId: players[0]!, clock, scheduler });
  return { clock, scheduler, host, config };
}

const runToEnd = (g: { host: LocalGameHost; scheduler: ManualScheduler; clock: ManualClock }) => {
  while (g.host.state.status !== 'over' && g.clock.now() < 3 * 3600_000) g.scheduler.advance(2000);
};

/** Moves and their total time, of one player over games (from movePace: the same yardstick as the server's). */
interface Tally {
  moves: number;
  ms: number;
}
const add = (t: Tally, p: MovePace | null) => {
  if (!p) return;
  t.moves += p.moves;
  t.ms += p.rawMs * p.moves;
};

/*
 * The plan's closed loop, in place of "bot against bot" (which is 50% by construction): model players at six
 * paces and on the three game types play ranked games against each other; movePace reads each game;
 * paceFromHistory makes his pace; stealthBotLevel builds the bot; then he plays the stealth bot 12 times. Over
 * all of them the bot's mean time per move must be within ±10% of his, and he must win 40%–60% of the games.
 *
 * STEALTH_BOT_CONFIG.normalization is calibrated on this (2026-10-20): at 1 the bot is about 6% quicker per
 * move and he wins about half; at 1.1 the bot was 5% slower and lost three games of four; at 0.95 it was 12%
 * quicker. Two things pull against each other: the bot takes easier cells than the model (quicker per move,
 * but an easy cell is worth fewer points, §6.4), and the base measured from his games already holds the time
 * he lost to cells taken from under him, which the bot then loses again. Against a model that picks cells as
 * surely as the bot (temperature 0.15), the bot at 1 is about 8% slower and wins only a third: the model is an
 * assumption, and the real tuning is the win rate the admin site shows (paceScale, plan §5.1).
 */
describe('the stealth bot plays at the pace of its opponent (closed loop, plan §5.1, §12)', () => {
  const MODEL = { temperature: 0.4, mistakeRate: 0.06 };
  const PEOPLE = [
    { baseMs: 5000, gameType: 'fast' as GameType },
    { baseMs: 8000, gameType: 'normal' as GameType },
    { baseMs: 10_000, gameType: 'fast' as GameType },
    { baseMs: 14_000, gameType: 'normal' as GameType },
    { baseMs: 18_000, gameType: 'fast' as GameType },
    { baseMs: 7000, gameType: 'hard' as GameType },
  ];
  const HISTORY_GAMES = 3;
  const STEALTH_GAMES = 12;
  const ME_ID = 'person';
  const BOT_ID = 'persona';

  const people = PEOPLE.map((person, pi) => {
    const puzzles = bankPuzzles(person.gameType, 300).slice(100 + 20 * pi);
    // His ranked games against people of his pace: what the server would have measured.
    const history: PaceGame[] = [];
    for (let k = 0; k < HISTORY_GAMES; k++) {
      const g = rankedGame(person.gameType, puzzles[k]!, 7000 + 100 * pi + k, [ME_ID, 'other']);
      new ModelPlayer(g, ME_ID, { ...person, ...MODEL, rng: createRng(1000 + 100 * pi + k) });
      new ModelPlayer(g, 'other', { ...person, ...MODEL, rng: createRng(2000 + 100 * pi + k) });
      runToEnd(g);
      const p = movePace(g.host.events, ME_ID)!;
      history.unshift({
        gameType: person.gameType,
        paceMs: p.baseMs,
        paceMoves: p.moves,
        digits: p.digits,
        mistakes: p.mistakes,
      });
    }
    const pace = paceFromHistory({ gameType: person.gameType, games: history });
    const level = stealthBotLevel(pace);
    // Then the stealth bot, built from that pace.
    const me: Tally = { moves: 0, ms: 0 };
    const bot: Tally = { moves: 0, ms: 0 };
    let wins = 0;
    for (let k = 0; k < STEALTH_GAMES; k++) {
      const seed = 9000 + 100 * pi + k;
      const g = rankedGame(person.gameType, puzzles[HISTORY_GAMES + k]!, seed, [ME_ID, BOT_ID]);
      new ModelPlayer(g, ME_ID, { ...person, ...MODEL, rng: createRng(3000 + seed) });
      attachBot(g.host, {
        botId: BOT_ID,
        level,
        clock: g.clock,
        scheduler: g.scheduler,
        rng: createRng(seed),
        config: stealthBotConfig(),
      });
      runToEnd(g);
      const result = g.host.state.result!;
      expect(result.reason).toBe('boardComplete');
      const place = (id: string) => result.ranking.find((r) => r.playerId === id)!.place;
      wins += place(ME_ID) < place(BOT_ID) ? 1 : place(ME_ID) === place(BOT_ID) ? 0.5 : 0;
      add(me, movePace(g.host.events, ME_ID));
      add(bot, movePace(g.host.events, BOT_ID));
    }
    return { person, pace, me, bot, wins };
  });

  const total = (pick: (p: (typeof people)[number]) => Tally) =>
    people.reduce((t, p) => ({ moves: t.moves + pick(p).moves, ms: t.ms + pick(p).ms }), { moves: 0, ms: 0 });
  const meAll = total((p) => p.me);
  const botAll = total((p) => p.bot);
  const winShare = people.reduce((a, p) => a + p.wins, 0) / (people.length * STEALTH_GAMES);

  it.each(
    people.map((p) => ({
      ...p,
      line: `${sec(p.person.baseMs)} ${p.person.gameType}: measured ${sec(p.pace.baseMs)}, mistakes ${pct(p.pace.mistakeRate)}; per move he ${sec(p.me.ms / p.me.moves)}, the bot ${sec(p.bot.ms / p.bot.moves)}; he won ${p.wins}/${STEALTH_GAMES}`,
    })),
  )('$line', ({ person, pace, me, bot }) => {
    // movePace reads his base back from his games (his base × 0.7–1.3, the mean 1).
    expect(Math.abs(pace.baseMs / person.baseMs - 1)).toBeLessThanOrEqual(0.1);
    // [D97a] It errs at his rate, within the bounds.
    expect(pace.mistakeRate).toBeGreaterThanOrEqual(0.02);
    expect(pace.mistakeRate).toBeLessThanOrEqual(0.14);
    // One person over 12 games: a rough check only. How much easier the bot's cells are than his depends on
    // the board (most on a hard one), which one normalization for all cannot follow.
    expect(Math.abs(bot.ms / bot.moves / (me.ms / me.moves) - 1)).toBeLessThanOrEqual(0.25);
  });

  it(`over all of them: the bot ${sec(botAll.ms / botAll.moves)} a move, he ${sec(meAll.ms / meAll.moves)} (within ±10%); he won ${pct(winShare)} (40%–60%)`, () => {
    expect(Math.abs(botAll.ms / botAll.moves / (meAll.ms / meAll.moves) - 1)).toBeLessThanOrEqual(0.1);
    expect(winShare).toBeGreaterThanOrEqual(0.4);
    expect(winShare).toBeLessThanOrEqual(0.6);
  });
});
