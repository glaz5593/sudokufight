import type { GameType } from '../../gameType';
import { CELL_COUNT, gridToString, isSolvedGrid, parseGrid } from '../../sudoku/board';
import { generateSolvedGrid } from '../../sudoku/generate';
import { ManualClock } from '../../util/clock';
import { createRng, type Rng, seedFromString, shuffled } from '../../util/random';
import { LEVEL_RULES, type LevelRules } from '../progress';
import {
  applyPuzzle,
  bandOf,
  boxFits,
  createPuzzle,
  PUZZLE_PLACES,
  puzzleCycles,
  type PuzzleFit,
  puzzleFitOf,
  type PuzzleState,
  puzzleStepsFrom,
  stackOf,
} from '../puzzle';
import type { AppLevelOf, LevelSpecOf, Stars, TimeStars } from '../spec';
import { BuildError } from './common';
import type { Built } from './find';

/**
 * The puzzle, "פאזל" (levels-content.md §5) [D70, D71]: a solved board cut into its nine boxes, `9 − moving`
 * of them fixed at home, the others shuffled into one cycle. The builder draws a solution, the fixed places and
 * the cycle from the level's seed, and keeps a draw only when:
 * - at least two fixed boxes lie in different bands and different stacks (that blocks the 36 moves of whole
 *   bands and stacks that keep any board valid);
 * - with the fixed boxes at home, exactly one arrangement of the others is a valid sudoku [D70b], counted in
 *   full (so "any valid arrangement" and "the stored one" are the same thing);
 * - it solves step by step: always a place only one box fits, or a box that fits only one place (§5.2), the
 *   puzzle's "technique" and the source of "למה?" (puzzleExplainSteps);
 * - every moving box starts away from home, and the moving boxes make one cycle: the fewest swaps are `moving`
 *   less one.
 * `board.grid` is the solution itself; the start is `targets.start`. lockOnCorrect is the plan's (off in every
 * chapter, D71), kept in the level so a change of the table never alters a built level.
 *
 * Also here, for levels:validate (validate.ts) and the simulation: puzzleProblems() (§5.7) and the blind
 * swapper of §5.3 (blindSwapperRuns, blindSwapperProblem).
 */

/** What the builder needs of a puzzle level's plan (levels.config's LevelPlanOf<'puzzle'> carries these). */
export interface PuzzleBuildPlan {
  id: string;
  rev: number;
  seed: number;
  chapter: number;
  slot: number;
  kind: 'puzzle';
  boss: boolean;
  gameType: GameType;
  timeLimitMs: number;
  stars: TimeStars;
  /** How many boxes move: 3 in chapters 1–3, up to 6 [D70a]; the others (at least 2) stay fixed at home. */
  moving: number;
  /** A box that reaches home locks there: never by default [D71]. */
  lockOnCorrect: boolean;
}

/** The fewest fixed boxes: two, in different bands and stacks, make the arrangement one (§5.2). */
export const PUZZLE_MIN_FIXED = 2;

/** Draws before the builder gives up: about 1 in 20 draws has a second arrangement (§5.2). */
export const PUZZLE_ATTEMPTS = 200;

// ---------------------------------------------------------------------------------------------------------
// Counting and checking

/** Whether two of the fixed places lie in different bands and different stacks. */
export const fixedApart = (fixed: readonly number[]): boolean =>
  fixed.some((p) => fixed.some((q) => bandOf(p) !== bandOf(q) && stackOf(p) !== stackOf(q)));

/**
 * How many arrangements with the fixed boxes at home are a valid sudoku, counted in full by backtracking over
 * the places (each box tried where it fits beside the ones placed); stops early at `limit`. Without a fixed box
 * every board has at least 36 (whole bands and stacks moved).
 */
export function countArrangements(
  solution: string,
  fixed: readonly number[],
  limit = Number.POSITIVE_INFINITY,
): number {
  return countWithFit(puzzleFitOf(solution), fixed, limit);
}

