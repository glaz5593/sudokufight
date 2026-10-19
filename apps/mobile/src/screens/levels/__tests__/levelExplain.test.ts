import {
  type AppLevel,
  cellName,
  type Digit,
  DIGITS,
  type LevelSpecOf,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';

import i18n from '../../../i18n';
import { type LevelSession, startLevel } from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { levelWhy, type WhyInput } from '../levelExplain';

/**
 * A stage's "למה?" (dev-plan §2ט, §3.1): for every kind, the engine's explanations (explain, explainSpotError,
 * formatWrong) inside the 'levels' frames, in Hebrew and English (snapshots), with every cell name an LTR isolate
 * in Hebrew. The views are the engine's: a real session on a manual clock, played a little.
 */

jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const LRI = '⁦';
const PDI = '⁩';

const sessions: LevelSession[] = [];
async function sessionOf(level: AppLevel) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: null,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
    },
  );
  sessions.push(session);
  return { session, scheduler };
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

const right = (level: AppLevel, cell: number) => Number(level.board.solution[cell]) as Digit;

/** A wrong digit for `cell` that the keypad still offers. */
function wrongFor(session: LevelSession, cell: number): Digit {
  const view = session.getView();
  return DIGITS.find((d) => d !== right(session.played, cell) && view.keypad.remaining[d - 1]! > 0)!;
}

/** Cell names in Hebrew text that are not inside an LTR isolate. */
function bareCells(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === LRI) depth++;
    else if (ch === PDI) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[A-I]/.test(ch) && /[1-9]/.test(text[i + 1] ?? ''))
      out.push(text.slice(i, i + 2));
  }
  return out;
}

/** The "למה?" of a few moments of each kind, as the result would get them. */
async function inputs(): Promise<[string, AppLevel, WhyInput][]> {
  const out: [string, AppLevel, WhyInput][] = [];

  // find: a wrong tap in the box, then the right one.
  const L001 = levelById('L001') as LevelSpecOf<'find'>;
  {
    const { session } = await sessionOf(L001);
    const target = L001.targets.target;
    const wrong = [...L001.board.grid].findIndex(
      (d, i) =>
        d === '0' && !target.accept.includes(i) && Math.floor(i / 27) === 2 && Math.floor((i % 9) / 3) === 1,
    );
    session.tap(wrong);
    session.tap(target.accept[0]!);
    out.push(['find', L001, { view: session.getView(), wrongTaps: [wrong] }]);
  }

  // the race: nothing taken yet (the first spot's explanation).
  const L012 = levelById('L012')!;
  {
    const { session } = await sessionOf(L012);
    out.push(['findDuel', L012, { view: session.getView(), wrongTaps: [] }]);
  }

  // fill the box: a wrong digit in its first missing cell.
  const L002 = levelById('L002') as LevelSpecOf<'fillBox'>;
  {
    const { session } = await sessionOf(L002);
    const cell = L002.targets.cells[0]!;
    session.host.select(cell);
    session.host.place(cell, wrongFor(session, cell));
    out.push(['fillBox, a mistake', L002, { view: session.getView(), wrongTaps: [] }]);
  }
  {
    const { session } = await sessionOf(L002);
    out.push(['fillBox, no mistake', L002, { view: session.getView(), wrongTaps: [] }]);
  }

  // the duel: a right move (my best), then the same with a wrong digit.
  const L021 = levelById('L021')!;
  {
    const { session } = await sessionOf(L021);
    const cell = [...L021.board.grid].findIndex((d) => d === '0');
    session.host.select(cell);
    session.host.place(cell, right(L021, cell));
    out.push(['duel, my best move', L021, { view: session.getView(), wrongTaps: [] }]);
    const next = [...L021.board.grid].findIndex((d, i) => d === '0' && i > cell);
    session.host.select(next);
    session.host.place(next, wrongFor(session, next));
    out.push(['duel, a mistake', L021, { view: session.getView(), wrongTaps: [] }]);
  }

  // spot the error: one error of two found, and a tap on a right digit of mine.
  const L077 = levelById('L077') as LevelSpecOf<'spotError'>;
  {
    const { session } = await sessionOf(L077);
    const [first] = L077.targets.errors;
    const mineRight = [...L077.board.mine!].findIndex(
      (d, i) => d !== '0' && !L077.targets.errors.some((e) => e.cell === i),
    );
    session.tap(mineRight);
    session.tap(first!.cell);
    out.push(['spotError', L077, { view: session.getView(), wrongTaps: [mineRight] }]);
  }

  // the point hunter: the best line's first move, then another cell.
  const L066 = levelById('L066') as LevelSpecOf<'pointHunter'>;
  {
    const { session } = await sessionOf(L066);
    const first = L066.targets.best[0]!;
    session.host.select(first.cell);
    session.host.place(first.cell, first.digit);
    out.push(['pointHunter', L066, { view: session.getView(), wrongTaps: [] }]);
  }

  // the chain: every step.
  const L085 = levelById('L085')!;
  {
    const { session } = await sessionOf(L085);
    out.push(['chain', L085, { view: session.getView(), wrongTaps: [] }]);
  }
  return out;
}

