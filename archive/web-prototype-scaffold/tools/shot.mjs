// Headless screenshot + console capture using the locally installed Microsoft Edge.
// Requires the dev server (node tools/serve.mjs) running on :5178.
//
// Usage:
//   node tools/shot.mjs --hash home --out shots/home.png
//   node tools/shot.mjs --hash game~2p --lang en --w 390 --h 844 --wait 1500 --out shots/game.png
//   node tools/shot.mjs --hash game~2p --steps shots/steps.json --out shots/game.png
//
// Options:
//   --hash   route token (screen or screen~demo). Default: home
//   --lang   he | en (default he)
//   --w/--h  viewport (default 390x844 = phone; studio chrome hides below 700px)
//   --dsf    device scale factor (default 1)
//   --wait   ms to wait after load before steps/shot (default 1200)
//   --eval   JS to evaluate in page before the shot (after wait)
//   --steps  JSON file: [{ "click": "css" } | { "wait": ms } | { "eval": "js" } | { "shot": "path.png" }
//                         | { "drag": ["fromCss", "toCss"] } | { "key": "Enter" } | { "type": ["css","text"] }]
//   --out    output PNG (default shots/shot.png). Use --no-shot to skip.
//   --full   full-page screenshot
//   --reduced  emulate prefers-reduced-motion
// Prints console errors / page errors to stdout so agents can catch runtime failures.
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

const hash = opt('hash', 'home');
const lang = opt('lang', 'he');
const w = Number(opt('w', 390)), h = Number(opt('h', 844));
const dsf = Number(opt('dsf', 1));
const waitMs = Number(opt('wait', 1200));
const out = opt('out', 'shots/shot.png');
const evalJs = opt('eval', null);
const stepsFile = opt('steps', null);
const port = Number(opt('port', 5178));

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = existsSync(EDGE) ? EDGE : CHROME;

const browser = await chromium.launch({ executablePath, headless: true });
const ctx = await browser.newContext({
  viewport: { width: w, height: h }, deviceScaleFactor: dsf,
  reducedMotion: flag('reduced') ? 'reduce' : 'no-preference',
  hasTouch: w < 700,
});
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

// Language is applied before boot via localStorage so the first frame renders in the right direction.
await page.addInitScript((l) => { try { const k = 'sf.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.lang = l; localStorage.setItem(k, JSON.stringify(s)); } catch {} }, lang);
await page.goto(`http://localhost:${port}/index.html#${hash}`, { waitUntil: 'load' });
await page.waitForTimeout(waitMs);

if (stepsFile) {
  const steps = JSON.parse(await readFile(stepsFile, 'utf8'));
  for (const s of steps) {
    try {
      if (s.click) await page.click(s.click, { timeout: 4000 });
      else if (s.wait) await page.waitForTimeout(s.wait);
      else if (s.eval) console.log('[eval]', JSON.stringify(await page.evaluate(s.eval)));
      else if (s.key) await page.keyboard.press(s.key);
      else if (s.type) await page.fill(s.type[0], s.type[1]);
      else if (s.drag) {
        const a = await page.locator(s.drag[0]).first().boundingBox();
        const b = await page.locator(s.drag[1]).first().boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2) - (a.x + a.width / 2)) * i / 12, a.y + a.height / 2 + ((b.y + b.height / 2) - (a.y + a.height / 2)) * i / 12);
        if (s.shotMid) { await mkdir(dirname(s.shotMid), { recursive: true }); await page.screenshot({ path: s.shotMid }); }
        await page.mouse.up();
      } else if (s.shot) { await mkdir(dirname(s.shot), { recursive: true }); await page.screenshot({ path: s.shot, fullPage: flag('full') }); console.log('saved', s.shot); }
    } catch (e) { problems.push(`[step failed] ${JSON.stringify(s)} → ${e.message.split('\n')[0]}`); }
  }
}
if (evalJs) { try { console.log('[eval]', JSON.stringify(await page.evaluate(evalJs))); } catch (e) { problems.push('[eval failed] ' + e.message); } }
if (!flag('no-shot')) {
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, fullPage: flag('full') });
  console.log('saved', out);
}
if (problems.length) { console.log('--- problems ---'); for (const p of problems) console.log(p); } else console.log('no console errors');
await browser.close();
