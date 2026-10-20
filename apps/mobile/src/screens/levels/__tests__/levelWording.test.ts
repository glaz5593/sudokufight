import { type AppLevel, type AppLevelOf, LEVEL_RULES, type LevelKind } from '@sudoku-fight/engine';

import i18n from '../../../i18n';
import { allLevels, levelById } from '../../../levels/levelsData';
import {
  bossBandText,
  bossGateText,
  bossResultText,
  bossTraitText,
  fillBoardLabel,
  fillTaskText,
  findPrompt,
  findSub,
  goalText,
  kindLabel,
  kindName,
  type LevelsT,
  puzzleBoardLabel,
  puzzleCountsOf,
  puzzleCountsText,
  puzzleSlotLabel,
  puzzleSwapAnnouncement,
  puzzleSwapsText,
  raceSpotsText,
  regionMapLabel,
  regionName,
} from '../levelWording';

/**
 * What a stage says about itself, 1.0.3 (levels-ui.md §6, levels-content.md §2; D79): find is "מיקום מדויק" /
 * "Pinpoint" with no digit wherever a stage is spoken of from outside, and "איפה ה־6?" only from a digit given
 * (the board being played); the panel's goals name no box, row or column; the new kinds' names, goals and
 * words (fill the row, fill the column, the puzzle) and the boss's. Hebrew and English.
 */

const LRI = '⁦';
const PDI = '⁩';

const he = () => i18n.getFixedT('he', 'levels') as LevelsT;
const en = () => i18n.getFixedT('en', 'levels') as LevelsT;

/** A stage of `kind` from the data, else one made from L002 (until the 1.0.3 rebuild brings the new kinds). */
function levelOf<K extends LevelKind>(kind: K): AppLevelOf<K> {
  const found = allLevels().find((l) => l.kind === kind && !l.boss);
  if (found) return found as AppLevelOf<K>;
  const base = levelById('L002')!;
  const targets = {
    fillRow: { row: 3, cells: [28, 30, 33] },
    fillCol: { col: 4, cells: [4, 13, 40, 58] },
    puzzle: { start: [4, 1, 2, 3, 8, 5, 6, 7, 0], fixed: [1, 2, 3, 5, 6, 7], lockOnCorrect: false },
  } as Record<string, unknown>;
  return { ...base, kind, timeLimitMs: 60000, targets: targets[kind] } as unknown as AppLevelOf<K>;
}

beforeAll(async () => {
  await i18n.changeLanguage('he');
});

describe('[D79] find is "מיקום מדויק" / "Pinpoint", with no digit, from outside the stage', () => {
  const find = levelOf('find');

  it('its name and label, in both languages, carry no digit', () => {
    expect(kindName(find, he())).toBe('מיקום מדויק');
    expect(kindLabel(find, he())).toBe('מיקום מדויק');
    expect(kindName(find, en())).toBe('Pinpoint');
    expect(kindLabel(find, en())).toBe('Pinpoint');
    for (const words of [kindName(find, he()), kindName(find, en())]) expect(words).not.toMatch(/\d/);
  });

  it('the same for every find stage, whatever its digit (the map, the panel, the gate sheet, the result)', () => {
    const finds = allLevels().filter((l) => l.kind === 'find');
    expect(finds.length).toBeGreaterThan(0);
    expect(new Set(finds.map((l) => kindName(l, he())))).toEqual(new Set(['מיקום מדויק']));
  });

  it('the goal finds "the exact spot of one digit", and names none', () => {
    const goal = goalText(find, he());
    expect(goal).toMatch(/^מצא את המקום המדויק של ספרה אחת\. השלב נגמר ב־\d+ ש׳\.$/);
    expect(goalText(find, en())).toMatch(/^Find the exact spot of one digit\. The stage ends at \d+ s\.$/);
  });

  it('"איפה ה־6?" only from the digit given (the board played), in the stage and "מוכן?"', () => {
    expect(findPrompt(6, he())).toBe('איפה ה־6?');
    expect(findPrompt(6, en())).toBe("Where's the 6?");
    expect(findSub(6, 1, he())).toBe('איפה ה־6? · פרק 1');
    expect(findSub(6, 1, en())).toBe("Where's the 6? · Chapter 1");
  });

  it('every other kind keeps the shared header line, hud.sub', () => {
    expect(he()('hud.sub', { kind: kindName(levelOf('puzzle'), he()), chapter: 3 })).toBe('פאזל · פרק 3');
  });

  it('a race in "מוכן?": its spots and its bot, no spot and no digit [D76]', () => {
    expect(raceSpotsText(5, 'Pip', he())).toBe('5 מקומות, מרוץ מול Pip');
    expect(raceSpotsText(5, 'Pip', en())).toBe('5 spots, a race against Pip');
    expect(raceSpotsText(1, 'Pip', he())).toBe('מקום אחד, מרוץ מול Pip');
  });
});

