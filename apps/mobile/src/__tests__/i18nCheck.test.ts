import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SAMPLE_LOCALES } from '../testing/localeFiles';

/**
 * Work plan stage 13, "בדיקת תרגום", and localization plan 0ד (D120): scripts/i18n-check.mjs (`npm run
 * i18n:check` every day, in CI and in `verify`; `npm run i18n:release` before a store build). It runs here on the
 * real tree (no errors; English's _two and _many and Hebrew's _many are kept, as warnings), on the Arabic,
 * Russian and Japanese samples with the app's own plural rules (services/pluralRules.ts, which the script reads),
 * and on small broken trees, where each kind of mistake must be reported: keys by a plural's base, the forms a
 * language's rules need, _zero where English has it, placeholders, isolates, namespace files, t('key') for a key
 * that doesn't exist, and the admin site's strings.ts. Two levels (D120): every day Hebrew and English fail on
 * every error, an enabled translated language only on what breaks it on screen (what merely lags behind Hebrew
 * and English is a warning), and another language's folder on nothing; with --release, every folder on every
 * error. Unused keys and extra plural forms are warnings (they fail only with --strict).
 */

jest.setTimeout(30_000);

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'i18n-check.mjs');
const LRI = String.fromCodePoint(0x2066);

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const errorsOf = (out: string) => out.split('\n').filter((l) => l.startsWith('error'));
const warningsOf = (out: string) => out.split('\n').filter((l) => l.startsWith('warning'));

/** Each expected text is in one of the lines. */
function expectLines(lines: string[], expected: string[]) {
  for (const e of expected)
    expect({ e, found: lines.some((l) => l.includes(e)) }).toEqual({ e, found: true });
}

