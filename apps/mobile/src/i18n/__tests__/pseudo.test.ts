import { checkLanguage, KEEP_LATIN } from '../../../../../scripts/lib/i18n-locales.mjs';
import { pluralCategory } from '../../services/pluralRules';
import { hasGlyph, INVISIBLE, SYSTEM_DRAWN } from '../../testing/fontMetrics';
import { APP_LOCALES, appPluralRules, dictionaries, readLocales } from '../../testing/localeFiles';
import { tokens } from '../../theme/tokens.generated';
import i18n, { type LocaleBundle, localeBundle } from '../index';
import { isRtlLanguage, PSEUDO_LANGUAGES, type PseudoLanguage } from '../languages';
import { PSEUDO_EXPANSION, PSEUDO_KEEP, pluralKeys, pseudoBundle, pseudoText } from '../pseudo';
import { registerPseudoLanguages } from '../pseudoLanguages';

/**
 * The pseudo languages (localization plan 0יג): en-XA, accented English about 40 % longer between brackets, and
 * ar-XB, English right to left, both made from English at run time (i18n/pseudo.ts). What a translator must not
 * touch stays as it is; every plural form of each language's rule exists, so every count resolves in the pseudo
 * language itself (critique-log #25: Arabic's six forms for ar-XB); en-XA draws only letters Rubik has.
 */

registerPseudoLanguages();

const english = localeBundle('en')!;
const bundles = Object.fromEntries(
  PSEUDO_LANGUAGES.map((lang) => [lang, pseudoBundle(english, lang)]),
) as Record<PseudoLanguage, LocaleBundle>;

/** Every string of a bundle as [ns:key, value]. */
function strings(bundle: LocaleBundle): [string, string][] {
  const out: [string, string][] = [];
  const walk = (level: object, path: string) => {
    for (const [key, value] of Object.entries(level)) {
      if (typeof value === 'string') out.push([`${path}${key}`, value]);
      else if (value && typeof value === 'object') walk(value as object, `${path}${key}.`);
    }
  };
  for (const [ns, tree] of Object.entries(bundle)) walk(tree, `${ns}:`);
  return out;
}

const englishStrings = new Map(strings(english));
const LRI = '\u{2066}';
const PDI = '\u{2069}';
const RLM = '\u{200F}';
const RLO = '\u{202E}';
const PDF = '\u{202C}';
const placeholders = (s: string) => [...s.matchAll(/\{\{[^}]*\}\}|<\/?\w+>/g)].map((m) => m[0]);

/** en-XA back to English: accents off, the brackets and the padding words taken away. */
const PLAIN = 'acdefghijklnoprstuwyzACDEGHIJKLNOPRSTUWYZ';
const ACCENTED = 'åçðéƒĝĥîĵķļñöþŕšťûŵýžÅÇÐÉĜĤÎĴĶĻÑÖÞŔŠŤÛŴÝŽ';
const PADDING_WORDS =
  /( (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen))+\]/;
function unAccent(s: string): string {
  return [...s].map((ch) => (ACCENTED.includes(ch) ? PLAIN[ACCENTED.indexOf(ch)] : ch)).join('');
}
function fromEnXA(s: string): string {
  const match = /^(\s*)\[([\s\S]*)\](\s*)$/.exec(s);
  if (!match) return s;
  return match[1] + unAccent(`${match[2]}]`.replace(PADDING_WORDS, ']').slice(0, -1)) + match[3];
}
/** ar-XB back to English: the controls it added taken away. */
const fromArXB = (s: string) => s.replace(/[\u{200F}\u{202E}\u{202C}\u{2066}\u{2069}]/gu, '');

