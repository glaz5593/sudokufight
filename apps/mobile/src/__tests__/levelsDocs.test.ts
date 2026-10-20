import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENGINE_VERSION, LEVEL_KINDS } from '@sudoku-fight/engine';
import { PROGRESS_PATHS, TELEMETRY_EVENT_GENERATION, TELEMETRY_EVENT_NAMES } from '@sudoku-fight/protocol';

import { levelById } from '../levels/levelsData';

/**
 * The release docs of the staged practice (1.0.2; dev-plan §2יא part B, §3.1 and §4): the QA checklist has a row
 * for every screen of plan §6, the device checks list every item of dev-plan §3.2 with Moshe's answers of
 * 2026-10-18, the release docs put the server before the 1.0.2 APK, the README names the levels' routes and
 * scripts, and the store forms cover the new data. Moshe tests on his phones from these docs, and the next sessions
 * release by them: a screen missing from the QA, a device check left out, or an APK before its server would ship
 * untested or broken. The spec's own checks are levelsSpecDocs.test.ts; this reads the rest, as a reviewer would.
 * 1.0.3 (docs/handoff/2026-10-19/levels-ui.md §12): the name "מיקום מדויק", QA rows for the row, the column and the
 * puzzle (no board: Moshe chose to build without asking), and a device check for each of Moshe's seven notes.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const DOCS = join(ROOT, 'docs');
const HANDOFF = join(DOCS, 'handoff', '2026-10-15', 'staged-practice');

/** The bidi marks the Hebrew docs put around signed numbers and code (LRM, RLM, the isolates): not words. */
const plain = (text: string): string => text.replace(/[‎‏⁦-⁩]/g, '');
const readFrom = (...path: string[]): string => plain(readFileSync(join(...path), 'utf8'));
const read = (...path: string[]): string => readFrom(DOCS, ...path);

/** The text from the line that starts with `start` to the next line that starts with `end` (or the end). */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(`\n${start}`);
  if (from < 0) throw new Error(`no section "${start}"`);
  const to = text.indexOf(`\n${end}`, from + start.length + 1);
  return text.slice(from, to < 0 ? undefined : to);
}

/** The rows of the markdown tables in `text`, as trimmed cells without the outer pipes; no separator rows. */
function tableRows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[-|\s]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
}

/** The app's stages as shipped (AppLevel[]), only what the docs name. */
interface ShippedLevel {
  id: string;
  kind: string;
  chapter: number;
  boss: boolean;
}
const LEVELS = JSON.parse(
  readFileSync(join(__dirname, '..', 'levels', 'data', 'levels.json'), 'utf8'),
) as ShippedLevel[];
const firstOf = (kind: string): ShippedLevel => {
  const level = LEVELS.find((l) => l.kind === kind);
  if (!level) throw new Error(`no stage of kind ${kind}`);
  return level;
};
const FIRST_BOSS = LEVELS.find((l) => l.boss);

/** The kinds as the device checks' table names them. */
const KIND_NAMES: Record<string, string> = {
  find: 'מיקום מדויק (סוג 1)', // 1.0.3 [D79]; "איפה ה־7?" until 1.0.2
  fillBox: 'מלא את הריבוע (סוג 3)',
  findDuel: 'מרוץ מול הבוט (סוג 2)',
  duel: 'דו־קרב ל־30 (סוג 4)',
  spotError: 'מצא את הטעות',
  pointHunter: 'צייד הנקודות',
  chain: 'שרשרת',
  // 1.0.3 (levels-content.md §3.1): the three new kinds.
  fillRow: 'מלא את השורה',
  fillCol: 'מלא את העמודה',
  puzzle: 'פאזל',
};

const NO_BOARD = 'אין לוח';
/**
 * The screens of plan §6 and their rows in the QA section: how the row's screen cell starts, its board in
 * docs/design/screens (or none), and the kind whose first stage its route opens.
 */
