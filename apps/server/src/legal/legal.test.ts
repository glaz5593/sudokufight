import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TELEMETRY_EVENT_NAMES } from '@sudoku-fight/protocol';

import { ConfigError, loadConfig } from '../config';
import { createTestDb, fakeClock, startHttp, type TestDb, type TestHttp, testConfig } from '../testing';
import {
  EVENT_DETAILS,
  formatDate,
  LEGAL_CSP,
  LEGAL_CSS_HASH,
  LEGAL_DOCS,
  LEGAL_LANGS,
  LEGAL_TEXTS,
  LEGAL_UPDATED,
  PAGE_COLORS,
  renderLegalPage,
  type LegalSettings,
} from '.';
import { inline } from './render';

/**
 * Work plan stage 14 (spec §23): the privacy policy, the terms of use and the account deletion page, in Hebrew
 * and English, served as static, locked-down pages at /legal/… for the app and the stores.
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

describe('the legal texts', () => {
  it('have the same sections, in the same order, in Hebrew and English', () => {
    for (const doc of LEGAL_DOCS) {
      const ids = (lang: 'he' | 'en') => LEGAL_TEXTS[doc][lang].sections.map((s) => s.id);
      expect({ doc, ids: ids('en') }).toEqual({ doc, ids: ids('he') });
      expect(new Set(ids('he')).size).toBe(ids('he').length);
    }
  });

  it('list every event the app reports (spec §27.1: the policy details the events)', () => {
    expect(Object.keys(EVENT_DETAILS).sort()).toEqual([...TELEMETRY_EVENT_NAMES].sort());
    for (const lang of LEGAL_LANGS) {
      const html = renderLegalPage('privacy', lang, SET);
      for (const name of TELEMETRY_EVENT_NAMES) expect(html).toContain(`<code dir="ltr">${name}</code>`);
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
    for (const lang of LEGAL_LANGS) {
      const terms = textOf(renderLegalPage('terms', lang, SET));
      expect(terms).toMatch(
        lang === 'en' ? /We review every report within 48 hours\./ : /אנחנו בודקים כל דיווח תוך 48 שעות\./,
      );
      expect(terms).toMatch(lang === 'en' ? /Settings → Blocked players/ : /הגדרות ← שחקנים חסומים/);
      expect(terms).toMatch(
        lang === 'en' ? /deleting it doesn’t lift the suspension/ : /המחיקה לא מבטלת את ההשעיה/,
      );
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

  it('takes an unknown or repeated ?lang as the default', async () => {
    const url = await start();
    for (const q of ['?lang=fr', '?lang=EN', '?lang=en&lang=he', '?lang[]=en']) {
      const res = await fetch(`${url}/legal/terms${q}`);
      expect({ q, status: res.status, lang: res.headers.get('content-language') }).toEqual({
        q,
        status: 200,
        lang: 'he',
      });
    }
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