describe('one string (pseudoText)', () => {
  it('en-XA: accented, between brackets, about 40 % longer in whole padding words', () => {
    expect(pseudoText('Play', 'en-XA')).toBe('[Þļåý]');
    expect(pseudoText('Close', 'en-XA')).toBe('[Çļöšé]');
    expect(pseudoText('Leaderboard', 'en-XA')).toBe('[Ļéåðéŕböåŕð one]');
    expect(pseudoText('Choose who you play against', 'en-XA')).toBe(
      '[Çĥööšé ŵĥö ýöû þļåý åĝåîñšť one two three]',
    );
  });

  it('ar-XB: each word right to left (RLM RLO … PDF RLM); spaces and plain digits as they are', () => {
    expect(pseudoText('New game', 'ar-XB')).toBe(`${RLM}${RLO}New${PDF}${RLM} ${RLM}${RLO}game${PDF}${RLM}`);
    expect(pseudoText('Top 10', 'ar-XB')).toBe(`${RLM}${RLO}Top${PDF}${RLM} 10`);
  });

  it('ar-XB isolates what Arabic isolates: a range, a signed number, a word never translated', () => {
    expect(pseudoText('{{total}} short stages · 0–3 stars', 'ar-XB')).toBe(
      `{{total}} ${RLM}${RLO}short${PDF}${RLM} ${RLM}${RLO}stages${PDF}${RLM} · ${LRI}0–3${PDI} ${RLM}${RLO}stars${PDF}${RLM}`,
    );
    expect(pseudoText('You gained +3.5', 'ar-XB')).toContain(`${LRI}+3.5${PDI}`);
    expect(pseudoText('GO! · gong', 'ar-XB')).toBe(`${LRI}GO!${PDI} · ${RLM}${RLO}gong${PDF}${RLM}`);
  });

  it('keeps placeholders, $t() references, tags and bidi controls as they are', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      const value = pseudoText(
        'Tap <accent>{{name}}</accent> for $t(common:more) \u{2066}+3\u{2069} now',
        lang,
      );
      for (const kept of ['<accent>', '{{name}}', '</accent>', '$t(common:more)', '\u{2066}+3\u{2069}'])
        expect(value).toContain(kept);
    }
  });

  it('keeps the spaces at either end, outside the brackets', () => {
    expect(pseudoText(' and ', 'en-XA')).toBe(' [åñð] ');
    expect(pseudoText(' and ', 'ar-XB')).toBe(` ${RLM}${RLO}and${PDF}${RLM} `);
  });

  it('keeps whole a string with no letters to change: separators, formats, Teko’s words, the brand', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      for (const value of [
        '',
        ' ',
        ' · ',
        ', ',
        '.',
        '{{value}}%',
        '{{label}}: {{value}}',
        '—',
        'VS',
        'GO!',
        'XP',
      ])
        expect(pseudoText(value, lang)).toBe(value);
    }
  });

  it('leaves the words never translated unaccented inside a sentence (en-XA)', () => {
    expect(pseudoText('Welcome to Sudoku Fight', 'en-XA')).toBe('[Ŵéļçömé ťö Sudoku Fight one two]');
    expect(pseudoText('Maestro waits', 'en-XA')).toContain('Maestro ');
    // Only as a word of its own: "Pipe" and "SUDOKUS" are words to change.
    expect(pseudoText('Pip and a Pipe', 'en-XA')).toBe('[Pip åñð å Þîþé one]');
    expect(pseudoText('SUDOKUS', 'en-XA')).toBe('[ŠÛÐÖĶÛŠ one]');
    expect(pseudoText('Pip and a Pipe', 'ar-XB')).toContain(`${LRI}Pip${PDI} `);
  });

  it('PSEUDO_KEEP is the check’s list of words never translated (scripts/lib/i18n-locales.mjs KEEP_LATIN)', () => {
    expect([...PSEUDO_KEEP].sort()).toEqual([...KEEP_LATIN].sort());
  });
});

