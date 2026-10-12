/**
 * Writes docs/avatars/preview.html: every avatar in a grid (by kind, with a name search), and a stage to try
 * each expression and motion on one of them.
 *
 *   npm run preview -w @sudoku-fight/avatars
 *
 * The page is self-contained (inline CSS and JS, Google Fonts only) and written without <!doctype>, <html>,
 * <head> or <body>: the artifact publisher wraps it. It stays small because it carries the avatar data as JSON
 * plus the package's renderer compiled to plain JS (esbuild): the page draws every SVG, and builds the motion
 * and gimmick CSS (motionCss, gimmickCss) from the same data, instead of shipping them prebuilt.
 *
 * esbuild is not a dependency of this package: it comes with tsx, a root dev dependency.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { build } from 'esbuild';

import { AVATARS } from '../src';

const REPO = join(__dirname, '..', '..', '..');
const OUT = join(REPO, 'docs', 'avatars', 'preview.html');

const FONTS =
  'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Teko:wght@500;600&display=swap';

/**
 * The page's own styles. Layout: the stage (one character, big and small, with its controls) beside the grid
 * on wide screens, where it stays in view while the grid scrolls; above it on narrow ones.
 */
const PAGE_CSS = `
:root {
  --bg: #f3f4f7;
  --surface: #ffffff;
  --surface-2: #eceef3;
  --border: #d8dce4;
  --text: #151922;
  --muted: #586172;
  --accent: #ffcf3f;
  --accent-text: #7a5a00;
  --on-accent: #241a00;
  --focus: #1b64d8;
  --ground-app: #0f1218;
  --ground-app-text: #9aa3b5;
  --ground-board: #f7f8fa;
  --ground-board-text: #586172;
  --font-ui: 'Rubik', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  --font-num: 'Teko', 'Rubik', system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0f1218;
    --surface: #171b24;
    --surface-2: #1f2430;
    --border: #2a3140;
    --text: #eef1f6;
    --muted: #9aa3b5;
    --accent-text: #ffcf3f;
    --focus: #ffcf3f;
    color-scheme: dark;
  }
}
:root[data-theme='dark'] {
  --bg: #0f1218;
  --surface: #171b24;
  --surface-2: #1f2430;
  --border: #2a3140;
  --text: #eef1f6;
  --muted: #9aa3b5;
  --accent-text: #ffcf3f;
  --focus: #ffcf3f;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--text); font-family: var(--font-ui); }
.page { max-width: 1360px; margin-inline: auto; padding-inline: 16px; padding-block: 24px 48px;
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; font-size: 15px; line-height: 1.45; }
header { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: flex-end; justify-content: space-between; }
.eyebrow { margin: 0 0 4px; font: 600 1.05rem/1 var(--font-num); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-text); }
h1 { margin: 0; font: 700 clamp(1.5rem, 1.1rem + 1.6vw, 2.1rem)/1.15 var(--font-ui); text-wrap: balance; }
.lead { margin: 6px 0 0; color: var(--muted); max-width: 62ch; }
h2, h3 { margin: 0; text-wrap: balance; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: start; }
.panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-content: start; min-width: 0;
  padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; }
@media (min-width: 1000px) {
  .layout { grid-template-columns: minmax(340px, 400px) minmax(0, 1fr); gap: 28px; }
  .panel { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 12px); max-height: calc(100vh - 24px);
    overflow-y: auto; overscroll-behavior: contain; }
}
@media (min-width: 680px) and (max-width: 999px) {
  .panel { grid-template-columns: minmax(0, 290px) minmax(0, 1fr); gap: 16px 22px; }
  .panel > .ground { grid-row: 1 / span 4; align-self: start; }
}
.ground { display: grid; justify-items: center; gap: 14px; padding: 22px 14px 14px; border-radius: 16px;
  background: var(--ground-app); color: var(--ground-app-text); }
.ground[data-ground='board'] { background: var(--ground-board); color: var(--ground-board-text);
  box-shadow: inset 0 0 0 1px var(--border); }
#big svg { display: block; width: min(200px, 100%); height: auto; }
.small { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; justify-content: center; }
.size { margin: 0; display: grid; justify-items: center; gap: 6px; }
.size svg { display: block; }
.size figcaption { font: 500 0.75rem/1 var(--font-ui); font-variant-numeric: tabular-nums; }

.who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.who h2 { font: 700 1.5rem/1.1 var(--font-ui); }
.who .en { color: var(--muted); font-size: 1rem; }
.kind { font-size: 0.78rem; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.group-label { margin: 0 0 8px; font-size: 0.8rem; font-weight: 500; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { min-height: 36px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); font: 500 0.9rem/1.1 var(--font-ui); cursor: pointer; }
.chip:hover { border-color: var(--muted); }
.chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.chip-strong { font-weight: 700; }
.count { font: 600 1.05rem/1 var(--font-num); opacity: 0.75; font-variant-numeric: tabular-nums; }
.status { margin: 8px 0 0; min-height: 1.4em; font-size: 0.85rem; color: var(--muted); }
.opts { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; padding-top: 14px;
  border-top: 1px solid var(--border); font-size: 0.92rem; }
.opts label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
.opts input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); }
.seg { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.seg .group-label { margin: 0; }

.faces { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.face { display: grid; justify-items: center; gap: 4px; min-width: 0; padding: 7px 2px 6px; border-radius: 12px;
  border: 1px solid transparent; background: transparent; color: var(--muted); font: 500 0.74rem/1.15 var(--font-ui);
  cursor: pointer; }
.face:hover { background: var(--surface-2); }
.face[aria-pressed='true'] { border-color: var(--accent); color: var(--text); background: var(--surface-2); }
.face svg { display: block; width: 100%; max-width: 56px; height: auto; }

.browse { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; }
.browse-head { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; }
.browse-head h2 { font: 700 1.2rem/1.2 var(--font-ui); }
.search { flex: 1 1 200px; max-width: 320px; }
.search input { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 16px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 400 0.95rem/1.2 var(--font-ui); }
.search input::placeholder { color: var(--muted); }
.result { margin: 0; min-height: 1.3em; font-size: 0.86rem; color: var(--muted); }
.result:empty { display: none; }
.kind-head { display: flex; align-items: baseline; gap: 8px; margin: 14px 0 10px; font: 700 1rem/1.2 var(--font-ui); }
.kind-head:first-child { margin-top: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
.card { display: grid; justify-items: center; align-content: start; gap: 7px; min-width: 0; padding: 12px 6px 10px;
  border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font: 500 0.86rem/1.2 var(--font-ui); text-align: center; cursor: pointer;
  content-visibility: auto; contain-intrinsic-size: auto 100px auto 134px; }
.card[aria-pressed='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.card svg { display: block; }
.empty { margin: 0; padding: 24px 0; color: var(--muted); }
footer { color: var(--muted); font-size: 0.82rem; }
code { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.95em; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .card svg { transition: transform 0.15s; }
  .card:hover svg { transform: translateY(-2px); }
}
.sfa-reduce .sfa .sfa-body, .sfa-reduce .sfa .sfa-face, .sfa-reduce .sfa .sfa-eye,
.sfa-reduce .sfa .sfa-gimmick { animation: none !important; }
`;

