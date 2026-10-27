import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BRAND,
  checkStoreFile,
  checkStoreLocales,
  KEYWORD_BYTES,
  length,
  LIMITS,
  STORE_LOCALES,
} from '../../../scripts/lib/store-check.mjs';

/**
 * `npm run store:check` (scripts/store-check.mjs; localization plan §4, D93, D115): the store listings of the 17
 * translated languages, docs/store/locales/<code>.json, as their README describes them. The real files pass; the
 * script's tables agree with the README and with the app's languages; and each rule catches its own mistake in a
 * broken copy of a real file.
 */

const REPO = path.join(__dirname, '..', '..', '..');
const LOCALES = path.join(REPO, 'docs', 'store', 'locales');
const SCRIPT = path.join(REPO, 'scripts', 'store-check.mjs');

type Listing = {
  googlePlay: Record<string, unknown>;
  appStore: Record<string, unknown>;
  screenshotCaptions: unknown[];
  variants: Record<string, unknown>;
};

const real = (lang: string): Listing =>
  JSON.parse(readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8')) as Listing;

/** A real file with some fields changed: { 'googlePlay.title': '…' }. */
function edited(lang: string, edits: Record<string, unknown>): Listing {
  const data = real(lang);
  for (const [where, value] of Object.entries(edits)) {
    const [part, field] = where.split('.') as [keyof Listing, string];
    if (field === undefined) (data as Record<string, unknown>)[part] = value;
    else (data[part] as Record<string, unknown>)[field] = value;
  }
  return data;
}

/** The errors of one file, each expected text in one of them, and nothing else. */
function expectErrors(lang: string, data: unknown, expected: string[]) {
  const { errors } = checkStoreFile(lang, data);
  for (const e of expected)
    expect({ e, found: errors.some((line) => line.includes(e)) }).toEqual({ e, found: true });
  expect(errors).toHaveLength(expected.length);
}

const tableRows = (md: string) =>
  md
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    );

describe('the real listings', () => {
  it('pass, every language with its file: no error', () => {
    const files = Object.fromEntries(
      readdirSync(LOCALES)
        .filter((f) => f.endsWith('.json'))
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(path.join(LOCALES, f), 'utf8')) as unknown]),
    );
    expect(Object.keys(files).sort()).toEqual(Object.keys(STORE_LOCALES).sort());
    expect(checkStoreLocales(files).errors).toEqual([]);
  });

  it('the script: exit 0 and a summary on the real files; exit 1 and the error on a broken folder', () => {
    const ok = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/store listings: 17 file\(s\) of 17 languages · 0 error\(s\)/);

    const dir = mkdtempSync(path.join(tmpdir(), 'store-check-'));
    try {
      for (const lang of Object.keys(STORE_LOCALES))
        writeFileSync(path.join(dir, `${lang}.json`), JSON.stringify(real(lang)));
      writeFileSync(
        path.join(dir, 'de.json'),
        JSON.stringify(edited('de', { 'googlePlay.title': 'Sudoku Fight: Das beste!' })),
      );
      writeFileSync(path.join(dir, 'fr.json'), '{ "googlePlay": ');
      const bad = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('error    de.json: googlePlay.title has "beste"');
      expect(bad.stderr).toContain('error    fr.json: not valid JSON');
      expect(bad.stdout).toMatch(/2 error\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cover the app’s languages but Hebrew and English, in the app’s order', () => {
    const enabled = JSON.parse(
      readFileSync(path.join(REPO, 'apps', 'mobile', 'src', 'i18n', 'enabled-languages.json'), 'utf8'),
    ) as string[];
    expect(Object.keys(STORE_LOCALES)).toEqual(enabled.filter((l) => l !== 'he' && l !== 'en'));
  });

  it('README’s tables are the script’s: each language’s store codes, and each field’s limit', () => {
    const readme = readFileSync(path.join(LOCALES, 'README.md'), 'utf8');
    const codes = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const table = Object.fromEntries(
      tableRows(readme)
        .filter((cells) => cells.length === 4 && codes(cells[1] ?? '').length === 1)
        .map((cells) => [codes(cells[1]!)[0], { googlePlay: codes(cells[2]!), appStore: codes(cells[3]!) }]),
    );
    expect(table).toEqual(STORE_LOCALES);

    const FIELDS: Record<string, Record<string, string>> = {
      googlePlay: {
        שם: 'title',
        'תיאור קצר': 'shortDescription',
        'תיאור מלא': 'fullDescription',
        'מה חדש': 'whatsNew',
      },
      appStore: {
        שם: 'name',
        'כותרת משנה': 'subtitle',
        'טקסט קידום': 'promotionalText',
        תיאור: 'description',
        'מילות מפתח': 'keywords',
        'מה חדש': 'whatsNew',
      },
    };
    const limits: Record<string, Record<string, number>> = { googlePlay: {}, appStore: {} };
    for (const [store, field, max] of tableRows(readme).filter((c) => c.length === 3)) {
      const key = store === 'Google Play' ? 'googlePlay' : store === 'App Store' ? 'appStore' : null;
      if (key === null) continue;
      limits[key]![FIELDS[key]![field!]!] = Number(max!.replace(/,/g, ''));
    }
    expect(limits).toEqual(LIMITS);
  });
});