describe('every string of the app (pseudoBundle)', () => {
  it('has every English key, and nothing English has not but plural forms', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      const keys = new Set(strings(bundles[lang]).map(([key]) => key));
      for (const key of englishStrings.keys())
        expect(keys.has(key) ? key : `${lang} misses ${key}`).toBe(key);
      for (const key of keys) {
        if (!englishStrings.has(key)) expect(key).toMatch(/_(zero|one|two|few|many|other)$/);
      }
    }
  });

  it('en-XA goes back to English exactly (accents off, brackets and padding away)', () => {
    for (const [key, value] of strings(bundles['en-XA'])) {
      const source = englishStrings.get(key);
      if (source !== undefined) expect([key, fromEnXA(value)]).toEqual([key, source]);
    }
  });

  it('ar-XB goes back to English exactly (its controls away), each override closed', () => {
    for (const [key, value] of strings(bundles['ar-XB'])) {
      const source = englishStrings.get(key);
      if (source !== undefined) expect([key, fromArXB(value)]).toEqual([key, source]);
      expect([key, value.split(RLO).length]).toEqual([key, value.split(PDF).length]);
      expect([key, value.split(LRI).length]).toEqual([key, value.split(PDI).length]);
    }
  });

  it('the same placeholders and tags as English, in the same order', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      for (const [key, value] of strings(bundles[lang])) {
        const source = englishStrings.get(key);
        if (source !== undefined) expect([key, placeholders(value)]).toEqual([key, placeholders(source)]);
      }
    }
  });

  it('en-XA is about 40 % longer: at least that, and at most one padding word more', () => {
    for (const [key, value] of strings(bundles['en-XA'])) {
      const source = englishStrings.get(key);
      if (source === undefined || value === source) continue;
      // What the string shows of its own: no placeholder, $t() reference or tag.
      const shown = (s: string) =>
        s.replace(/\$t\((?:[^()]|\([^()]*\))*\)|\{\{[^}]*\}\}|<\/?\w+>/g, '').trim().length;
      const target = Math.ceil(shown(source) * PSEUDO_EXPANSION);
      expect([key, shown(value) >= target]).toEqual([key, true]);
      expect([key, shown(value) <= Math.max(target, shown(source) + 2) + ' fourteen'.length]).toEqual([
        key,
        true,
      ]);
    }
  });

  it('en-XA draws only what Rubik has in all four weights (or what the phone draws itself)', () => {
    const rubik = Object.values(tokens.font.load.Rubik);
    const missing = new Set<string>();
    for (const [, value] of strings(bundles['en-XA'])) {
      for (const ch of value) {
        if (INVISIBLE.test(ch) || SYSTEM_DRAWN.test(ch) || /[\n\r\t]/.test(ch)) continue;
        if (!rubik.every((family) => hasGlyph(family, ch))) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('Teko’s words and the separators stay exactly English’s', () => {
    for (const lang of PSEUDO_LANGUAGES) {
      for (const key of [
        'player:vs',
        'match:countdown.go',
        'game:hud.none',
        'game:results.stats.none',
        'home:profile.none',
        'progress:common.none',
        'player:sep',
        'player:listSep',
        'common:number.decimal',
        'common:number.percent',
        'match:sentenceSpace',
      ])
        expect([lang, key, new Map(strings(bundles[lang])).get(key)]).toEqual([
          lang,
          key,
          englishStrings.get(key),
        ]);
    }
  });

  it('passes the translation check as a language of its own (scripts/i18n-check.mjs rules): no errors', () => {
    const trees = readLocales(APP_LOCALES);
    const { en, he } = dictionaries({ en: trees.en!, he: trees.he! });
    for (const lang of PSEUDO_LANGUAGES) {
      const dict = dictionaries({ [lang]: bundles[lang] as Record<string, object> })[lang]!;
      const { errors, warnings } = checkLanguage({ lang, dict, en: en!, he, plural: appPluralRules(lang) });
      expect({ lang, errors }).toEqual({ lang, errors: [] });
      // ar-XB's words are overrides (RLO), Android's own way; the check tells translators to isolate instead.
      expect(warnings.filter((w) => !/embedding or override/.test(w))).toEqual([]);
    }
  });
});

describe('plurals: every form of each language’s rule (critique-log #25)', () => {
  const keys = pluralKeys(english);

  it('finds the app’s plural keys (by their _other form)', () => {
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toEqual(expect.arrayContaining(['game:hit.seconds', 'home:profile.gamesLabel']));
  });

  it('ar-XB has Arabic’s six forms; a form English lacks comes from its _other, _zero from English', () => {
    const ar = new Map(strings(bundles['ar-XB']));
    for (const key of keys) {
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other'])
        expect([key, form, ar.has(`${key}_${form}`)]).toEqual([key, form, true]);
      expect(ar.get(`${key}_few`)).toBe(pseudoText(englishStrings.get(`${key}_other`)!, 'ar-XB'));
      const zero = englishStrings.get(`${key}_zero`);
      expect(ar.get(`${key}_zero`)).toBe(pseudoText(zero ?? englishStrings.get(`${key}_other`)!, 'ar-XB'));
    }
  });

  it('en-XA has English’s one and other (and _zero where English has it)', () => {
    const xa = new Map(strings(bundles['en-XA']));
    for (const key of keys) {
      expect(xa.get(`${key}_one`)).toBe(
        pseudoText(englishStrings.get(`${key}_one`) ?? englishStrings.get(`${key}_other`)!, 'en-XA'),
      );
      expect(xa.get(`${key}_other`)).toBe(pseudoText(englishStrings.get(`${key}_other`)!, 'en-XA'));
      expect(xa.has(`${key}_zero`)).toBe(englishStrings.has(`${key}_zero`));
    }
  });

  it.each(PSEUDO_LANGUAGES)('every plural key resolves in %s itself for 0…100 and 1.5', async (lang) => {
    await i18n.loadLanguages(lang);
    const counts = [...Array.from({ length: 101 }, (_, n) => n), 1.5];
    const wrong: string[] = [];
    for (const key of keys) {
      for (const count of counts) {
        const found = i18n.t(key, { count, lng: lang, returnDetails: true }) as unknown as {
          usedLng: string;
          exactUsedKey: string;
        };
        // i18next's form: _zero for 0 where the key has one, else the rule's (the phone's: services/pluralRules.ts).
        const form = count === 0 && englishStrings.has(`${key}_zero`) ? 'zero' : pluralCategory(lang, count);
        const expected = `${key.slice(key.indexOf(':') + 1)}_${form}`;
        if (found.usedLng !== lang || found.exactUsedKey !== expected)
          wrong.push(`${key} ${count}: ${found.usedLng} ${found.exactUsedKey}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('3 in ar-XB is Arabic’s "few", made from English’s _other, not plain English', async () => {
    await i18n.loadLanguages('ar-XB');
    const three = i18n.t('game:hit.seconds', { count: 3, lng: 'ar-XB' });
    expect(three).toBe(
      pseudoText(englishStrings.get('game:hit.seconds_other')!, 'ar-XB').replace('{{count}}', '3'),
    );
    expect(three).not.toBe(i18n.t('game:hit.seconds', { count: 3, lng: 'en' }));
  });
});

describe('direction', () => {
  it('ar-XB is right to left, en-XA left to right, for the app and for i18next', () => {
    expect(isRtlLanguage('ar-XB')).toBe(true);
    expect(isRtlLanguage('en-XA')).toBe(false);
    expect(i18n.dir('ar-XB')).toBe('rtl');
    expect(i18n.dir('en-XA')).toBe('ltr');
  });
});
