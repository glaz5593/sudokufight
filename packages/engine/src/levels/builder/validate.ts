import { BOT_CONFIG, type BotConfig } from '../../bot/levels';
import {
  agreesWith,
  BOXES,
  boxOf,
  CELL_COUNT,
  type CellIndex,
  COLS,
  filledCount,
  type Grid,
  isSolvedGrid,
  PEERS,
  ROWS,
} from '../../sudoku/board';
import { gradePuzzle } from '../../sudoku/grade';
import { TECHNIQUES } from '../../sudoku/logic';
import { knowableCells, knowablePlacements } from '../../sudoku/reading';
import { moveScore } from '../../sudoku/scoring';
import { hasUniqueSolution } from '../../sudoku/solver';
import { targetTier } from '../../sudoku/targets';
import { seedFromString } from '../../util/random';
import {
  chainPlan,
  DUEL,
  fillPlan,
  FIRST_BOSS,
  LEVEL_GIVENS,
  type LevelLogic,
  levelPlan,
  levelRev,
  levelSeed,
  pointHunterPlan,
  puzzlePlan,
  RACE,
  spotErrorPlan,
  targetBoxEmpties,
  tierOfSlot,
} from '../levels.config';
import { chapterOf, LEVEL_RULES, levelIdOf, type LevelRules, maxLevel, maxMsOf } from '../progress';
import {
  type FillLevelKind,
  fillRegionOf,
  type FindTarget,
  isFillKind,
  type LevelSpec,
  type LevelSpecOf,
} from '../spec';
import { pointStars, starRuleIsOrdered } from '../stars';
import { boxEmpties, withoutNeeded } from './common';
import { gradeTechniques } from './duel';
import {
  digitGapsOutside,
  fillRegionModelMs,
  fillRegionSolve,
  givensAround,
  regionCellsOf,
  regionCloses,
} from './fillRegion';
import { boxEmptiesFit, meetsLogic } from './find';
import { staysTarget, withSpots } from './findDuel';
import { pointHunterBest, scoreYOf } from './pointHunter';
import { FILL_MODEL } from './profiles';
import { blindSwapperProblem, puzzleProblems } from './puzzle';
import { cleanedBoard } from './spotError';

/**
 * levels:validate (plan §5.6, as dev-plan §1.4 adjusts it; dev-plan §3.1, 2ד; 1.0.3: levels-content.md §4.2,
 * §5.3, §5.7, §6): every rule a level must keep. validateLevel() holds for a level and for every equivalent
 * board of it (transformLevel, "שוב" [D63]): it reads only the level itself and the chapter's numbers.
 * validateLevelSet() checks the stored file against the config: ids, kinds, seeds, the plan's numbers, and
 * what holds only across levels.
 *
 * A problem is a sentence starting with the level's id; none means the level is good.
 */

const parse = (text: string): number[] => [...text].map((ch) => (ch >= '1' && ch <= '9' ? Number(ch) : 0));

const isGridText = (text: unknown): text is string =>
  typeof text === 'string' && text.length === CELL_COUNT && /^[0-9]+$/.test(text);

/** The kinds whose board is a full board of its type: the D43 givens apply (dev-plan §1.4). */
const D43_KINDS: ReadonlySet<LevelSpec['kind']> = new Set([
  'find',
  'findDuel',
  'duel',
  'pointHunter',
  'chain',
]);

/** The cells of a target's unit; null for the whole board. */
function scopeCells(t: FindTarget): readonly CellIndex[] | null {
  const s = t.scope;
  if (s.kind === 'board') return null;
  return (s.kind === 'row' ? ROWS : s.kind === 'col' ? COLS : BOXES)[s.index]!.cells;
}

