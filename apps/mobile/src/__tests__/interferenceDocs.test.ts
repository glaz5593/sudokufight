import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import heGame from '../i18n/locales/he/game.json';
import { INTERFERENCE_UNLOCK_LEVELS } from '../screens/game/arsenal/config';

/**
 * The docs agree with Moshe's interference decisions of 2026-10-17 (spec §7 and §24): D44 no interferences in a
 * game against a known bot, D45 two taps and no drag, D46 the board dim, D47 the three new kinds and their unlock
 * levels (D17). Sessions read these docs before every stage (CLAUDE.md), and the QA pass goes by their ✓ and ☐:
 * a line that still prescribes the drag, bot interferences or the old unlock levels would get them built again,
 * and a ✓ on a row nobody checked would skip it. This reads the docs the way a reviewer would.
 */

const DOCS = join(__dirname, '..', '..', '..', '..', 'docs');
const read = (...path: string[]): string => readFileSync(join(DOCS, ...path), 'utf8');

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

/** Words that name the drag: גרירה, בגרירה, גרור, or "drag" (not "drop-shadow", not "dragon"). */
const DRAG = /גריר|גרור|\bdrag\b/i;

interface Canvas {
  boards: Record<string, { title: string }>;
  notes: Record<string, { text: string }>;
}
const canvas = JSON.parse(read('design', 'canvas.json')) as Canvas;
const boardName = (file: string): string => file.replace(/\.dc\.html$/, '');
/** The boards the canvas marks as partly old: "… (old: what, replaced by …)". */
const oldBoards = Object.entries(canvas.boards)
  .filter(([, board]) => board.title.includes('(old:'))
  .map(([file]) => boardName(file));

describe('01-SPEC.md', () => {
  const spec = read('01-SPEC.md');
  const header = spec.slice(0, spec.indexOf('## תוכן עניינים'));
  const decision = (id: string): string[] => {
    const row = tableRows(section(spec, '## 24.', '## 25.')).find((cells) => cells[0] === id);
    if (!row) throw new Error(`no ${id} in §24`);
    return row;
  };

  it('its header does not say that only "pending" proposals depart from the original', () => {
    expect(header).not.toMatch(/נשארה\*\*, חוץ מהצעות/);
    expect(header).toContain('דרישות שמשה החליף במפורש');
    expect(header).toContain('ממתינה לאישור');
  });

  it.each(['D14', 'D44', 'D45'])(
    'its header lists %s among the requirements Moshe replaced, and §24 marks it "✓ החלטת משה"',
    (id) => {
      expect(header).toContain(`**${id}:**`);
      const row = decision(id);
      expect(row[row.length - 1]).toContain('✓ החלטת משה');
    },
  );

  it('its header says the drag is not built again (D45)', () => {
    expect(header).toMatch(/D45:\*\*[^\n]*גרירה[^\n]*אין לבנות גרירה מחדש/);
  });

  it('§7.2: the D35 scope is for fireworks, cats and warp; scramble and ink stay on the board, keypad on the keypad', () => {
    const rules = section(spec, '### 7.2', '### 7.3');
    const d35 = rules.slice(rules.indexOf('[D35]'), rules.indexOf('\n- ', rules.indexOf('[D35]')));
    expect(d35).toContain('עד שתאושר, ההפרעה פועלת על כל המסך');
    for (const words of ['זיקוקים', 'חתולים', 'עיוות']) expect(d35).toContain(words);
    expect(d35).toMatch(/מספרים מתערבלים ודיו פועלים על הלוח, ומקלדת מתערבלת על המקלדת/);
    // The same in §24's row, which is what gets approved.
    expect(decision('D35')[2]).toContain('D47');
  });

  it('§4.1 names every board the canvas marks old', () => {
    const note = section(spec, '- **הפרעות, אחרי ההחלטות של משה', '### 4.2');
    expect(oldBoards.length).toBeGreaterThan(0);
    for (const board of oldBoards)
      expect({ board, named: note.includes(board) }).toEqual({ board, named: true });
  });
});

describe('design/canvas.json', () => {
  it('every board that still draws the drag says so in its title', () => {
    const drawsDrag = Object.keys(canvas.boards).filter((file) => {
      const path = join(DOCS, 'design', 'screens', file);
      return existsSync(path) && DRAG.test(readFileSync(path, 'utf8'));
    });
    expect(drawsDrag).toEqual(
      expect.arrayContaining(['Arsenal', 'Interferences', 'Splash'].map((name) => `${name}.dc.html`)),
    );
    for (const file of drawsDrag) {
      const title = canvas.boards[file]?.title ?? '';
      expect({ file, title, old: /\(old: [^)]*D45\)/.test(title) }).toEqual({ file, title, old: true });
    }
  });

  it('no note presents the drag as the way to launch, or as an open decision', () => {
    for (const [id, { text }] of Object.entries(canvas.notes)) {
      if (!DRAG.test(text)) continue;
      expect({ id, cites: text.includes('D45'), open: text.includes('החלטה פתוחה') }).toEqual({
        id,
        cites: true,
        open: false,
      });
    }
    expect(canvas.notes['d-interfere']?.text).toContain('שתי הקשות, בלי גרירה');
  });

  it('the drag screen is gone', () => {
    expect(Object.keys(canvas.boards)).not.toContain('Interference-Drag.dc.html');
    expect(existsSync(join(DOCS, 'design', 'screens', 'Interference-Drag.dc.html'))).toBe(false);
  });
});

