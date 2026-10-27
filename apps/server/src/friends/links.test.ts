import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { FRIENDS_APP_SCHEME, FRIENDS_PATHS } from '@sudoku-fight/protocol';
import express from 'express';

import { type FriendsLinksConfig, loadConfig, NO_FRIENDS_LINKS, TEMPLATE_DEBUG_KEY_SHA256 } from '../config';
import { legalLangFor, PAGE_LANGUAGES } from '../legal';
import {
  ANDROID_PACKAGE,
  appleAppSiteAssociation,
  assetLinks,
  createFriendsLinksRouter,
  FRIENDS_MIN_APP_VERSION,
  intentLink,
  IOS_BUNDLE_ID,
  langFromAcceptLanguage,
  LINK_LANGS,
  platformOf,
  renderRoomPage,
  ROOM_PAGE_CSP,
  ROOM_PAGE_CSS_HASH,
  ROOM_PAGE_TEXTS,
  type RoomPageInput,
} from './links';

/**
 * friends-room.md §6, §10 (links.test.ts): a room's link outside the app. The page in the app's 19 languages, the
 * same for every well-formed code (it never asks whether the room exists), a general page for a code that is
 * not one; the app-link files from the settings only. Localization (plan 0יב, D113): words per language,
 * the way to the code quoted as the app's own labels, any other language in English.
 */

const REPO = path.join(__dirname, '..', '..', '..', '..');
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
/** A made-up fingerprint (no real key's). */
const EAS = Array.from({ length: 32 }, (_, i) => (i * 5 + 17).toString(16).toUpperCase()).join(':');
const PLAY = 'https://play.google.com/store/apps/details?id=com.mosheg.sudokufight';
const APPLE = 'https://apps.apple.com/app/id1234567890';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const textOf = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

const page = (overrides: Partial<RoomPageInput> = {}): string =>
  renderRoomPage({
    code: '123456',
    lang: 'he',
    platform: 'other',
    pageUrl: 'https://sudoku-fight-staging.fly.dev/r/123456?lang=he',
    storeUrls: { android: null, ios: null },
    ...overrides,
  });

describe('the app-link files', () => {
  it('name the app as apps/mobile/app.json does: package, bundle id, scheme', () => {
    const app = JSON.parse(readFileSync(path.join(REPO, 'apps', 'mobile', 'app.json'), 'utf8')) as {
      expo: { scheme: string; android: { package: string }; ios: { bundleIdentifier: string } };
    };
    expect(ANDROID_PACKAGE).toBe(app.expo.android.package);
    expect(IOS_BUNDLE_ID).toBe(app.expo.ios.bundleIdentifier);
    expect(FRIENDS_APP_SCHEME).toBe(app.expo.scheme);
  });

  it('assetlinks.json: the app signed by any of the keys handles all of the server’s links', () => {
    expect(assetLinks([EAS, TEMPLATE_DEBUG_KEY_SHA256])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.mosheg.sudokufight',
          sha256_cert_fingerprints: [EAS, TEMPLATE_DEBUG_KEY_SHA256],
        },
      },
    ]);
  });

  it('apple-app-site-association: the app id opens /r/…', () => {
    expect(appleAppSiteAssociation('ABCDE12345.com.mosheg.sudokufight')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.com.mosheg.sudokufight'],
            components: [{ '/': '/r/*', comment: 'A room link: /r/<6 digits>' }],
          },
        ],
      },
    });
  });
});