const PLAN_SCREENS: { plan: string; row: string; board: string; kind?: string }[] = [
  { plan: '1', row: '7. משחק חדש: השורה "אימון בשלבים"', board: 'Modes-Levels' },
  { plan: '2', row: '28. מפת השלבים', board: 'Levels-Map' },
  { plan: '2א', row: '28. מצבי צומת', board: 'Levels-Map' },
  { plan: '3', row: '28. פתיחת שלב', board: 'Levels-Map' },
  { plan: '4', row: '31. שלב: מיקום מדויק', board: 'Lv-Find', kind: 'find' },
  { plan: '5', row: '32. שלב: מרוץ מול הבוט', board: 'Lv-Race', kind: 'findDuel' },
  { plan: '6', row: '33. שלב: מלא את הריבוע', board: 'Lv-Box', kind: 'fillBox' },
  { plan: '7', row: '34. שלב: דו־קרב ל־30', board: 'Lv-Sprint', kind: 'duel' },
  { plan: '8', row: '35. שלב: מצא את הטעות', board: 'Lv-SpotError', kind: 'spotError' },
  { plan: '8', row: '36. שלב: צייד הנקודות', board: 'Lv-PointHunter', kind: 'pointHunter' },
  { plan: '8', row: '37. שלב: שרשרת', board: 'Lv-Chain', kind: 'chain' },
  { plan: '9', row: '— שלב בוס', board: NO_BOARD },
  { plan: '10', row: '30. תוצאת שלב', board: 'Level-Result' },
  { plan: '11', row: '29. שער פרק', board: 'Levels-Gate' },
  { plan: '12', row: '— פרק חדש נפתח', board: NO_BOARD },
  { plan: '13', row: '— איך משחקים', board: NO_BOARD },
];
/**
 * 1.0.3's new stage screens (spec §4.1 rows 38–39): no board, because none was drawn (Moshe: build without asking,
 * 2026-10-20); each opens its kind's first stage.
 */
const SCREENS_103: { row: string; kind: string }[] = [
  { row: '38. שלב: מלא את השורה', kind: 'fillRow' },
  { row: '38. שלב: מלא את העמודה', kind: 'fillCol' },
  { row: '39. שלב: פאזל', kind: 'puzzle' },
];
/** The screens with no board that spec §4.1 lists ("אין לוח ל:") beyond plan §6's own. */
const MORE_NO_BOARD = [
  '— מוכן?',
  '— רשימת הפרקים',
  '— דיאלוג היציאה',
  '— תוצאה עם 0 כוכבים',
  '— הקפאה ברקע',
  '— השורה בכרטיס השחקן',
];

