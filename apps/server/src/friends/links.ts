import { createHash } from 'node:crypto';

import {
  FRIENDS_APP_SCHEME,
  FRIENDS_PATHS,
  formatFriendCode,
  normalizeFriendCode,
  roomAppLink,
  roomLink,
} from '@sudoku-fight/protocol';
import { type Request, type Response, Router } from 'express';

import { type FriendsLinksConfig, NO_FRIENDS_LINKS } from '../config';
import { escapeHtml, legalHref, PAGE_COLORS } from '../legal';

/**
 * A room's link outside the app (playing with friends, 1.0.4; docs/handoff/2026-10-19/friends-room.md §6), public:
 *   GET /r/:code                                → the page a link opens in a browser (no app, an old app, or
 *                                                 App Links not verified), in Hebrew or English
 *   GET /.well-known/assetlinks.json            → Android App Links (ANDROID_APP_LINK_SHA256), else 404
 *   GET /.well-known/apple-app-site-association → iOS universal links (IOS_APP_ID), else 404
 *
 * The page is the same for every well-formed code: it never asks whether the room exists or who is in it, so it
 * tells nobody anything and can't be used to guess codes (§6.4). A code that is not one gets a general page
 * (404). Locked down like the legal pages: no script, no external file, one inline style allowed by its hash,
 * no framing, no referrer (the code must not travel to a store in a Referer), not indexed, never cached.
 */

/** The app's Android package and iOS bundle id (apps/mobile/app.json; a test keeps them equal). */
export const ANDROID_PACKAGE = 'com.mosheg.sudokufight';
export const IOS_BUNDLE_ID = 'com.mosheg.sudokufight';

/**
 * The first app version that knows rooms (friends-room.md §6.8): an older one opens `sudokufight://room/…` on
 * expo-router's "not found" screen, so the page says which version is needed.
 */
export const FRIENDS_MIN_APP_VERSION = '1.0.4';

/** The paths an app link covers: `/r/<code>` (FRIENDS_PATHS.link). */
export const ROOM_LINK_PATH_PREFIX = '/r/';

// ---- /.well-known ----------------------------------------------------------------------------------------------

/** One statement of a Digital Asset Links file (developers.google.com/digital-asset-links). */
export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/**
 * assetlinks.json: the app signed by any of these keys may open this server's links (Android verifies it once,
 * at install, for an intent filter with autoVerify). Every key that signs a build the server's links should
 * open: staging, the PC's test key and EAS's; production, EAS's and Google Play's app signing key.
 */
export function assetLinks(sha256Fingerprints: readonly string[]): AssetLinkStatement[] {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [...sha256Fingerprints],
      },
    },
  ];
}

export interface AppleAppSiteAssociation {
  applinks: {
    details: { appIDs: string[]; components: { '/': string; comment?: string }[] }[];
  };
}

/** apple-app-site-association (iOS 13 and later): the app `<Team ID>.<bundle id>` opens the room links. */
export function appleAppSiteAssociation(iosAppId: string): AppleAppSiteAssociation {
  return {
    applinks: {
      details: [
        {
          appIDs: [iosAppId],
          components: [{ '/': `${ROOM_LINK_PATH_PREFIX}*`, comment: 'A room link: /r/<6 digits>' }],
        },
      ],
    },
  };
}

// ---- the page ---------------------------------------------------------------------------------------------------

export const LINK_LANGS = ['he', 'en'] as const;
export type LinkLang = (typeof LINK_LANGS)[number];

/** What the browser is, for the "open in the app" link and which store to offer. */
export type LinkPlatform = 'android' | 'ios' | 'other';

export function platformOf(userAgent: string | undefined): LinkPlatform {
  const ua = userAgent ?? '';
  if (/\bAndroid\b/i.test(ua)) return 'android';
  if (/\b(?:iPhone|iPad|iPod)\b/i.test(ua)) return 'ios';
  return 'other';
}