/** A target's own shape: its cells are empty cells of its digit, in its scope. */
function targetShape(grid: Grid, solution: Grid, t: FindTarget): string | null {
  if (!t.accept.length) return 'accepts no cell';
  for (const c of t.accept)
    if (grid[c] !== 0 || solution[c] !== t.digit) return `accepts ${c}, not an empty cell of ${t.digit}`;
  const cells = scopeCells(t);
  if (cells === null) {
    const all: CellIndex[] = [];
    for (let c = 0; c < CELL_COUNT; c++) if (grid[c] === 0 && solution[c] === t.digit) all.push(c);
    if (t.cell !== null || all.join(',') !== [...t.accept].sort((a, b) => a - b).join(','))
      return 'the whole board accepts every empty cell of the digit, and has no one cell';
    return null;
  }
  if (t.cell === null || t.accept.length !== 1 || t.accept[0] !== t.cell)
    return 'a unit target accepts its cell only';
  if (!cells.includes(t.cell)) return `${t.cell} is not in its ${t.scope.kind}`;
  return null;
}

const logicOf = (spec: LevelSpec): LevelLogic => ({
  techniques: spec.check?.techniques ?? [],
  mustNeed: spec.check?.mustNeed ?? [],
});

function validateFind(spec: LevelSpecOf<'find'>, grid: Grid, solution: Grid, out: string[]): void {
  const t = spec.targets.target;
  const logic = logicOf(spec);
  const shape = targetShape(grid, solution, t);
  if (shape) out.push(`target ${shape}`);
  if (!meetsLogic(grid, t, logic))
    out.push(
      `the ${t.digit} of its ${t.scope.kind} is not known with its techniques` +
        (logic.mustNeed.length ? `, or is known without ${logic.mustNeed.join('/')}` : ''),
    );
  if (targetTier(grid, t, logic.techniques) !== t.tier) out.push(`target tier is not ${t.tier}`);
  const range = targetBoxEmpties(spec.chapter, tierOfSlot(spec.slot));
  if (!boxEmptiesFit(grid, t, logic, range)) out.push(`target box empties not ${range.min}–${range.max}`);
}

function validateFindDuel(spec: LevelSpecOf<'findDuel'>, grid: Grid, solution: Grid, out: string[]): void {
  const spots = spec.targets.spots;
  const logic = logicOf(spec);
  const range = targetBoxEmpties(spec.chapter, tierOfSlot(spec.slot));
  if (spots.length !== RACE.spots) out.push(`${spots.length} spots, not ${RACE.spots}`);
  if (new Set(spots.map((s) => s.cell)).size !== spots.length) out.push('two spots share a cell');
  spots.forEach((spot, k) => {
    const shape = targetShape(grid, solution, spot);
    if (shape || spot.scope.kind === 'board') {
      out.push(`spot ${k + 1} ${shape ?? 'is on the whole board'}`);
      return;
    }
    const shown = withSpots(
      grid,
      spots,
      spots.slice(0, k).map((_, j) => j),
    );
    if (!meetsLogic(shown, spot, logic))
      out.push(`spot ${k + 1} is not known with its techniques when shown`);
    if (targetTier(shown, spot, logic.techniques) !== spot.tier)
      out.push(`spot ${k + 1} tier is not ${spot.tier}`);
    if (!staysTarget(grid, spots, k, logic))
      out.push(`spot ${k + 1} is not a target with some earlier spots void`);
    const n = boxEmpties(grid, boxOf(spot.cell!));
    if (n < range.min || n > range.max)
      out.push(`spot ${k + 1} box empties ${n}, not ${range.min}–${range.max}`);
  });
  const bot = spec.bot;
  if (!bot) out.push('a race needs its bot');
  else {
    if (!bot.findMs || bot.findMs.length !== spots.length)
      out.push('the bot has no frozen search range per spot');
    else if (bot.findMs.some(([min, max]) => !(min > 0 && max >= min)))
      out.push('a bot search range is empty');
    for (const share of [bot.missShare, bot.reactShare])
      if (!(typeof share === 'number' && share >= 0 && share <= 1)) out.push('the bot has no frozen shares');
  }
}