function countWithFit(fit: PuzzleFit, fixed: readonly number[], limit: number): number {
  const placed = new Map<number, number>(fixed.map((p) => [p, p]));
  const places = PUZZLE_PLACES.filter((p) => !placed.has(p));
  const used = new Set<number>();
  let n = 0;
  const place = (k: number): void => {
    if (n >= limit) return;
    if (k === places.length) {
      n++;
      return;
    }
    const p = places[k]!;
    for (const home of places) {
      if (used.has(home) || !boxFits(fit, home, p, placed)) continue;
      used.add(home);
      placed.set(p, home);
      place(k + 1);
      placed.delete(p);
      used.delete(home);
    }
  };
  place(0);
  return n;
}

/** Whether the puzzle solves step by step from its fixed boxes, to the last moving one (§5.2). */
export const solvesStepByStep = (solution: string, fixed: readonly number[]): boolean =>
  puzzleStepsFrom(solution, fixed, PUZZLE_PLACES).length === PUZZLE_PLACES.length - fixed.length;

/** One cycle through the moving places, every box away from home: start[m_i] = m_(i+1), in a drawn order. */
export function drawCycle(rng: Rng, moving: readonly number[]): number[] {
  const start = PUZZLE_PLACES.slice();
  const order = shuffled(rng, moving);
  order.forEach((p, i) => {
    start[p] = order[(i + 1) % order.length]!;
  });
  return start;
}

// ---------------------------------------------------------------------------------------------------------
// Building