/** Isolates (LRI…PDI): the code stays left to right inside Hebrew text where no markup can (the <title>). */
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/**
 * Chrome on Android: open the app at `sudokufight://room/<code>`; when it is not installed, go to
 * `fallbackUrl` instead of an error (developer.chrome.com/docs/android/intents).
 */
export function intentLink(code: string, fallbackUrl: string): string {
  const path = roomAppLink(code).slice(`${FRIENDS_APP_SCHEME}://`.length);
  return (
    `intent://${path}#Intent;scheme=${FRIENDS_APP_SCHEME};package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`
  );
}

interface PageTexts {
  brand: string;
  languages: string;
  /** <title> of a room's page; {code} is the code, isolated. */
  title: string;
  heading: string;
  codeLabel: string;
  open: string;
  /** The heading over the stores. */
  noApp: string;
  googlePlay: string;
  appStore: string;
  /** With a store: the app is there but did not open. {code}, {version}. */
  typeCode: string;
  /** Without a store (staging): {code}, {version}. */
  testing: string;
  testingHeading: string;
  /** Under it all, quietly. */
  closedNote: string;
  privacy: string;
  badTitle: string;
  badHeading: string;
  badText: string;
}

const LANGUAGE_NAMES: Record<LinkLang, string> = { he: 'עברית', en: 'English' };

export const ROOM_PAGE_TEXTS: Record<LinkLang, PageTexts> = {
  he: {
    brand: 'סודוקו פייט',
    languages: 'שפה',
    title: 'הזמנה לחדר {code} · סודוקו פייט',
    heading: 'הוזמנת למשחק סודוקו פייט',
    codeLabel: 'קוד החדר',
    open: 'פתח באפליקציה',
    noApp: 'אין לך את האפליקציה?',
    googlePlay: 'להורדה מ־Google Play',
    appStore: 'להורדה מ־App Store',
    typeCode:
      'האפליקציה כבר מותקנת ולא נפתחה? עדכנו אותה (צריך גרסה {version} ומעלה), או הקלידו את הקוד: משחק חדש ← הצטרף עם קוד ← {code}.',
    testing:
      'האפליקציה עדיין בבדיקות. אם היא מותקנת אצלך: משחק חדש ← הצטרף עם קוד ← {code}. צריך גרסה {version} ומעלה.',
    testingHeading: 'הצטרפות עם הקוד',
    closedNote: 'אם החדר כבר נסגר, האפליקציה תגיד לך, ואפשר לבקש מהחבר קוד חדש.',
    privacy: 'מדיניות פרטיות',
    badTitle: 'קישור לא תקין · סודוקו פייט',
    badHeading: 'הקישור לא שלם',
    badText:
      'בקישור הזה אין קוד חדר תקין. בקשו מהחבר ששלח אותו את קוד החדר (6 ספרות), ובאפליקציה: משחק חדש ← הצטרף עם קוד.',
  },
  en: {
    brand: 'Sudoku Fight',
    languages: 'Language',
    title: 'Invitation to room {code} · Sudoku Fight',
    heading: 'You’re invited to a game of Sudoku Fight',
    codeLabel: 'Room code',
    open: 'Open in the app',
    noApp: 'Don’t have the app?',
    googlePlay: 'Get it on Google Play',
    appStore: 'Download on the App Store',
    typeCode:
      'Have the app, and it didn’t open? Update it (you need version {version} or later), or type the code: New game → Join with code → {code}.',
    testing:
      'The app is still in testing. If you have it: New game → Join with code → {code}. You need version {version} or later.',
    testingHeading: 'Join with the code',
    closedNote:
      'If the room has closed already, the app will tell you, and you can ask your friend for a new code.',
    privacy: 'Privacy policy',
    badTitle: 'Broken link · Sudoku Fight',
    badHeading: 'This link is incomplete',
    badText:
      'This link has no valid room code. Ask the friend who sent it for the room code (6 digits), then in the app: New game → Join with code.',
  },
};

