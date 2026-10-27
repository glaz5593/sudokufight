import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { flatten, PLURAL_SUFFIX } from '../../../../scripts/lib/i18n-locales.mjs';
import {
  allowListEntries,
  countedNounAfter,
  nestedCounts,
  NUMBER_OK,
  numberAllowed,
  numberProblems,
  type PassedNumber,
  shownPlaceholders,
  WHY,
} from '../../../../scripts/lib/i18n-numbers.mjs';
import { APP_LOCALES, readLocales } from '../testing/localeFiles';

/**
 * Localization plan 6.1 #21, rule 21 of scripts/i18n-check.mjs (its rules in scripts/lib/i18n-numbers.mjs): a
 * number in a string must be a plural. It fails on a key that is not a plural with a placeholder followed by a
 * counted noun ("{{score}} points"), and on a t() call that passes a number (by its TypeScript type) to a
 * placeholder that is not the plural's count, unless NUMBER_OK allows it with the reason (an abbreviation, a
 * number that names something, a number with no counted noun). A sentence with two numbers nests one plural per
 * number ($t(ns:key, {"count": {{x}} })). And a call that reads a plural must pass { count }: without it i18next
 * looks for the plain key and shows the key's name.
 */

jest.setTimeout(30_000);

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'i18n-check.mjs');

const code = (entries: Record<string, Partial<PassedNumber>>) =>
  new Map(
    Object.entries(entries).map(([p, v]) => [p, { numberAt: [], showsCount: false, ...v } as PassedNumber]),
  );

describe('the text: a placeholder followed by a counted noun', () => {
  it('finds the noun, with up to two words that describe it, a closing tag or a no-break space between', () => {
    expect(countedNounAfter('Final score: {{score}} points', 'score')).toBe('points');
    expect(countedNounAfter('{{cells}} missing cells instead of {{usual}}', 'cells')).toBe('cells');
    expect(countedNounAfter('{{total}} short stages · 0–3 stars', 'total')).toBe('stages');
    expect(countedNounAfter('after {{games}} ranked games', 'games')).toBe('games');
    expect(countedNounAfter('<b>{{n}}</b> seconds', 'n')).toBe('seconds');
    expect(countedNounAfter('{{n}} hours', 'n')).toBe('hours');
    expect(countedNounAfter('{{n}} point', 'n')).toBe('point');
  });

  it('no noun: a name, a label, an abbreviation, a symbol, a verb', () => {
    expect(countedNounAfter('Level {{level}}', 'level')).toBeNull();
    expect(countedNounAfter('Taps: {{count}}', 'count')).toBeNull();
    expect(countedNounAfter('{{cost}} pts', 'cost')).toBeNull();
    expect(countedNounAfter('{{s}} s left', 's')).toBeNull();
    expect(countedNounAfter('{{stars}}/{{max}}', 'stars')).toBeNull();
    expect(countedNounAfter('{{left}} left', 'left')).toBeNull();
    expect(countedNounAfter('{{n}} pointless', 'n')).toBeNull();
  });

  it('a nested plural shows its own number: what is inside $t(…) is not shown by the sentence', () => {
    const value =
      'costs $t(game:a.pts, {"count": {{cost}} }), $t(game:a.short, {"count": {{missing}} }) · {{score}}';
    expect(nestedCounts(value)).toEqual(['cost', 'missing']);
    expect(shownPlaceholders(value)).toEqual(['score']);
    expect(countedNounAfter('$t(a, {"count": {{n}} }) points', 'n')).toBeNull();
  });
});