/**
 * fillBox, fillRow and fillCol (levels-content.md §4) [D67, D69]: through fillRegionOf, one reading for the
 * three. The region's empties are exactly its editable cells (a fillRow whose cells became a column, as a
 * transposed "שוב" would make them, fails here), the ladder's missing cells and givens around, every digit
 * missing outside from chapter 5 (§4.2), and one answer with the chapter's techniques, not without its must.
 */
function validateFillRegion(
  spec: LevelSpecOf<FillLevelKind>,
  grid: Grid,
  solution: Grid,
  out: string[],
): void {
  const region = fillRegionOf(spec)!;
  const { unit, index, cells } = region;
  const logic = logicOf(spec);
  const plan = fillPlan(spec.chapter, tierOfSlot(spec.slot));
  if (!(Number.isInteger(index) && index >= 0 && index <= 8)) {
    out.push(`no ${unit} ${index}`);
    return;
  }
  const all = regionCellsOf(unit, index);
  const empties = all.filter((c) => grid[c] === 0);
  if (empties.join(',') !== [...cells].sort((a, b) => a - b).join(','))
    out.push(`editable cells are not the ${unit} empties`);
  if (cells.length !== plan.missing) out.push(`${cells.length} missing, not ${plan.missing}`);
  const around = givensAround(grid, all);
  if (around !== plan.around) out.push(`${around} givens around the ${unit}, not ${plan.around}`);
  if (plan.minDigitGaps > 0) {
    const gaps = digitGapsOutside(grid, solution, all);
    const short = gaps.flatMap((n, d) => (n < plan.minDigitGaps ? [d + 1] : []));
    if (short.length)
      out.push(`digit ${short.join(', ')} has no empty cell outside the ${unit} (every digit must miss)`);
  }
  if (!regionCloses(grid, cells, logic.techniques)) out.push(`the ${unit} does not fill with its techniques`);
  if (logic.mustNeed.length && regionCloses(grid, cells, withoutNeeded(logic)))
    out.push(`the ${unit} fills without ${logic.mustNeed.join('/')}`);
}

/**
 * [D67, D74] A fill level's region as a good player fills it by the time model (profiles.ts FILL_MODEL, per cell
 * by what it needs: fillRegionSolve) takes no longer than its ★★. The ladder's thresholds come from that model
 * with a typical mix of cells (§4.4: one to three hidden singles, one elimination from chapter 16); a region
 * that needs far more (five hidden singles and three pairs) would be out of a good player's reach in 60 s.
 * Checked on the stored board only: an equivalent board ("שוב") may read its cells in another order. A sentence
 * with the level's id, or null.
 */
export function fillModelProblem(spec: LevelSpec): string | null {
  if (!isFillKind(spec.kind) || spec.stars.by !== 'timeMs') return null;
  const region = fillRegionOf(spec)!;
  const solve = fillRegionSolve(parse(spec.board.grid), region.cells, logicOf(spec).techniques);
  // A region that does not fill is validateLevel's problem.
  if (!solve) return null;
  const ms = fillRegionModelMs(solve, FILL_MODEL);
  return ms > spec.stars.two
    ? `${spec.id}: a good player needs ${ms / 1000} s by the model, over its ★★ ${spec.stars.two / 1000} s`
    : null;
}

/**
 * The puzzle (levels-content.md §5.7) [D70, D71]: its own rules (builder/puzzle.ts puzzleProblems: one valid
 * arrangement, step by step, one cycle, the fixed boxes apart, the chapter's moving boxes and lock), and from 4
 * moving boxes a blind swapper does not get ★★★ (§5.3), only once the rest holds (it plays the level).
 */
function validatePuzzle(spec: LevelSpecOf<'puzzle'>, rules: LevelRules, out: string[]): void {
  const plan = puzzlePlan(spec.chapter, tierOfSlot(spec.slot));
  out.push(...puzzleProblems(spec, { moving: plan.moving, lockOnCorrect: plan.lockOnCorrect }));
  if (out.length) return;
  const blind = blindSwapperProblem(spec, { rules });
  if (blind) out.push(blind);
}

