import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STEALTH_BOT_CONFIG } from '@sudoku-fight/engine';
import { TELEMETRY_EVENT_GENERATION, TELEMETRY_EVENT_NAMES } from '@sudoku-fight/protocol';

import { FRIENDS_UI } from '../config/friends';

/**
 * The docs agree with playing with friends (1.0.4) and the stealth bot (server only, built off), as Moshe decided on
 * 2026-10-20: "כן כן כן, לך עם ברירות המחדל, תמשיך לבנות" (docs/handoff/2026-10-19/plan.md §5; friends-room.md §12,
 * stealth-bot.md §14). His triple yes is the explicit yes the plan asked for on the three decisions that depart from
 * the original spec (D80a, D90, D92); every other decision of D80–D99 is built at its default. The stealth bot is
 * switched on in staging only when he says so (D90).
 * Sessions read these docs before every stage (CLAUDE.md): a ☐ left on a decided row, a contradiction of the original
 * without its quote, or a stealth bot that reads as "on" would get the wrong thing built. This reads them as a
 * reviewer would, and checks the numbers they quote against the settings the code reads.
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

/** [D80–D99] Moshe, 2026-10-20, in the status column of §24. */
const MOSHE_YES = "✓ משה 2026-10-20: 'כן כן כן, לך עם ברירות המחדל'";
const FRIENDS = Array.from({ length: 10 }, (_, i) => `D${80 + i}`);
const STEALTH = Array.from({ length: 10 }, (_, i) => `D${90 + i}`);
/** The ones that depart from the original spec, and the original sections they depart from. */
const AGAINST_ORIGINAL: Record<string, string[]> = { D80: ['§5'], D90: ['§5.3', '§7', '§24'], D92: ['§5.2'] };
/** A 6-digit room code inside Hebrew text: LTR-isolated (LRI…PDI), or "123 456" turns into "456 123". */
const LRI = '⁦';
const PDI = '⁩';