describe('QA-CHECKLIST.md', () => {
  const qa = read('QA-CHECKLIST.md');
  const block = section(qa, '## אימון בשלבים', '## ');
  // | screen | canvas file | route | עברית | אנגלית | Android | iOS | notes |
  const rows = tableRows(block).filter((cells) => cells[0] !== 'מסך');
  const rowOf = (start: string): string[] => {
    const row = rows.find((cells) => (cells[0] ?? '').startsWith(start));
    if (!row) throw new Error(`no QA row "${start}"`);
    return row;
  };
  const names = (cell: string): string[] => cell.split(/[\s,()]+/);

  it('row 7: the new-game screen has six rows, checked at 360×780 in Hebrew and English', () => {
    const row = tableRows(section(qa, '## לפני משחק', '## ')).find((cells) => cells[0] === '7. מצבי משחק');
    expect(names(row?.[1] ?? '')).toContain('Modes-Levels');
    const notes = row?.[7] ?? '';
    expect(notes).toContain('שש שורות');
    // 1.0.4 (D80a): the friends group takes the bottom line's place, and the six rows still fit with it.
    expect(notes).toContain(
      'לבדוק בטלפון של 360×780, בעברית ובאנגלית: שש השורות וקבוצת "עם חברים" בלי גלילה',
    );
    expect(notes).not.toContain('חמש השורות');
    expect(notes).not.toContain('מקום לשורה שישית');
  });

  it.each(PLAN_SCREENS)('plan §6 screen $plan: the row "$row", on $board', ({ row, board, kind }) => {
    const cells = rowOf(row);
    if (board === NO_BOARD) expect(cells[1]).toBe(NO_BOARD);
    else {
      expect(names(cells[1] ?? '')).toContain(board);
      expect(existsSync(join(DOCS, 'design', 'screens', `${board}.dc.html`))).toBe(true);
    }
    // A kind's row opens its first stage, as the app's levels have it.
    if (kind) expect(cells[2]).toContain(`/levels/play?id=${firstOf(kind).id}`);
  });

  it('the boss row opens the first boss, and since 1.0.3 says it is always against a bot', () => {
    const boss = rowOf('— שלב בוס');
    expect(boss[2]).toContain(`/levels/play?id=${FIRST_BOSS?.id}`);
    expect(boss[7]).toContain('תמיד מול בוט');
    expect(boss[7]).toContain('פתיחת בוס');
  });

  it.each(SCREENS_103)('1.0.3: the row "$row", no board, opens its first stage', ({ row, kind }) => {
    const cells = rowOf(row);
    expect(cells[1]).toBe(NO_BOARD);
    expect(cells[2]).toContain(`/levels/play?id=${firstOf(kind).id}`);
  });

  it.each(MORE_NO_BOARD)('the screen with no board "%s" has its row too', (start) => {
    expect(rowOf(start)[1]).toBe(NO_BOARD);
  });

  it('every row has its 8 columns and a route; Hebrew and English ☐ or ✓; Android and iOS left to the phone', () => {
    expect(rows.length).toBe(PLAN_SCREENS.length + SCREENS_103.length + MORE_NO_BOARD.length);
    for (const cells of rows) {
      expect({ row: cells[0], columns: cells.length }).toEqual({ row: cells[0], columns: 8 });
      expect({ row: cells[0], route: (cells[2] ?? '').includes('`/') }).toEqual({
        row: cells[0],
        route: true,
      });
      for (const lang of [cells[3], cells[4]]) expect(['☐', '✓']).toContain(lang);
      // Moshe fills these on the device (✓, or what is wrong); never "—", as if there were nothing to check.
      for (const phone of [cells[5], cells[6]]) expect(phone === '' || phone === '—').toBe(false);
    }
  });

  it('the section says what ☐ means, points at the device checks, and keeps D49 and D62', () => {
    expect(block).toContain('העמודות "עברית" ו"אנגלית" ☐ עד בדיקת הקוד מול הלוחות');
    expect(block).toContain('[`LEVELS-DEVICE-CHECKS.md`](LEVELS-DEVICE-CHECKS.md)');
    expect(block).toContain('(D49)');
    expect(block).toContain('אין כפתור תגובות שלי (D62)');
    expect(block).toContain('אף פעם לא "Level"');
    // 1.0.3: the node's screen-reader label says the kind's name, never "איפה ה־7"; its example is a real
    // Pinpoint stage (L005; L007 is a puzzle since the rebuild).
    expect(block).not.toContain('"שלב 7, איפה ה־7');
    expect(rowOf('28. מצבי צומת')[7]).toContain('"שלב 5, מיקום מדויק, שני כוכבים מתוך שלושה"');
    expect(levelById('L005')?.kind).toBe('find');
  });

  (existsSync(join(HANDOFF, 'plan.md')) ? it : it.skip)('the rows follow plan §6, screen by screen', () => {
    const plan = readFrom(HANDOFF, 'plan.md');
    const screens = tableRows(section(plan, '## 6.', '## 7.'))
      .map((cells) => cells[0] ?? '')
      .filter((n) => /^\d+א?$/.test(n));
    expect(screens).toEqual([...new Set(PLAN_SCREENS.map((s) => s.plan))]);
  });
});

/**
 * dev-plan §3.2, item by item: how the item starts there, and the words its check here has (all of them in the
 * checkboxes of one "בדיקה").
 */
