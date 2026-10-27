import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TELEMETRY_EVENT_NAMES } from '@sudoku-fight/protocol';

import { ConfigError, loadConfig } from '../config';
import { createTestDb, fakeClock, startHttp, type TestDb, type TestHttp, testConfig } from '../testing';
import {
  type Block,
  escapeHtml,
  EVENT_DETAILS,
  formatDate,
  isTranslation,
  LEGAL_CATALOG,
  LEGAL_CHROME,
  LEGAL_CSP,
  LEGAL_CSS_HASH,
  LEGAL_DOCS,
  LEGAL_LANGS,
  LEGAL_ORIGINALS,
  LEGAL_TEXTS,
  LEGAL_UPDATED,
  type LegalCatalog,
  type LegalDoc,
  legalLangFor,
  PAGE_COLORS,
  PAGE_LANGUAGES,
  pageDir,
  renderLegalPage,
  type LegalLang,
  type LegalSettings,
} from '.';
import { inline } from './render';

/**
 * Work plan stage 14 (spec §23): the privacy policy, the terms of use and the account deletion page, in Hebrew
 * and English, served as static, locked-down pages at /legal/… for the app and the stores. Localization (plan
 * 0יב, D112): a translated version per language, with the same sections, links and contact details, under a
 * line saying the English version prevails; any other language gets English.
 */

const SET: LegalSettings = { contactEmail: 'privacy@sudoku.example', operatorName: 'Sudoku Fight Ltd.' };
const UNSET: LegalSettings = { contactEmail: null, operatorName: null };

const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const textOf = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Every text of a block: a paragraph, a list's items, a table's head and cells. */
const blockTexts = (b: Block): string[] =>
  typeof b === 'string' ? [b] : 'list' in b ? [...b.list] : [...b.table.head, ...b.table.rows.flat()];

/**
 * What every version of a document must keep from the English one, section by section: the anchor, the shape of
 * its blocks, the pages it links to, every web address, the contact address and the operator's name, the
 * `code` marks (event names, settings) and the numbers (48 hours, 30 days, 13 years…; digits are Western in
 * every language, D108).
 */