describe('QA-CHECKLIST.md', () => {
  const qa = read('QA-CHECKLIST.md');
  const rows = tableRows(qa);
  // | screen | canvas file | route | עברית | אנגלית | Android | iOS | notes |
  const HE = 3;
  const EN = 4;
  const NOTES = 7;
  /** "ישן", "ישנה", "ישנים", "ישנות" (old). */
  const OLD = /ישן|ישנה|ישנים|ישנות/;
  /** The rows whose canvas cell names `board` ("Game-Bot", "DS-Foundations, DS-Components", "Arsenal (ישן: …)"). */
  const named = (board: string): string[][] =>
    rows.filter((cells) => (cells[1] ?? '').split(/[\s,()]+/).includes(board));

  it('the interference block keeps its rule: rows the 2026-10-17 decisions changed are ☐ in Hebrew and English', () => {
    expect(qa).toContain('השורות שהשתנו מסומנות ☐ גם בעברית ובאנגלית');
    const block = tableRows(section(qa, '## הפרעות, תגובות וכניעה', '## '));
    // Every interference row (screen 16) changed with D44–D47; so does any other row that cites them.
    const changed = block.filter(
      (cells) => (cells[0] ?? '').startsWith('16.') || /D4[4-7]/.test(cells.join('|')),
    );
    expect(changed.length).toBeGreaterThanOrEqual(13);
    for (const cells of changed) {
      expect({ row: cells[0], he: cells[HE], en: cells[EN] }).toEqual({ row: cells[0], he: '☐', en: '☐' });
    }
  });

  it.each(['Game-Bot', 'Hit-Fireworks', 'Hit-Cats', 'Hit-Warp'])(
    '%s (D44, D46): ☐ in Hebrew and English until the code is checked',
    (board) => {
      expect(named(board).length).toBeGreaterThan(0);
      for (const cells of named(board)) {
        expect({ board, he: cells[HE], en: cells[EN] }).toEqual({ board, he: '☐', en: '☐' });
      }
    },
  );

  it('every row on a board the canvas marks old says the board is old', () => {
    for (const board of oldBoards) {
      for (const cells of named(board)) {
        const old = OLD.test(cells[1] ?? '') || OLD.test(cells[NOTES] ?? '');
        expect({ board, row: cells[0], old }).toEqual({ board, row: cells[0], old: true });
      }
    }
    // The collection board's drag tile and hint, and the splash's drag tip (D45), in the canvas column itself.
    expect(named('Interferences')[0]?.[1]).toContain('ישן');
    expect(named('Splash')[0]?.[1]).toContain('ישן');
  });
});

describe('02-WORK-PLAN.md', () => {
  const plan = read('02-WORK-PLAN.md');

  it('stage 5: a dated note says the bot never interferes (D44)', () => {
    const stage5 = section(plan, '## שלב 5', '## שלב 6');
    const note = stage5.split('\n').find((line) => line.startsWith('> ') && line.includes('D44')) ?? '';
    expect(note).toContain('17.10.2026');
    expect(note).toContain('הבוט לא מפריע אף פעם');
  });

  it('stage 12: a dated note gives the unlock levels of today (D17, D47), as INTERFERENCE_UNLOCK_LEVELS has them', () => {
    const stage12 = section(plan, '## שלב 12', '## שלב 13');
    const note = stage12.split('\n').find((line) => line.startsWith('> ') && line.includes('D17')) ?? '';
    expect(note).toContain('D47');
    expect(note).toContain('17.10.2026');
    for (const [kind, level] of Object.entries(INTERFERENCE_UNLOCK_LEVELS)) {
      const name = heGame.interference[kind as keyof typeof heGame.interference];
      // "זיקוקים, חתולים ועיוות פתוחים מההתחלה", "מספרים מתערבלים נפתחים ברמה 2", "דיו ברמה 3"…
      const where = level === 0 ? 'פתוחים מההתחלה' : `ברמה ${level}`;
      const at = note.indexOf(name);
      const soonAfter = note.slice(at, at + name.length + 40);
      expect({ kind, named: at >= 0, where: soonAfter.includes(where) }).toEqual({
        kind,
        named: true,
        where: true,
      });
    }
  });
});
