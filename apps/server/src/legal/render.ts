import { createHash } from 'node:crypto';

import { DELETE_ACCOUNT } from './deleteAccount';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import {
  type Block,
  LEGAL_DOCS,
  LEGAL_LANGS,
  LEGAL_UPDATED,
  type LegalDocId,
  type LegalLang,
  type LegalSettings,
  type LegalTexts,
} from './types';

/**
 * A legal page as one self-contained HTML document: no script, no external file, no font download (system
 * fonts), one inline <style> that the CSP allows by its hash. Responsive (one column, 16 px gutters, tables
 * scroll inside their own box) and direction-aware: Hebrew is `dir="rtl"`, English `ltr`; event names and
 * addresses are isolated left to right inside Hebrew.
 *
 * Every text is escaped first; the few marks in types.ts are the only markup a text can make.
 */

export const LEGAL_TEXTS: Record<LegalDocId, LegalTexts> = {
  privacy: PRIVACY,
  terms: TERMS,
  'delete-account': DELETE_ACCOUNT,
};

export const isLegalDoc = (value: unknown): value is LegalDocId =>
  typeof value === 'string' && (LEGAL_DOCS as readonly string[]).includes(value);
export const isLegalLang = (value: unknown): value is LegalLang =>
  typeof value === 'string' && (LEGAL_LANGS as readonly string[]).includes(value);

/** The page's address on this server, e.g. /legal/terms?lang=en. */
export const legalHref = (doc: LegalDocId, lang: LegalLang): string => `/legal/${doc}?lang=${lang}`;

/** The app's dark palette (docs/design/tokens.json `color`; a test keeps them equal), and a light one. */
export const PAGE_COLORS = {
  bg: '#0f1218',
  surface: '#171b24',
  border: '#2a3140',
  text: '#eef1f6',
  textMuted: '#9aa3b5',
  accent: '#ffcf3f',
  danger: '#ff4d5e',
} as const;

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
  `--bg:${c.bg};--surface:${c.surface};--border:${c.border};--text:${c.text};--muted:${c.textMuted};--accent:${c.accent};--danger:${c.danger}`;

export const LEGAL_CSS = [
  `:root{color-scheme:dark;${vars(PAGE_COLORS)}}`,
  `@media (prefers-color-scheme:light){:root{color-scheme:light;${vars(LIGHT)}}}`,
  '*{box-sizing:border-box}',
  'html{-webkit-text-size-adjust:100%;text-size-adjust:100%}',
  'body{margin:0;background:var(--bg);color:var(--text);font:400 17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Hebrew","Noto Sans",Arial,sans-serif;overflow-wrap:anywhere}',
  '.wrap{max-width:46rem;margin:0 auto;padding:0 16px}',
  '.top{background:var(--surface);border-bottom:1px solid var(--border)}',
  '.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px}',
  '.brand{font-weight:700;letter-spacing:.02em}',
  '.langs{display:flex;gap:4px}',
  '.langs a{display:inline-block;min-height:44px;line-height:44px;padding:0 10px}',
  'a{color:var(--accent);text-underline-offset:3px}',
  'a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}',
  'a[aria-current]{color:var(--text);text-decoration:none;font-weight:600}',
  'h1{font-size:1.9rem;line-height:1.25;margin:32px 0 8px}',
  'h2{font-size:1.25rem;line-height:1.35;margin:36px 0 8px;padding-top:16px;border-top:1px solid var(--border)}',
  '.lead{color:var(--muted);margin:0 0 4px}',
  '.updated{color:var(--muted);font-size:.9rem;margin:0 0 24px}',
  '.toc{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px}',
  '.toc ol{margin:0;padding-inline-start:1.25rem;columns:2 13rem;column-gap:24px}',
  'ul,ol{padding-inline-start:1.4rem}',
  'li{margin:6px 0}',
  'code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0 4px;unicode-bidi:isolate}',
  '.table{overflow-x:auto;border:1px solid var(--border);border-radius:12px;margin:12px 0}',
  'table{border-collapse:collapse;width:100%;font-size:.95rem}',
  'th,td{padding:8px 12px;text-align:start;vertical-align:top;border-bottom:1px solid var(--border)}',
  'th{background:var(--surface);font-weight:600}',
  'tr:last-child td{border-bottom:0}',
  '.ph{color:var(--danger);border:1px dashed var(--danger);border-radius:4px;padding:0 4px}',
  '.draft{border:1px solid var(--danger);border-radius:12px;padding:12px 16px;margin:24px 0 0}',
  'footer{margin-top:48px;border-top:1px solid var(--border);color:var(--muted);font-size:.9rem}',
  'footer .wrap{padding-top:16px;padding-bottom:32px}',
  'footer nav{display:flex;flex-wrap:wrap;gap:4px 16px}',
  '@media print{:root{color-scheme:light;--bg:#fff;--surface:#fff;--text:#000;--muted:#333;--accent:#000}.top,.toc,footer nav,.langs{display:none}}',
].join('\n');