function validateFullBoard(spec: LevelSpec, grid: Grid, out: string[]): void {
  if (!hasUniqueSolution(grid)) out.push('the board has more than one solution');
  if (gradePuzzle(grid).gameType !== spec.gameType) out.push(`the board is not graded ${spec.gameType}`);
}

function validateSpotError(spec: LevelSpecOf<'spotError'>, grid: Grid, solution: Grid, out: string[]): void {
  const logic = logicOf(spec);
  const plan = spotErrorPlan(spec.chapter, tierOfSlot(spec.slot));
  if (!isGridText(spec.board.mine)) {
    out.push('no "mine" digits');
    return;
  }
  const mine = parse(spec.board.mine);
  if (!hasUniqueSolution(grid)) out.push('the givens alone have more than one solution');
  const errors = spec.targets.errors;
  const at = new Map(errors.map((e) => [e.cell, e]));
  for (let c = 0; c < CELL_COUNT; c++) {
    if (mine[c] === 0) continue;
    if (grid[c] !== 0) out.push(`a "mine" digit on the given ${c}`);
    else if (!at.has(c) && mine[c] !== solution[c]) out.push(`${c} is wrong but not a planted error`);
  }
  const visible = errors.filter((e) => e.visible).length;
  if (visible !== plan.visible || errors.length - visible !== plan.silent)
    out.push(
      `${visible} visible and ${errors.length - visible} silent errors, not ${plan.visible} and ${plan.silent}`,
    );
  const shown = grid.map((v, i) => (v !== 0 ? v : mine[i]!));
  const cleaned = cleanedBoard(grid, mine, solution);
  const known = knowablePlacements(cleaned, logic.techniques);
  const knownLean = logic.mustNeed.length ? knowablePlacements(cleaned, withoutNeeded(logic)) : known;
  const decides = (list: typeof known, c: CellIndex) =>
    list.some((p) => p.cell === c && p.digit === solution[c]);
  for (const e of errors) {
    if (mine[e.cell] !== e.digit || e.digit === solution[e.cell] || grid[e.cell] !== 0) {
      out.push(`${e.cell} is not a planted error`);
      continue;
    }
    const clashGiven = PEERS[e.cell]!.some((p) => grid[p] === e.digit);
    const clashAny = PEERS[e.cell]!.some((p) => shown[p] === e.digit);
    if (e.visible && !clashGiven) out.push(`the visible error at ${e.cell} clashes with no given`);
    if (!e.visible && clashAny) out.push(`the silent error at ${e.cell} clashes`);
    if (!decides(known, e.cell)) out.push(`the right digit at ${e.cell} is not known with its techniques`);
    else if (!e.visible && logic.mustNeed.length && decides(knownLean, e.cell))
      out.push(`the silent error at ${e.cell} is known without ${logic.mustNeed.join('/')}`);
  }
  if (filledCount(mine) !== plan.mine) out.push(`${filledCount(mine)} "mine" digits, not ${plan.mine}`);
}

function validatePointHunter(
  spec: LevelSpecOf<'pointHunter'>,
  grid: Grid,
  solution: Grid,
  out: string[],
): void {
  const logic = logicOf(spec);
  const plan = pointHunterPlan(spec.chapter);
  const { maxMoves, best } = spec.targets;
  if (maxMoves !== plan.maxMoves) out.push(`${maxMoves} moves, not ${plan.maxMoves}`);
  if (spec.stars.by !== 'points') {
    out.push('a point hunter goes by points');
    return;
  }
  const fresh = pointHunterBest(grid, solution, maxMoves, logic.techniques, spec.gameType);
  if (fresh.max !== spec.stars.max)
    out.push(`stored best ${spec.stars.max}, a full search finds ${fresh.max}`);
  if (JSON.stringify(pointStars(spec.stars.max, plan.shares)) !== JSON.stringify(spec.stars))
    out.push('the thresholds do not come from the best');
  const board = grid.slice();
  let sum = 0;
  for (const m of best) {
    if (!knowableCells(board, logic.techniques).includes(m.cell))
      out.push(`best line: ${m.cell} not known then`);
    if (solution[m.cell] !== m.digit) out.push(`best line: ${m.cell} is not ${m.digit}`);
    else if (moveScore(board, m.cell, m.digit, scoreYOf(spec.gameType)).points !== m.points)
      out.push(`best line: ${m.cell} does not score ${m.points}`);
    board[m.cell] = m.digit;
    sum += m.points;
  }
  if (best.length !== maxMoves || sum !== spec.stars.max) out.push('the best line does not make the best');
}