describe('numberProblems', () => {
  const base = { ns: 'game', base: 'x' };

  it('a key that is not a plural: a counted noun, or a number from the code, is a problem', () => {
    expect(numberProblems({ ...base, value: '{{score}} points', isPlural: false }).problems).toEqual([
      { placeholder: 'score', noun: 'points', numberAt: [] },
    ]);
    expect(
      numberProblems({
        ...base,
        value: 'Taps: {{n}}',
        isPlural: false,
        code: code({ n: { numberAt: ['a.tsx:3'] } }),
      }).problems,
    ).toEqual([{ placeholder: 'n', noun: null, numberAt: ['a.tsx:3'] }]);
    expect(numberProblems({ ...base, value: 'Hello {{name}}', isPlural: false }).problems).toEqual([]);
  });

  it('a placeholder that holds words is never read as a number ("{{name}} wins", "a {{type}} game")', () => {
    expect(
      numberProblems({ ...base, value: '{{name}} wins · a {{type}} game', isPlural: false }).problems,
    ).toEqual([]);
  });

  it('a plural: its count, or the count shown another way, is fine; a second number is not', () => {
    expect(numberProblems({ ...base, value: '{{count}} points', isPlural: true }).problems).toEqual([]);
    const shown = code({ score: { showsCount: true } });
    expect(
      numberProblems({ ...base, value: '{{score}} points', isPlural: true, code: shown }).problems,
    ).toEqual([]);
    expect(
      numberProblems({
        ...base,
        value: '{{count}} mistakes, {{s}} seconds added',
        isPlural: true,
        code: code({ s: { numberAt: ['b.tsx:9'] } }),
      }).problems,
    ).toEqual([{ placeholder: 's', noun: 'seconds', numberAt: ['b.tsx:9'] }]);
  });

  it('a plural that another value nests: its other placeholders come from that call (the count shown)', () => {
    expect(
      numberProblems({ ...base, value: '{{missing}} points short', isPlural: true, nested: true }).problems,
    ).toEqual([]);
    expect(
      numberProblems({ ...base, value: '{{missing}} points short', isPlural: true }).problems,
    ).toHaveLength(1);
  });

  it('NUMBER_OK: by the name for a number from the code, never for a counted noun; by the key for both', () => {
    const digit = numberProblems({
      ...base,
      value: 'Digit {{digit}}',
      isPlural: false,
      code: code({ digit: { numberAt: ['c'] } }),
    });
    expect(digit).toEqual({ problems: [], allowed: ['*#digit'] });
    expect(numberAllowed('game', 'x', 'level')).toBe('*#level');
    expect(numberAllowed('game', 'x', 'level', { noun: 'levels' })).toBeNull();
    expect(numberProblems({ ...base, value: '{{level}} levels', isPlural: false }).problems).toHaveLength(1);
    expect(numberAllowed('board', 'keypad.armed', 'left')).toBe('board:keypad.armed#left');
    expect(numberAllowed('history', 'summary.winRate', 'rate', { noun: 'wins' })).toBe(
      'history:summary.winRate#rate',
    );
  });

  it('every NUMBER_OK entry gives one of the reasons, and names a key English has', () => {
    const reasons = new Set(Object.values(WHY));
    for (const reason of Object.values(NUMBER_OK.placeholders)) expect(reasons.has(reason)).toBe(true);
    const en = readLocales(APP_LOCALES).en!;
    const bases = new Set(
      Object.entries(en).flatMap(([ns, tree]) =>
        flatten(tree).map(
          ([key]) => `${ns}:${key.replace(PLURAL_SUFFIX, '').replace(/_(male|female)$/, '')}`,
        ),
      ),
    );
    for (const [key, placeholders] of Object.entries(NUMBER_OK.keys)) {
      expect({ key, inEnglish: bases.has(key) }).toEqual({ key, inEnglish: true });
      for (const reason of Object.values(placeholders)) expect(reasons.has(reason)).toBe(true);
    }
    expect(allowListEntries().length).toBe(
      Object.keys(NUMBER_OK.placeholders).length +
        Object.values(NUMBER_OK.keys).reduce((n, ps) => n + Object.keys(ps).length, 0),
    );
  });
});