const DEVICE_ITEMS: { item: string; words: string[] }[] = [
  { item: 'פרק 1 שלם במצב טיסה', words: ['פרק 1 שלם במצב טיסה, מההתחלה ועד השער'] },
  {
    item: 'שער: עם 19 כוכבים נעול',
    words: [
      'שער: עם 19 כוכבים נעול, עם הגיליון',
      'משחק חוזר עד 20 פותח אותו',
      'פרק חדש נפתח',
      '+50 XP',
      'פעם אחת',
    ],
  },
  { item: '"לשלב הבא"', words: ['"לשלב הבא" ← "מוכן?" של 2 ש׳ ← השלב מתחיל'] },
  {
    item: '"שוב" אחרי 0 כוכבים בסוג 1',
    words: ['"שוב" אחרי 0 כוכבים בסוג 1', 'הלוח נראה אחר, והתשובה הקודמת לא עוזרת', 'הקושי מרגיש אותו דבר'],
  },
  {
    item: 'שער עם מספיק כוכבים ובוס שלא שוחק',
    words: ['שער עם מספיק כוכבים ובוס שלא שוחק: הלוחית והגיליון מפנים לבוס'],
  },
  {
    item: 'כל אחד מ־7 הסוגים, ובוס',
    // 1.0.3: ten kinds now (the dev-plan item, above, keeps its 1.0.2 wording).
    words: ['כל אחד מ־10 הסוגים, ובוס: שלב אחד לפחות', 'התחושה של 30 השניות', 'הקצב של הבוט'],
  },
  {
    item: 'יציאה באישור (X, וגם "חזרה")',
    words: ['יציאה באישור (X, וגם "חזרה")', 'תוצאה עם 0 כוכבים', 'והשלב הבא נפתח'],
  },
  {
    item: 'שיחת טלפון, מעבר לאפליקציה אחרת או כיבוי מסך באמצע שלב',
    words: [
      'שיחת טלפון, מעבר לאפליקציה אחרת או כיבוי מסך באמצע שלב: השלב קופא',
      'בחזרה: 3, 2, 1 מעל הלוח המכוסה',
      'מאותה נקודה, עם אותו זמן שנשאר',
      'גם במרוץ ובדו־קרב: הבוט לא התקדם בזמן ההקפאה',
    ],
  },
  { item: 'סגירת האפליקציה באמצע שלב', words: ['סגירת האפליקציה באמצע שלב: לא נחשב'] },
  { item: 'עברית ואנגלית', words: ['עברית ואנגלית', 'הלוח והמקלדת תמיד משמאל לימין'] },
  {
    item: 'הפחתת תנועה',
    words: ['הפחתת תנועה', 'אין פעימה', 'אין רעד', 'אין קונפטי', 'והכוכבים מופיעים מיד'],
  },
  { item: 'TalkBack', words: ['TalkBack', 'תווית לכל צומת', 'הזמן שנשאר מוקרא'] },
  {
    item: 'מסך "משחק חדש" עם שש שורות',
    words: ['מסך "משחק חדש" עם שש שורות, בטלפון קטן (360×780), בלי גלילה'],
  },
  {
    item: 'התקנה מחדש, או טלפון שני עם אותו חשבון',
    words: ['התקנה מחדש, או טלפון שני עם אותו חשבון: הכוכבים חוזרים'],
  },
  { item: 'ה־XP מגיע אחרי חזרה לרשת', words: ['ה־XP מגיע אחרי חזרה לרשת, ולא פעמיים'] },
  { item: 'טלפון עם 1.0.1 מול השרת החדש', words: ['טלפון עם 1.0.1 מול השרת החדש: הכל עובד כמו קודם'] },
  {
    item: 'אימון לבד, אימון מול בוט ומדורג',
    words: ['אימון לבד, אימון מול בוט ומדורג: בדיוק כמו ב־1.0.1'],
  },
  {
    item: 'הקפאה באימון לבד ובאימון מול בוט (2יג, D65)',
    words: [
      'ההקפאה ברקע גם באימון לבד ובאימון מול בוט',
      'אותה משבצת עדיין נעולה, עם אותן 5 שניות',
      'הבוט לא הניח ספרה ולא נעל משבצת',
      'זמן המשחק לא כולל את ההקפאה',
      'במדורג אין הקפאה',
    ],
  },
  {
    item: 'שני המתגים של גרסת staging',
    words: [
      'שרשרת: ניחוש עולה 5 ש׳',
      'פתח את כל השלבים (בדיקה)',
      'הכוכבים וה־XP כרגיל',
      'בגרסה לחנות (production) אין את הקטע "בדיקה" בכלל',
    ],
  },
  { item: 'אתר הניהול: דף "שלבים"', words: ['אתר הניהול: דף "שלבים" מציג את המשחקים שלך'] },
  {
    item: 'אין מסך שחור',
    words: ['אין מסך שחור בסוף שלב, במעבר לתוצאה, או בחזרה למפה'],
  },
];