function validateChain(spec: LevelSpecOf<'chain'>, grid: Grid, solution: Grid, out: string[]): void {
  const logic = logicOf(spec);
  const plan = chainPlan(spec.chapter, tierOfSlot(spec.slot));
  const cells = spec.targets.cells;
  if (cells.length !== plan.steps) out.push(`${cells.length} steps, not ${plan.steps}`);
  const lean = withoutNeeded(logic);
  const board = grid.slice();
  let needed = false;
  cells.forEach((cell, i) => {
    const known = knowableCells(board, TECHNIQUES);
    if (known.length !== 1 || known[0] !== cell)
      out.push(
        `step ${i + 1}: the solver knows ${known.length ? known.join(', ') : 'nothing'}, not ${cell} alone`,
      );
    if (
      !knowablePlacements(board, logic.techniques).some((p) => p.cell === cell && p.digit === solution[cell])
    )
      out.push(`step ${i + 1}: ${cell} is not known with its techniques`);
    else if (!knowableCells(board, lean).includes(cell)) needed = true;
    board[cell] = solution[cell]!;
  });
  if (logic.mustNeed.length && !needed) out.push(`no step needs ${logic.mustNeed.join('/')}`);
}

/** Every rule one level keeps, on its own (and on any equivalent board of it). */
export function validateLevel(spec: LevelSpec, rules: LevelRules = LEVEL_RULES): string[] {
  const out: string[] = [];
  const { grid: g, solution: s } = spec.board;
  if (!isGridText(g) || !isGridText(s)) return [`${spec.id}: the board is not 81 digits`];
  const grid = parse(g);
  const solution = parse(s);
  if (!isSolvedGrid(solution)) out.push('the solution is not a solved grid');
  if (!agreesWith(grid, solution)) out.push('the givens disagree with the solution');
  const maxMs = maxMsOf(spec.kind, rules);
  if (!(Number.isInteger(spec.timeLimitMs) && spec.timeLimitMs > 0 && spec.timeLimitMs <= maxMs))
    out.push(`time limit ${spec.timeLimitMs} not within ${maxMs}`);
  if (!starRuleIsOrdered(spec.stars)) out.push('the star thresholds are not ordered');
  if (
    spec.stars.by === 'timeMs' &&
    Math.max(spec.stars.three, spec.stars.two, spec.stars.one) > spec.timeLimitMs
  )
    out.push('a threshold lies beyond the time limit');
  if (/interfer/i.test(JSON.stringify(spec))) out.push('an interference field');
  if (spec.bot && !(spec.bot.pace >= 0.7 && spec.bot.pace <= 1.2)) out.push(`bot pace ${spec.bot.pace}`);
  // [D72] Every boss is a fight against a named bot; only D72 ב's chapter-1 box has none.
  if (spec.boss && !spec.bot && !(spec.chapter === 1 && FIRST_BOSS.kind !== 'findDuel'))
    out.push('a boss needs its bot');
  if (!spec.check) out.push('no build check');
  if (D43_KINDS.has(spec.kind)) {
    const n = filledCount(grid);
    const range = LEVEL_GIVENS[spec.gameType];
    if (n < range.min || n > range.max)
      out.push(`${n} givens, not ${range.min}–${range.max} (${spec.gameType})`);
  }
  if (!out.length)
    switch (spec.kind) {
      case 'find':
        validateFind(spec, grid, solution, out);
        break;
      case 'findDuel':
        validateFindDuel(spec, grid, solution, out);
        break;
      case 'fillBox':
      case 'fillRow':
      case 'fillCol':
        validateFillRegion(spec, grid, solution, out);
        break;
      case 'puzzle':
        validatePuzzle(spec, rules, out);
        break;
      case 'duel':
        if (spec.targets.endAtScore !== DUEL.endAtScore) out.push(`target ${spec.targets.endAtScore}`);
        if (!spec.bot) out.push('a duel needs its bot');
        validateFullBoard(spec, grid, out);
        break;
      case 'spotError':
        validateSpotError(spec, grid, solution, out);
        break;
      case 'pointHunter':
        validatePointHunter(spec, grid, solution, out);
        validateFullBoard(spec, grid, out);
        break;
      case 'chain':
        validateChain(spec, grid, solution, out);
        break;
    }
  return out.map((p) => `${spec.id}: ${p}`);
}