const skeleton = (text: LegalDoc) =>
  text.sections.map((s) => {
    const words = [s.title, ...s.blocks.flatMap(blockTexts)].join('\n');
    const all = (re: RegExp) => [...words.matchAll(re)].map((m) => m[1] ?? m[0]).sort();
    return {
      id: s.id,
      blocks: s.blocks.map((b) =>
        typeof b === 'string'
          ? 'p'
          : 'list' in b
            ? `${b.ordered ? 'ol' : 'ul'}×${b.list.length}`
            : `table ${b.table.head.length}×${b.table.rows.length}`,
      ),
      links: all(/\]\(([a-z-]+)\)/g),
      urls: all(/https?:\/\/[^\s)"'<>]+/g),
      email: all(/\{email\}/g).length,
      operator: all(/\{operator\}/g).length,
      code: all(/`([^`]+)`/g),
      numbers: all(/\d+(?:[.,]\d+)?/g),
    };
  });

describe('the legal texts', () => {
  it('have, in every language, the English version’s sections, links, addresses, contact details and numbers', () => {
    for (const doc of LEGAL_DOCS) {
      const en = skeleton(LEGAL_TEXTS[doc].en);
      expect(new Set(en.map((s) => s.id)).size).toBe(en.length);
      expect(en.some((s) => s.email > 0)).toBe(true);
      for (const lang of LEGAL_LANGS)
        expect({ doc, lang, s: skeleton(LEGAL_TEXTS[doc][lang]) }).toEqual({ doc, lang, s: en });
    }
  });

  it('list every event the app reports (spec §27.1: the policy details the events)', () => {
    expect(Object.keys(EVENT_DETAILS).sort()).toEqual([...TELEMETRY_EVENT_NAMES].sort());
    for (const lang of LEGAL_LANGS) {
      const html = renderLegalPage('privacy', lang, SET);
      for (const name of TELEMETRY_EVENT_NAMES) expect(html).toContain(`<code dir="ltr">${name}</code>`);
    }
  });

  it('count the events in the App Store answers as the app has them (docs/store/APP-PRIVACY.md: 26)', () => {
    const doc = readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'docs', 'store', 'APP-PRIVACY.md'),
      'utf8',
    );
    const counts = [...doc.matchAll(/(\d+) אירועים/g)].map((m) => Number(m[1]));
    expect(counts).toEqual([TELEMETRY_EVENT_NAMES.length]);
    expect(TELEMETRY_EVENT_NAMES.length).toBe(26);
  });

  it('say what playing with friends keeps and shows (1.0.4): who sees what in a room, no code in the events', () => {
    const en = textOf(renderLegalPage('privacy', 'en', SET));
    expect(en).toMatch(/Games with friends\s+\(in a room with a code; kept on the server like a ranked game/);
    expect(en).toMatch(/kept only in the server’s memory, until the room closes/);
    expect(en).toMatch(
      /anyone who has its code or link and enters the room sees the name, avatar, flag and general rating/,
    );
    expect(en).toMatch(/The code and the link themselves carry no personal information\./);
    const he = textOf(renderLegalPage('privacy', 'he', SET));
    expect(he).toMatch(/משחקים עם חברים/);
    expect(he).toMatch(/נשמרים רק בזיכרון של השרת, עד שהחדר נסגר/);
    expect(he).toMatch(/רואה את השם, האווטאר, הדגל והדירוג הכללי של מי שבחדר/);
    expect(he).toMatch(/בקוד ובקישור עצמם אין שום מידע אישי\./);
    // The six events of generation 3 are in the table, in both languages; none carries a code or who was there.
    const friendsEvents = TELEMETRY_EVENT_NAMES.filter((name) => name.startsWith('friends_'));
    expect(friendsEvents).toHaveLength(6);
    for (const lang of LEGAL_LANGS) {
      const html = renderLegalPage('privacy', lang, SET);
      for (const name of friendsEvents) {
        expect(html).toContain(`<code dir="ltr">${name}</code>`);
        for (const words of EVENT_DETAILS[name][lang]) expect(textOf(html)).toContain(words);
      }
    }
    // In the originals' words (a translation says it in its own: its table has every event, as above).
    for (const name of ['game_start', 'game_end'] as const) {
      expect(EVENT_DETAILS[name].en[1]).toMatch(/with friends/);
      expect(EVENT_DETAILS[name].he[1]).toMatch(/עם חברים/);
    }
    expect(EVENT_DETAILS.friends_invite_share.en[1]).toMatch(/not the code/);
  });

  it('[D93] disclose the computer-controlled opponent in one line of the terms, and the pace in the privacy policy', () => {
    const service = (lang: LegalLang) => {
      const section = LEGAL_TEXTS.terms[lang].sections.find((s) => s.id === 'service');
      return (section?.blocks ?? []).filter((b): b is string => typeof b === 'string').join('\n');
    };
    // The one line, in the "Availability" section the store reviewer notes point to.
    expect(LEGAL_TEXTS.terms.en.sections.find((s) => s.id === 'service')?.title).toBe('Availability');
    expect(service('he')).toContain(
      'כשאין שחקנים זמינים, ייתכן שתשובצו מול יריב ממוחשב שמשחק בקצב דומה לשלכם. משחקים כאלה נספרים בדירוג.',
    );
    expect(service('en')).toContain(
      'When no players are available, you may be matched with a computer-controlled opponent that plays at a pace similar to yours. Such games count toward your rating.',
    );
    // The practice offer ("Play a bot meanwhile") and the restart rule stay.
    expect(service('he')).toMatch(/משחק אימון מול בוט, בלי דירוג\..*מסתיים בלי שינוי בדירוג\./s);
    expect(service('en')).toMatch(
      /a practice game against a bot, with no rating\..*ends with no rating change\./s,
    );
    expect(service('en')).not.toMatch(/the game may offer a game against a bot/i);
    // Only there: one mention on the whole page, in each language.
    const mentions = (lang: LegalLang, words: RegExp) =>
      textOf(renderLegalPage('terms', lang, SET)).match(words)?.length ?? 0;
    expect(mentions('he', /יריב ממוחשב/g)).toBe(1);
    expect(mentions('en', /computer-controlled/g)).toBe(1);

    // The privacy policy: the pace kept at the end of each ranked game, what it is for, and a link to the terms.
    const en = renderLegalPage('privacy', 'en', SET);
    expect(en).toMatch(
      /<strong>Your pace:<\/strong> at the end of each ranked game we work out, from your moves, your average time per move[^<]*\(see the <a href="\/legal\/terms\?lang=en">Terms of Use<\/a>\)\. Your pace is not shown to other players\./,
    );
    expect(textOf(en)).toMatch(
      /we set the pace of a computer-controlled opponent when no players are available/,
    );
    const he = renderLegalPage('privacy', 'he', SET);
    expect(he).toMatch(
      /<strong>קצב המשחק שלכם:<\/strong> בסוף כל משחק מדורג אנחנו מחשבים מהמהלכים שלכם את הזמן הממוצע שלכם למהלך[^<]*\(ראו <a href="\/legal\/terms\?lang=he">תנאי השימוש<\/a>\)\. הקצב לא מוצג לשחקנים אחרים\./,
    );
    expect(textOf(he)).toMatch(/נקבע הקצב של יריב ממוחשב, כשאין שחקנים זמינים/);
    // The 1.0.3 and friends lines are still there.
    expect(textOf(en)).toMatch(/Games with friends/);
    expect(EVENT_DETAILS.level_start.en[1]).toMatch(/number and version/);

    // The meaning changed, so the date did (the stealth bot's lines, 2026-10-20).
    expect(LEGAL_UPDATED >= '2026-10-20').toBe(true);
  });

  it('[D93] tell the store reviewers about the computer-controlled opponent, and keep the store forms in step', () => {
    const store = (file: string) =>
      readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'store', file), 'utf8');
    const codeBlocks = (doc: string) =>
      [...doc.matchAll(/```\r?\n([\s\S]*?)\r?\n```/g)].map((m) => m[1] ?? '');
    const apple = codeBlocks(store('LISTING-APPLE.md')).find((b) => b.includes('Demo account:')) ?? '';
    const google =
      codeBlocks(store('LISTING-GOOGLE.md')).find((b) => b.startsWith('Sign in with the demo account')) ?? '';
    for (const [name, notes] of [
      ['apple', apple],
      ['google', google],
    ] as const) {
      const flat = notes.replace(/\s+/g, ' ');
      for (const words of [
        /2-player ranked games only/,
        /computer-controlled opponent/,
        /a made-up name that belongs to no real player/,
        /plays at a pace close to yours/,
        /the game counts for the rating like any ranked game/,
        /The game itself does not mark it as a computer/,
        /Terms of Use \(Settings → About and legal\), section "Availability"/,
        /a server setting and may be switched off/,
        /"Play a bot meanwhile"/,
        /start the same search on both within a few seconds/,
      ])
        expect({ name, has: words.test(flat) }).toEqual({ name, has: true });
      expect({ name, realOnly: /needs a real opponent/.test(flat) }).toEqual({ name, realOnly: false });
    }
    // The forms: the pace is gameplay data the code already had (no new type, no new event).
    const privacy = store('APP-PRIVACY.md');
    const safety = store('DATA-SAFETY.md');
    for (const doc of [privacy, safety]) {
      expect(doc).toContain('`pace_ms`');
      expect(doc).toContain('יריב ממוחשב');
    }
    expect(privacy).toContain("`users.kind = 'persona'`");
  });

  it('say where staged practice’s progress is kept: the server’s copy goes with the account, the phone’s stays until uninstall', () => {
    const en = textOf(renderLegalPage('privacy', 'en', SET));
    expect(en).toMatch(/Staged practice:\s+when the app syncs your progress to your account/);
    expect(en).toMatch(/your best stars on each stage, how many times you played it/);
    expect(en).toMatch(
      /the copy on the server \(your stars on each stage, and the XP the stages gave each day\) is deleted with the account\. The copy on your phone stays until you uninstall the app\./,
    );
    expect(en).toMatch(/does not delete the practice games and the staged-practice progress on your phone/);
    const he = textOf(renderLegalPage('privacy', 'he', SET));
    expect(he).toMatch(/הכוכבים הטובים ביותר בכל שלב/);
    expect(he).toMatch(
      /העותק שבשרת \(הכוכבים בכל שלב, וה־XP שהשלבים נתנו בכל יום\) נמחק עם החשבון\. העותק שבטלפון נשאר עד שמסירים את האפליקציה\./,
    );
    expect(he).toMatch(/לא מוחקת את משחקי האימון ואת ההתקדמות באימון בשלבים שבטלפון/);
    // Its six events are in the table, in both languages, with what they carry.
    for (const lang of LEGAL_LANGS) {
      const html = renderLegalPage('privacy', lang, SET);
      for (const name of [
        'level_map_open',
        'level_start',
        'level_end',
        'level_quit',
        'chapter_gate',
        'level_tutorial',
      ] as const) {
        expect(html).toContain(`<code dir="ltr">${name}</code>`);
        for (const words of EVENT_DETAILS[name][lang]) expect(textOf(html)).toContain(words);
      }
    }
  });

  it('name the processors and what the code keeps (accounts, IP in memory only, deletion)', () => {
    for (const lang of LEGAL_LANGS) {
      const text = textOf(renderLegalPage('privacy', lang, SET));
      for (const word of [
        'Firebase Authentication',
        'Crashlytics',
        'Google Analytics for Firebase',
        'Sentry',
        'Fly.io',
        'Neon',
      ])
        expect(text).toContain(word);
    }
    const en = textOf(renderLegalPage('privacy', 'en', SET));
    expect(en).toMatch(/only in the server’s memory/);
    expect(en).toMatch(/replaced by an anonymous id/);
    expect(en).toMatch(/not meant for children under 13/);
  });

  it('say what reports and blocks keep, and promise a review within 48 hours (spec §3.5)', () => {
    const en = textOf(renderLegalPage('privacy', 'en', SET));
    expect(en).toMatch(/Reports and blocks/);
    expect(en).toMatch(/A report has no free text\. The reported player is not told who reported them\./);
    expect(en).toMatch(/a block hides no one from the leaderboards/);
    expect(en).toMatch(/within 48 hours/);
    // A reset name can't come back, and deleting an account doesn't lift its suspension (a one-way fingerprint).
    expect(en).toMatch(/A name replaced this way goes on a list of names nobody may choose again/);
    expect(en).toMatch(/deleting an account doesn’t lift a suspension/);
    expect(en).toMatch(
      /a one-way fingerprint \(a hash\) of its sign-in id and of its verified email address/,
    );
    const he = textOf(renderLegalPage('privacy', 'he', SET));
    expect(he).toMatch(/דיווחים וחסימות/);
    expect(he).toMatch(/תוך 48 שעות/);
    expect(he).toMatch(/מחיקה לא מבטלת השעיה/);
    for (const lang of LEGAL_ORIGINALS) {
      const terms = textOf(renderLegalPage('terms', lang, SET));
      expect(terms).toMatch(
        lang === 'en' ? /We review every report within 48 hours\./ : /אנחנו בודקים כל דיווח תוך 48 שעות\./,
      );
      expect(terms).toMatch(lang === 'en' ? /Settings → Blocked players/ : /הגדרות ← שחקנים חסומים/);
      expect(terms).toMatch(
        lang === 'en' ? /deleting it doesn’t lift the suspension/ : /המחיקה לא מבטלת את ההשעיה/,
      );
    }
    // Every translation keeps the 48 hours too (the skeleton test keeps every number).
    for (const lang of LEGAL_LANGS) expect(textOf(renderLegalPage('terms', lang, SET))).toMatch(/48/);
  });

  it('[D112] quote the way to a setting as the app labels it, in every language (Settings → Blocked players…)', () => {
    const app = (lang: string, ns: string) =>
      JSON.parse(
        readFileSync(
          path.join(__dirname, '..', '..', '..', 'mobile', 'src', 'i18n', 'locales', lang, `${ns}.json`),
          'utf8',
        ),
      ) as Record<string, Record<string, string> | undefined>;
    for (const lang of LEGAL_LANGS) {
      const settings = app(lang, 'home').settings!;
      const labels = [
        app(lang, 'account').settings!.deleteAccount,
        app(lang, 'moderation').blocked!.settingsRow,
        settings.licenses,
      ];
      const words = LEGAL_DOCS.flatMap((doc) =>
        LEGAL_TEXTS[doc][lang].sections.flatMap((s) => [s.title, ...s.blocks.flatMap(blockTexts)]),
      ).join('\n');
      // The arrow points the way the language reads.
      const arrow = pageDir(lang) === 'rtl' ? '←' : '→';
      for (const label of labels)
        expect({ lang, label, quoted: words.includes(`${settings.title} ${arrow} ${label}`) }).toEqual({
          lang,
          label,
          quoted: true,
        });
    }
  });

  it('say what sign-in with Google brings (Moshe, 14.10.2026): optional, what comes from Google, what we keep', () => {
    const en = textOf(renderLegalPage('privacy', 'en', SET));
    expect(en).toMatch(/Sign in with Google \(optional\)/);
    expect(en).toMatch(/your Google account’s email \(verified by Google\) and its Google id/);
    expect(en).toMatch(/Our server doesn’t store or show them/);
    expect(en).toMatch(/revokes the access it was given to your Google account/);
    const he = textOf(renderLegalPage('privacy', 'he', SET));
    expect(he).toMatch(/כניסה עם Google \(רשות\)/);
    expect(he).toMatch(/השרת שלנו לא שומר אותם ולא מציג אותם/);
    expect(textOf(renderLegalPage('delete-account', 'en', SET))).toMatch(/choose your Google account again/);
    expect(textOf(renderLegalPage('delete-account', 'he', SET))).toMatch(/בוחרים שוב את חשבון Google/);
  });
});

describe('a rendered page', () => {
  it('is a whole document in the language and direction asked', () => {
    for (const doc of LEGAL_DOCS) {
      const he = renderLegalPage(doc, 'he', SET);
      expect(he.startsWith('<!doctype html>\n<html lang="he" dir="rtl">')).toBe(true);
      expect(he).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(he).toContain(`<h1>${LEGAL_TEXTS[doc].he.title}</h1>`);
      const en = renderLegalPage(doc, 'en', SET);
      expect(en.startsWith('<!doctype html>\n<html lang="en" dir="ltr">')).toBe(true);
      expect(en).toContain(`<h1>${LEGAL_TEXTS[doc].en.title}</h1>`);
    }
  });

  it('loads and runs nothing: no script, no external file, and its one style is the one the CSP allows', () => {
    for (const doc of LEGAL_DOCS)
      for (const lang of LEGAL_LANGS) {
        const html = renderLegalPage(doc, lang, SET);
        expect(html).not.toMatch(/<script|<link rel="stylesheet"|<img|<iframe|\son[a-z]+=|src=/i);
        expect(html.match(/<style>/g)).toHaveLength(1);
        const hash = createHash('sha256').update(styleOf(html), 'utf8').digest('base64');
        expect(`sha256-${hash}`).toBe(LEGAL_CSS_HASH);
      }
    expect(LEGAL_CSP).toBe(
      `default-src 'none'; style-src '${LEGAL_CSS_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });

  it('links the other pages and the other language, keeping the language', () => {
    const he = renderLegalPage('privacy', 'he', SET);
    expect(he).toContain('<a href="/legal/terms?lang=he">תנאי שימוש</a>');
    expect(he).toContain('<a href="/legal/delete-account?lang=he">');
    expect(he).toContain('<a href="/legal/privacy?lang=en" lang="en" hreflang="en">English</a>');
    expect(he).toContain(
      '<a href="/legal/privacy?lang=he" lang="he" hreflang="he" aria-current="page">עברית</a>',
    );
    expect(he).toContain('<link rel="alternate" hreflang="en" href="/legal/privacy?lang=en">');
    // A [label](doc) mark inside a text.
    expect(he).toContain('<a href="/legal/delete-account?lang=he">דף מחיקת החשבון</a>');
  });

  it('shows the contact address and the operator, escaped; event names stay left to right', () => {
    const html = renderLegalPage('privacy', 'he', {
      contactEmail: 'privacy@sudoku.example',
      operatorName: 'Moshe <b>&</b> "Co"',
    });
    expect(html).toContain('<a href="mailto:privacy@sudoku.example" dir="ltr">privacy@sudoku.example</a>');
    expect(html).toContain('<bdi>Moshe &lt;b&gt;&amp;&lt;/b&gt; &quot;Co&quot;</bdi>');
    expect(html).not.toContain('<b>&</b>');
    expect(html).not.toContain('class="draft"');
    expect(html).toContain('<code dir="ltr">game_end</code>');
  });

  it('without contact details: visible placeholders and a draft note', () => {
    const he = renderLegalPage('privacy', 'he', UNSET);
    expect(he).toContain('<p class="draft" role="note">');
    expect(he).toContain('<span class="ph" dir="ltr">privacy@&lt;domain&gt;</span>');
    expect(he).toContain('<span class="ph">[שם המפעיל]</span>');
    expect(he).not.toContain('mailto:');
    const en = renderLegalPage('terms', 'en', UNSET);
    expect(en).toContain('<span class="ph">[operator name]</span>');
  });

  it('dates the texts in each language', () => {
    expect(formatDate('2026-10-11', 'en')).toBe('October 11, 2026');
    expect(formatDate('2026-10-11', 'he')).toBe('11 באוקטובר 2026');
    expect(renderLegalPage('terms', 'en', SET)).toContain(
      `<time datetime="${LEGAL_UPDATED}">${formatDate(LEGAL_UPDATED, 'en')}</time>`,
    );
  });

  it('escapes every text, and refuses a link to a page that does not exist', () => {
    const ctx = { lang: 'en' as const, settings: SET };
    expect(inline('a <i>b</i> & **c `<x>`**', ctx)).toBe(
      'a &lt;i&gt;b&lt;/i&gt; &amp; <strong>c <code dir="ltr">&lt;x&gt;</code></strong>',
    );
    expect(() => inline('[x](nowhere)', ctx)).toThrow(/unknown page: nowhere/);
  });

  it('uses the app’s colors (docs/design/tokens.json)', () => {
    const tokens = JSON.parse(
      readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'design', 'tokens.json'), 'utf8'),
    ) as { color: Record<string, unknown> };
    for (const [name, value] of Object.entries(PAGE_COLORS))
      expect({ name, value }).toEqual({ name, value: tokens.color[name] });
  });
});