/** The CSP source of the inline <style>: its SHA-256, so nothing else inline can apply. */
export const LEGAL_CSS_HASH = `sha256-${createHash('sha256').update(LEGAL_CSS, 'utf8').digest('base64')}`;

/**
 * The pages' Content Security Policy: nothing may load or run (no script at all, no image, no font, no
 * request), the one style by its hash, no framing, no form posting, no <base>.
 */
export const LEGAL_CSP = [
  "default-src 'none'",
  `style-src '${LEGAL_CSS_HASH}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The words around the texts. */
const CHROME: Record<
  LegalLang,
  {
    brand: string;
    languages: string;
    contents: string;
    documents: string;
    updated: string;
    emailPlaceholder: string;
    operatorPlaceholder: string;
    draft: string;
  }
> = {
  he: {
    brand: 'סודוקו פייט',
    languages: 'שפה',
    contents: 'תוכן העניינים',
    documents: 'מסמכים',
    updated: 'עודכן לאחרונה:',
    emailPlaceholder: 'privacy@<domain>',
    operatorPlaceholder: '[שם המפעיל]',
    draft: 'טיוטה: פרטי הקשר עוד לא הוגדרו בשרת (LEGAL_CONTACT_EMAIL, ‏LEGAL_OPERATOR_NAME).',
  },
  en: {
    brand: 'Sudoku Fight',
    languages: 'Language',
    contents: 'Contents',
    documents: 'Documents',
    updated: 'Last updated:',
    emailPlaceholder: 'privacy@<domain>',
    operatorPlaceholder: '[operator name]',
    draft:
      'Draft: the contact details are not set on the server yet (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  },
};

const LANGUAGE_NAMES: Record<LegalLang, string> = { he: 'עברית', en: 'English' };

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Context {
  lang: LegalLang;
  settings: LegalSettings;
}

const MARKS = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([a-z-]+)\)|\{(email|operator)\}/g;

/** One text with its marks (types.ts) as HTML. */
export function inline(text: string, ctx: Context): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    out += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [, bold, code, label, target, field] = m;
    if (bold !== undefined) out += `<strong>${inline(bold, ctx)}</strong>`;
    else if (code !== undefined) out += `<code dir="ltr">${escapeHtml(code)}</code>`;
    else if (label !== undefined) {
      if (!isLegalDoc(target)) throw new Error(`A legal text links to an unknown page: ${target}`);
      out += `<a href="${escapeHtml(legalHref(target, ctx.lang))}">${inline(label, ctx)}</a>`;
    } else if (field === 'email') out += email(ctx);
    else out += operator(ctx);
  }
  return out + escapeHtml(text.slice(last));
}

function email({ lang, settings }: Context): string {
  const address = settings.contactEmail;
  if (address === null)
    return `<span class="ph" dir="ltr">${escapeHtml(CHROME[lang].emailPlaceholder)}</span>`;
  return `<a href="mailto:${escapeHtml(address)}" dir="ltr">${escapeHtml(address)}</a>`;
}

function operator({ lang, settings }: Context): string {
  const name = settings.operatorName;
  if (name === null) return `<span class="ph">${escapeHtml(CHROME[lang].operatorPlaceholder)}</span>`;
  return `<bdi>${escapeHtml(name)}</bdi>`;
}

function block(b: Block, ctx: Context): string {
  if (typeof b === 'string') return `<p>${inline(b, ctx)}</p>`;
  if ('list' in b) {
    const tag = b.ordered ? 'ol' : 'ul';
    return `<${tag}>${b.list.map((item) => `<li>${inline(item, ctx)}</li>`).join('')}</${tag}>`;
  }
  const head = b.table.head.map((h) => `<th scope="col">${inline(h, ctx)}</th>`).join('');
  const rows = b.table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** "11 באוקטובר 2026" / "October 11, 2026". */
export function formatDate(iso: string, lang: LegalLang): string {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** The whole page of one document in one language. */
export function renderLegalPage(doc: LegalDocId, lang: LegalLang, settings: LegalSettings): string {
  const text = LEGAL_TEXTS[doc][lang];
  const chrome = CHROME[lang];
  const ctx: Context = { lang, settings };
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const unset = settings.contactEmail === null || settings.operatorName === null;

  const langLinks = LEGAL_LANGS.map((l) => {
    const current = l === lang ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(legalHref(doc, l))}" lang="${l}" hreflang="${l}"${current}>${LANGUAGE_NAMES[l]}</a>`;
  }).join('');
  const alternates = LEGAL_LANGS.filter((l) => l !== lang)
    .map((l) => `<link rel="alternate" hreflang="${l}" href="${escapeHtml(legalHref(doc, l))}">`)
    .join('');
  const toc = text.sections
    .map((s) => `<li><a href="#${escapeHtml(s.id)}">${inline(s.title, ctx)}</a></li>`)
    .join('');
  const sections = text.sections
    .map(
      (s) =>
        `<section id="${escapeHtml(s.id)}" aria-labelledby="${escapeHtml(s.id)}-h">` +
        `<h2 id="${escapeHtml(s.id)}-h">${inline(s.title, ctx)}</h2>` +
        s.blocks.map((b) => block(b, ctx)).join('') +
        '</section>',
    )
    .join('\n');
  const docLinks = LEGAL_DOCS.map((d) => {
    const current = d === doc ? ' aria-current="page"' : '';
    return `<a href="${escapeHtml(legalHref(d, lang))}"${current}>${escapeHtml(LEGAL_TEXTS[d][lang].title)}</a>`;
  }).join('');

  return [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="dark light">',
    `<title>${escapeHtml(text.title)} · ${escapeHtml(chrome.brand)}</title>`,
    `<meta name="description" content="${escapeHtml(text.lead)}">`,
    alternates,
    `<style>${LEGAL_CSS}</style>`,
    '</head>',
    '<body>',
    `<header class="top"><div class="wrap"><span class="brand">${escapeHtml(chrome.brand)}</span>` +
      `<nav class="langs" aria-label="${escapeHtml(chrome.languages)}">${langLinks}</nav></div></header>`,
    '<main class="wrap">',
    unset ? `<p class="draft" role="note">${escapeHtml(chrome.draft)}</p>` : '',
    `<h1>${escapeHtml(text.title)}</h1>`,
    `<p class="lead">${inline(text.lead, ctx)}</p>`,
    `<p class="updated">${escapeHtml(chrome.updated)} <time datetime="${LEGAL_UPDATED}">${escapeHtml(formatDate(LEGAL_UPDATED, lang))}</time></p>`,
    text.sections.length > 3
      ? `<nav class="toc" aria-label="${escapeHtml(chrome.contents)}"><ol>${toc}</ol></nav>`
      : '',
    sections,
    '</main>',
    `<footer><div class="wrap"><nav aria-label="${escapeHtml(chrome.documents)}">${docLinks}</nav></div></footer>`,
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