// ---------------------------------------------------------------------------------------------------------
// The whole file

/** The levels file (packages/engine/data/levels.json): the 300 levels and the bot settings they were built with. */
export interface LevelsFile {
  /** botConfigFingerprint() when the file was built: a bot tuning change is a deliberate rebuild. */
  botConfigFingerprint: string;
  levels: LevelSpec[];
}

/**
 * The BOT_CONFIG fields the levels' bots play by: a duel's bot plays the live config (its think times,
 * mistakes, cell choice, reactions; levelBotConfig sets its pace, no lingering, no adaptation), and the
 * race's search ranges and shares are frozen from BOT_CONFIG.find. A hash (seedFromString's FNV-1a), in hex.
 */
export function botConfigFingerprint(config: BotConfig = BOT_CONFIG): string {
  const used = {
    levels: config.levels.map((l) => ({
      level: l.level,
      thinkMs: l.thinkMs,
      mistakeRate: l.mistakeRate,
      reactions: l.reactions,
    })),
    difficulty: config.difficulty,
    cellChoiceTemperature: config.cellChoiceTemperature,
    placeWithin: config.placeWithin,
    solveShare: config.solveShare,
    reactionDelayMs: config.reactionDelayMs,
    retryMs: config.retryMs,
    find: {
      ms: config.find.ms,
      tierFactor: config.find.tierFactor,
      missShare: config.find.missShare,
      reactShare: config.find.reactShare,
    },
  };
  return seedFromString(JSON.stringify(used)).toString(16).padStart(8, '0');
}

/** The plan's numbers a stored level must carry (levels.config), beyond what validateLevel reads. */
function planProblems(spec: LevelSpec, n: number, rules: LevelRules): string[] {
  const out: string[] = [];
  const plan = levelPlan(n, rules);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (spec.kind !== plan.kind) return [`kind ${spec.kind}, not ${plan.kind}`];
  if (spec.gameType !== plan.gameType) out.push(`board type ${spec.gameType}, not ${plan.gameType}`);
  if (spec.timeLimitMs !== plan.timeLimitMs)
    out.push(`time limit ${spec.timeLimitMs}, not ${plan.timeLimitMs}`);
  const givens = filledCount(parse(spec.board.grid));
  if ('givens' in plan && givens !== plan.givens) out.push(`${givens} givens, not ${plan.givens}`);
  if (plan.kind === 'pointHunter') {
    if (spec.stars.by !== 'points' || !same(spec.stars, pointStars(spec.stars.max, plan.shares)))
      out.push('stars not the plan shares of its best');
    if ((spec.worthHint ?? false) !== plan.worthHint)
      out.push(`worthHint ${String(spec.worthHint ?? false)}`);
  } else if (!same(spec.stars, plan.stars)) out.push(`stars ${JSON.stringify(spec.stars)}, not the plan's`);
  const check =
    'logic' in plan
      ? plan.logic
      : plan.kind === 'puzzle'
        ? // A puzzle reads no sudoku technique: its "technique" is the step-by-step fit (puzzleProblems).
          { techniques: [], mustNeed: [] }
        : {
            techniques: plan.kind === 'duel' ? gradeTechniques(plan.gameType) : plan.techniques,
            mustNeed: [],
          };
  if (!same(spec.check, { techniques: check.techniques, mustNeed: check.mustNeed }))
    out.push('check is not the plan logic');
  if (plan.kind === 'fillBox' || plan.kind === 'fillRow' || plan.kind === 'fillCol') {
    const index = isFillKind(spec.kind) ? fillRegionOf(spec)?.index : undefined;
    if (index !== plan.index) out.push(`region ${String(index)}, not the plan's ${plan.index}`);
  }
  if ('bot' in plan) {
    if (spec.bot?.level !== plan.bot.level || spec.bot.pace !== plan.bot.pace)
      out.push(`bot ${spec.bot?.level}×${spec.bot?.pace}, not ${plan.bot.level}×${plan.bot.pace}`);
  } else if (spec.bot) out.push('a bot where the plan has none');
  return out;
}

