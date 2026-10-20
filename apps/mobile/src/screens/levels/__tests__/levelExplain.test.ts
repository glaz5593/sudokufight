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
import { firstLevelOf, levelsOf } from '../../../levels/__tests__/helpers/levelsOf';
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

  // find: a wrong tap in the target's box, then the right one (stages picked by kind: helpers/levelsOf).
  const FIND = firstLevelOf('find', 1) as LevelSpecOf<'find'>;
  {
    const { session } = await sessionOf(FIND);
    const target = FIND.targets.target;
    const [band, stack] = [Math.floor(target.cell! / 27), Math.floor((target.cell! % 9) / 3)];
    const wrong = [...FIND.board.grid].findIndex(
      (d, i) =>
        d === '0' &&
        !target.accept.includes(i) &&
        Math.floor(i / 27) === band &&
        Math.floor((i % 9) / 3) === stack,
    );
    session.tap(wrong);
    session.tap(target.accept[0]!);
    out.push(['find', FIND, { view: session.getView(), wrongTaps: [wrong] }]);
  }

  // the race: nothing taken yet (the first spot's explanation).
  const RACE = firstLevelOf('findDuel');
  {
    const { session } = await sessionOf(RACE);
    out.push(['findDuel', RACE, { view: session.getView(), wrongTaps: [] }]);
  }

  // fill the box: a wrong digit in its first missing cell.
  const BOX = firstLevelOf('fillBox', 1) as LevelSpecOf<'fillBox'>;
  {
    const { session } = await sessionOf(BOX);
    const cell = BOX.targets.cells[0]!;
    session.host.select(cell);
    session.host.place(cell, wrongFor(session, cell));
    out.push(['fillBox, a mistake', BOX, { view: session.getView(), wrongTaps: [] }]);
  }
  {
    const { session } = await sessionOf(BOX);
    out.push(['fillBox, no mistake', BOX, { view: session.getView(), wrongTaps: [] }]);
  }

  // the duel: a right move (my best), then the same with a wrong digit.
  const DUEL = firstLevelOf('duel');
  {
    const { session } = await sessionOf(DUEL);
    const cell = [...DUEL.board.grid].findIndex((d) => d === '0');
    session.host.select(cell);
    session.host.place(cell, right(DUEL, cell));
    out.push(['duel, my best move', DUEL, { view: session.getView(), wrongTaps: [] }]);
    const next = [...DUEL.board.grid].findIndex((d, i) => d === '0' && i > cell);
    session.host.select(next);
    session.host.place(next, wrongFor(session, next));
    out.push(['duel, a mistake', DUEL, { view: session.getView(), wrongTaps: [] }]);
  }

  // spot the error: one error of two found, and a tap on a right digit of mine.
  const SPOT_TWO = firstLevelOf('spotError', 8) as LevelSpecOf<'spotError'>;
  {
    const { session } = await sessionOf(SPOT_TWO);
    const [first] = SPOT_TWO.targets.errors;
    const mineRight = [...SPOT_TWO.board.mine!].findIndex(
      (d, i) => d !== '0' && !SPOT_TWO.targets.errors.some((e) => e.cell === i),
    );
    session.tap(mineRight);
    session.tap(first!.cell);
    out.push(['spotError', SPOT_TWO, { view: session.getView(), wrongTaps: [mineRight] }]);
  }

  // the point hunter: the best line's first move, then another cell.
  const HUNTER = levelsOf('pointHunter')[0] as LevelSpecOf<'pointHunter'>;
  {
    const { session } = await sessionOf(HUNTER);
    const first = HUNTER.targets.best[0]!;
    session.host.select(first.cell);
    session.host.place(first.cell, first.digit);
    out.push(['pointHunter', HUNTER, { view: session.getView(), wrongTaps: [] }]);
  }

  // the chain: every step.
  const CHAIN = levelsOf('chain')[0]!;
  {
    const { session } = await sessionOf(CHAIN);
    out.push(['chain', CHAIN, { view: session.getView(), wrongTaps: [] }]);
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
    const SPOT_TWO = firstLevelOf('spotError', 8) as LevelSpecOf<'spotError'>;
    const { session } = await sessionOf(SPOT_TWO);
    const [first, second] = SPOT_TWO.targets.errors;
    session.tap(first!.cell);
    const why = levelWhy(SPOT_TWO, { view: session.getView(), wrongTaps: [] }, 'he')!;
    expect(why).toContain(`${LRI}${cellName(first!.cell)}${PDI}, נמצאה: `);
    expect(why).toContain(`${LRI}${cellName(second!.cell)}${PDI}, לא נמצאה: `);
    expect(why).not.toContain('ההקשה עליו עלתה');
  });

  it('the point hunter: my points against the board’s best, as a share, and the best line', async () => {
    const HUNTER = levelsOf('pointHunter')[0] as LevelSpecOf<'pointHunter'>;
    const { session } = await sessionOf(HUNTER);
    const first = HUNTER.targets.best[0]!;
    session.host.select(first.cell);
    session.host.place(first.cell, first.digit);
    const score = session.getView().players[0]!.score;
    const max = HUNTER.stars.by === 'points' ? HUNTER.stars.max : 0;
    const why = levelWhy(HUNTER, { view: session.getView(), wrongTaps: [] }, 'he')!;
    expect(why).toContain(
      `צברת ${score} מתוך ${max} נקודות, ${LRI}${Math.round((score / max) * 100)}%${PDI}`,
    );
    expect(why).toContain(
      `${first.digit} ב־${LRI}${cellName(first.cell)}${PDI} ${LRI}+${first.points}${PDI}`,
    );
  });

  it('the chain: a step a line, in order, never ahead of the board', async () => {
    const CHAIN = levelsOf('chain')[0] as LevelSpecOf<'chain'>;
    const { session } = await sessionOf(CHAIN);
    const why = levelWhy(CHAIN, { view: session.getView(), wrongTaps: [] }, 'en')!;
    const lines = why.split('\n').filter((l) => /^Step \d:/.test(l));
    expect(lines.map((l) => l.slice(0, 7))).toEqual(CHAIN.targets.cells.map((_, k) => `Step ${k + 1}:`));
    CHAIN.targets.cells.forEach((cell, k) => expect(lines[k]).toContain(cellName(cell)));
  });

  it('nothing to explain: null, never a throw', () => {
    const FIND = firstLevelOf('find', 1);
    const broken = { ...FIND, board: { ...FIND.board, grid: '0'.repeat(81) } } as AppLevel;
    expect(() =>
      levelWhy(broken, { view: { players: [], wrong: [] } as never, wrongTaps: [] }, 'he'),
    ).not.toThrow();
  });
});