describe('rule 21 in scripts/i18n-check.mjs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'i18n-numbers-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  }
  const linesOf = (out: string, kind: 'error' | 'warning') =>
    out.split('\n').filter((l) => l.startsWith(kind));

  function writeTree(files: Record<string, string | object>) {
    for (const [path, content] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
    }
  }

  const EN = {
    a: '{{n}} points',
    b: 'Level {{level}}',
    c: 'Taps: {{taps}}',
    d_one: '{{score}} point',
    d_other: '{{score}} points',
    e: 'Costs $t(home:pts, {"count": {{cost}} })',
    pts_one: '{{count}} point',
    pts_other: '{{count}} points',
    f_one: 'One mistake, {{s}} seconds added',
    f_other: '{{count}} mistakes, {{s}} seconds added',
    g: 'Digit {{digit}}',
    h_one: '{{stars}} star to go',
    h_other: '{{stars}} stars to go',
  };
  const HE = {
    a: '{{n}} נקודות',
    b: 'רמה {{level}}',
    c: 'לחיצות: {{taps}}',
    d_one: '{{score}} נקודה',
    d_two: '{{score}} נקודות',
    d_other: '{{score}} נקודות',
    e: 'עולה $t(home:pts, {"count": {{cost}} })',
    pts_one: 'נקודה אחת',
    pts_two: '{{count}} נקודות',
    pts_other: '{{count}} נקודות',
    f_one: 'טעות אחת, נוספו {{s}} שניות',
    f_two: '{{count}} טעויות, נוספו {{s}} שניות',
    f_other: '{{count}} טעויות, נוספו {{s}} שניות',
    g: 'ספרה {{digit}}',
    h_one: 'חסר {{stars}} כוכב',
    h_two: 'חסרים {{stars}} כוכבים',
    h_other: 'חסרים {{stars}} כוכבים',
  };
  const source = (calls: string[]) =>
    [
      "import { useTranslation } from 'react-i18next';",
      'const fmt = (n: number): string => String(n);',
      'export default function Index({ score, need, have }: { score: number; need: number; have: number }) {',
      "  const { t } = useTranslation('home');",
      `  return [${calls.join(', ')}];`,
      '}',
    ].join('\n');
  const tree = (calls: string[]) => ({
    'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['home'] as const;",
    'apps/mobile/src/i18n/locales/en/home.json': EN,
    'apps/mobile/src/i18n/locales/he/home.json': HE,
    'apps/mobile/app/index.tsx': source(calls),
  });

  it('fails on a counted noun, a number from the code and a second number; passes the plurals and NUMBER_OK', () => {
    writeTree(
      tree([
        "t('a', { n: 'x' })",
        "t('b', { level: 3 })",
        "t('c', { taps: 3 })",
        "t('d', { count: score, score: fmt(score) })",
        "t('e', { cost: 3 })",
        "t('f', { count: 2, s: 5 })",
        "t('g', { digit: 5 })",
        "t('h', { count: need, stars: need - have })",
      ]),
    );
    const { code: exit, out } = run('--root', root);
    expect(exit).toBe(1);
    const errors = linesOf(out, 'error');
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('en/home.json: "a" {{n}} counts "points" without a plural: pass { count }');
    expect(errors.find((l) => l.includes('"c"'))).toContain(
      '{{taps}} gets a number (apps/mobile/app/index.tsx:5)',
    );
    expect(errors.find((l) => l.includes('"f_other"'))).toContain('{{s}} counts "seconds"');
    // A number worked out from the count (need - have) is another number.
    expect(errors.find((l) => l.includes('"h_other"'))).toContain('{{stars}} counts "stars"');
    // The nested plural is used through the sentence that nests it.
    expect(linesOf(out, 'warning').filter((l) => l.includes('pts'))).toEqual([]);
  });

  it('passes once each number is a plural: a count, a nested plural, the count shown another way', () => {
    writeTree({
      ...tree([
        "t('a', { count: score, n: fmt(score) })",
        "t('b', { level: 3 })",
        "t('c', { taps: '3' })",
        "t('d', { count: score, score: fmt(score) })",
        "t('e', { cost: 3 })",
        "t('f', { count: 2, s: 5 })",
        "t('g', { digit: 5 })",
        "t('h', { count: need - have, stars: need - have })",
      ]),
      'apps/mobile/src/i18n/locales/en/home.json': {
        ...EN,
        a: undefined,
        a_one: '{{n}} point',
        a_other: '{{n}} points',
        f_one: 'One mistake, $t(home:secondsAdded, {"count": {{s}} })',
        f_other: '{{count}} mistakes, $t(home:secondsAdded, {"count": {{s}} })',
        secondsAdded_one: '{{count}} second added',
        secondsAdded_other: '{{count}} seconds added',
      },
      'apps/mobile/src/i18n/locales/he/home.json': {
        ...HE,
        a: undefined,
        a_one: '{{n}} נקודה',
        a_two: '{{n}} נקודות',
        a_other: '{{n}} נקודות',
        f_one: 'טעות אחת, $t(home:secondsAdded, {"count": {{s}} })',
        f_two: '{{count}} טעויות, $t(home:secondsAdded, {"count": {{s}} })',
        f_other: '{{count}} טעויות, $t(home:secondsAdded, {"count": {{s}} })',
        secondsAdded_one: 'נוספה שנייה אחת',
        secondsAdded_two: 'נוספו {{count}} שניות',
        secondsAdded_other: 'נוספו {{count}} שניות',
      },
    });
    const { code: exit, out } = run('--root', root);
    expect(linesOf(out, 'error')).toEqual([]);
    expect(exit).toBe(0);
  });

  it('fails on a call that reads a plural without { count } (i18next would show the key itself)', () => {
    const lines = [
      "import { Trans, useTranslation } from 'react-i18next';",
      "type Tip = 'lock' | 'plain';",
      'export default function Index({ n, tip, any, which }: { n: number; tip: Tip; any: string; which: "a" }) {',
      "  const { t } = useTranslation('home');",
      "  if (tip === 'lock') return [t('tips.lock', { count: n })];",
      '  return [',
      "    t('tips.lock'),",
      '    t(`tips.${tip}`),',
      '    t(`tips.${any}`),',
      '    t(`only.${which}`),',
      '    t(`only.${any}`),',
      "    t('tips.lock', { returnObjects: true }),",
      "    t('tips.lock', { count: n }),",
      '    t(`only.${which}`, { ...{ count: n } }),',
      '    <Trans key="1" i18nKey="tips.lock" count={n} />,',
      '    <Trans key="2" i18nKey="tips.lock" values={{ n }} />,',
      '  ];',
      '}',
    ];
    writeTree({
      'apps/mobile/src/i18n/index.ts': "export const NAMESPACES = ['home'] as const;",
      'apps/mobile/src/i18n/locales/en/home.json': {
        tips: { lock_one: '{{count}} second', lock_other: '{{count}} seconds', plain: 'Plain' },
        only: { a_one: '{{count}} point', a_other: '{{count}} points' },
      },
      'apps/mobile/src/i18n/locales/he/home.json': {
        tips: {
          lock_one: 'שנייה אחת',
          lock_two: '{{count}} שניות',
          lock_other: '{{count}} שניות',
          plain: 'רגיל',
        },
        only: { a_one: 'נקודה אחת', a_two: '{{count}} נקודות', a_other: '{{count}} נקודות' },
      },
      'apps/mobile/app/index.tsx': lines.join('\n'),
    });
    const { code: exit, out } = run('--root', root);
    const at = (text: string) => `apps/mobile/app/index.tsx:${lines.indexOf(text) + 1}:`;
    const errors = linesOf(out, 'error');
    expect(errors.map((l) => l.slice('error    '.length, l.indexOf(' without')))).toEqual([
      `${at("    t('tips.lock'),")} t('tips.lock') reads a plural (home:tips.lock)`,
      // A template reads the keys its parts' literal types allow (which is "a").
      `${at('    t(`only.${which}`),')} t('only.a') reads a plural (home:only.a)`,
      // A part that is any string: every key it can match is a plural.
      `${at('    t(`only.${any}`),')} t('only.…') reads a plural (home:only.a)`,
      `${at('    <Trans key="2" i18nKey="tips.lock" values={{ n }} />,')} t('tips.lock') reads a plural (home:tips.lock)`,
    ]);
    // Not reported: tip narrowed to 'plain', tips.${any} (it may read tips.plain), returnObjects, a count passed
    // through a spread, and <Trans count>.
    expect(exit).toBe(1);
  });

  it('sees calls through a property typed as a t function (words.t in i18n/explain.ts)', () => {
    writeTree({
      ...tree([]),
      'apps/mobile/app/index.tsx': [
        "import type { TFunction } from 'i18next';",
        "interface Words { t: TFunction<'home'>; rtl: boolean }",
        "export const taps = (w: Words, n: number): string => w.t('c', { taps: n });",
        "export const lock = (w: Words): string => w.t('d');",
      ].join('\n'),
    });
    const errors = linesOf(run('--root', root).out, 'error');
    expect(errors.find((l) => l.includes('"c"'))).toContain(
      '{{taps}} gets a number (apps/mobile/app/index.tsx:3)',
    );
    expect(errors.find((l) => l.includes(':4:'))).toContain(
      "t('d') reads a plural (home:d) without { count }",
    );
  });

  it('the app itself: no number without a plural, and no NUMBER_OK entry left over', () => {
    const { code: exit, out } = run();
    expect(linesOf(out, 'error')).toEqual([]);
    expect(linesOf(out, 'warning').filter((l) => l.includes('NUMBER_OK'))).toEqual([]);
    expect(exit).toBe(0);
  });
});
