import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { I18N_CONFIG } from '../config/i18n';
import { LANGUAGE_NAMES, LANGUAGES } from '../i18n/languages';

/**
 * The docs agree with the localization project (19 languages, 1.1.0), as Moshe approved its plan on 2026-10-23:
 * "מאשר, ברירות המחדל", with his own answers on D101 (English), D112 (translate the legal texts) and D121 (a
 * native speaker later) (docs/handoff/2026-10-23/localization/plan.md §7, §0טו).
 * Sessions read these docs before every stage (CLAUDE.md), and Moshe follows the device checks on his phone: a ☐
 * left on a decided row, a setting quoted with another value than the app's, or a menu name the app no longer shows
 * would get the wrong thing built or checked. This reads them as a reviewer would, against the code they describe.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const DOCS = join(ROOT, 'docs');
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

/** A Hebrew string of the app, by namespace and dotted key. */
function he(ns: string, key: string): string {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', 'i18n', 'locales', 'he', `${ns}.json`), 'utf8'),
  ) as Record<string, unknown>;
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], json);
  if (typeof value !== 'string') throw new Error(`no he ${ns}:${key}`);
  return value;
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

const DECISIONS = Array.from({ length: 24 }, (_, i) => `D${101 + i}`);
const APPROVED = "✓ משה 2026-10-23: 'מאשר, ברירות המחדל'";
/** Moshe's own answers (plan §7), each in its status. */
const HIS_ANSWERS: Record<string, string> = {
  D101: '✓ משה 2026-10-23: אנגלית',
  D112: '✓ משה 2026-10-23: מתרגמים',
  D121: '✓ משה 2026-10-23: אחר כך, לא בפרויקט הזה',
};
const NEW_LANGUAGES = LANGUAGES.filter((lang) => lang !== 'he' && lang !== 'en');

describe('01-SPEC.md', () => {
  const spec = read('01-SPEC.md');
  const header = spec.slice(0, spec.indexOf('## תוכן עניינים'));
  const rows = tableRows(section(spec, '## 24.', '## 25.')).filter((cells) => /^D\d+$/.test(cells[0] ?? ''));
  const row = (id: string): string[] => rows.find((cells) => cells[0] === id) ?? [];
  const status = (id: string): string => row(id)[4] ?? '';
  const languages = section(spec, '## 22.', '## 23.');
  const stores = section(spec, '## 23.', '## 24.');

  it.each(DECISIONS)('§24 %s: approved by Moshe on 2026-10-23, with what is built', (id) => {
    expect({ id, cols: row(id).length }).toEqual({ id, cols: 5 });
    const expected = HIS_ANSWERS[id] ?? APPROVED;
    expect({ id, status: status(id).startsWith(expected) }).toEqual({ id, status: true });
    expect({ id, built: (row(id)[2] ?? '').length > 40 }).toEqual({ id, built: true });
  });

  it('none of D101–D124 departs from the original (it has no requirement on languages)', () => {
    expect(header).toContain('D101–D124');
    expect(header).toContain('אף אחת מהן לא סותרת את המקור');
    for (const id of DECISIONS) {
      expect({ id, listed: header.includes(`**${id}:**`) }).toEqual({ id, listed: false });
      expect({ id, against: status(id).includes('שונה מהמקור') }).toEqual({ id, against: false });
    }
  });

  it('every I18N_CONFIG value the spec quotes is the app’s, and every decision setting is quoted', () => {
    const quoted = [...spec.matchAll(/`I18N_CONFIG\.(\w+) = '?([\w-]+)'?`/g)];
    for (const [, key, value] of quoted)
      expect({ key, value }).toEqual({ key, value: String(I18N_CONFIG[key as keyof typeof I18N_CONFIG]) });
    const keys = new Set(quoted.map(([, key]) => key));
    for (const key of Object.keys(I18N_CONFIG).filter((k) => k !== 'regionMap'))
      expect({ key, quoted: keys.has(key) }).toEqual({ key, quoted: true });
    expect(row('D105')[2]).toContain('`I18N_CONFIG.regionMap`');
  });

  it('D120 points at the CLAUDE.md proposal, which exists; CLAUDE.md is Moshe’s to change', () => {
    const proposal = 'docs/handoff/2026-10-23/localization/claude-md-proposal.md';
    expect(row('D120')[2]).toContain(proposal);
    expect(existsSync(join(ROOT, proposal))).toBe(true);
    expect(status('D120')).toContain('מחכה לאישור של משה');
  });

  it('§22: the 19 languages, the one list of enabled ones, English as the fallback, Western digits', () => {
    expect(LANGUAGES).toHaveLength(19);
    expect(languages).toContain('19 שפות: עברית ואנגלית, ועוד 17');
    expect(languages).toContain('`apps/mobile/src/i18n/enabled-languages.json`');
    expect(languages).toContain('**שפת ברירת המחדל והגיבוי: אנגלית [D101].**');
    expect(I18N_CONFIG.fallbackLanguage).toBe('en');
    // D108 keeps the spec's own rule (it was line 1737 before 1.1.0), now for every language.
    expect(languages).toContain('מספרים תמיד בספרות לטיניות, בכל השפות');
    expect(languages).toContain('עברית וערבית מימין לשמאל');
    expect(languages).toContain('**הלוח והמקלדת תמיד משמאל לימין,** בכל שפה');
    for (const id of ['D102', 'D103', 'D104', 'D106', 'D119', 'D120', 'D123'])
      expect({ id, cited: languages.includes(id) }).toEqual({ id, cited: true });
  });

  it('§23: the translated legal texts carry the "English prevails" line, the Hebrew and English ones do not', () => {
    expect(stores).toContain('[D112]');
    expect(stores).toContain('"זה תרגום של הגרסה האנגלית. אם יש הבדל, הגרסה האנגלית גוברת."');
    expect(stores).toContain('**העברית והאנגלית לא משתנות,** ובהן אין את השורה הזו');
    // D115b: "available in 19 languages" only in the version that ships all 19.
    expect(stores).toContain('רק בגרסה שבה כל 19 השפות יוצאות');
    expect(row('D115')[2]).toContain('**רק בגרסה שבה כל 19 השפות יוצאות.**');
  });
});

