import {
  type AppLevel,
  type CellIndex,
  cellName,
  type Digit,
  explain,
  type ExplainOptions,
  explainSpotError,
  fillRegionOf,
  type GameView,
  type Grid,
  LEVEL_PENALTY_MS,
  type LevelSpecOf,
  parseGrid,
  puzzleExplainSteps,
  whyWrong,
} from '@sudoku-fight/engine';

import { ltr, scoreText, signedText } from '../../components/player/format';
import i18n from '../../i18n';
import { decimalSeparator, percent } from '../../i18n/compose';
import { formatExplanation, formatWrong } from '../../i18n/explain';
import { findWhy, type LevelFinishResult } from '../../levels/levelSession';
import type { LevelsT } from './levelWording';

/**
 * A stage's "למה?" on its result (components.md §19.10; dev-plan §2ט), for every kind: the engine's explanations
 * (explain, explainSpotError, whyWrong), worded by i18n/explain.ts in the app's language (the cell names already
 * isolated in a right-to-left one), inside the 'levels' namespace's frames. Pure: the stage as played and how it
 * ended in, text out; nothing here decides a rule.
 *
 * - find: the target in its scope, and why my first wrong tap could not hold it (the session's findWhy).
 * - the race: the first spot I did not take (else the first), in its scope, on the board as it was shown.
 * - fill the box, the row, the column (one path, fillRegionOf [D69]): my first wrong digit in the region and
 *   why, and why the right one holds (in the region's frame); with no mistake, the region's first missing cell.
 * - the duel: my first wrong digit and why; with none, why my best move holds.
 * - spot the error: each planted error, found or not, why it is wrong and why the right digit holds; and my
 *   first tap on a right digit of mine.
 * - the point hunter: my points against the board's best, as a share; the best line; why its first move holds.
 * - the chain: each step, why it is the one cell known at that moment (on the board with the steps before it).
 * - the puzzle: the engine's puzzleExplainSteps, one place at a time from the start to the solution, each with
 *   its reason (the one box that fits a place, or the one place a box fits); this file only words it.
 *
 * The board an explanation reads: the stage's start for a target (plus a race's spots or a chain's steps
 * before it); the end's board, the cell emptied, for a digit of mine (its right digits only: a wrong one never
 * stays), since the end's picture has no history. The level data ships no technique list (AppLevel has no
 * `check`), so the engine explains with all it knows, simplest first: the chapter's own techniques come first.
 */

/** What the explanation reads of a stage's end. */
export type WhyInput = Pick<LevelFinishResult, 'view' | 'wrongTaps'>;

/**
 * "למה?" for the stage as played (`played`: the attempt's board), or null when nothing explains. `lang`: the
 * language to write in (i18n.language).
 */