export function buildPuzzle(
  plan: PuzzleBuildPlan,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'puzzle'>> {
  const fixedCount = PUZZLE_PLACES.length - plan.moving;
  if (!(Number.isInteger(plan.moving) && plan.moving >= 2 && fixedCount >= PUZZLE_MIN_FIXED))
    throw new BuildError(plan.id, `${plan.moving} moving boxes leave fewer than ${PUZZLE_MIN_FIXED} fixed`);
  for (let attempt = 1; attempt <= PUZZLE_ATTEMPTS; attempt++) {
    const solution = gridToString(generateSolvedGrid(rng));
    const fixed = shuffled(rng, PUZZLE_PLACES)
      .slice(0, fixedCount)
      .sort((a, b) => a - b);
    if (!fixedApart(fixed)) continue;
    if (countArrangements(solution, fixed, 2) !== 1) continue;
    if (!solvesStepByStep(solution, fixed)) continue;
    const start = drawCycle(
      rng,
      PUZZLE_PLACES.filter((p) => !fixed.includes(p)),
    );
    return {
      spec: {
        id: plan.id,
        rev: plan.rev,
        chapter: plan.chapter,
        slot: plan.slot,
        kind: 'puzzle',
        boss: plan.boss,
        seed: plan.seed,
        gameType: plan.gameType,
        board: { grid: solution, solution },
        timeLimitMs: plan.timeLimitMs,
        targets: { start, fixed, lockOnCorrect: plan.lockOnCorrect },
        stars: plan.stars,
        // A puzzle reads no sudoku technique: its "technique" is the step-by-step fit, checked above.
        check: { techniques: [], mustNeed: [] },
      },
      attempts: attempt,
    };
  }
  throw new BuildError(
    plan.id,
    `no puzzle of ${plan.moving} moving with one arrangement in ${PUZZLE_ATTEMPTS} tries`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// levels:validate (§5.7)

/** What a puzzle level must carry by its plan; each check runs only when given. */
export interface PuzzleExpect {
  /** The plan's moving boxes (PUZZLE_ROWS). */
  moving?: number;
  /** The plan's lockOnCorrect [D71]. */
  lockOnCorrect?: boolean;
}

/**
 * Every rule of a puzzle level of its own (and of any equivalent board of it, "שוב" [D63]), as levels:validate
 * reads them (levels-content.md §5.7); the sentences carry no id (validateLevel prefixes it). Not here: that the
 * solution is no ranked board and no other level's (validateLevelSet, the build's `avoid`), the time limit
 * against maxMsOf('puzzle') and the star order (validateLevel's own), and the blind swapper
 * (blindSwapperProblem, from 4 moving boxes).
 */
export function puzzleProblems(level: AppLevelOf<'puzzle'>, expect: PuzzleExpect = {}): string[] {
  const out: string[] = [];
  const { grid, solution } = level.board;
  if (solution.length !== CELL_COUNT || !isSolvedGrid(parseGrid(solution)))
    return ['the solution is not a solved grid'];
  if (grid !== solution) out.push("a puzzle's board is its solution");
  const { start, fixed, lockOnCorrect } = level.targets;
  const isPlace = (p: unknown) => Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 8;
  if (start.length !== 9 || !start.every(isPlace) || new Set(start).size !== 9)
    return [...out, 'the start is not an arrangement of the nine boxes'];
  if (
    !fixed.every(isPlace) ||
    fixed.some((p, k) => k > 0 && p <= fixed[k - 1]!) ||
    fixed.length < PUZZLE_MIN_FIXED
  )
    return [
      ...out,
      `the fixed places ${JSON.stringify(fixed)} are not ${PUZZLE_MIN_FIXED}+ ascending places`,
    ];
  for (const p of fixed) if (start[p] !== p) out.push(`the fixed box of place ${p} does not start at home`);
  if (!fixedApart(fixed)) out.push('no two fixed boxes lie in different bands and stacks');
  const moving = PUZZLE_PLACES.filter((p) => !fixed.includes(p));
  if (expect.moving !== undefined && moving.length !== expect.moving)
    out.push(`${moving.length} moving boxes, not ${expect.moving}`);
  const home = moving.filter((p) => start[p] === p);
  if (home.length) out.push(`moving box ${home.join(', ')} starts at home`);
  const cycles = puzzleCycles(start);
  if (!home.length && cycles.length !== 1) out.push(`the moving boxes make ${cycles.length} cycles, not one`);
  const count = countArrangements(solution, fixed);
  if (count !== 1) out.push(`${count} valid arrangements, not one`);
  else if (!solvesStepByStep(solution, fixed)) out.push('it does not solve step by step');
  if (expect.lockOnCorrect !== undefined && lockOnCorrect !== expect.lockOnCorrect)
    out.push(`lockOnCorrect ${String(lockOnCorrect)}, not the chapter's ${String(expect.lockOnCorrect)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// The blind swapper (§5.3): a player who swaps without reading a digit

/**
 * [D74] Assumptions, not calibrated: the blind swapper drags a pair every 1.5 s (the model's time per swap,
 * §5.3), from the first moment, and pays the 5 s of every wrong swap; 200 runs a level. From 4 moving boxes it
 * must get ★★★ in fewer than `maxThreeShare` (35%) of its runs: most of its attempts fall short of ★★★, but
 * not all (see below). With 3 there are only 3 swaps, and guessing cannot be prevented: chapters 1–3 are the
 * introduction (§5.3).
 *
 * The rule as agreed (1.0.3 review, 2026-10-20): the plan's first wording, "a blind swapper never reaches ★★★
 * from 4 moving boxes", cannot hold with 4 moving and ★★★ at 36 s (a 4-cycle guessed blind is ★★★ about a
 * quarter of the time). The chapters' moving boxes are content (PUZZLE_ROWS), so they stay; the bound is the
 * measured one with a margin, and the spec says so (01-SPEC §5.3.2, §5.3.9).
 *
 * Measured on the shipped levels.json (2026-10-20, these numbers): with 3 moving (★★★ 26 s) a blind swapper
 * gets ★★★ in 64–72% of its runs; with 4 (★★★ 36 s, chapters 4–7) in 22–30% (at least ★ in 41–45%), and most
 * runs run out of time; with 5 (chapters 8–16) in 3–8%; with 6 (chapters 17–30) in 0–2%. A lucky few cannot be
 * kept out with 4 moving: a tenth of the runs end by 12.5 s, faster than a good player (27.5 s). A stricter
 * share (say 10%) holds from 5 moving only.
 */
export const BLIND_SWAPPER = {
  swapMs: 1500,
  runs: 200,
  fromMoving: 4,
  maxThreeShare: 0.35,
} as const;

export interface BlindSwapperOptions {
  swapMs?: number;
  runs?: number;
  /** The runs' seed; by default from the level's id, rev and its start. */
  seed?: number;
  rules?: LevelRules;
}

export interface BlindSwapperRun {
  solved: boolean;
  /** The level clock at the end (the limit when the time ran out). */
  elapsedMs: number;
  swaps: number;
  mistakes: number;
  stars: Stars;
}

/**
 * Plays the level `runs` times through the puzzle engine itself (createPuzzle, applyPuzzle), with a player who
 * swaps two random movable boxes every `swapMs` (it sees the fixed boxes and, with the lock, the locked ones),
 * until the puzzle ends. Deterministic per seed.
 */
export function blindSwapperRuns(
  level: AppLevelOf<'puzzle'>,
  o: BlindSwapperOptions = {},
): BlindSwapperRun[] {
  const swapMs = o.swapMs ?? BLIND_SWAPPER.swapMs;
  const runs = o.runs ?? BLIND_SWAPPER.runs;
  const rng = createRng(
    o.seed ?? seedFromString(`${level.id}:r${level.rev}:blind:${level.targets.start.join('')}`),
  );
  const out: BlindSwapperRun[] = [];
  for (let k = 0; k < runs; k++) {
    const clock = new ManualClock();
    const player = { id: 'blind' };
    let state: PuzzleState = createPuzzle(
      { id: `blind-${k}`, spec: level, player },
      { clock, attempt: 1, rules: o.rules ?? LEVEL_RULES },
    ).state;
    state = applyPuzzle(state, { type: 'start' }, 0).state;
    for (let t = swapMs; state.status === 'running'; t += swapMs) {
      const movable = PUZZLE_PLACES.filter((p) => !state.locked[p]);
      const [from, to] = shuffled(rng, movable);
      state = applyPuzzle(state, { type: 'swap', playerId: player.id, from: from!, to: to! }, t).state;
    }
    const over = state.result!;
    out.push({
      solved: over.reason === 'targetReached',
      elapsedMs: over.elapsedMs,
      swaps: over.swaps,
      mistakes: over.mistakes,
      stars: over.stars,
    });
  }
  return out;
}

/**
 * levels:validate's rule of §5.3: from BLIND_SWAPPER.fromMoving moving boxes, a blind swapper gets ★★★ in fewer
 * than maxThreeShare of its runs (35% by default: most of its attempts have no ★★★). A sentence when it gets it
 * as often or more (no id: validateLevel prefixes it), null when the level keeps the rule or has fewer moving
 * boxes.
 */
export function blindSwapperProblem(
  level: AppLevelOf<'puzzle'>,
  o: BlindSwapperOptions & { maxThreeShare?: number; fromMoving?: number } = {},
): string | null {
  const moving = PUZZLE_PLACES.length - level.targets.fixed.length;
  if (moving < (o.fromMoving ?? BLIND_SWAPPER.fromMoving)) return null;
  const runs = blindSwapperRuns(level, o);
  const share = runs.filter((r) => r.stars === 3).length / runs.length;
  const max = o.maxThreeShare ?? BLIND_SWAPPER.maxThreeShare;
  return share >= max
    ? `a blind swapper gets ★★★ in ${Math.round(share * 100)}% of its runs (under ${Math.round(max * 100)}% allowed)`
    : null;
}