describe('the page of a room link', () => {
  it('Hebrew: right to left, the code "123 456" left to right (isolated), and read digit by digit', () => {
    const html = page();
    expect(html.startsWith('<!doctype html>\n<html lang="he" dir="rtl">')).toBe(true);
    // In the <title>, where no markup can isolate it: LRI…PDI (without them "123 456" shows as "456 123").
    expect(html).toContain(`<title>הזמנה לחדר ${LRI}123 456${PDI} · סודוקו פייט</title>`);
    expect(html).toContain('<span dir="ltr" aria-hidden="true">123 456</span>');
    expect(html).toContain('<span class="sr">קוד החדר: 1 2 3 4 5 6</span>');
    expect(textOf(html)).toContain('הוזמנת למשחק סודוקו פייט');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('English: left to right, the same parts', () => {
    const html = page({ lang: 'en', pageUrl: 'https://x.example/r/123456?lang=en' });
    expect(html.startsWith('<!doctype html>\n<html lang="en" dir="ltr">')).toBe(true);
    expect(html).toContain(`<title>Invitation to room ${LRI}123 456${PDI} · Sudoku Fight</title>`);
    expect(textOf(html)).toContain('You’re invited to a game of Sudoku Fight');
    expect(html).toContain('<span class="sr">Room code: 1 2 3 4 5 6</span>');
    expect(html).toContain('href="/legal/privacy?lang=en"');
  });

  it('"open in the app": Chrome’s intent on Android (back to this page without the app), the app’s link elsewhere', () => {
    const pageUrl = 'https://sudoku-fight-staging.fly.dev/r/123456?lang=he';
    const intent = intentLink('123456', `${pageUrl}#get-app`);
    expect(intent).toBe(
      'intent://room/123456#Intent;scheme=sudokufight;package=com.mosheg.sudokufight;' +
        `S.browser_fallback_url=${encodeURIComponent(`${pageUrl}#get-app`)};end`,
    );
    expect(page({ platform: 'android' })).toContain(
      `<a class="button" href="${intent.replace(/&/g, '&amp;')}">`,
    );
    expect(page({ platform: 'ios' })).toContain(
      '<a class="button" href="sudokufight://room/123456">פתח באפליקציה</a>',
    );
    expect(page({ platform: 'other' })).toContain('href="sudokufight://room/123456"');
    // With a store, an Android phone without the app goes straight to it.
    expect(page({ platform: 'android', storeUrls: { android: PLAY, ios: null } })).toContain(
      `S.browser_fallback_url=${encodeURIComponent(PLAY)};end`,
    );
  });

  it('without a store (staging): "still in testing", how to type the code, and the version it needs', () => {
    expect(FRIENDS_MIN_APP_VERSION).toBe('1.0.4');
    const he = page();
    expect(textOf(he)).toContain(
      'האפליקציה עדיין בבדיקות. אם היא מותקנת אצלך: משחק חדש ← הצטרף עם קוד ← 123 456 . צריך גרסה 1.0.4 ומעלה.',
    );
    expect(he).toContain('<bdi dir="ltr">123 456</bdi>');
    expect(he).not.toContain('play.google.com');
    const en = page({ lang: 'en' });
    expect(textOf(en)).toContain(
      'The app is still in testing. If you have it: New game → Join with code → 123 456 . You need version 1.0.4 or later.',
    );
  });

  it('with stores: the one that fits the phone (both on a computer), and how to type the code', () => {
    const storeUrls = { android: PLAY, ios: APPLE };
    const android = page({ platform: 'android', storeUrls });
    expect(android).toContain(`<a href="${PLAY.replace(/&/g, '&amp;')}">להורדה מ־Google Play</a>`);
    expect(android).not.toContain(APPLE);
    const iphone = page({ platform: 'ios', storeUrls, lang: 'en' });
    expect(iphone).toContain(`<a href="${APPLE}">Download on the App Store</a>`);
    expect(iphone).not.toContain(PLAY);
    const computer = page({ storeUrls });
    expect(computer).toContain(PLAY);
    expect(computer).toContain(APPLE);
    expect(textOf(computer)).toContain('אין לך את האפליקציה?');
    expect(textOf(computer)).toContain('משחק חדש ← הצטרף עם קוד ← 123 456 .');
    expect(textOf(computer)).not.toContain('עדיין בבדיקות');
    // An iPhone when only Google Play has the app: the "testing" way, with the code.
    expect(textOf(page({ platform: 'ios', storeUrls: { android: PLAY, ios: null } }))).toContain(
      'עדיין בבדיקות',
    );
  });

  it('a link without a valid code: a general page (no code, no button)', () => {
    for (const lang of ['he', 'en'] as const) {
      const html = page({ code: null, lang, pageUrl: '' });
      expect(textOf(html)).toContain(ROOM_PAGE_TEXTS[lang].badHeading);
      expect(html).not.toContain('class="button"');
      expect(html).not.toContain('sudokufight://');
    }
  });

  it('is locked down: no script, nothing loaded, the one style by its hash', () => {
    const html = page({ platform: 'android', storeUrls: { android: PLAY, ios: APPLE } });
    expect(html).not.toMatch(/<script|<img|<link|<iframe|<form|\son\w+=/i);
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(`sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}`).toBe(ROOM_PAGE_CSS_HASH);
    expect(ROOM_PAGE_CSP).toBe(
      `default-src 'none'; style-src '${ROOM_PAGE_CSS_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
  });

  it('[D113] the way to the code is quoted as the app labels it, in every language the page has', () => {
    const appLabels = (lang: string) => {
      const home = JSON.parse(
        readFileSync(path.join(REPO, 'apps', 'mobile', 'src', 'i18n', 'locales', lang, 'home.json'), 'utf8'),
      ) as { modes: { title: string; friends: { join: string } } };
      return [home.modes.title, home.modes.friends.join];
    };
    for (const lang of LINK_LANGS) {
      const t = ROOM_PAGE_TEXTS[lang];
      // "New game", then its "Join with code" button, joined by one arrow.
      expect({ lang, steps: t.path.split(/ [←→] /) }).toEqual({ lang, steps: appLabels(lang) });
      expect(t.path.match(/[←→]/g)).toHaveLength(1);
      for (const key of ['typeCode', 'testing', 'badText'] as const)
        expect({ lang, key, quotes: t[key].includes('{path}') }).toEqual({ lang, key, quotes: true });
      const html = page({ lang, storeUrls: { android: PLAY, ios: APPLE } });
      expect(textOf(html)).toContain(`${t.path} ${t.path.includes('←') ? '←' : '→'} 123 456`);
      expect(textOf(page({ lang, code: null, pageUrl: '' }))).toContain(t.path);
    }
    expect(ROOM_PAGE_TEXTS.he.path).toBe('משחק חדש ← הצטרף עם קוד');
    expect(ROOM_PAGE_TEXTS.en.path).toBe('New game → Join with code');
  });

  it('[D113] its languages: Hebrew and English first, all of them the app’s, in its order; the privacy link in a version that exists', () => {
    expect(LINK_LANGS.slice(0, 2)).toEqual(['he', 'en']);
    // Since 1.1.0 (localization stages 1–17), every language of the app.
    expect([...LINK_LANGS]).toEqual([...PAGE_LANGUAGES]);
    const order = LINK_LANGS.map((l) => PAGE_LANGUAGES.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(Object.keys(ROOM_PAGE_TEXTS)).toEqual([...LINK_LANGS]);
    for (const lang of LINK_LANGS) {
      expect(page({ lang })).toContain(`href="/legal/privacy?lang=${legalLangFor(lang)}"`);
      // Every language link, each by its own name; the current one marked.
      expect(page({ lang })).toContain(
        `<a href="?lang=${lang}" lang="${lang}" hreflang="${lang}" aria-current="page">`,
      );
    }
  });

  it('the language: ?lang, else the browser’s (any of the app’s 19; English for any other), Hebrew without a header', () => {
    expect(langFromAcceptLanguage(undefined)).toBe('he');
    expect(langFromAcceptLanguage('')).toBe('he');
    expect(langFromAcceptLanguage('he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7')).toBe('he');
    expect(langFromAcceptLanguage('en-US,en;q=0.9,he;q=0.8')).toBe('en');
    expect(langFromAcceptLanguage('iw')).toBe('he');
    expect(langFromAcceptLanguage('sw-KE, en;q=0.5, he;q=0.6')).toBe('he');
    expect(langFromAcceptLanguage('ru-RU, en;q=0.5, he;q=0.6')).toBe('ru');
    expect(langFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('fr');
    expect(langFromAcceptLanguage('sw-KE,sw;q=0.9')).toBe('en');
    expect(langFromAcceptLanguage('en;q=0, he;q=0.1')).toBe('he');
    expect(langFromAcceptLanguage('*')).toBe('he');
    expect(langFromAcceptLanguage('he;q=abc, en')).toBe('en');
    // The tags as the app reads them (D105): iw → he, in → id, every Portuguese → pt-BR, Chinese by script or
    // region.
    expect(langFromAcceptLanguage('he_IL')).toBe('he');
    expect(langFromAcceptLanguage('ar-EG,ar;q=0.9')).toBe('ar');
    expect(langFromAcceptLanguage('in-ID')).toBe('id');
    expect(langFromAcceptLanguage('pt-PT, he;q=0.2')).toBe('pt-BR');
    expect(langFromAcceptLanguage('zh-TW, en;q=0.2')).toBe('zh-Hant');
    expect(langFromAcceptLanguage('zh-Hans-HK, en;q=0.2')).toBe('zh-Hans');
    expect(langFromAcceptLanguage('zh-CN, en;q=0.2')).toBe('zh-Hans');
  });

  it('the phone: Android, iPhone or iPad, or anything else', () => {
    expect(platformOf(ANDROID_UA)).toBe('android');
    expect(platformOf(IPHONE_UA)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
    expect(platformOf(undefined)).toBe('other');
  });
});

// ---- over HTTP --------------------------------------------------------------------------------------------------

interface Running {
  url: string;
  close(): Promise<void>;
}

async function serve(links: FriendsLinksConfig | undefined): Promise<Running> {
  const app = express();
  app.use(createFriendsLinksRouter({ links }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

describe('GET /r/:code and /.well-known', () => {
  let none: Running;
  let set: Running;
  beforeAll(async () => {
    [none, set] = await Promise.all([
      serve(undefined),
      serve({
        androidSha256: [EAS, TEMPLATE_DEBUG_KEY_SHA256],
        iosAppId: 'ABCDE12345.com.mosheg.sudokufight',
        storeUrls: { android: PLAY, ios: null },
      }),
    ]);
  });
  afterAll(() => Promise.all([none.close(), set.close()]));

  it('the page: Hebrew by default, English by the browser or ?lang=en; locked down and never cached', async () => {
    const he = await fetch(`${none.url}/r/123456`);
    expect(he.status).toBe(200);
    expect(he.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(he.headers.get('content-language')).toBe('he');
    expect(he.headers.get('content-security-policy')).toBe(ROOM_PAGE_CSP);
    expect(he.headers.get('cache-control')).toBe('no-store');
    expect(he.headers.get('referrer-policy')).toBe('no-referrer');
    expect(he.headers.get('x-frame-options')).toBe('DENY');
    expect(he.headers.get('x-content-type-options')).toBe('nosniff');
    expect(he.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await he.text()).toContain('<html lang="he" dir="rtl">');

    const byBrowser = await fetch(`${none.url}/r/123456`, {
      headers: { 'accept-language': 'en-GB,en;q=0.9' },
    });
    expect(byBrowser.headers.get('content-language')).toBe('en');
    expect(await byBrowser.text()).toContain('<html lang="en" dir="ltr">');
    const asked = await fetch(`${none.url}/r/123456?lang=en`, { headers: { 'accept-language': 'he' } });
    expect(await asked.text()).toContain('<html lang="en" dir="ltr">');
    // Every language of the app has its words (1.1.0); not a language of the app: the browser's.
    const french = await fetch(`${none.url}/r/123456?lang=fr`, { headers: { 'accept-language': 'he' } });
    expect(french.headers.get('content-language')).toBe('fr');
    expect(await french.text()).toContain('<html lang="fr" dir="ltr">');
    const arabic = await fetch(`${none.url}/r/123456`, { headers: { 'accept-language': 'ar-EG,ar;q=0.9' } });
    expect(arabic.headers.get('content-language')).toBe('ar');
    expect(await arabic.text()).toContain('<html lang="ar" dir="rtl">');
    const unknown = await fetch(`${none.url}/r/123456?lang=xx`, { headers: { 'accept-language': 'he' } });
    expect(unknown.headers.get('content-language')).toBe('he');
    const head = await fetch(`${none.url}/r/123456`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('the same page for every well-formed code: nothing about the room (it is never looked up)', async () => {
    const a = await (await fetch(`${set.url}/r/123456`, { headers: { 'user-agent': ANDROID_UA } })).text();
    const b = await (await fetch(`${set.url}/r/987654`, { headers: { 'user-agent': ANDROID_UA } })).text();
    expect(b).not.toBe(a);
    const masked = (html: string, code: string) =>
      html
        .replaceAll(code, 'CODE')
        .replaceAll(`${code.slice(0, 3)} ${code.slice(3)}`, 'CODE')
        .replaceAll(code.split('').join(' '), 'CODE');
    expect(masked(b, '987654')).toBe(masked(a, '123456'));
    // A code typed with a dash or spaces is the same room's page.
    const dashed = await fetch(`${set.url}/r/123-456`);
    expect(dashed.status).toBe(200);
    expect(await dashed.text()).toContain('<span dir="ltr" aria-hidden="true">123 456</span>');
  });

  it('on Android: Chrome’s intent, back to the store (when there is one) or to this very page', async () => {
    const withStore = await (
      await fetch(`${set.url}/r/123456`, { headers: { 'user-agent': ANDROID_UA } })
    ).text();
    expect(withStore).toContain(`S.browser_fallback_url=${encodeURIComponent(PLAY)};end`);
    const noStore = await (
      await fetch(`${none.url}/r/123456?lang=en`, { headers: { 'user-agent': ANDROID_UA } })
    ).text();
    expect(noStore).toContain(
      `S.browser_fallback_url=${encodeURIComponent(`${none.url}/r/123456?lang=en#get-app`)};end`,
    );
    expect(noStore).toContain('<section id="get-app"');
  });

  it('a code that is not one: the general page, 404', async () => {
    for (const bad of ['/r/12345', '/r/1234567', '/r/abcdef', '/r/12a456', '/r', '/r/', '/r/123/456']) {
      const res = await fetch(`${none.url}${bad}`);
      expect({ bad, status: res.status }).toEqual({ bad, status: 404 });
      expect(res.headers.get('content-security-policy')).toBe(ROOM_PAGE_CSP);
      const html = await res.text();
      expect(html).toContain(ROOM_PAGE_TEXTS.he.badHeading);
      expect(html).not.toContain('sudokufight://');
    }
  });

  it('assetlinks.json: every fingerprint of the settings, as application/json; 404 without any', async () => {
    const res = await fetch(`${set.url}${FRIENDS_PATHS.assetLinks}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(assetLinks([EAS, TEMPLATE_DEBUG_KEY_SHA256]));
    expect((await fetch(`${none.url}${FRIENDS_PATHS.assetLinks}`)).status).toBe(404);
  });

  it('apple-app-site-association: only with IOS_APP_ID', async () => {
    const res = await fetch(`${set.url}${FRIENDS_PATHS.appleAppSiteAssociation}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual(appleAppSiteAssociation('ABCDE12345.com.mosheg.sudokufight'));
    expect((await fetch(`${none.url}${FRIENDS_PATHS.appleAppSiteAssociation}`)).status).toBe(404);
    expect(NO_FRIENDS_LINKS.iosAppId).toBeNull();
  });
});

// ---- the deployments --------------------------------------------------------------------------------------------

/** The [env] table of a fly.toml: KEY = "value" lines. */
function flyEnv(file: string): Record<string, string> {
  const lines = readFileSync(path.join(REPO, file), 'utf8').split(/\r?\n/);
  const env: Record<string, string> = {};
  let inEnv = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) inEnv = trimmed === '[env]';
    const m = inEnv ? /^([A-Z0-9_]+)\s*=\s*"(.*)"$/.exec(trimmed) : null;
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

describe('the Fly apps', () => {
  const load = (file: string) =>
    loadConfig(
      { ...flyEnv(file), DATABASE_URL: 'postgres://h/db' },
      { warn: () => {}, randomSecret: () => 'x' },
    );

  it('staging lists the PC’s test key, on purpose; its settings load', () => {
    const env = flyEnv('fly.toml');
    expect(env.SENTRY_ENVIRONMENT).toBe('staging');
    expect(load('fly.toml').friends?.links.androidSha256).toContain(TEMPLATE_DEBUG_KEY_SHA256);
    expect(env.ANDROID_APP_LINK_ALLOW_DEBUG_KEY).toBe('true');
  });

  it('the QA module is on, and open (no sign-in), in staging only; a key would be a secret, never in a file', () => {
    const staging = flyEnv('fly.toml');
    const production = flyEnv('fly.production.toml');
    expect(staging.QA_ENABLED).toBe('true');
    expect(load('fly.toml').qa?.enabled).toBe(true);
    expect(production.QA_ENABLED).toBeUndefined();
    expect(load('fly.production.toml').qa?.enabled).toBe(false);
    expect(staging.QA_OPEN).toBe('true');
    expect(load('fly.toml').qa?.open).toBe(true);
    expect(production.QA_OPEN).toBeUndefined();
    expect(load('fly.production.toml').qa?.open).toBe(false);
    expect(staging.QA_AGENT_TOKEN).toBeUndefined();
    expect(production.QA_AGENT_TOKEN).toBeUndefined();
  });

  it('production never lists the public debug key, nor allows it; its settings load', () => {
    const env = flyEnv('fly.production.toml');
    expect(env.SENTRY_ENVIRONMENT).toBe('production');
    expect(env.ANDROID_APP_LINK_ALLOW_DEBUG_KEY).toBeUndefined();
    expect(load('fly.production.toml').friends?.links.androidSha256).not.toContain(TEMPLATE_DEBUG_KEY_SHA256);
  });
});