describe('each rule catches its mistake', () => {
  it('a field over its limit, counted in characters (an emoji is one)', () => {
    expect(length('😂ab')).toBe(3);
    expectErrors('de', edited('de', { 'appStore.subtitle': 'x'.repeat(31) }), [
      'appStore.subtitle is 31 characters, over the limit of 30',
    ]);
    expectErrors('ja', edited('ja', { 'appStore.promotionalText': '数'.repeat(171) }), [
      'appStore.promotionalText is 171 characters, over the limit of 170',
    ]);
  });

  it('a field missing, empty or with spaces around it; 8 screenshot captions', () => {
    expectErrors('it', edited('it', { 'googlePlay.whatsNew': undefined, 'appStore.subtitle': ' ' }), [
      'googlePlay.whatsNew is missing or not a string',
      'appStore.subtitle is empty',
    ]);
    expectErrors('it', edited('it', { 'appStore.promotionalText': 'Sfida live. ' }), [
      'appStore.promotionalText has spaces at its start or end',
    ]);
    expectErrors('it', edited('it', { screenshotCaptions: real('it').screenshotCaptions.slice(1) }), [
      'screenshotCaptions must be 8 captions',
    ]);
  });

  it('the store codes of README’s table', () => {
    expectErrors('es', edited('es', { 'googlePlay.locales': ['es-ES'] }), [
      'googlePlay.locales is ["es-ES"], README\'s table says ["es-419","es-ES"]',
    ]);
  });

  it('the brand (D115a): Google Play "Sudoku Fight: …" (French "Sudoku Fight : …"), App Store "Sudoku Fight" alone', () => {
    expect(real('fr').googlePlay.title).toMatch(/^Sudoku Fight[\u00A0\u202F ]: /);
    expectErrors('ru', edited('ru', { 'googlePlay.title': 'Судоку Fight: PvP' }), [
      'googlePlay.title must be "Sudoku Fight: …"',
    ]);
    expectErrors('ru', edited('ru', { 'appStore.name': `${BRAND}: Судоку` }), [
      'appStore.name must be exactly "Sudoku Fight"',
    ]);
  });

  it('Google Play’s metadata policy in the title and short description: no emoji, #1, best, free, call to action', () => {
    expectErrors('es', edited('es', { 'googlePlay.shortDescription': 'El sudoku #1 en vivo 🔥' }), [
      'googlePlay.shortDescription has an emoji',
      'googlePlay.shortDescription has "#1"',
    ]);
    expectErrors('es', edited('es', { 'googlePlay.title': 'Sudoku Fight: PvP gratis' }), [
      'googlePlay.title has "gratis"',
    ]);
    expectErrors('ko', edited('ko', { 'googlePlay.shortDescription': '최고의 실시간 스도쿠' }), [
      'googlePlay.shortDescription has "최고"',
    ]);
    expectErrors('ru', edited('ru', { 'googlePlay.shortDescription': 'Бесплатное судоку вживую' }), [
      'googlePlay.shortDescription has "бесплатн"',
    ]);
    expectErrors('nl', edited('nl', { 'googlePlay.shortDescription': 'Download nu en speel live' }), [
      'googlePlay.shortDescription has "download nu"',
    ]);
    // A word that only contains one is fine ("topo" is not "top"; "Freunde" is not "free").
    expect(
      checkStoreFile('de', edited('de', { 'googlePlay.shortDescription': 'Mit Freunden live, fair.' }))
        .errors,
    ).toEqual([]);
    // The full description may have emoji (the game's reactions).
    expect(real('es').googlePlay.fullDescription).toMatch(/\p{Extended_Pictographic}/u);
  });

  it('App Store keywords: commas without spaces, no empty or repeated keyword, none from the name or subtitle', () => {
    expectErrors('de', edited('de', { 'appStore.keywords': 'Rätsel, Zahlen,Logik' }), [
      'appStore.keywords: a space next to a comma',
    ]);
    expectErrors('de', edited('de', { 'appStore.keywords': 'Rätsel,,Zahlen,rätsel' }), [
      'appStore.keywords: an empty keyword',
      'appStore.keywords: "rätsel" twice',
    ]);
    // German: the subtitle is "Multiplayer-Sudoku-Duelle live".
    expectErrors('de', edited('de', { 'appStore.keywords': 'Rätsel,Duelle,live spielen' }), [
      'appStore.keywords: "Duelle" repeats a word of the name or the subtitle',
      'appStore.keywords: "live spielen" repeats a word of the name or the subtitle',
    ]);
    // Without spaces between words (Chinese): a keyword the subtitle contains.
    expectErrors('zh-Hans', edited('zh-Hans', { 'appStore.keywords': '益智,多人,数独' }), [
      'appStore.keywords: "多人" repeats a word of the name or the subtitle',
      'appStore.keywords: "数独" repeats a word of the name or the subtitle',
    ]);
  });

  it('keywords over 100 bytes: a warning, not an error (Apple may count bytes outside Latin)', () => {
    const { errors, warnings } = checkStoreFile('ja', real('ja'));
    expect(errors).toEqual([]);
    expect(new TextEncoder().encode(real('ja').appStore.keywords as string).length).toBeGreaterThan(
      KEYWORD_BYTES,
    );
    expect(warnings).toEqual([expect.stringContaining('ja.json: appStore.keywords is')]);
  });

  it('D93: no text says the opponents are all real people', () => {
    const description = `${real('es').appStore.description as string}\n\nSolo jugadores reales.`;
    expectErrors('es', edited('es', { 'appStore.description': description }), [
      'appStore.description says the opponents are real people (D93',
    ]);
    expectErrors(
      'pl',
      edited('pl', { screenshotCaptions: [...real('pl').screenshotCaptions.slice(0, 7), 'No bots!'] }),
      ['screenshotCaptions[7] says the opponents are real people'],
    );
  });

  it('D115b: both descriptions say the app is in 19 languages', () => {
    const without = (real('tr').googlePlay.fullDescription as string).replace(/(?<!\d)19(?!\d)/g, 'birçok');
    expectErrors('tr', edited('tr', { 'googlePlay.fullDescription': without }), [
      "googlePlay.fullDescription doesn't say the app is in 19 languages (D115b)",
    ]);
  });

  it('variants (es-ES): a locale of the file and fields of its store, checked like the rest', () => {
    const es = real('es');
    expect(Object.keys(es.variants)).toEqual(['es-ES']);
    expectErrors('es', { ...es, variants: { 'es-AR': { appStore: { subtitle: 'x' } } } }, [
      "variants.es-AR: not one of the file's locales",
    ]);
    expectErrors('es', { ...es, variants: { 'es-ES': { appStore: { tagline: 'x' } } } }, [
      'variants.es-ES.appStore.tagline: appStore has no such field',
    ]);
    expectErrors(
      'es',
      { ...es, variants: { 'es-ES': { googlePlay: { title: 'Sudoku Fight: lo mejor' } } } },
      ['variants.es-ES.googlePlay.title has "mejor"'],
    );
    expectErrors('es', { ...es, variants: { 'es-ES': { appStore: { subtitle: 'y'.repeat(31) } } } }, [
      'variants.es-ES.appStore.subtitle is 31 characters, over the limit of 30',
    ]);
  });

  it('a missing file, a file for Hebrew or English (theirs are LISTING-*.md), and one that isn’t JSON', () => {
    const files: Record<string, unknown> = Object.fromEntries(
      Object.keys(STORE_LOCALES).map((lang) => [lang, real(lang)]),
    );
    delete files.vi;
    files.he = real('ar');
    files.nl = new SyntaxError('Unexpected end of JSON input');
    const { errors } = checkStoreLocales(files);
    expect(errors).toHaveLength(3);
    expect(errors).toEqual(
      expect.arrayContaining([
        'vi.json: missing (every language of the app has its listing)',
        expect.stringContaining('he.json: not a language of the app'),
        'nl.json: not valid JSON (Unexpected end of JSON input)',
      ]),
    );
  });
});
