import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type Block,
  type CellIndex,
  type Digit,
  explain,
  type ExplainOptions,
  type Explanation,
  parseGrid,
  type Step,
  type Technique,
  type WrongReason,
} from '@sudoku-fight/engine';

import i18n from '..';
import {
  formatBlock,
  formatExplanation,
  formatNotYet,
  formatStep,
  formatWrong,
  techniqueName,
} from '../explain';

/**
 * Hebrew and English did not change, word for word (localization plan 0ו, 6.1 #20). Before the wording left the
 * engine, its formatters (explainText.ts: formatExplanation, formatStep, formatWrong, formatBlock, formatNotYet and
 * techniqueName) ran in both languages on a corpus, and their output is __fixtures__/explainGolden.json:
 * - every empty cell of 20 puzzles of the original bank, 4 "normal" and 8 "hard" of the offline bank (chains with
 *   box-line reductions and pairs, up to 53 steps), 3 of them again with the singles only (a level's chapter);
 *   3 puzzles' cells framed by their box, row and column (a find target); a chain level's digit without a
 *   solution; the design fixtures' games move by move; the engine tests' boards and an empty one (beyond);
 * - why a digit is wrong: a clash and a quiet one for every cell of 9 of those puzzles, and the design games';
 * - hand-made steps for every technique and unit kind, blocks, "not yet" with 0 to 4 candidates, the techniques.
 * The engine explains each board again here (its data did not change) and the app's formatter must write exactly
 * what the engine wrote. "samples" keep the full text of one explanation of each shape, so a failure reads as a
 * diff; the whole corpus is checked by a digest of its text. The old formatters are gone: never regenerate this.
 */

interface Texts {
  he: string;
  en: string;
}
interface ExplanationCase {
  /** The board: "givens|solution" (no solution: explained by the digit alone). */
  b: number;
  c: CellIndex;
  o?: ExplainOptions;
}
interface Golden {
  boards: string[];
  samples: (ExplanationCase & Texts & { technique: Explanation['technique'] })[];
  explanations: (ExplanationCase & { h: string })[];
  steps: (Texts & { step: Step })[];
  wrongs: (Texts & { reason: WrongReason })[];
  blocks: (Texts & { cell: CellIndex; block: Block; digit: Digit })[];
  notYet: (Texts & { cell: CellIndex; candidates: Digit[] })[];
  techniques: (Texts & { technique: Technique | 'chain' | 'beyond' })[];
}

const golden = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'explainGolden.json'), 'utf8'),
) as Golden;

const both = (f: (lang: string) => string): Texts => ({ he: f('he'), en: f('en') });

function explained({ b, c, o }: ExplanationCase): Explanation {
  const [givens, solution] = golden.boards[b]!.split('|') as [string, string];
  return explain(parseGrid(givens), c, solution ? parseGrid(solution) : undefined, o);
}

/** Every hidden single's blocked cells, in order: what a stage's "why" may say of a wrong tap. */
const blocksOf = (expl: Explanation) =>
  expl.steps.flatMap((s) =>
    s.technique === 'hiddenSingle'
      ? s.blocked.map((b) => ({ cell: b.cell, block: b.block, digit: s.digit }))
      : [],
  );

const digest = (texts: Texts[]): string =>
  createHash('sha256')
    .update(JSON.stringify(texts.map((t) => [t.he, t.en])))
    .digest('hex')
    .slice(0, 12);

/** The cases whose text differs (the first few, with both texts, so a failure shows the change). */
function differences<T>(cases: readonly T[], made: (c: T) => Texts, want: (c: T) => Texts) {
  const out: { case: T; made: Texts; want: Texts }[] = [];
  for (const c of cases) {
    const m = made(c);
    const w = want(c);
    if (m.he !== w.he || m.en !== w.en) out.push({ case: c, made: m, want: w });
    if (out.length >= 3) break;
  }
  return out;
}

beforeAll(async () => {
  await i18n.loadLanguages(['he', 'en']);
});

describe('the explanations, as the engine wrote them (golden)', () => {
  it('holds a broad corpus', () => {
    expect(golden.explanations.length).toBeGreaterThan(2000);
    expect(new Set(golden.samples.map((s) => s.technique))).toEqual(
      new Set(['nakedSingle', 'hiddenSingle', 'chain', 'beyond']),
    );
    expect(new Set(golden.steps.map((s) => s.step.technique))).toEqual(
      new Set(['nakedSingle', 'hiddenSingle', 'pointing', 'claiming', 'nakedPair', 'hiddenPair']),
    );
  });

  it('samples: one of each shape, word for word', () => {
    const diff = differences(
      golden.samples,
      (s) => both((lang) => formatExplanation(explained(s), lang)),
      (s) => s,
    );
    expect(diff).toEqual([]);
  });

  it('the whole corpus: every explanation and the blocks of its hidden singles', () => {
    const wrong: unknown[] = [];
    for (const e of golden.explanations) {
      const expl = explained(e);
      const texts = [
        both((lang) => formatExplanation(expl, lang)),
        ...blocksOf(expl).map((x) => both((lang) => formatBlock(x.cell, x.block, x.digit, lang))),
      ];
      if (digest(texts) !== e.h) wrong.push({ case: e, texts });
      if (wrong.length >= 3) break;
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it('steps of every technique and unit kind', () => {
    expect(
      differences(
        golden.steps,
        (s) => both((lang) => formatStep(s.step, lang)),
        (s) => s,
      ),
    ).toEqual([]);
  });

  it('why a digit is wrong', () => {
    expect(
      differences(
        golden.wrongs,
        (w) => both((lang) => formatWrong(w.reason, lang)),
        (w) => w,
      ),
    ).toEqual([]);
  });

  it('why a cell is blocked, and "not yet"', () => {
    expect(
      differences(
        golden.blocks,
        (b) => both((lang) => formatBlock(b.cell, b.block, b.digit, lang)),
        (b) => b,
      ),
    ).toEqual([]);
    expect(
      differences(
        golden.notYet,
        (n) => both((lang) => formatNotYet(n.cell, n.candidates, lang)),
        (n) => n,
      ),
    ).toEqual([]);
  });

  it('the techniques’ names', () => {
    expect(
      differences(
        golden.techniques,
        (x) => both((lang) => techniqueName(x.technique, lang)),
        (x) => x,
      ),
    ).toEqual([]);
  });
});