describe('LEVELS-DEVICE-CHECKS.md', () => {
  const doc = read('LEVELS-DEVICE-CHECKS.md');
  const checksTitles = doc.split('\n').filter((line) => line.startsWith('## בדיקה '));
  /** Each "בדיקה" with the text of its checkboxes (nested ones too), without the bold marks. */
  const checks = checksTitles.map((title) => ({
    title,
    boxes: section(doc, title, '## ')
      .split('\n')
      .filter((line) => line.trimStart().startsWith('- [ ] '))
      .join('\n')
      .replace(/\*\*/g, ''),
  }));
  const allBoxes = checks.map((c) => c.boxes).join('\n');

  it('is in the format of STAGE7: a title, "הכנה", numbered checks with checkboxes, and "אם משהו נכשל"', () => {
    expect(doc.startsWith('# ')).toBe(true);
    expect(doc).toContain('\n## הכנה (פעם אחת)\n');
    expect(checksTitles.map((t) => /^## בדיקה (\d+)/.exec(t)?.[1])).toEqual(
      checksTitles.map((_, i) => String(i + 1)),
    );
    expect(checks.length).toBeGreaterThanOrEqual(9);
    for (const { title, boxes } of checks)
      expect({ title, boxes: boxes.length > 0 }).toEqual({ title, boxes: true });
    expect(doc.trimEnd().split('\n## ').pop()?.startsWith('אם משהו נכשל')).toBe(true);
  });

  it.each(DEVICE_ITEMS.map((d, i) => ({ n: i + 1, ...d })))(
    'dev-plan §3.2 item $n ($item) is a check, with all its parts in one "בדיקה"',
    ({ words }) => {
      // The "בדיקה" with the most of its words (all of them, when the item is there).
      const count = (boxes: string) => words.filter((word) => boxes.includes(word)).length;
      const where = checks.reduce((best, check) => (count(check.boxes) > count(best.boxes) ? check : best));
      for (const word of words)
        expect({ word, in: where.title, found: where.boxes.includes(word) }).toEqual({
          word,
          in: where.title,
          found: true,
        });
    },
  );

  (existsSync(join(HANDOFF, 'dev-plan.md')) ? it : it.skip)('the items are dev-plan §3.2, one by one', () => {
    const list = section(readFrom(HANDOFF, 'dev-plan.md'), '### 3.2', '### 3.3')
      .split('\n')
      .filter((line) => line.startsWith('- [ ] '))
      .map((line) => line.slice('- [ ] '.length));
    expect(list).toHaveLength(DEVICE_ITEMS.length);
    list.forEach((line, i) => {
      const item = DEVICE_ITEMS[i]?.item ?? '';
      expect({ i, item, starts: line.startsWith(item) }).toEqual({ i, item, starts: true });
    });
  });

  it('Moshe 2026-10-18: no reactions button but the bot reacts (D62); the chain in both modes (D64)', () => {
    expect(allBoxes).toMatch(/אין כפתור תגובות שלי \(D62[^\n]*הבוט עדיין מגיב[^\n]*😂/);
    expect(allBoxes).toMatch(/שרשרת, שני המצבים \(D64: עדיין פתוחה/);
    expect(allBoxes).toContain('"שרשרת: ניחוש עולה 5 ש׳"');
    expect(allBoxes).toMatch(/כבוי \(ברירת המחדל, לפי המקור, `'accept'`\)/);
    expect(allBoxes).toContain("דלוק (`'penalty'`)");
    expect(allBoxes).toContain('בכל צעד יש בדיוק משבצת אחת שאפשר להוכיח. אם אתה בטוח בספרה, זו המשבצת.');
    expect(allBoxes).toContain('אין הפרעות (D49)');
  });

  it('D65: the freeze over a covered board in a stage, in solo and bot practice too, never in ranked', () => {
    expect(allBoxes).toContain('הלוח מכוסה ("המשחק עצור")');
    expect(allBoxes).toContain('בהפחתת תנועה: רק המספר מתחלף');
    expect(allBoxes).toContain('ההקפאה ברקע גם באימון לבד ובאימון מול בוט (D65');
    expect(allBoxes).toContain('במדורג אין הקפאה');
  });

  it('"הכנה" names the first stage of every kind and the first boss, as the app ships them', () => {
    const prep = section(doc, '## הכנה', '## בדיקה 1').replace(/^ +/gm, '');
    expect(Object.keys(KIND_NAMES).sort()).toEqual([...LEVEL_KINDS].sort());
    // | kind | first stage | chapter |
    const rows = tableRows(prep);
    for (const kind of LEVEL_KINDS) {
      const first = firstOf(kind);
      const row = rows.find((cells) => cells[0] === KIND_NAMES[kind]);
      expect({ kind, stage: row?.[1], chapter: row?.[2] }).toEqual({
        kind,
        stage: first.id,
        chapter: String(first.chapter),
      });
    }
    const boss = rows.find((cells) => (cells[0] ?? '').startsWith('בוס:'));
    expect([boss?.[1], boss?.[2]]).toEqual([FIRST_BOSS?.id, String(FIRST_BOSS?.chapter)]);
    // The last kind to come, behind its gates.
    const last = LEVEL_KINDS.map(firstOf).reduce((a, b) => (b.chapter > a.chapter ? b : a));
    expect(prep).toContain(`(${last.id}) עוברים ${last.chapter - 1} שערים`);
  });

  it('the calibration check names the first stage of every kind', () => {
    const calibration = section(doc, '## בדיקה 10', '## ');
    for (const kind of LEVEL_KINDS) expect(calibration).toContain(firstOf(kind).id);
  });

  /**
   * 1.0.3: Moshe's seven notes on 1.0.2 (docs/handoff/2026-10-19/plan.md §1), each a "בדיקה" whose title names its
   * note ("(הערה 4)", "(הערות 2 ו־7)") and whose checkboxes have these words; the stages named are the shipped ones.
   */
  const MOSHE_NOTES = (): { note: number; words: string[] }[] => [
    { note: 1, words: ['"מיקום מדויק"', '"איפה ה־6?"', '"שוב" על מיקום מדויק'] },
    {
      note: 2,
      words: ['פרק 1:', 'אף פעם לא שני שלבים רצופים מאותו סוג', 'עד פרק 5 כל 10 הסוגים הופיעו'],
    },
    {
      note: 3,
      words: [
        `פרק 1 (${firstOf('fillBox').id}):`,
        '2 משבצות חסרות, בלוח מלא',
        'כל ספרה חסרה לפחות פעם אחת מחוץ לריבוע',
        'והסרגל מראה 60',
      ],
    },
    {
      note: 4,
      words: [
        `${firstOf('puzzle').id}:`,
        'גרירה:',
        'ריבוע קבוע',
        'הקשה ואז הקשה:',
        '"+5 ש׳"',
        'ריבוע שהגיע למקומו לא ננעל ולא מסומן',
        'TalkBack:',
        'הפחתת תנועה:',
      ],
    },
    {
      note: 5,
      words: ['רואים את האזור תוך פחות משנייה', '"מוכן?":', '"התשובה":', 'Deuteranomaly'],
    },
    {
      note: 6,
      words: [
        `${FIRST_BOSS?.id} (פרק 1):`,
        '"הבוט הראשון: Pip"',
        '"Pip מהיר ב־10%"',
        '"ניצחת את הבוס!"',
        '"הבוס ניצח הפעם", גם כשקיבלת כוכב',
      ],
    },
    {
      note: 7,
      words: [`${firstOf('fillRow').id} (שורה) ו־${firstOf('fillCol').id} (עמודה)`, 'השורה נשארת שורה'],
    },
  ];

  it.each(MOSHE_NOTES())(
    '1.0.3: Moshe’s note $note has its own check, with all its parts',
    ({ note, words }) => {
      const notesOf = (title: string): number[] =>
        (/\(הער(?:ה|ות) ([^)]*)\)/.exec(title)?.[1]?.match(/\d+/g) ?? []).map(Number);
      const missing = (boxes: string): string[] => words.filter((w) => !boxes.includes(w));
      // Of the checks that name this note (one note can be named by two), the one with the most of its words.
      const best = checks
        .filter((c) => notesOf(c.title).includes(note))
        .sort((a, b) => missing(a.boxes).length - missing(b.boxes).length)[0];
      expect({ note, named: best !== undefined, missing: missing(best?.boxes ?? '') }).toEqual({
        note,
        named: true,
        missing: [],
      });
    },
  );

  it('1.0.3: the server on Staging answers the engine of this build, and the intro says Moshe judges on the phone', () => {
    const health = `"engine":"${ENGINE_VERSION}"`;
    expect(section(doc, '## הכנה', '## בדיקה 1')).toContain(health);
    expect(section(doc, '## אם משהו נכשל', '## ')).toContain(health);
    expect(doc.slice(0, doc.indexOf('## הכנה'))).toContain('"תבצע בלי לשאול"');
    // The stars kept by id, the best reset, and the telemetry of the new kinds, after the server went first.
    expect(allBoxes).toContain('הכוכבים שלך נשמרו');
    expect(allBoxes).toContain('התאפס');
    expect(allBoxes).toContain('המנות לא נדחו');
  });

  it('the QA checklist, the release checklist and the work plan point at it', () => {
    for (const other of ['QA-CHECKLIST.md', 'RELEASE-CHECKLIST.md', '02-WORK-PLAN.md'])
      expect({ other, links: read(other).includes('LEVELS-DEVICE-CHECKS.md') }).toEqual({
        other,
        links: true,
      });
  });
});

describe('the server before the 1.0.2 APK', () => {
  const GROWS = /מספר השלבים גדל[^\n]*סוג שלב[^\n]*אירועי השלבים/;

  it('RELEASE-CHECKLIST: verify, the versions, the server on Staging, its APK, Production, and only then the app', () => {
    const block = section(read('RELEASE-CHECKLIST.md'), '## גרסה 1.0.2', '## ');
    // | ☐ | # | what | who | where |
    const steps = tableRows(block).filter((cells) => /^\d+$/.test(cells[1] ?? ''));
    expect(steps.map((cells) => cells[1])).toEqual(steps.map((_, i) => String(i + 1)));
    const step = (mark: string): number => steps.findIndex((cells) => (cells[2] ?? '').includes(mark));
    const order = [
      'npm run verify',
      '`ENGINE_VERSION`',
      'npm run version:bump',
      'fly deploy --ha=false',
      'npm run apk',
      'fly.production.toml',
      'eas build --profile production',
    ].map((mark) => ({ mark, at: step(mark) }));
    for (const { mark, at } of order) expect({ mark, found: at >= 0 }).toEqual({ mark, found: true });
    expect(order.map(({ at }) => at)).toEqual([...order.map(({ at }) => at)].sort((a, b) => a - b));
    const staging = steps[step('fly deploy --ha=false')]?.[2] ?? '';
    expect(staging).toContain('0008');
    expect(staging).toContain('בלי `db:seed-puzzles`');
    expect(staging).toContain('"engine":"0.3.0"');
    expect(block).toMatch(GROWS);
  });

  it('DEPLOY-PRODUCTION §5: Staging, its APK, Production, then the app; 0008 by itself, no db:seed-puzzles', () => {
    const deploy = section(read('DEPLOY-PRODUCTION.md'), '## 5.', '## 6.');
    expect(deploy).toContain(
      'הסדר הוא Staging, APK 1.0.2 מול Staging, Production, ורק אחריו האפליקציה לשחקנים',
    );
    expect(deploy).toMatch(/0008[^\n]*רץ לבד כשהשרת עולה/);
    expect(deploy).toContain('אין צורך ב־`db:seed-puzzles`');
    expect(deploy).toMatch(GROWS);
    expect(section(read('DEPLOY-PRODUCTION.md'), '## 9.', '## 10.')).toContain('מ־1.0.2 חזרה ל־1.0.1');
  });

  it('BUILD-APK: the server on Staging first, then `npm run apk`, and Production before its APK', () => {
    const block = section(read('BUILD-APK.md'), '## לפני APK של גרסה חדשה', '## ');
    const steps = block.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('fly deploy --ha=false');
    expect(steps[1]).toMatch(/^2\. \*\*רק אחריו:\*\* `npm run apk`/);
    expect(steps[2]).toContain('npm run apk -- --server production');
    expect(steps[2]).toContain('רק אחרי שגם שרת ה־Production עודכן');
    expect(block).toMatch(GROWS);
  });
});

describe('README.md', () => {
  const readme = readFrom(ROOT, 'README.md');
  const scripts = (packageJson: string): Record<string, string> =>
    (JSON.parse(readFileSync(packageJson, 'utf8')) as { scripts: Record<string, string> }).scripts;

  it('names both routes of the levels, as the protocol has them', () => {
    expect(PROGRESS_PATHS.myLevels).toBe('/v1/me/levels');
    for (const verb of ['GET', 'PUT']) expect(readme).toContain(`\`${verb} ${PROGRESS_PATHS.myLevels}\``);
  });

  it('its commands table has levels:build, levels:validate and the app copy, and each script exists', () => {
    const commands = tableRows(section(readme, '## פקודות', '## ')).map((cells) => cells[0]);
    const root = scripts(join(ROOT, 'package.json'));
    const mobile = scripts(join(ROOT, 'apps', 'mobile', 'package.json'));
    for (const [command, defined] of [
      ['`npm run levels:build`', root['levels:build']],
      ['`npm run levels:validate`', root['levels:validate']],
      ['`npm run levels -w @sudoku-fight/mobile`', mobile.levels],
    ] as const) {
      expect({ command, listed: commands.includes(command) }).toEqual({ command, listed: true });
      expect({ command, defined: typeof defined }).toEqual({ command, defined: 'string' });
    }
  });

  it('names the six events of the staged practice (keyed `level`) and the admin Levels route', () => {
    const levelEvents = TELEMETRY_EVENT_NAMES.filter((name) => TELEMETRY_EVENT_GENERATION[name] === 2);
    expect(levelEvents).toHaveLength(6);
    for (const name of levelEvents) expect(readme).toContain(`\`${name}\``);
    expect(readme).toContain('בשדה `level`, אף פעם לא `levelId`');
    expect(readme).toContain('`GET /admin/api/levels?days=30`');
  });
});

describe('docs/store (the forms follow the new data)', () => {
  it('APP-PRIVACY: the levels’ progress and its two tables, and the event count of today', () => {
    const privacy = read('store', 'APP-PRIVACY.md');
    expect(privacy).toContain('**אימון בשלבים**');
    expect(privacy).toContain('`user_levels`');
    expect(privacy).toContain('`level_xp_days`');
    expect(privacy).toContain(`${TELEMETRY_EVENT_NAMES.length} אירועים עם props`);
  });

  it('DATA-SAFETY: the progress under "Other actions", the six events under "App interactions"', () => {
    const safety = read('store', 'DATA-SAFETY.md');
    // | category | type | collected | shared | ephemeral | required | notes |
    const notes = (type: string): string =>
      tableRows(safety).find((cells) => cells[1] === `**${type}**`)?.[6] ?? '';
    expect(notes('App interactions')).toContain('ששת האירועים של אימון בשלבים');
    expect(notes('Other actions')).toContain('ההתקדמות באימון בשלבים');
    expect(safety).toContain('`user_levels`');
  });
});