function writeTree(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const LOCALES = 'apps/mobile/src/i18n/locales';
const ENABLED = 'apps/mobile/src/i18n/enabled-languages.json';

const HOME = {
  he: {
    title: 'בית',
    greet: 'שלום {{name}}',
    items_one: 'פריט',
    items_two: 'שני פריטים',
    items_other: '{{count}} פריטים',
    modes: { solo: 'לבד', bot: 'בוט' },
  },
  en: {
    title: 'Home',
    greet: 'Hello {{name}}',
    items_one: 'item',
    items_other: '{{count}} items',
    modes: { solo: 'Solo', bot: 'Bot' },
  },
  // Arabic: six forms; "one", "two" and "zero" are one number each, and may leave it out.
  ar: {
    title: 'الرئيسية',
    greet: 'مرحبًا {{name}}',
    items_zero: 'لا عناصر',
    items_one: 'عنصر واحد',
    items_two: 'عنصران',
    items_few: '{{count}} عناصر',
    items_many: '{{count}} عنصرًا',
    items_other: '{{count}} عنصر',
    modes: { solo: 'فردي', bot: 'روبوت' },
  },
  // Russian: four forms; "one" is 1, 21, 31…, so it shows the number.
  ru: {
    title: 'Главная',
    greet: 'Привет, {{name}}',
    items_one: '{{count}} предмет',
    items_few: '{{count}} предмета',
    items_many: '{{count}} предметов',
    items_other: '{{count}} предмета',
    modes: { solo: 'Один', bot: 'Бот' },
  },
};

/** A copy of an object without one key. */
const without = <T extends object>(o: T, key: keyof T) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

const ADMIN = {
  'apps/admin/src/strings.ts': [
    "const he = { 'a.b': 'שלום {name}' } satisfies Record<string, string>;",
    "const en: Record<string, string> = { 'a.b': 'Hi {name}' };",
  ].join('\n'),
  'apps/admin/src/App.tsx': "export const x = (t: (k: string) => string) => t('a.b');",
};

const GOOD = {
  ...ADMIN,
  'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['home'] as const;",
  [`${LOCALES}/he/home.json`]: HOME.he,
  [`${LOCALES}/en/home.json`]: HOME.en,
  'apps/mobile/app/index.tsx': [
    "import { useTranslation } from 'react-i18next';",
    'export default function Index({ mode }: { mode: string }) {',
    "  const { t } = useTranslation('home');",
    "  return [t('title'), t('greet', { name: 'x' }), t('items', { count: 2 }), t(`modes.${mode}`)];",
    '}',
  ].join('\n'),
};

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'i18n-check-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scripts/i18n-check.mjs', () => {
  it('passes on the app and the admin site', () => {
    const { code, out } = run();
    expect({ code, errors: errorsOf(out) }).toEqual({ code: 0, errors: [] });
    expect(out).toMatch(
      /app: \d+ namespaces, \d+ keys, \d+ languages \([^)]*; enabled: he en[^)]*\) · admin: \d+ keys · 0 error\(s\)/,
    );
    // English's _two and _many and Hebrew's _many stay in the files: one warning line each, never an error.
    const kept = (lang: string) => warningsOf(out).find((l) => l.startsWith(`warning  ${lang}: `)) ?? '';
    expect(kept('en')).toMatch(/plural form\(s\) its rules never pick, kept \(.*_two ×\d+.*_many ×\d+/);
    expect(kept('he')).toMatch(/plural form\(s\) its rules never pick, kept \(_many ×\d+;/);
  });

  it('passes on the app with --release (npm run i18n:release) while only Hebrew and English exist', () => {
    const { code, out } = run('--release');
    expect({ code, errors: errorsOf(out) }).toEqual({ code: 0, errors: [] });
    expect(out).toContain('release: every language');
  });

  it('passes on a tree with nothing wrong', () => {
    writeTree(root, GOOD);
    const { code, out } = run('--root', root);
    expect(out).toContain('0 error(s), 0 warning(s)');
    expect(code).toBe(0);
  });

  it('passes on the Arabic, Russian and Japanese samples, enabled, with the app’s plural rules (6, 4 and 1 forms)', () => {
    const samples = Object.fromEntries(
      readdirSync(SAMPLE_LOCALES).map((lang) => [
        `${LOCALES}/${lang}/sample.json`,
        readFileSync(join(SAMPLE_LOCALES, lang, 'sample.json'), 'utf8'),
      ]),
    );
    writeTree(root, {
      ...ADMIN,
      ...samples,
      'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['sample'] as const;",
      [ENABLED]: ['he', 'en', 'ar', 'ru', 'ja'],
      'apps/mobile/app/index.tsx': [
        "import { useTranslation } from 'react-i18next';",
        'export default function Index() {',
        "  const { t } = useTranslation('sample');",
        "  return [t('title'), t('greet', { name: 'x' }), t('points', { count: 2 }), t('streak', { count: 0 }),",
        "    t('lead', { count: 2, name: 'x', gap: 2 }), t('range'), t('score', { score: '1' }), t('sep'),",
        "    t('sentenceSpace'), t('brand'), t('vs')];",
        '}',
      ].join('\n'),
    });
    const daily = run('--root', root);
    expect(daily.out).toContain('5 languages (ar en he ja ru; enabled: he en ar ru ja)');
    expect(daily.out).toContain('0 error(s), 0 warning(s)');
    expect(daily.code).toBe(0);
    const release = run('--root', root, '--release');
    expect(release.out).toContain('0 error(s), 0 warning(s)');
    expect(release.code).toBe(0);
  });

  it('reports every kind of mistake, and fails', () => {
    writeTree(root, {
      ...GOOD,
      [`${LOCALES}/he/home.json`]: {
        title: 'בית',
        greet: 'שלום {{name}}',
        onlyHe: 'רק בעברית',
        empty: ' ',
        items_one: 'פריט',
        items_other: '{{count}} פריטים',
        streak_one: 'ניצחון אחד',
        streak_two: 'שני ניצחונות',
        streak_other: '{{count}} ניצחונות',
        range: `${LRI}0–3 כוכבים`,
        nested: '$t(home:nope)',
        modes: { solo: 'לבד', bot: 'בוט' },
      },
      [`${LOCALES}/en/home.json`]: {
        title: 'Home',
        greet: 'Hello {{who}}',
        onlyEn: 'English only',
        empty: 'Empty',
        items_one: 'item',
        items_other: '{{count}} items',
        streak_zero: 'No streak',
        streak_one: '{{count}} win',
        streak_other: '{{count}} wins',
        range: '0–3 stars',
        nested: '$t(home:nope)',
        modes: { solo: 'Solo', bot: 'Bot' },
      },
      [`${LOCALES}/he/game.json`]: { a: 'א' },
      'apps/mobile/app/other.tsx': [
        "import type { TFunction } from 'i18next';",
        "type HomeT = TFunction<'home'>;",
        "export const a = (t: HomeT) => [t('missing.key'), t(`nomodes.${'x'}`), t('home:nope')];",
      ].join('\n'),
      'apps/admin/src/strings.ts': [
        "const he = { 'a.b': 'שלום {name}', 'a.c': 'ג ', 'only.he': 'א' } satisfies Record<string, string>;",
        "const en: Record<string, string> = { 'a.b': 'Hi {who}', 'a.c': 'C' };",
      ].join('\n'),
    });
    const { code, out } = run('--root', root);
    expect(code).toBe(1);
    expectLines(errorsOf(out), [
      'i18n/index.ts: namespace "game" is not in NAMESPACES',
      'he/game.json: there is no en/game.json',
      'he/home.json: "onlyHe" is not in en/home.json',
      'he/home.json: "onlyEn" is missing (en/home.json has it)',
      'he/home.json: "empty" is empty',
      'he/home.json: plural "items" has no "_two" form',
      'he/home.json: plural "streak" has no "_zero" form',
      'he/home.json: "greet" has different placeholders: en [who], he [name]',
      'he/home.json: "range": an isolate (LRI/RLI/FSI) is not closed by a PDI',
      'en/home.json: "nested" nests $t(home:nope), which doesn\'t exist',
      "other.tsx:3: t('missing.key') - no such key in home",
      'other.tsx:3: t(`nomodes.…`) - no key in home matches',
      "other.tsx:3: t('home:nope') - no such key in home",
      'strings.ts: he "a.c" has spaces at an end',
      'strings.ts: "only.he" is in he but not in en',
      'strings.ts: "a.b" has different placeholders',
    ]);
  });

  it('keeps plural forms a language’s rules never pick (English _two, Hebrew _many): a warning, not an error', () => {
    writeTree(root, {
      ...GOOD,
      [`${LOCALES}/he/home.json`]: { ...HOME.he, items_many: '{{count}} פריטים' },
      [`${LOCALES}/en/home.json`]: { ...HOME.en, items_two: 'two items' },
    });
    const { code, out } = run('--root', root);
    expect(code).toBe(0);
    expect(warningsOf(out).sort()).toEqual([
      'warning  en: 1 plural form(s) its rules never pick, kept (_two ×1; e.g. home:items_two)',
      'warning  he: 1 plural form(s) its rules never pick, kept (_many ×1; e.g. home:items_many)',
    ]);
    expect(run('--root', root, '--strict').code).toBe(1);
  });

  it('a language not enabled yet: its errors are warnings every day, and errors with --release (D120)', () => {
    writeTree(root, {
      ...GOOD,
      [`${LOCALES}/ar/home.json`]: { ...without(HOME.ar, 'items_few'), title: 'Home' },
    });
    const daily = run('--root', root);
    expect({ code: daily.code, errors: errorsOf(daily.out) }).toEqual({ code: 0, errors: [] });
    expectLines(warningsOf(daily.out), [
      'ar/home.json: plural "items" has no "_few" form [ar is not enabled: an error with --release]',
      'ar/home.json: "title" is the same as English ("Home")',
      'ar/home.json: "title" has Latin letters',
    ]);
    expect(daily.out).toContain('3 languages (ar en he; enabled: he en)');
    const release = run('--root', root, '--release');
    expect(release.code).toBe(1);
    expectLines(errorsOf(release.out), [
      'ar/home.json: plural "items" has no "_few" form',
      'ar/home.json: "title" is the same as English ("Home")',
    ]);
  });

  it('an enabled language may lag behind Hebrew and English every day, not break (D120)', () => {
    // Not translated yet (a plural form, a key): English shows there meanwhile, so a warning until --release.
    writeTree(root, {
      ...GOOD,
      [ENABLED]: ['he', 'en', 'ru'],
      [`${LOCALES}/ru/home.json`]: without(without(HOME.ru, 'items_many'), 'title'),
    });
    const lagging = run('--root', root);
    expect({ code: lagging.code, errors: errorsOf(lagging.out) }).toEqual({ code: 0, errors: [] });
    expectLines(warningsOf(lagging.out), [
      'ru/home.json: plural "items" has no "_many" form [not translated yet: an error with --release]',
      'ru/home.json: "title" is missing (en/home.json has it) [not translated yet: an error with --release]',
    ]);
    const release = run('--root', root, '--release');
    expect(release.code).toBe(1);
    expectLines(errorsOf(release.out), [
      'ru/home.json: plural "items" has no "_many" form',
      'ru/home.json: "title" is missing (en/home.json has it)',
    ]);

    // What breaks it on screen even so (a placeholder English doesn't pass), and an enabled language with no
    // folder at all: errors every day.
    writeTree(root, {
      [ENABLED]: ['he', 'en', 'ru', 'ja'],
      [`${LOCALES}/ru/home.json`]: { ...HOME.ru, greet: 'Привет, {{who}}' },
    });
    const { code, out } = run('--root', root);
    expect(code).toBe(1);
    const errors = errorsOf(out);
    expectLines(errors, [
      'ru/home.json: "greet" has different placeholders: en [name], ru [who]',
      'enabled-languages.json: "ja" is enabled, with no folder',
    ]);
    expect(errors.filter((l) => l.includes('is not enabled') || l.includes('not translated yet'))).toEqual(
      [],
    );

    // Hebrew lags behind nothing: a missing key fails every day.
    writeTree(root, { [`${LOCALES}/he/home.json`]: without(HOME.he, 'title') });
    expectLines(errorsOf(run('--root', root).out), [
      'he/home.json: "title" is missing (en/home.json has it)',
    ]);

    writeTree(root, { [ENABLED]: { he: true } });
    expectLines(errorsOf(run('--root', root).out), [
      'enabled-languages.json: not a JSON array of language codes',
    ]);
  });

  it('D109: the dev namespace and the staging-only keys are not needed in a translated language', () => {
    writeTree(root, {
      ...GOOD,
      'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['home', 'dev'] as const;",
      [`${LOCALES}/he/home.json`]: { ...HOME.he, settings: { testing: 'בדיקה' } },
      [`${LOCALES}/en/home.json`]: { ...HOME.en, settings: { testing: 'Testing' } },
      [`${LOCALES}/he/dev.json`]: { title: 'פיתוח' },
      [`${LOCALES}/en/dev.json`]: { title: 'Development' },
      [`${LOCALES}/ar/home.json`]: HOME.ar,
      'apps/mobile/app/dev.tsx': [
        "import type { TFunction } from 'i18next';",
        "export const a = (t: TFunction<'home'>) => [t('settings.testing'), t('dev:title')];",
      ].join('\n'),
    });
    const release = run('--root', root, '--release');
    expect({ code: release.code, errors: errorsOf(release.out) }).toEqual({ code: 0, errors: [] });

    // config/i18n.ts, devNamespacesTranslated: true (D109 the other way): then they are needed.
    writeTree(root, {
      'apps/mobile/src/config/i18n.ts': 'export const I18N = { devNamespacesTranslated: true };',
    });
    const translated = run('--root', root, '--release');
    expect(translated.code).toBe(1);
    expect(errorsOf(translated.out).sort()).toEqual([
      'error    ar/dev.json: missing (en/dev.json has it)',
      'error    ar/home.json: "settings.testing" is missing (en/home.json has it)',
    ]);
  });

  it('reports unused keys as warnings, and fails on them only with --strict', () => {
    writeTree(root, {
      ...GOOD,
      [`${LOCALES}/he/home.json`]: { ...HOME.he, spare: 'עוד' },
      [`${LOCALES}/en/home.json`]: { ...HOME.en, spare: 'More' },
    });
    const lenient = run('--root', root);
    expect(lenient.code).toBe(0);
    expect(lenient.out).toContain('warning  home: "spare" is not used');
    // Plural forms, nested keys under t(`modes.${mode}`), and placeholders' keys are all counted as used.
    expect(lenient.out).toContain('0 error(s), 1 warning(s)');
    expect(run('--root', root, '--strict').code).toBe(1);
  });
});
