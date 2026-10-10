import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Work plan stage 13, "בדיקת תרגום": scripts/i18n-check.mjs (`npm run i18n:check`, in CI and in `verify`).
 * It runs here on the real tree (no errors), and on a small broken tree, where each kind of mistake must be
 * reported: missing keys both ways, empty values, different placeholders, a plural form Hebrew needs, a
 * namespace file in one language only or not registered, t('key') for a key that doesn't exist, and the
 * admin site's strings.ts. Unused keys are warnings, which don't fail the run (unless --strict).
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'i18n-check.mjs');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function writeTree(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const GOOD = {
  'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['home'] as const;",
  'apps/mobile/src/i18n/locales/he/home.json': {
    title: 'בית',
    greet: 'שלום {{name}}',
    items_one: 'פריט',
    items_two: 'שני פריטים',
    items_other: '{{count}} פריטים',
    modes: { solo: 'לבד', bot: 'בוט' },
  },
  'apps/mobile/src/i18n/locales/en/home.json': {
    title: 'Home',
    greet: 'Hello {{name}}',
    items_one: 'item',
    items_two: 'two items',
    items_other: '{{count}} items',
    modes: { solo: 'Solo', bot: 'Bot' },
  },
  'apps/mobile/app/index.tsx': [
    "import { useTranslation } from 'react-i18next';",
    'export default function Index({ mode }: { mode: string }) {',
    "  const { t } = useTranslation('home');",
    "  return [t('title'), t('greet', { name: 'x' }), t('items', { count: 2 }), t(`modes.${mode}`)];",
    '}',
  ].join('\n'),
  'apps/admin/src/strings.ts': [
    "const he = { 'a.b': 'שלום {name}' } satisfies Record<string, string>;",
    "const en: Record<string, string> = { 'a.b': 'Hi {name}' };",
  ].join('\n'),
  'apps/admin/src/App.tsx': "export const x = (t: (k: string) => string) => t('a.b');",
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
    expect({ code, errors: out.split('\n').filter((l) => l.startsWith('error')) }).toEqual({
      code: 0,
      errors: [],
    });
    expect(out).toMatch(/app: \d+ namespaces, \d+ keys · admin: \d+ keys · 0 error\(s\)/);
  });

  it('passes on a tree with nothing wrong', () => {
    writeTree(root, GOOD);
    const { code, out } = run('--root', root);
    expect(out).toContain('0 error(s), 0 warning(s)');
    expect(code).toBe(0);
  });

  it('reports every kind of mistake, and fails', () => {
    writeTree(root, {
      ...GOOD,
      'apps/mobile/src/i18n/locales/he/home.json': {
        title: 'בית',
        greet: 'שלום {{name}}',
        onlyHe: 'רק בעברית',
        empty: ' ',
        items_one: 'פריט',
        items_other: '{{count}} פריטים',
        modes: { solo: 'לבד', bot: 'בוט' },
      },
      'apps/mobile/src/i18n/locales/en/home.json': {
        title: 'Home',
        greet: 'Hello {{who}}',
        onlyEn: 'English only',
        empty: 'Empty',
        items_one: 'item',
        items_other: '{{count}} items',
        modes: { solo: 'Solo', bot: 'Bot' },
      },
      'apps/mobile/src/i18n/locales/he/game.json': { a: 'א' },
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
    const expected = [
      'namespace "game" is not in NAMESPACES',
      'locales/en/game.json: missing',
      'he/home.json: "onlyHe" is missing in en/home.json',
      'en/home.json: "onlyEn" is missing in he/home.json',
      'he/home.json: "empty" is empty',
      'he/home.json: plural "items" has no "_two" form',
      'home: "greet" has different placeholders',
      "other.tsx:3: t('missing.key') - no such key in home",
      'other.tsx:3: t(`nomodes.…`) - no key in home matches',
      "other.tsx:3: t('home:nope') - no such key in home",
      'strings.ts: he "a.c" has spaces at an end',
      'strings.ts: "only.he" is in he but not in en',
      'strings.ts: "a.b" has different placeholders',
    ];
    const errors = out.split('\n').filter((l) => l.startsWith('error'));
    for (const e of expected)
      expect({ e, found: errors.some((l) => l.includes(e)) }).toEqual({ e, found: true });
  });

  it('reports unused keys as warnings, and fails on them only with --strict', () => {
    writeTree(root, {
      ...GOOD,
      'apps/mobile/src/i18n/locales/he/home.json': {
        ...GOOD['apps/mobile/src/i18n/locales/he/home.json'],
        spare: 'עוד',
      },
      'apps/mobile/src/i18n/locales/en/home.json': {
        ...GOOD['apps/mobile/src/i18n/locales/en/home.json'],
        spare: 'More',
      },
    });
    const lenient = run('--root', root);
    expect(lenient.code).toBe(0);
    expect(lenient.out).toContain('warning  home: "spare" is not used');
    // Plural forms, nested keys under t(`modes.${mode}`), and placeholders' keys are all counted as used.
    expect(lenient.out).toContain('0 error(s), 1 warning(s)');
    expect(run('--root', root, '--strict').code).toBe(1);
  });
});