const LIGHT = {
  bg: '#ffffff',
  surface: '#f4f5f8',
  border: '#d6dae3',
  text: '#141821',
  textMuted: '#4a5263',
  accent: '#7a5c00',
  danger: '#b8102f',
} as const;

const vars = (c: Record<keyof typeof PAGE_COLORS, string>) =>
  `--bg:${c.bg};--surface:${c.surface};--border:${c.border};--text:${c.text};--muted:${c.textMuted};--accent:${c.accent}`;

/** The page's one style: the legal pages' look (the app's dark palette, a light one), a big code, a button. */
export const ROOM_PAGE_CSS = [
  `:root{color-scheme:dark;${vars(PAGE_COLORS)};--on-accent:${PAGE_COLORS.bg}}`,
  `@media (prefers-color-scheme:light){:root{color-scheme:light;${vars(LIGHT)};--on-accent:${LIGHT.bg}}}`,
  '*{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--text);font:400 17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Hebrew","Noto Sans",Arial,sans-serif;overflow-wrap:anywhere}',
  '.wrap{max-width:34rem;margin:0 auto;padding:0 16px}',
  '.top{background:var(--surface);border-bottom:1px solid var(--border)}',
  '.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px}',
  '.brand{font-weight:700;letter-spacing:.02em}',
  '.langs{display:flex;gap:4px}',
  '.langs a{display:inline-block;min-height:44px;line-height:44px;padding:0 10px}',
  'a{color:var(--accent);text-underline-offset:3px}',
  'a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}',
  'a[aria-current]{color:var(--text);text-decoration:none;font-weight:600}',
  'h1{font-size:1.6rem;line-height:1.3;margin:32px 0 16px}',
  'h2{font-size:1.15rem;line-height:1.35;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--border)}',
  '.label{color:var(--muted);margin:0}',
  '.code{font:700 2.6rem/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.08em;margin:4px 0 24px}',
  '.button{display:inline-block;min-height:48px;line-height:48px;padding:0 24px;border-radius:12px;background:var(--accent);color:var(--on-accent);font-weight:700;text-decoration:none}',
  '.stores{display:flex;flex-wrap:wrap;gap:8px 24px;padding:0;margin:8px 0;list-style:none}',
  '.stores a{display:inline-block;min-height:44px;line-height:44px}',
  '.muted{color:var(--muted);font-size:.95rem}',
  'section:target{outline:2px solid var(--accent);outline-offset:8px;border-radius:4px}',
  '.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
  'footer{margin-top:48px;border-top:1px solid var(--border);color:var(--muted);font-size:.9rem}',
  'footer .wrap{padding-top:16px;padding-bottom:32px}',
].join('\n');

export const ROOM_PAGE_CSS_HASH = `sha256-${createHash('sha256').update(ROOM_PAGE_CSS, 'utf8').digest('base64')}`;

/** Nothing may load or run: no script at all, no image, no font, no request; the one style by its hash. */
export const ROOM_PAGE_CSP = [
  "default-src 'none'",
  `style-src '${ROOM_PAGE_CSS_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Every answer of /r/…: never cached (it depends on the language and the phone), never indexed. */
export const ROOM_PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': ROOM_PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Accept-Language, User-Agent',
};

export interface RoomPageInput {
  /** The room's code (6 digits), or null for a link without a valid one: the general page. */
  code: string | null;
  lang: LinkLang;
  platform: LinkPlatform;
  /** This page's own address (absolute): where Chrome comes back when the app is not installed. */
  pageUrl: string;
  storeUrls: FriendsLinksConfig['storeUrls'];
}

const fill = (text: string, values: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

/** The code inside a text: escaped first, then the code in an isolate that reads left to right. */
const withCode = (text: string, code: string, version: string): string =>
  fill(escapeHtml(text), { code: `<bdi dir="ltr">${escapeHtml(formatFriendCode(code))}</bdi>`, version });

interface StoreLink {
  href: string;
  label: string;
}

function storesFor({ platform, storeUrls, lang }: RoomPageInput): StoreLink[] {
  const t = ROOM_PAGE_TEXTS[lang];
  const android = storeUrls.android === null ? [] : [{ href: storeUrls.android, label: t.googlePlay }];
  const ios = storeUrls.ios === null ? [] : [{ href: storeUrls.ios, label: t.appStore }];
  if (platform === 'android') return android;
  if (platform === 'ios') return ios;
  return [...android, ...ios];
}

/** "Open in the app": Chrome's intent on Android (back to the store, or to this page, without the app). */
function openHref(input: RoomPageInput & { code: string }): string {
  if (input.platform !== 'android') return roomAppLink(input.code);
  const fallback = input.storeUrls.android ?? `${input.pageUrl}#get-app`;
  return intentLink(input.code, fallback);
}

