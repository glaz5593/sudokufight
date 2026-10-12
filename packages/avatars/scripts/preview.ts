/**
 * Writes docs/avatars/preview.html: every avatar in a grid, and a stage to try each expression and motion.
 *
 *   npm run preview -w @sudoku-fight/avatars
 *
 * The page is self-contained (inline CSS and JS, Google Fonts only) and written without <!doctype>, <html>,
 * <head> or <body>: the artifact publisher wraps it. It stays small because it carries the avatar data as JSON
 * plus the package's renderer compiled to plain JS (esbuild), not a prebuilt SVG per avatar and expression.
 *
 * esbuild is not a dependency of this package: it comes with tsx, a root dev dependency.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { build } from 'esbuild';

import { AVATARS, motionCss } from '../src';

const REPO = join(__dirname, '..', '..', '..');
const OUT = join(REPO, 'docs', 'avatars', 'preview.html');

const FONTS =
  'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Teko:wght@500;600&display=swap';

/** The page's own styles. Layout: a stage card (one character, big and small, with its controls) above the grid. */
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
.page { max-width: 1120px; margin-inline: auto; padding-inline: 16px; padding-block: 28px 56px;
  display: grid; gap: 32px; font-size: 15px; line-height: 1.45; }
header { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: flex-end; justify-content: space-between; }
.eyebrow { margin: 0 0 4px; font: 600 1.05rem/1 var(--font-num); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-text); }
h1 { margin: 0; font: 700 clamp(1.5rem, 1.1rem + 1.6vw, 2.1rem)/1.15 var(--font-ui); text-wrap: balance; }
.lead { margin: 6px 0 0; color: var(--muted); max-width: 62ch; }
h2, h3 { margin: 0; text-wrap: balance; }
h3 { font: 700 1.05rem/1.2 var(--font-ui); }

.stage { display: grid; grid-template-columns: minmax(0, 320px) minmax(0, 1fr); gap: 24px; padding: 20px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 20px; }
@media (max-width: 760px) { .stage { grid-template-columns: minmax(0, 1fr); padding: 14px; } }
.ground { display: grid; justify-items: center; gap: 18px; padding: 26px 18px 18px; border-radius: 16px;
  background: var(--ground-app); color: var(--ground-app-text); }
.ground[data-ground='board'] { background: var(--ground-board); color: var(--ground-board-text);
  box-shadow: inset 0 0 0 1px var(--border); }
#big svg { display: block; width: min(240px, 100%); height: auto; }
.small-wrap { display: grid; gap: 10px; justify-items: center; width: 100%; }
.ground-label { margin: 0; font-size: 0.8rem; }
.small { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: flex-end; justify-content: center; }
.size { margin: 0; display: grid; justify-items: center; gap: 6px; }
.size svg { display: block; }
.size figcaption { font: 500 0.78rem/1 var(--font-ui); font-variant-numeric: tabular-nums; }

.controls { display: grid; gap: 18px; align-content: start; min-width: 0; }
.who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.who h2 { font: 700 1.7rem/1.1 var(--font-ui); }
.who .en { color: var(--muted); font-size: 1.05rem; }
.kind { font-size: 0.8rem; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.group-label { margin: 0 0 8px; font-size: 0.8rem; font-weight: 500; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { min-height: 36px; padding: 8px 13px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); font: 500 0.92rem/1.1 var(--font-ui); cursor: pointer; }
.chip:hover { border-color: var(--muted); }
.chip[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.chip-strong { font-weight: 700; }
.count { font: 600 1.05rem/1 var(--font-num); opacity: 0.75; font-variant-numeric: tabular-nums; }
.status { margin: 8px 0 0; min-height: 1.4em; font-size: 0.86rem; color: var(--muted); }
.opts { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; padding-top: 14px;
  border-top: 1px solid var(--border); }
.opts label { display: inline-flex; gap: 8px; align-items: center; cursor: pointer; }
.opts input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); }
.seg { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.seg .group-label { margin: 0; }

.section { display: grid; gap: 14px; }
.section-head { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; justify-content: space-between; }
.faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.face { display: grid; justify-items: center; gap: 6px; padding: 10px 4px 8px; border-radius: 14px;
  border: 1px solid transparent; background: transparent; color: var(--muted); font: 500 0.85rem/1.2 var(--font-ui);
  cursor: pointer; }
.face:hover { background: var(--surface-2); }
.face[aria-pressed='true'] { border-color: var(--accent); color: var(--text); background: var(--surface); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 12px; }
.card { display: grid; justify-items: center; gap: 8px; padding: 14px 8px 12px; border-radius: 16px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 500 0.9rem/1.2 var(--font-ui);
  cursor: pointer; }
.card[aria-pressed='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.card svg, .face svg { display: block; }
.empty { margin: 0; color: var(--muted); }
footer { color: var(--muted); font-size: 0.82rem; }
code { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.95em; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .card svg { transition: transform 0.15s; }
  .card:hover svg { transform: translateY(-2px); }
}
.sfa-reduce .sfa .sfa-body, .sfa-reduce .sfa .sfa-face, .sfa-reduce .sfa .sfa-eyes { animation: none !important; }
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
  <section class="stage" id="stage">
    <div class="ground" id="ground" data-ground="app">
      <div id="big"></div>
      <div class="small-wrap">
        <p class="ground-label" data-t="sizes"></p>
        <div class="small" id="small"></div>
      </div>
    </div>
    <div class="controls">
      <div class="who"><h2 id="name-he"></h2><span class="en" id="name-en" lang="en" dir="ltr"></span><span class="kind" id="kind"></span></div>
      <div><p class="group-label" data-t="expression"></p><div class="chips" id="expressions"></div></div>
      <div>
        <p class="group-label" data-t="motion"></p>
        <div class="chips" id="motions"></div>
        <p class="status" id="status" aria-live="polite"></p>
      </div>
      <div class="opts">
        <label><input type="checkbox" id="opt-blink" checked><span data-t="blink"></span></label>
        <label><input type="checkbox" id="opt-reduce"><span data-t="reduce"></span></label>
        <span class="seg"><span class="group-label" data-t="ground"></span>
          <button type="button" class="chip" data-ground="app" data-t="app"></button>
          <button type="button" class="chip" data-ground="board" data-t="board"></button></span>
      </div>
    </div>
  </section>
  <section class="section">
    <h3 data-t="faces"></h3>
    <div class="faces" id="faces"></div>
  </section>
  <section class="section">
    <div class="section-head"><h3 data-t="all"></h3><div class="chips" id="filters"></div></div>
    <div class="grid" id="grid"></div>
  </section>
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
  const css = `${PAGE_CSS.trim()}\n${motionCss()}`;
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
    `Wrote ${relative(REPO, OUT)}: ${kb(html.length)} (data ${kb(json.length)}, script ${kb(js.length)}, ` +
      `${AVATARS.length} avatars)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