describe('QA-CHECKLIST.md', () => {
  const qa = read('QA-CHECKLIST.md');
  const heading = '## שפות (פרויקט השפות, 1.1.0)';
  const block = section(qa, heading, '## ');
  const rows = tableRows(block).filter((cells) => cells[0] !== 'מסך');

  it('the languages section: 8 columns a row, the picker ☐ until its code is checked, the device checks linked', () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const cells of rows)
      expect({ row: cells[0], cols: cells.length }).toEqual({ row: cells[0], cols: 8 });
    const picker = rows.find((cells) => cells[0] === 'הגדרות: בורר השפה') ?? [];
    expect([picker[3], picker[4]]).toEqual(['☐', '☐']);
    expect(picker[1]).toContain('`components.md` סעיף 21');
    expect(block).toContain('[`LOCALIZATION-DEVICE-CHECKS.md`](LOCALIZATION-DEVICE-CHECKS.md)');
  });

  it('the intro’s link to the section lands on its heading', () => {
    expect(qa).toContain(`(#${slug(heading.slice(3))})`);
  });
});

describe('RELEASE-CHECKLIST.md', () => {
  const release = read('RELEASE-CHECKLIST.md');
  const block = section(release, '## גרסה 1.1.0', '## ');
  // | ☐ | # | what | who | where |
  const steps = tableRows(block).filter((cells) => /^\d+$/.test(cells[1] ?? ''));
  const step = (mark: string): number => steps.findIndex((cells) => (cells[2] ?? '').includes(mark));

  it('its steps run 1…n: verify, i18n:release, the server, the APK, the aapt2 check, then the version', () => {
    expect(steps.map((cells) => cells[1])).toEqual(steps.map((_, i) => String(i + 1)));
    const order = [
      'npm run verify',
      'npm run i18n:release',
      'השרת קודם',
      'APK ראשון אחרי שלב 0',
      'aapt2 dump configurations',
      'npm run version:bump -- minor',
    ].map(step);
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('i18n:release is a root script and blocks every store build; the aapt2 check names the library folders', () => {
    const scripts = (
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts['i18n:release']).toContain('--release');
    expect(steps[step('npm run i18n:release')]?.[2]).toContain('חוסם כל בנייה לחנות');
    expect(section(release, '## שלב יג', '## ')).toContain('`npm run i18n:release` עובר');
    const aapt = steps[step('aapt2 dump configurations')]?.[2] ?? '';
    for (const folder of ['iw', 'in', 'zh-rCN', 'zh-rTW', 'pt'])
      expect({ folder, named: aapt.includes(`\`${folder}\``) }).toEqual({ folder, named: true });
    expect(aapt).toContain('res/xml/locales_config.xml');
    expect(aapt).toContain('android:localeConfig');
  });

  it('D115b: the "In Hebrew and English" line changes only in the version that ships all 19 languages', () => {
    const d115b = steps[step('D115ב')]?.[2] ?? '';
    expect(d115b).toContain('**רק בגרסה שבה כל 19 השפות יוצאות.**');
  });
});

describe('LOCALIZATION-DEVICE-CHECKS.md', () => {
  const doc = read('LOCALIZATION-DEVICE-CHECKS.md');
  const partA = section(doc, '## חלק א', '## חלק ב');
  const partB = section(doc, '## חלק ב', '## מה עוד');

  it('part A: checks 1–8 in order, the pseudo languages, the plural screen and the system language', () => {
    const titles = partA.split('\n').filter((line) => line.startsWith('### בדיקה '));
    expect(titles.map((line) => /^### בדיקה (\d+):/.exec(line)?.[1])).toEqual(
      Array.from({ length: 8 }, (_, i) => String(i + 1)),
    );
    for (const lang of ['en-XA', 'ar-XB'])
      expect(partA).toContain(`### בדיקה ${lang === 'en-XA' ? 4 : 5}: השפה המדומה ${lang}`);
    expect(partA).toContain('הגדרות ← מערכת ← שפות ← שפות אפליקציה ← Sudoku Fight');
    expect(partA).toContain('**אין לולאה של הפעלות מחדש:**');
  });

  it('every menu and button it names is the app’s Hebrew', () => {
    const names = [
      he('home', 'settings.testing'),
      he('home', 'settings.language'),
      he('home', 'settings.languageDevice'),
      he('home', 'settings.languageSheetTitle'),
      he('home', 'settings.languageConfirm.confirm'),
      he('dev', 'pseudo.title'),
      he('dev', 'pseudo.plurals'),
    ];
    for (const name of names)
      expect({ name, quoted: doc.includes(`"${name}"`) }).toEqual({ name, quoted: true });
    expect(doc).toContain(
      `"${he('home', 'settings.languageConfirm.title').replace('{{language}}', 'English')}"`,
    );
  });

  it('the Hebrew "two" forms it asks to see are the app’s', () => {
    for (const [ns, key] of [
      ['levels', 'hud.puzzle.moving_two'],
      ['levels', 'hud.puzzle.fixed_two'],
      ['player', 'mistakes.long_two'],
      ['game', 'live.leadMine_two'],
    ] as const)
      expect({ key, quoted: doc.includes(`"${he(ns, key)}"`) }).toEqual({ key, quoted: true });
  });

  it('part B: every new language by the name the picker shows, and the per-language template', () => {
    for (const lang of NEW_LANGUAGES)
      expect({ lang, named: partB.includes(`| ${LANGUAGE_NAMES[lang]} |`) }).toEqual({ lang, named: true });
    for (const part of ['5.1 ו־5.2', '5.3', '5.4', '5.5'])
      expect({ part, checked: partB.includes(`(${part}`) }).toEqual({ part, checked: true });
  });
});

describe('docs/store/locales/README.md', () => {
  const doc = read('store', 'locales', 'README.md');

  it('one row per new language, in the app’s order, with both stores’ codes', () => {
    const codes = tableRows(section(doc, '## הקודים בכל חנות', '## '))
      .filter((cells) => cells[0] !== 'שפה')
      .map((cells) => /`([^`]+)`/.exec(cells[1] ?? '')?.[1]);
    expect(codes).toEqual(NEW_LANGUAGES);
  });

  it('the field limits of both stores (source document §3)', () => {
    const limits = tableRows(section(doc, '## מגבלות התווים', '## '))
      .filter((cells) => cells[0] !== 'חנות')
      .map((cells) => Number((cells[2] ?? '').replace(',', '')));
    expect(limits).toEqual([30, 80, 4000, 500, 30, 30, 170, 4000, 100, 4000]);
  });

  it('the listing docs point at it', () => {
    for (const listing of ['LISTING-GOOGLE.md', 'LISTING-APPLE.md'])
      expect({ listing, links: read('store', listing).includes('(locales/README.md)') }).toEqual({
        listing,
        links: true,
      });
  });
});

describe('the CLAUDE.md proposal (D120)', () => {
  const proposal = read('handoff', '2026-10-23', 'localization', 'claude-md-proposal.md');
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

  it('quotes today’s CLAUDE.md word for word, so Moshe sees exactly what changes', () => {
    const today = proposal
      .split('**היום:**')
      .slice(1)
      .flatMap((part) => (part.split('**מוצע:**')[0] ?? '').split('\n'))
      .filter((line) => line.startsWith('> '))
      .map((line) => line.slice(2));
    expect(today.length).toBeGreaterThanOrEqual(4);
    for (const line of today)
      expect({ line, inClaudeMd: claude.includes(line) }).toEqual({ line, inClaudeMd: true });
  });

  it('keeps Hebrew and English every day, and names the release gate and the enabled-languages list', () => {
    expect(proposal).toContain('**ביום־יום:** כל מחרוזת חדשה בעברית ובאנגלית');
    expect(proposal).toContain('`npm run i18n:release` חייב לעבור');
    expect(proposal).toContain('`apps/mobile/src/i18n/enabled-languages.json`');
  });
});

describe('links', () => {
  it.each([
    ['LOCALIZATION-DEVICE-CHECKS.md'],
    ['store/locales/README.md'],
    ['handoff/2026-10-23/localization/claude-md-proposal.md'],
  ])('every relative link in %s leads to a file', (file) => {
    const text = read(file);
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (!target || /^https?:/.test(target)) continue;
      const path = join(DOCS, dirname(file), target);
      expect({ file, target, exists: existsSync(path) }).toEqual({ file, target, exists: true });
    }
  });
});