/** The file against the config: ids, order, kinds, seeds, the plan's numbers, and the rules across levels. */
export function validateLevelSet(file: LevelsFile, rules: LevelRules = LEVEL_RULES): string[] {
  const out: string[] = [];
  const levels = file.levels;
  if (levels.length !== maxLevel(rules)) out.push(`${levels.length} levels, not ${maxLevel(rules)}`);
  const seenGrid = new Map<string, string>();
  const seenSolution = new Map<string, string>();
  /** The regions the fill kinds used: every box, row and column at least once (levels-content.md §11). */
  const used: Record<FillLevelKind, Set<number>> = {
    fillBox: new Set(),
    fillRow: new Set(),
    fillCol: new Set(),
  };
  levels.forEach((spec, k) => {
    const n = k + 1;
    const id = levelIdOf(n);
    const p: string[] = [];
    if (spec.id !== id) p.push(`at place ${n}, not ${id}`);
    const slot = ((n - 1) % rules.chapterSize) + 1;
    if (spec.chapter !== chapterOf(n, rules) || spec.slot !== slot) p.push('chapter or slot out of place');
    if (spec.boss !== (slot === rules.chapterSize)) p.push('boss out of place');
    if (spec.rev !== levelRev(spec.id)) p.push(`rev ${spec.rev}, not ${levelRev(spec.id)}`);
    if (spec.seed !== levelSeed(spec.id, spec.rev)) p.push('seed not from id:rev');
    p.push(...planProblems(spec, n, rules));
    const slow = fillModelProblem(spec);
    if (slow) p.push(slow.slice(spec.id.length + 2));
    const dupGrid = seenGrid.get(spec.board.grid);
    if (dupGrid) p.push(`the givens of ${dupGrid}`);
    const dupSolution = seenSolution.get(spec.board.solution);
    if (dupSolution) p.push(`the solution of ${dupSolution}`);
    seenGrid.set(spec.board.grid, spec.id);
    seenSolution.set(spec.board.solution, spec.id);
    if (isFillKind(spec.kind)) used[spec.kind].add(fillRegionOf(spec)!.index);
    const overlord = spec.bot?.level === 5;
    if (overlord !== (spec.boss && spec.chapter >= 28))
      p.push(overlord ? 'Overlord out of place' : 'no Overlord');
    out.push(...p.map((x) => `${spec.id}: ${x}`));
  });
  for (const [kind, unit] of [
    ['fillBox', 'box'],
    ['fillRow', 'row'],
    ['fillCol', 'column'],
  ] as const) {
    const unused = BOXES.map((b) => b.index).filter((i) => !used[kind].has(i));
    if (unused.length) out.push(`no ${kind} in ${unit} ${unused.join(', ')}`);
  }
  return out;
}