export function levelWhy(
  played: AppLevel,
  r: WhyInput,
  lang: string,
  t: LevelsT = i18n.getFixedT(lang, 'levels') as LevelsT,
): string | null {
  try {
    const lines = whyLines(played, r, lang, t);
    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

function whyLines(played: AppLevel, r: WhyInput, lang: string, t: LevelsT): string[] {
  const ctx = context(played, r.view, lang);
  switch (played.kind) {
    case 'find': {
      const text = findWhy(played, r.wrongTaps, lang);
      return text ? [text] : [];
    }
    case 'findDuel':
      return raceWhy(played, ctx, t);
    case 'fillBox':
    case 'fillRow':
    case 'fillCol': {
      const region = fillRegionOf(played)!;
      const unit = { kind: region.unit, index: region.index };
      const first = region.cells[0];
      return (
        mistakeWhy(ctx, t, region.cells, unit) ??
        lineOf(first === undefined ? null : ctx.explained(ctx.endBoard(first), first, { unit }))
      );
    }
    case 'puzzle':
      return puzzleWhy(played, t);
    case 'duel': {
      const best = ctx.me?.bestMove ?? null;
      return (
        mistakeWhy(ctx, t) ??
        (best
          ? lineOf(ctx.explained(ctx.endBoard(best.cell), best.cell), (text) =>
              t('explain.best', { digit: best.digit, cell: ltr(cellName(best.cell)), text }),
            )
          : [])
      );
    }
    case 'spotError':
      return spotErrorWhy(played, ctx, r.wrongTaps, t);
    case 'pointHunter':
      return pointHunterWhy(played, ctx, t);
    case 'chain':
      return chainWhy(played, ctx, t);
  }
}

interface WhyContext {
  lang: string;
  view: GameView;
  /** The stage's givens. */
  grid: number[];
  solution: number[];
  me: GameView['players'][number] | null;
  /** The board at the end (right digits only: a wrong one never stays), with `cell` empty again. */
  endBoard: (cell: CellIndex) => number[];
  /**
   * The engine's explanation of `cell` on `board`, formatted; null when it cannot be had. `solved` false: by
   * the digit asked alone (a chain board need not have one solution).
   */
  explained: (
    board: Grid,
    cell: CellIndex | undefined,
    options?: ExplainOptions,
    solved?: boolean,
  ) => string | null;
}

function context(played: AppLevel, view: GameView, lang: string): WhyContext {
  const grid = parseGrid(played.board.grid);
  const solution = parseGrid(played.board.solution);
  return {
    lang,
    view,
    grid,
    solution,
    me: view.players.find((p) => p.id === view.me) ?? null,
    endBoard: (cell) => view.grid.map((v, i) => (i === cell ? 0 : v)),
    explained: (board, cell, options = {}, solved = true) => {
      if (cell === undefined || board[cell] !== 0) return null;
      try {
        return formatExplanation(explain(board, cell, solved ? solution : undefined, options), lang);
      } catch {
        return null;
      }
    },
  };
}

/** One line, or none; `frame` puts it in words of its own. */
function lineOf(text: string | null, frame?: (text: string) => string): string[] {
  if (text === null) return [];
  return [frame ? frame(text) : text];
}

/** My first wrong digit (in `cells`, when given): why it was wrong, and why the right digit holds. */
function mistakeWhy(
  ctx: WhyContext,
  t: LevelsT,
  cells?: readonly CellIndex[],
  unit?: ExplainOptions['unit'],
): string[] | null {
  const myId = ctx.view.me;
  const at = ctx.view.wrong.findIndex(
    (list, c) => (!cells || cells.includes(c)) && list.some((w) => w.playerId === myId),
  );
  if (at < 0) return null;
  const digit = ctx.view.wrong[at]!.find((w) => w.playerId === myId)!.digit;
  const board = ctx.endBoard(at);
  const reason = formatWrong(whyWrong(board, at, digit, ctx.solution), ctx.lang);
  return [
    t('explain.mistake', { digit, cell: ltr(cellName(at)), reason }),
    ...lineOf(ctx.explained(board, at, { unit })),
  ];
}

/** The race: the first spot I did not take (else the first), on the board as it was shown. */
function raceWhy(played: LevelSpecOf<'findDuel'>, ctx: WhyContext, t: LevelsT): string[] {
  const spots = played.targets.spots;
  const states = ctx.view.level?.find?.spots ?? [];
  const missed = states.findIndex((s) => !(s.state === 'won' && s.playerId === ctx.view.me));
  const k = missed < 0 || missed >= spots.length ? 0 : missed;
  const board = ctx.grid.slice();
  for (let j = 0; j < k; j++) {
    const s = states[j];
    if (s?.state === 'won') board[s.cell] = spots[j]!.digit;
  }
  const spot = spots[k];
  if (!spot) return [];
  const cell = spot.cell ?? spot.accept.find((c) => board[c] === 0);
  const unit = spot.scope.kind === 'board' ? undefined : spot.scope;
  return lineOf(ctx.explained(board, cell, { unit, digit: spot.digit }), (text) =>
    t('explain.spot', { n: k + 1, text }),
  );
}

/** Spot the error: every planted error, found or not, and my first tap on a right digit of mine. */
function spotErrorWhy(
  played: LevelSpecOf<'spotError'>,
  ctx: WhyContext,
  wrongTaps: readonly CellIndex[],
  t: LevelsT,
): string[] {
  const mine = parseGrid(played.board.mine ?? '0'.repeat(ctx.grid.length));
  const errors = played.targets.errors;
  const found = ctx.view.level?.find?.found ?? [];
  const lines = errors.flatMap((e) => {
    const x = explainSpotError(ctx.grid, mine, e.cell, e.digit, ctx.solution);
    const key = found.includes(e.cell) ? 'explain.errorFound' : 'explain.errorMissed';
    return [
      t(key, { cell: ltr(cellName(e.cell)), reason: formatWrong(x.reason, ctx.lang) }),
      formatExplanation(x.explanation, ctx.lang),
    ];
  });
  const tapped = wrongTaps.find(
    (c) => ctx.grid[c] === 0 && mine[c] !== 0 && !errors.some((e) => e.cell === c),
  );
  if (tapped !== undefined)
    lines.push(
      t('explain.rightTap', {
        cell: ltr(cellName(tapped)),
        digit: mine[tapped]!,
        penalty: signedText(LEVEL_PENALTY_MS / 1000, decimalSeparator(t)),
      }),
    );
  return lines;
}

/** The point hunter: my points as a share of the board's best, the best line, and why its first move holds. */
function pointHunterWhy(played: LevelSpecOf<'pointHunter'>, ctx: WhyContext, t: LevelsT): string[] {
  const max = played.stars.by === 'points' ? played.stars.max : 0;
  const score = ctx.me?.score ?? 0;
  const share = max > 0 ? Math.round((Math.max(0, score) / max) * 100) : 0;
  const decimal = decimalSeparator(t);
  const best = played.targets.best;
  // The moves one after another (player:sep, " · "); a per cent in the language's pattern (D108).
  const moves = best
    .map((m) =>
      t('explain.move', {
        digit: m.digit,
        cell: ltr(cellName(m.cell)),
        points: signedText(m.points, decimal),
      }),
    )
    .join(t('player:sep'));
  return [
    t('explain.points', {
      points: scoreText(score, decimal),
      count: max,
      max: scoreText(max, decimal),
      percent: ltr(percent(share, t)),
    }),
    ...(best.length ? [t('explain.line', { moves })] : []),
    ...lineOf(ctx.explained(ctx.grid, best[0]?.cell)),
  ];
}

/**
 * The puzzle: the engine's steps from the start to the solution, each "Step 2: only the box that started at
 * place 7 fits place 3: …" (places said 1–9, row-major, as on the board, which is always LTR).
 */
function puzzleWhy(played: LevelSpecOf<'puzzle'>, t: LevelsT): string[] {
  return puzzleExplainSteps(played).map((step, k) =>
    t('explain.step', {
      n: k + 1,
      text: t(`explain.puzzle.${step.reason}`, { place: step.place + 1, from: step.from + 1 }),
    }),
  );
}

/** The chain: each step on the board with the steps before it (its digits are forced in every solution). */
function chainWhy(played: LevelSpecOf<'chain'>, ctx: WhyContext, t: LevelsT): string[] {
  const board = ctx.grid.slice();
  return played.targets.cells.flatMap((cell, k) => {
    const digit = ctx.solution[cell] as Digit;
    const text = ctx.explained(board, cell, { digit }, false);
    board[cell] = digit;
    return lineOf(text, (step) => t('explain.step', { n: k + 1, text: step }));
  });
}