describe('the languages (localization plan 0יב, D112)', () => {
  it('are Hebrew and English first, all of them languages of the app, in its order', () => {
    expect(LEGAL_LANGS.slice(0, 2)).toEqual(['he', 'en']);
    expect(LEGAL_ORIGINALS).toEqual(['he', 'en']);
    const order = LEGAL_LANGS.map((l) => PAGE_LANGUAGES.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(LEGAL_CATALOG.langs).toBe(LEGAL_LANGS);
  });

  it('every translated version, and only a translated one, has the line that the English version prevails', () => {
    for (const lang of LEGAL_LANGS) {
      const notice = LEGAL_CHROME[lang].translationNotice;
      expect({
        lang,
        translated: isTranslation(lang),
        notice: typeof notice === 'string' && notice.trim() !== '',
      }).toEqual({ lang, translated: !LEGAL_ORIGINALS.includes(lang), notice: isTranslation(lang) });
      if (!isTranslation(lang))
        for (const doc of LEGAL_DOCS)
          expect(renderLegalPage(doc, lang, SET)).not.toContain('class="translated"');
    }
  });

  /** The Arabic version's line (D112): "This is a translation of the English version…", in Arabic. */
  const NOTICE = escapeHtml(LEGAL_CHROME.ar.translationNotice ?? '');

  it('a translated version: the line at the very top, with a link to the English one; Arabic right to left', () => {
    expect(NOTICE).not.toBe('');
    for (const doc of LEGAL_DOCS) {
      const html = renderLegalPage(doc, 'ar', SET);
      expect(html.startsWith('<!doctype html>\n<html lang="ar" dir="rtl">')).toBe(true);
      expect(html).toContain(
        `<main class="wrap">\n<p class="translated" role="note">${NOTICE} ` +
          `<a href="/legal/${doc}?lang=en" lang="en" hreflang="en" dir="ltr">English</a></p>\n<h1>`,
      );
      expect(html.match(/class="translated"/g)).toHaveLength(1);
      // The language links and the alternates name every version, the Arabic one by its own name.
      expect(html).toContain(
        `<a href="/legal/${doc}?lang=ar" lang="ar" hreflang="ar" aria-current="page">العربية</a>`,
      );
      expect(html).toContain(`<link rel="alternate" hreflang="he" href="/legal/${doc}?lang=he">`);
      // The other pages and the marks keep the language.
      for (const other of LEGAL_DOCS) expect(html).toContain(`href="/legal/${other}?lang=ar"`);
      // The one style is still the one the CSP allows.
      const hash = createHash('sha256').update(styleOf(html), 'utf8').digest('base64');
      expect(`sha256-${hash}`).toBe(LEGAL_CSS_HASH);
    }
    // Hebrew and English have no such line.
    expect(renderLegalPage('terms', 'he', SET)).not.toContain('class="translated"');
  });

  it('refuses a translated version without its line, and a language without a version', () => {
    const silent: LegalCatalog = {
      ...LEGAL_CATALOG,
      chrome: { ...LEGAL_CHROME, ar: { ...LEGAL_CHROME.ar, translationNotice: null } },
    };
    expect(() => renderLegalPage('privacy', 'ar', SET, silent)).toThrow(/no translation notice/);
    // Every language of the app has a version since 1.1.0: a catalog of the originals only has no French.
    const originals: LegalCatalog = { ...LEGAL_CATALOG, langs: LEGAL_ORIGINALS };
    expect(() => renderLegalPage('privacy', 'fr', SET, originals)).toThrow(/No legal page privacy in fr/);
  });

  it('dates a translated version with Western digits (D108); Thai keeps its Buddhist year', () => {
    expect(formatDate('2026-10-11', 'ar')).toBe('11 أكتوبر 2026');
    expect(formatDate('2026-10-11', 'zh-Hans')).toBe('2026年10月11日');
    expect(formatDate('2026-10-11', 'th')).toBe('11 ตุลาคม 2569');
    for (const lang of PAGE_LANGUAGES)
      expect({ lang, date: formatDate('2026-10-11', lang) }).toMatchObject({
        lang,
        date: expect.stringMatching(/^[^\u0660-\u0669\u06f0-\u06f9]*$/),
      });
  });
});

describe('LEGAL_CONTACT_EMAIL and LEGAL_OPERATOR_NAME', () => {
  it('are read, trimmed, and checked', () => {
    const warn = jest.fn();
    const config = loadConfig(
      { NODE_ENV: 'test', LEGAL_CONTACT_EMAIL: ' privacy@sudoku.example ', LEGAL_OPERATOR_NAME: ' Moshe ' },
      { warn },
    );
    expect(config.legal).toEqual({ contactEmail: 'privacy@sudoku.example', operatorName: 'Moshe' });
    expect(loadConfig({ NODE_ENV: 'test' }, { warn }).legal).toEqual(UNSET);
    expect(() => loadConfig({ NODE_ENV: 'test', LEGAL_CONTACT_EMAIL: 'not an email' }, { warn })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ NODE_ENV: 'test', LEGAL_OPERATOR_NAME: 'x'.repeat(121) }, { warn })).toThrow(
      ConfigError,
    );
  });

  it('production warns while either is unset', () => {
    const warnings: string[] = [];
    loadConfig(
      { NODE_ENV: 'production', PGLITE_DIR: 'memory', LEGAL_CONTACT_EMAIL: 'privacy@sudoku.example' },
      { warn: (m) => warnings.push(m) },
    );
    expect(warnings.some((w) => w.includes('LEGAL_OPERATOR_NAME'))).toBe(true);
  });
});