const BODY = `
<div id="app" class="page" dir="rtl" lang="he">
  <header>
    <div>
      <p class="eyebrow">Sudoku Fight · Prototype</p>
      <h1 data-t="heading">האווטרים של סודוקו פייט</h1>
      <p class="lead" id="lead"></p>
    </div>
    <button type="button" class="chip" id="lang">English</button>
  </header>
  <div class="layout">
    <section class="panel" id="stage" aria-labelledby="name-he">
      <div class="ground" id="ground" data-ground="app">
        <div id="big"></div>
        <div class="small" id="small" role="group" data-t-label="sizes"></div>
      </div>
      <div class="who"><h2 id="name-he"></h2><span class="en" id="name-en" lang="en" dir="ltr"></span><span class="kind" id="kind"></span></div>
      <div><p class="group-label" data-t="expression"></p><div class="faces" id="faces"></div></div>
      <div>
        <p class="group-label" data-t="motion"></p>
        <div class="chips" id="motions"></div>
        <p class="status" id="status" aria-live="polite"></p>
      </div>
      <div class="opts">
        <label><input type="checkbox" id="opt-blink" checked><span data-t="blink"></span></label>
        <label><input type="checkbox" id="opt-idle" checked><span data-t="idle"></span></label>
        <label><input type="checkbox" id="opt-reduce"><span data-t="reduce"></span></label>
        <span class="seg"><span class="group-label" data-t="ground"></span>
          <button type="button" class="chip" data-ground="app" data-t="app"></button>
          <button type="button" class="chip" data-ground="board" data-t="board"></button></span>
      </div>
    </section>
    <section class="browse" aria-labelledby="all-title">
      <div class="browse-head">
        <h2 id="all-title" data-t="all"></h2>
        <label class="search"><span class="sr-only" data-t="search"></span><input type="search" id="q" autocomplete="off" spellcheck="false"></label>
      </div>
      <div class="chips" id="filters" role="group" data-t-label="kinds"></div>
      <p class="result" id="result" aria-live="polite"></p>
      <div id="grid"></div>
    </section>
  </div>
  <footer id="footer"></footer>
</div>`;

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [join(__dirname, 'preview', 'client.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    minify: true,
    target: 'es2020',
    legalComments: 'none',
    charset: 'utf8',
  });
  const js = (result.outputFiles[0]?.text ?? '').replace(/<\/script/gi, '<\\/script');
  // JSON inside a <script> block: escape "<" so no string can close it.
  const json = JSON.stringify({ avatars: AVATARS }).replace(/</g, '\\u003c');
  const css = PAGE_CSS.trim();
  const html =
    `<title>Sudoku Fight Avatars</title>\n` +
    `<link rel="preconnect" href="https://fonts.googleapis.com">\n` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n` +
    `<link rel="stylesheet" href="${FONTS}">\n` +
    `<style>\n${css}\n</style>\n` +
    `${BODY.trim()}\n` +
    `<script type="application/json" id="sfa-data">${json}</script>\n` +
    `<script>${js}</script>\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `Wrote ${relative(REPO, OUT)}: ${kb(Buffer.byteLength(html))} (data ${kb(Buffer.byteLength(json))}, ` +
      `script ${kb(Buffer.byteLength(js))}, styles ${kb(Buffer.byteLength(css))}, ${AVATARS.length} avatars)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