describe.each(['he', 'en'] as const)('"למה?" (%s)', (lang) => {
  beforeAll(async () => {
    await i18n.changeLanguage(lang);
  });

  it('a sentence for every kind (snapshot)', async () => {
    const all = await inputs();
    expect(new Set(all.map(([, level]) => level.kind))).toEqual(
      new Set(['find', 'findDuel', 'fillBox', 'duel', 'spotError', 'pointHunter', 'chain']),
    );
    for (const [name, level, input] of all) {
      const why = levelWhy(level, input, lang);
      expect({ name, why }).toEqual({ name, why: expect.stringMatching(/\S/) });
      expect(why).toMatchSnapshot(name);
      // Hebrew: every cell name sits in an LTR isolate (CLAUDE.md), or "D5 → 7" turns around.
      if (lang === 'he') expect({ name, bare: bareCells(why!) }).toEqual({ name, bare: [] });
    }
  });
});

describe('what each "למה?" says', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('spot the error: each error, found or not, why it is wrong, and my tap on a right digit', async () => {
    const L077 = levelById('L077') as LevelSpecOf<'spotError'>;
    const { session } = await sessionOf(L077);
    const [first, second] = L077.targets.errors;
    session.tap(first!.cell);
    const why = levelWhy(L077, { view: session.getView(), wrongTaps: [] }, 'he')!;
    expect(why).toContain(`${LRI}${cellName(first!.cell)}${PDI}, נמצאה: `);
    expect(why).toContain(`${LRI}${cellName(second!.cell)}${PDI}, לא נמצאה: `);
    expect(why).not.toContain('ההקשה עליו עלתה');
  });

  it('the point hunter: my points against the board’s best, as a share, and the best line', async () => {
    const L066 = levelById('L066') as LevelSpecOf<'pointHunter'>;
    const { session } = await sessionOf(L066);
    const first = L066.targets.best[0]!;
    session.host.select(first.cell);
    session.host.place(first.cell, first.digit);
    const score = session.getView().players[0]!.score;
    const max = L066.stars.by === 'points' ? L066.stars.max : 0;
    const why = levelWhy(L066, { view: session.getView(), wrongTaps: [] }, 'he')!;
    expect(why).toContain(
      `צברת ${score} מתוך ${max} נקודות, ${LRI}${Math.round((score / max) * 100)}%${PDI}`,
    );
    expect(why).toContain(
      `${first.digit} ב־${LRI}${cellName(first.cell)}${PDI} ${LRI}+${first.points}${PDI}`,
    );
  });

  it('the chain: a step a line, in order, never ahead of the board', async () => {
    const L085 = levelById('L085') as LevelSpecOf<'chain'>;
    const { session } = await sessionOf(L085);
    const why = levelWhy(L085, { view: session.getView(), wrongTaps: [] }, 'en')!;
    const lines = why.split('\n').filter((l) => /^Step \d:/.test(l));
    expect(lines.map((l) => l.slice(0, 7))).toEqual(L085.targets.cells.map((_, k) => `Step ${k + 1}:`));
    L085.targets.cells.forEach((cell, k) => expect(lines[k]).toContain(cellName(cell)));
  });

  it('nothing to explain: null, never a throw', () => {
    const L001 = levelById('L001')!;
    const broken = { ...L001, board: { ...L001.board, grid: '0'.repeat(81) } } as AppLevel;
    expect(() =>
      levelWhy(broken, { view: { players: [], wrong: [] } as never, wrongTaps: [] }, 'he'),
    ).not.toThrow();
  });
});