describe('the new kinds: names and goals, with no region in a goal', () => {
  it('names', () => {
    expect(kindName(levelOf('fillRow'), he())).toBe('מלא את השורה');
    expect(kindName(levelOf('fillCol'), he())).toBe('מלא את העמודה');
    expect(kindName(levelOf('puzzle'), he())).toBe('פאזל');
    expect(kindName(levelOf('fillRow'), en())).toBe('Fill the row');
    expect(kindName(levelOf('fillCol'), en())).toBe('Fill the column');
    expect(kindName(levelOf('puzzle'), en())).toBe('Puzzle');
  });

  it.each(['fillBox', 'fillRow', 'fillCol'] as const)(
    '%s: "fill the N missing cells of one box/row/column" (no box number, row letter or column number)',
    (kind) => {
      const level = levelOf(kind);
      const cells = level.targets.cells.length;
      const unit = { fillBox: 'בריבוע אחד', fillRow: 'בשורה אחת', fillCol: 'בעמודה אחת' }[kind];
      const s = String(level.timeLimitMs / 1000);
      expect(goalText(level, he())).toBe(`מלא את ${cells} המשבצות החסרות ${unit}, עד ${s} ש׳.`);
      const enUnit = { fillBox: 'one box', fillRow: 'one row', fillCol: 'one column' }[kind];
      expect(goalText(level, en())).toBe(`Fill the ${cells} missing cells of ${enUnit}, up to ${s} s.`);
      expect(goalText(level, he())).not.toMatch(/ריבוע \d|שורה [A-I]|עמודה \d/);
    },
  );

  it('the puzzle: its wrong swap’s cost from the engine’s rules', () => {
    const puzzle = levelOf('puzzle');
    const penalty = String(LEVEL_RULES.puzzleSwapPenaltyMs / 1000);
    expect(goalText(puzzle, he())).toBe(
      `סדר את הריבועים. החלפה שגויה מוסיפה ${penalty} ש׳. עד ${puzzle.timeLimitMs / 1000} ש׳.`,
    );
    expect(goalText(puzzle, en())).toBe(
      `Put the boxes in order. A wrong swap adds ${penalty} s. Up to ${puzzle.timeLimitMs / 1000} s.`,
    );
  });

  it('every kind has a name, a label and a goal in both languages (no raw key, no raw {{placeholder}})', () => {
    const kinds: LevelKind[] = [
      'find',
      'findDuel',
      'fillBox',
      'duel',
      'spotError',
      'pointHunter',
      'chain',
      'fillRow',
      'fillCol',
      'puzzle',
    ];
    for (const kind of kinds) {
      const level = levelOf(kind) as AppLevel;
      for (const t of [he(), en()]) {
        for (const words of [kindName(level, t), kindLabel(level, t), goalText(level, t)]) {
          expect({ kind, words }).toEqual({ kind, words: expect.not.stringMatching(/{{|^kinds\.|^goals\./) });
        }
      }
    }
  });
});

describe('a region, from the board played', () => {
  it('its name: "ריבוע 5", "שורה D", "עמודה 5"', () => {
    expect(regionName({ unit: 'box', index: 4 }, he())).toBe('ריבוע 5');
    expect(regionName({ unit: 'row', index: 3 }, he())).toBe('שורה D');
    expect(regionName({ unit: 'col', index: 4 }, he())).toBe('עמודה 5');
    expect(regionName({ unit: 'row', index: 3 }, en())).toBe('Row D');
    expect(regionMapLabel({ unit: 'col', index: 4 }, he())).toBe('מפת הלוח: עמודה 5');
  });

  it('the fill header’s task and the board’s label say the region of the attempt', () => {
    expect(fillTaskText({ unit: 'box', index: 4 }, he())).toBe('מלא את ריבוע 5');
    expect(fillTaskText({ unit: 'row', index: 3 }, he())).toBe('מלא את שורה D');
    expect(fillTaskText({ unit: 'col', index: 4 }, he())).toBe('מלא את עמודה 5');
    expect(fillTaskText({ unit: 'row', index: 3 }, en())).toBe('Fill row D');
    const row = { unit: 'row', index: 3, cells: [28, 30, 33, 34] } as const;
    expect(fillBoardLabel(row, he())).toBe('הלוח · ממלאים רק את 4 המשבצות החסרות בשורה D');
    expect(fillBoardLabel({ unit: 'col', index: 4, cells: [4, 13] }, en())).toBe(
      'The board · fill only the 2 missing cells of column 5',
    );
    expect(fillBoardLabel({ unit: 'box', index: 5, cells: [1, 2, 3] }, he())).toBe(
      'הלוח · ממלאים רק את 3 המשבצות החסרות בריבוע 6',
    );
  });
});

describe('the puzzle’s words', () => {
  it('its counts, plural by plural: 1, 2, 5, and "every box moves"', () => {
    expect(puzzleCountsText(3, 6, he())).toBe('3 ריבועים זזים · 6 ריבועים קבועים');
    expect(puzzleCountsText(2, 7, he())).toBe('שני ריבועים זזים · 7 ריבועים קבועים');
    expect(puzzleCountsText(8, 1, he())).toBe('8 ריבועים זזים · ריבוע אחד קבוע');
    expect(puzzleCountsText(5, 4, en())).toBe('5 boxes move · 4 boxes are fixed');
    expect(puzzleCountsText(1, 2, en())).toBe('1 box moves · 2 boxes are fixed');
    expect(puzzleCountsText(9, 0, he())).toBe('כל הריבועים זזים');
    expect(puzzleCountsText(9, 0, en())).toBe('Every box moves');
  });

  it('the board’s label says the same counts', () => {
    expect(puzzleBoardLabel(3, 6, he())).toBe('לוח הפאזל · 3 ריבועים זזים · 6 ריבועים קבועים');
    expect(puzzleBoardLabel(3, 6, en())).toBe('The puzzle · 3 boxes move · 6 boxes are fixed');
  });

  it('a level’s counts before it is played come from its targets', () => {
    expect(puzzleCountsOf(levelOf('puzzle'))).toEqual({ moving: 3, fixed: 6 });
    expect(puzzleCountsOf(levelOf('find'))).toBeNull();
  });

  it('a slot for a screen reader: its number, its state, its digits row by row, left to right', () => {
    const digits = [5, 3, 9, 6, 1, 2, 8, 7, 4];
    expect(puzzleSlotLabel(3, 'movable', digits, he())).toBe('ריבוע 4, אפשר להזיז: 5 3 9, 6 1 2, 8 7 4');
    expect(puzzleSlotLabel(0, 'fixed', digits, en())).toBe('Box 1, fixed: 5 3 9, 6 1 2, 8 7 4');
    expect(puzzleSlotLabel(8, 'selected', digits, he())).toMatch(/^ריבוע 9, נבחר: /);
  });

  it('a swap’s announcement, with its penalty from the event', () => {
    expect(puzzleSwapAnnouncement(3, 6, 0, he())).toBe('ריבוע 4 וריבוע 7 התחלפו');
    expect(puzzleSwapAnnouncement(3, 6, 5000, he())).toBe('ריבוע 4 וריבוע 7 התחלפו. עוד 5 שניות');
    expect(puzzleSwapAnnouncement(3, 6, 5000, en())).toBe('Boxes 4 and 7 swapped. Plus 5 seconds');
  });

  it('the result’s swaps against the fewest', () => {
    expect(puzzleSwapsText(4, 3, he())).toBe('4 החלפות · המינימום 3');
    expect(puzzleSwapsText(1, 1, he())).toBe('החלפה אחת · המינימום 1');
    expect(puzzleSwapsText(4, 3, en())).toBe('4 swaps · the fewest: 3');
  });
});

describe('the boss’s words: only what the engine says', () => {
  it('a chip per trait (bossTraits), the per cent an LTR isolate', () => {
    expect(bossTraitText({ key: 'firstBot', bot: 'Pip' }, he())).toBe('הבוט הראשון: Pip');
    expect(bossTraitText({ key: 'faster', bot: 'Pip', pct: 10 }, he())).toBe(`Pip מהיר ב־${LRI}10%${PDI}`);
    expect(bossTraitText({ key: 'faster', bot: 'Pip', pct: 10 }, en())).toBe(`Pip is ${LRI}10%${PDI} faster`);
    expect(bossTraitText({ key: 'overlord' }, he())).toBe('Overlord');
    expect(bossTraitText({ key: 'moreCells', from: 4, to: 5 }, he())).toBe('5 משבצות חסרות במקום 4');
  });

  it('the result’s line from levelOutcome().bossBeaten, none for a stage that is not a boss', () => {
    expect(bossResultText(true, he())).toBe('ניצחת את הבוס!');
    expect(bossResultText(false, he())).toBe('הבוס ניצח הפעם');
    expect(bossResultText(true, en())).toBe('You beat the boss!');
    expect(bossResultText(false, en())).toBe('The boss won this time');
    expect(bossResultText(null, he())).toBeNull();
    expect(bossResultText(undefined, he())).toBeNull();
  });

  it('the gate line and the band', () => {
    expect(bossGateText(1, 22, 20, true, he())).toBe(`השער לפרק 2: ${LRI}★ 22/20${PDI} · נפתח!`);
    expect(bossGateText(1, 18, 20, false, he())).toBe(`השער לפרק 2: ${LRI}★ 18/20${PDI}`);
    expect(bossGateText(1, 22, 20, true, en())).toBe(`Gate to chapter 2: ${LRI}★ 22/20${PDI} · open!`);
    expect(bossBandText(3, he())).toBe('בוס · פרק 3');
    expect(bossBandText(3, en())).toBe('Boss · Chapter 3');
  });
});

describe('the gate sheet’s footnote [D68]', () => {
  it('most stages up to 30 s, fill and puzzle up to 60', () => {
    expect(LEVEL_RULES.levelMaxMs).toBe(30000);
    expect(he()('gateSheet.footnote')).toBe(
      'רוב השלבים עד 30 שניות, ומילוי ופאזל עד 60. הכוכבים הטובים ביותר נשמרים.',
    );
    expect(en()('gateSheet.footnote')).toBe(
      'Most stages last up to 30 s; fill and puzzle stages up to 60. Your best stars are kept.',
    );
  });
});

describe('what is new in each chapter (levels-content.md §3.2)', () => {
  it('chapters 1–5 bring the kinds of the new table', () => {
    expect(he()('chapters.1.news')).toBe('מיקום מדויק, מלא את הריבוע, פאזל ומלא את השורה');
    expect(he()('chapters.2.news')).toBe('מלא את העמודה, ומרוץ מול הבוט');
    expect(he()('chapters.3.news')).toBe('דו־קרב ל־30, ומצא את הטעות');
    expect(he()('chapters.4.news')).toMatch(/^שרשרת/);
    expect(he()('chapters.5.news')).toMatch(/^בוט חדש: Biscuit, צייד הנקודות/);
    expect(en()('chapters.1.news')).toBe('Pinpoint, fill the box, the puzzle and fill the row');
  });

  it('no chapter says find’s old name', () => {
    for (let n = 1; n <= 30; n++) {
      expect(he()(`chapters.${n}.news` as 'chapters.1.news')).not.toMatch(/איפה ה/);
      expect(en()(`chapters.${n}.news` as 'chapters.1.news')).not.toMatch(/Where's/);
    }
  });
});