/** The whole page, one self-contained HTML document. */
export function renderRoomPage(input: RoomPageInput): string {
  const { code, lang } = input;
  const t = ROOM_PAGE_TEXTS[lang];
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const langLinks = LINK_LANGS.map((l) => {
    const current = l === lang ? ' aria-current="page"' : '';
    return `<a href="?lang=${l}" lang="${l}" hreflang="${l}"${current}>${LANGUAGE_NAMES[l]}</a>`;
  }).join('');

  let title: string;
  let main: string[];
  if (code === null) {
    title = escapeHtml(t.badTitle);
    main = [`<h1>${escapeHtml(t.badHeading)}</h1>`, `<p>${escapeHtml(t.badText)}</p>`];
  } else {
    const shown = formatFriendCode(code);
    title = escapeHtml(fill(t.title, { code: `${LRI}${shown}${PDI}` }));
    const stores = storesFor(input);
    const howTo =
      stores.length === 0
        ? [
            `<h2 id="get-app-h">${escapeHtml(t.testingHeading)}</h2>`,
            `<p>${withCode(t.testing, code, FRIENDS_MIN_APP_VERSION)}</p>`,
          ]
        : [
            `<h2 id="get-app-h">${escapeHtml(t.noApp)}</h2>`,
            `<ul class="stores">${stores
              .map((s) => `<li><a href="${escapeHtml(s.href)}">${escapeHtml(s.label)}</a></li>`)
              .join('')}</ul>`,
            `<p>${withCode(t.typeCode, code, FRIENDS_MIN_APP_VERSION)}</p>`,
          ];
    main = [
      `<h1>${escapeHtml(t.heading)}</h1>`,
      `<p class="label">${escapeHtml(t.codeLabel)}</p>`,
      // Screen readers get the digits one by one; the eye gets "123 456", left to right (dir="ltr" isolates it:
      // without it, Hebrew text would show "456 123").
      `<p class="code"><span dir="ltr" aria-hidden="true">${escapeHtml(shown)}</span>` +
        `<span class="sr">${escapeHtml(t.codeLabel)}: ${code.split('').join(' ')}</span></p>`,
      `<p><a class="button" href="${escapeHtml(openHref({ ...input, code }))}">${escapeHtml(t.open)}</a></p>`,
      `<section id="get-app" aria-labelledby="get-app-h">${howTo.join('')}</section>`,
      `<p class="muted">${escapeHtml(t.closedNote)}</p>`,
    ];
  }

  return [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="dark light">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${title}</title>`,
    `<style>${ROOM_PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    `<header class="top"><div class="wrap"><span class="brand">${escapeHtml(t.brand)}</span>` +
      `<nav class="langs" aria-label="${escapeHtml(t.languages)}">${langLinks}</nav></div></header>`,
    '<main class="wrap">',
    ...main,
    '</main>',
    `<footer><div class="wrap"><a href="${escapeHtml(legalHref('privacy', lang))}">${escapeHtml(t.privacy)}</a></div></footer>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ---- the router -------------------------------------------------------------------------------------------------

/**
 * The page's language from the browser's Accept-Language: the preferred one of Hebrew (he, or the old iw) and
 * English, by `q` (on a tie, the first); `*` counts as Hebrew. No header: Hebrew, like the legal pages. A header
 * with neither (say, only French): English, which more people read than Hebrew.
 */
export function langFromAcceptLanguage(header: string | undefined): LinkLang {
  if (header === undefined || header.trim() === '') return 'he';
  let best: { lang: LinkLang; q: number } | undefined;
  for (const part of header.split(',').slice(0, 32)) {
    const [tag = '', ...params] = part.split(';').map((s) => s.trim());
    const primary = tag.toLowerCase().split('-')[0];
    const lang: LinkLang | null =
      primary === 'he' || primary === 'iw' || primary === '*' ? 'he' : primary === 'en' ? 'en' : null;
    if (lang === null) continue;
    const qParam = params.find((p) => /^q=/i.test(p));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    if (!(q > 0 && q <= 1)) continue; // q=0: "not this one"; anything else malformed
    if (best === undefined || q > best.q) best = { lang, q };
  }
  return best?.lang ?? 'en';
}

/** ?lang=he|en; else the browser's languages (langFromAcceptLanguage). */
export function linkLangOf(req: Request): LinkLang {
  const asked = req.query.lang;
  if (asked === 'he' || asked === 'en') return asked;
  return langFromAcceptLanguage(req.get('accept-language'));
}

const WELL_KNOWN_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'public, max-age=300',
};

function sendWellKnown(res: Response, body: Buffer | null): void {
  res.set(WELL_KNOWN_HEADERS);
  if (body === null) {
    res.status(404).type('text/plain; charset=utf-8').send('Not found');
    return;
  }
  // Exactly "application/json", as Android's and Apple's checks expect: Node's own setHeader (Express's set()
  // would add a charset), and a Buffer (send() keeps the type it finds).
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(body);
}

export interface FriendsLinksRouterDeps {
  /** From ServerConfig.friends (absent: no app-link files, no store links). */
  links?: FriendsLinksConfig;
}

export function createFriendsLinksRouter({ links = NO_FRIENDS_LINKS }: FriendsLinksRouterDeps = {}): Router {
  const assetLinksBody =
    links.androidSha256.length === 0 ? null : Buffer.from(JSON.stringify(assetLinks(links.androidSha256)));
  const aasaBody =
    links.iosAppId === null ? null : Buffer.from(JSON.stringify(appleAppSiteAssociation(links.iosAppId)));

  const router = Router();
  router.get(FRIENDS_PATHS.assetLinks, (_req, res) => sendWellKnown(res, assetLinksBody));
  router.get(FRIENDS_PATHS.appleAppSiteAssociation, (_req, res) => sendWellKnown(res, aasaBody));

  const page = (req: Request, res: Response, rawCode: unknown) => {
    const code = typeof rawCode === 'string' ? normalizeFriendCode(rawCode) : null;
    const lang = linkLangOf(req);
    const host = req.get('host') ?? 'localhost';
    const pageUrl = code === null ? '' : `${roomLink(`${req.protocol}://${host}`, code)}?lang=${lang}`;
    res.set(ROOM_PAGE_HEADERS);
    res.set('Content-Language', lang);
    res
      .status(code === null ? 404 : 200)
      .type('html')
      .send(
        renderRoomPage({
          code,
          lang,
          platform: platformOf(req.get('user-agent')),
          pageUrl,
          storeUrls: links.storeUrls,
        }),
      );
  };
  router.get(FRIENDS_PATHS.link, (req, res) => page(req, res, req.params.code));
  // /r, /r/ and deeper paths (/r/123/456): the general page.
  router.get(['/r', '/r/*rest'], (req, res) => page(req, res, null));
  return router;
}