describe('GET /legal/…', () => {
  let t: TestDb;
  let http: TestHttp | undefined;
  beforeAll(async () => {
    t = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await t.close();
  });
  afterEach(async () => {
    await http?.close();
    http = undefined;
  });

  /** null: settings without `legal` at all (as tests and older configs have). */
  async function start(legal: LegalSettings | null = SET) {
    const config = legal === null ? testConfig() : testConfig({ legal });
    http = await startHttp({ config, db: t.db, now: fakeClock().now });
    return http.url;
  }

  it('serves each page in Hebrew by default, and in English with ?lang=en, locked down', async () => {
    const url = await start();
    for (const doc of LEGAL_DOCS) {
      const he = await fetch(`${url}/legal/${doc}`);
      expect(he.status).toBe(200);
      expect(he.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(he.headers.get('content-language')).toBe('he');
      expect(he.headers.get('content-security-policy')).toBe(LEGAL_CSP);
      expect(he.headers.get('x-frame-options')).toBe('DENY');
      expect(he.headers.get('x-content-type-options')).toBe('nosniff');
      expect(he.headers.get('referrer-policy')).toBe('no-referrer');
      expect(he.headers.get('cache-control')).toBe('public, max-age=300');
      expect(await he.text()).toBe(renderLegalPage(doc, 'he', SET));

      const en = await fetch(`${url}/legal/${doc}?lang=en`);
      expect(en.headers.get('content-language')).toBe('en');
      expect(await en.text()).toBe(renderLegalPage(doc, 'en', SET));
    }
  });

  it('takes an unknown or repeated ?lang as none (fetch sends `Accept-Language: *`: the default)', async () => {
    const url = await start();
    for (const q of ['?lang=xx', '?lang=EN', '?lang=en&lang=he', '?lang[]=en', '?lang=']) {
      const res = await fetch(`${url}/legal/terms${q}`);
      expect({ q, status: res.status, lang: res.headers.get('content-language') }).toEqual({
        q,
        status: 200,
        lang: 'he',
      });
    }
  });

  it('[D112] sends a language of the app without a version to English, and serves every version it has', async () => {
    const url = await start();
    for (const lang of PAGE_LANGUAGES) {
      const res = await fetch(`${url}/legal/privacy?lang=${lang}`);
      const shown = legalLangFor(lang);
      expect({ lang, shown: res.headers.get('content-language') }).toEqual({ lang, shown });
      expect(await res.text()).toBe(renderLegalPage('privacy', shown, SET));
    }
    // Since 1.1.0, every language of the app has its own version (versionOf's English fallback:
    // languages.test.ts).
    expect([...LEGAL_LANGS]).toEqual([...PAGE_LANGUAGES]);
    expect(legalLangFor('fr')).toBe('fr');
    expect(legalLangFor('he')).toBe('he');
    const root = await fetch(`${url}/legal?lang=ar`, { redirect: 'manual' });
    expect(root.headers.get('location')).toBe(`/legal/privacy?lang=${legalLangFor('ar')}`);
  });

  it('without ?lang, picks among the versions by the browser’s languages (English when none fits)', async () => {
    const url = await start();
    const langOf = async (acceptLanguage: string) =>
      (await fetch(`${url}/legal/terms`, { headers: { 'accept-language': acceptLanguage } })).headers.get(
        'content-language',
      );
    expect(await langOf('he-IL,he;q=0.9,en;q=0.8')).toBe('he');
    expect(await langOf('en-GB,en;q=0.9')).toBe('en');
    expect(await langOf('iw')).toBe('he');
    expect(await langOf('fr-FR,fr;q=0.9')).toBe('fr');
    expect(await langOf('sw-KE,sw;q=0.9')).toBe('en');
    expect(await langOf('sw-KE, he;q=0.5')).toBe('he');
    expect(await langOf('zh-TW,zh;q=0.9')).toBe('zh-Hant');
    // The same URL differs by the browser's languages, so a cache must keep them apart.
    const res = await fetch(`${url}/legal/terms`);
    expect(res.headers.get('vary')).toBe('Accept-Language');
  });

  it('answers HEAD, sends /legal to the privacy policy, and 404s anything else', async () => {
    const url = await start();
    const head = await fetch(`${url}/legal/privacy?lang=en`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const root = await fetch(`${url}/legal?lang=en`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/legal/privacy?lang=en');
    const bare = await fetch(`${url}/legal/`, { redirect: 'manual' });
    expect(bare.headers.get('location')).toBe('/legal/privacy?lang=he');

    for (const [method, p] of [
      ['GET', '/legal/cookies'],
      ['GET', '/legal/privacy/more'],
      ['POST', '/legal/privacy'],
    ] as const) {
      const res = await fetch(`${url}${p}`, { method });
      expect({ method, p, status: res.status }).toEqual({ method, p, status: 404 });
      expect(res.headers.get('content-security-policy')).toBe(LEGAL_CSP);
    }
  });

  it('shows placeholders when the server has no contact details', async () => {
    const url = await start(null);
    const html = await (await fetch(`${url}/legal/privacy`)).text();
    expect(html).toBe(renderLegalPage('privacy', 'he', UNSET));
    expect(html).toContain('class="draft"');
  });
});
