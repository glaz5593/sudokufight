import type { GameEvent, GameState } from '../game/types';
import { replay } from '../game/view';
import { GAME_TYPES, type GameType } from '../gameType';
import { type CellIndex, DIGITS, missingDigits, unitsOf } from '../sudoku/board';
import {
  bankPuzzles,
  type BotGame,
  botGame,
  eventsOf,
  HUMAN,
  runUntilOver,
  scriptHuman,
} from '../testing/bot';
import { adaptationFactor, cellDifficulty, eligibleCells } from './brain';
import {
  BOT_CONFIG,
  BOT_LEVELS,
  BOT_PACE,
  type BotLevel,
  CELL_TECHNIQUES,
  type CellTechnique,
} from './levels';

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
    // About 50 gaps at 15–25 s, a last gap quicker, a mistake now and then: well under half an hour.
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