describe('01-SPEC.md', () => {
  const spec = read('01-SPEC.md');
  const original = read('00-original-spec-v1.md');
  const header = spec.slice(0, spec.indexOf('## תוכן עניינים'));
  const rows = tableRows(section(spec, '## 24.', '## 25.')).filter((cells) => /^D\d+$/.test(cells[0] ?? ''));
  const row = (id: string): string[] => rows.find((cells) => cells[0] === id) ?? [];
  const status = (id: string): string => row(id)[4] ?? '';

  it.each([...FRIENDS, ...STEALTH])('§24 %s: decided by Moshe on 2026-10-20, with what is built', (id) => {
    expect({ id, cols: row(id).length }).toEqual({ id, cols: 5 });
    expect({ id, status: status(id).startsWith(MOSHE_YES) }).toEqual({ id, status: true });
    expect({ id, built: (row(id)[2] ?? '').length > 20 }).toEqual({ id, built: true });
  });

  it.each(Object.entries(AGAINST_ORIGINAL))(
    '%s departs from the original: the header lists it, §24 says "החלטת משה", and names the section',
    (id, sections) => {
      const listed = id === 'D80' ? 'D80a' : id;
      expect(header).toContain(`**${listed}:**`);
      expect(status(id)).toContain('החלטת משה');
      expect(status(id)).toContain('"כן" מפורש');
      for (const s of sections)
        expect({ id, s, named: status(id).includes(s) }).toEqual({ id, s, named: true });
    },
  );

  it('D90 is built off, and switched on in staging only when Moshe says so', () => {
    expect(status('D90')).toContain('נבנה כבוי');
    expect(status('D90')).toContain('ב־staging רק כשמשה אומר');
    expect(row('D90')[2]).toContain('`STEALTH_BOT_ENABLED=false`');
    expect(header).toMatch(/\*\*D90:\*\*[^\n]*נבנה כבוי בכל השרתים/);
  });

  it('D39 is closed by Moshe’s request; D40 now says "no visible bot", and points at D90', () => {
    expect(status('D39')).toContain('✓ בקשת משה, 19.10.2026');
    expect(row('D40')[2]).toContain('אין בוט גלוי. בוט סמוי: D90');
  });

  it('§5.1 records D80a as original / decision / why, with its switches as FRIENDS_UI has them', () => {
    const modes = section(spec, '### 5.1', '### 5.2');
    const d80a = modes.slice(modes.indexOf('[D80a] (20.10.2026)'));
    expect(d80a).toContain('**הדרישה המקורית (§5):**');
    expect(d80a).toContain('**ההחלטה:**');
    expect(d80a).toContain('**למה:**');
    for (const key of ['modesGroup', 'groupName', 'rankedChip'] as const)
      expect({ key, named: d80a.includes(`\`FRIENDS_UI.${key}`) }).toEqual({ key, named: true });
    expect(FRIENDS_UI.modesGroup).toBe(true);
    expect(FRIENDS_UI.rankedChip).toBe(false);
  });

  it('§5.4 has its eight parts, and every FRIENDS_UI value it quotes is the app’s', () => {
    const friends = section(spec, '### 5.4', '## 6.');
    for (let part = 1; part <= 8; part++)
      expect({ part, found: friends.includes(`\n#### 5.4.${part} `) }).toEqual({ part, found: true });
    const quoted = [...spec.matchAll(/`FRIENDS_UI\.(\w+) = '?(\w+)'?`/g)];
    expect(quoted.length).toBeGreaterThan(0);
    for (const [, key, value] of quoted)
      expect({ key, value }).toEqual({ key, value: String(FRIENDS_UI[key as keyof typeof FRIENDS_UI]) });
    // D84a: no time limit, and a held seat for 6 h.
    expect(friends).toContain('`FRIENDS_RULES.lobbyAwayHoldMs = 21600000`');
    expect(friends).toContain('`FRIENDS_RULES.lobbyMaxMs = null`');
  });

  it('room codes in the spec’s Hebrew are LTR-isolated', () => {
    for (const m of spec.matchAll(/\d{3} \d{3}/g)) {
      const at = m.index ?? 0;
      expect({ code: m[0], isolated: spec[at - 1] === LRI && spec[at + 7] === PDI }).toEqual({
        code: m[0],
        isolated: true,
      });
    }
  });

  it('§9.1 quotes the original it departs from, and the numbers are STEALTH_BOT_CONFIG’s', () => {
    const stealth = section(spec, '### 9.1', '## 10.');
    for (const quote of [
      'במשחק מדורג מול שחקנים אמיתיים המערכת תחפש שחקנים בטווח Rating מתאים.',
      'שחקנים ישובצו מול שחקנים בטווח דירוג מתאים.',
      'ללא השפעה על Rating',
      'להשתמש בהפרעות',
      'Player vs Player',
    ]) {
      expect({ quote, inOriginal: original.includes(quote) }).toEqual({ quote, inOriginal: true });
      expect({ quote, inSpec: stealth.includes(quote) }).toEqual({ quote, inSpec: true });
    }
    const c = STEALTH_BOT_CONFIG;
    expect(c.defaultBaseMs).toBe(14_000);
    expect(stealth).toContain('14 ש׳ למהלך רגיל');
    expect(c.baseBounds).toEqual({ min: 3000, max: 40_000 });
    expect(stealth).toContain('3–40 ש׳');
    expect(c.spread).toBe(0.3);
    expect(stealth).toContain('בין 0.7 ל־1.3');
    expect(c.mistakes).toEqual({ min: 0.02, max: 0.2, default: 0.08 });
    expect(stealth).toContain('בין 2% ל־20% (בלי נתונים: 8%)');
    expect(c.retaliate.afterEndMs).toEqual({ min: 2000, max: 20_000 });
    expect(c.retaliate.sameKindShare).toBe(0.5);
    expect(c.guard).toMatchObject({ games: 10, winShare: 0.65, step: 0.05, min: 0.8 });
    expect(stealth).toContain('65%');
    expect(stealth).toContain('×0.8');
    expect(c.reactions).toEqual({});
    expect(stealth).toContain('`STEALTH_BOT_CONFIG.reactions = {}`');
    expect(stealth).toContain(`\`normalization = ${c.normalization}\``);
    expect(stealth).toContain(`\`paceScale\` (היום ${c.paceScale})`);
  });

  it('§22 lists every friends event the app sends (generation 3), with no code and no id', () => {
    const events = section(spec, '## 22.', '## 23.');
    const friends = TELEMETRY_EVENT_NAMES.filter((name) => TELEMETRY_EVENT_GENERATION[name] === 3);
    expect(friends).toHaveLength(6);
    for (const name of friends)
      expect({ name, listed: events.includes(`\`${name}{`) }).toEqual({ name, listed: true });
    expect(events).not.toMatch(/`friends_[a-z_]+\{[^}]*(code|Id|id)\b/);
  });

  it('the original spec is never edited: it still has the requirements these decisions depart from', () => {
    expect(original).toContain('יוצגו חמש אפשרויות בלבד.');
    expect(original).toContain('משחק Player vs Player:');
  });
});

describe('DECISIONS-PENDING.md', () => {
  const pending = read('DECISIONS-PENDING.md');
  const decided = (item: string, end: string): string[][] =>
    tableRows(section(pending, item, end)).filter((cells) => /^D\d+$/.test(cells[0] ?? ''));

  it('2.8 (D39) is closed', () => {
    expect(section(pending, '### 2.8', '### 2.9').split('\n')[1]).toContain('✓ נסגר');
  });

  it('2.21 closes the friends room: D80–D89, each ✓, in the 2.19 table', () => {
    const item = section(pending, '### 2.21', '### 2.22');
    expect(item.split('\n')[1]).toContain('✓ נסגר');
    expect(item).toContain('כן כן כן, לך עם ברירות המחדל');
    expect(item).toContain('[`FRIENDS-DEVICE-CHECKS.md`](FRIENDS-DEVICE-CHECKS.md)');
    const rows = decided('### 2.21', '### 2.22');
    expect(rows.map((cells) => cells[0])).toEqual(FRIENDS);
    for (const cells of rows)
      expect({ id: cells[0], cols: cells.length, ok: cells[5] }).toEqual({ id: cells[0], cols: 6, ok: '✓' });
  });

  it('2.22 closes the stealth bot, built off: D90 waits for Moshe’s word to switch it on in staging', () => {
    const item = section(pending, '### 2.22', '## 3.');
    expect(item.split('\n')[1]).toContain('✓ נסגר, ונבנה כבוי');
    expect(item).toContain('**מחכה למילה שלך:** מתי להדליק ב־staging');
    const rows = decided('### 2.22', '## 3.');
    expect(rows.map((cells) => cells[0])).toEqual(STEALTH);
    expect(rows[0]?.[5]).toBe('✓ (כבוי)');
    for (const cells of rows.slice(1))
      expect({ id: cells[0], ok: cells[5] }).toEqual({ id: cells[0], ok: '✓' });
    // 3.22 points at D95.
    expect(section(pending, '### 3.22', '### 3.23')).toContain('D95');
  });
});

describe('02-WORK-PLAN.md', () => {
  const plan = read('02-WORK-PLAN.md');

  it('has stages 14ג and 14ד in the overview, and the server before the 1.0.4 APK on the parallel track', () => {
    const overview = tableRows(section(plan, '## סקירת שלבים', '---'));
    expect(overview.find((cells) => cells[0] === '14ג')?.[1]).toBe('משחק עם חברים (גרסה 1.0.4)');
    expect(overview.find((cells) => cells[0] === '14ד')?.[1]).toBe('בוט סמוי (שרת בלבד, כבוי)');
    const track = tableRows(section(plan, '## מסלול מקביל', '## סקירת שלבים'));
    const friends = track.find((cells) => cells[0]?.includes('1.0.4'));
    expect(friends?.[0]).toMatch(/השרת לפני ה־APK/);
    expect(friends?.[0]).toContain('0009');
    expect(friends?.[0]).toContain('בנייה מלאה');
    expect(friends?.[2]).toBe('14ג');
    expect(track.find((cells) => cells[2] === '14ד')?.[0]).toContain('כבוי');
  });

  it.each([
    ['14ג', '## שלב 14ד'],
    ['14ד', '## שלב 15'],
  ])('stage %s is in the house format, and its prompt waits for approval', (id, next) => {
    const stage = section(plan, `## שלב ${id}`, next);
    expect(stage).toContain('**מקור:**');
    expect(stage.split('\n').filter((line) => /^\*\*[^*]+\*\* \(/.test(line))).toHaveLength(6);
    const done = section(stage, '**סיום:**', '**פרומפט:**');
    expect(done.split('\n').filter((line) => line.startsWith('- ')).length).toBeGreaterThanOrEqual(3);
    const prompt = stage.slice(stage.indexOf('**פרומפט:**'));
    const block = prompt
      .slice(prompt.indexOf('```') + 3, prompt.lastIndexOf('```'))
      .trim()
      .split('\n');
    expect(block[0]).toMatch(new RegExp(`^שלב ${id} לפי docs/02-WORK-PLAN\\.md`));
    expect(block[block.length - 1]).toBe('התחל בתוכנית וברשימת בדיקות, וחכה לאישור.');
  });

  it('stage 14ד: built off, switched on in staging only when Moshe says so, and no APK', () => {
    const stage = section(plan, '## שלב 14ד', '## שלב 15');
    expect(stage).toContain('**נבנה כבוי בכל השרתים**');
    expect(stage).toContain('**אין שינוי באפליקציה, ולכן אין APK.**');
    expect(stage).toContain('**רק אחרי שמשה אומר "להדליק":**');
  });
});

describe('FRIENDS-DEVICE-CHECKS.md', () => {
  const doc = read('FRIENDS-DEVICE-CHECKS.md');

  it('has the 21 checks of friends-room.md §10, two phones on staging, each with boxes to tick', () => {
    for (let n = 1; n <= 21; n++) {
      const check = section(doc, `## בדיקה ${n}:`, '## ');
      expect({ n, boxes: check.includes('- [ ]') }).toEqual({ n, boxes: true });
    }
    expect(doc).not.toContain('## בדיקה 22:');
    expect(doc).toContain('**בקצרה: קודם השרת, ורק אחר כך האפליקציה.**');
    expect(doc).toContain('**1.0.4 הוא APK עם שינוי native**');
    // The host waits in WhatsApp 15 minutes and more (D84a), and the link opens the room itself (D88).
    expect(section(doc, '## בדיקה 2:', '## ')).toContain('15 דקות');
    expect(section(doc, '## בדיקה 4:', '## ')).toContain('**האפליקציה נפתחת ישר בחדר ההמתנה,**');
  });

  it('room codes in its Hebrew are LTR-isolated', () => {
    for (const m of doc.matchAll(/\d{3} \d{3}/g)) {
      const at = m.index ?? 0;
      expect({ code: m[0], isolated: doc[at - 1] === LRI && doc[at + 7] === PDI }).toEqual({
        code: m[0],
        isolated: true,
      });
    }
  });

  it('the QA checklist, the release checklist, the work plan and the decisions point at it', () => {
    for (const other of [
      'QA-CHECKLIST.md',
      'RELEASE-CHECKLIST.md',
      '02-WORK-PLAN.md',
      'DECISIONS-PENDING.md',
    ])
      expect({ other, links: read(other).includes('FRIENDS-DEVICE-CHECKS.md') }).toEqual({
        other,
        links: true,
      });
  });
});

describe('QA-CHECKLIST.md', () => {
  const qa = read('QA-CHECKLIST.md');

  it('the friends section: every row has its 8 columns and a route, and the two boards are named', () => {
    const rows = tableRows(section(qa, '## משחק עם חברים', '## ')).filter((cells) => cells[0] !== 'מסך');
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const cells of rows) {
      expect({ row: cells[0], cols: cells.length }).toEqual({ row: cells[0], cols: 8 });
      expect({
        row: cells[0],
        route: /`(\/|https:)/.test(cells[2] ?? '') || (cells[2] ?? '').includes('`+not-found`'),
      }).toEqual({
        row: cells[0],
        route: true,
      });
    }
    for (const board of ['Friends-Room', 'Friends-Join'])
      expect({
        board,
        named: rows.some((cells) => (cells[1] ?? '').split(/[\s,()]+/).includes(board)),
      }).toEqual({
        board,
        named: true,
      });
  });

  it('the stealth bot: its staging checks run only after Moshe says "להדליק"', () => {
    const stealth = section(qa, '## בוט סמוי', '## ');
    expect(stealth).toContain('**הבדיקות כאן רק אחרי שמשה אומר "להדליק" ב־staging**');
    expect(stealth.split('\n').filter((line) => /^\d+\. /.test(line))).toHaveLength(11);
  });
});

describe('design/', () => {
  interface Canvas {
    boards: Record<string, { title: string }>;
    order: string[];
    notes: Record<string, { text: string }>;
  }
  const canvas = JSON.parse(read('design', 'canvas.json')) as Canvas;

  it.each(['Friends-Room', 'Friends-Join'])('%s is drawn, on the canvas and in screens/', (board) => {
    const file = `${board}.dc.html`;
    expect(existsSync(join(DOCS, 'design', 'screens', file))).toBe(true);
    expect(canvas.boards[file]?.title).toMatch(/^Friends · /);
    expect(canvas.order).toContain(file);
    // Drawn alongside the build: the board says the spec and the code win.
    expect(read('design', 'screens', file)).toContain('the spec and the code win');
  });

  it('the canvas notes say the boards were drawn alongside the build, and point at the spec and components', () => {
    const note = canvas.notes['d-friends']?.text ?? '';
    expect(note).toContain('כן כן כן, לך עם ברירות המחדל');
    expect(note).toContain('אפיון סעיף 5.4');
    expect(note).toContain('components.md סעיף 20');
  });

  it('components.md §20 and its checklist line; motion.md §4.12 with a Reduced Motion form for each row', () => {
    const components = read('design', 'components.md');
    const friends = section(components, '## 20.', '## 21.');
    expect(friends.split('\n')[1]).toContain('[new]');
    expect(friends).toContain('**the code is LTR everywhere**');
    expect(section(components, '## 18.', '## 19.')).toContain('**Playing with friends (§20');
    const motion = section(read('design', 'motion.md'), '### 4.12', '## 5.');
    const rows = tableRows(motion).filter((cells) => /^`friends\./.test(cells[0] ?? ''));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const cells of rows)
      expect({ id: cells[0], cols: cells.length, reduced: (cells[5] ?? '').length > 0 }).toEqual({
        id: cells[0],
        cols: 6,
        reduced: true,
      });
  });
});
