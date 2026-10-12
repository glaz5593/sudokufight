/**
 * The visual check loop (docs/avatars/STYLE.md, "Check what you draw"): contact sheets and motion filmstrips.
 *
 *   npm run sheet -w @sudoku-fight/avatars -- [ids…] [--fixtures] [--out <dir>] [--shoot]
 *
 * For each avatar (default: all) it writes, to <dir> (default: <os temp>/sfa-sheets, never the repo):
 * - sheet-<id>.html: every expression at 160, 48 and 24 px (plus the head crop) on the dark app and the light
 *   board, and 24/48 px again at 3x (a phone's real pixels);
 * - film-<id>.html: every motion as 10 frames, sampled from the same data the app and the CSS play;
 * - gimmicks-<id>.html (avatars with gimmicks): every gimmick anim as 10 frames over one run, on the face that
 *   triggers it, sampled with sampleGimmick (what the app plays).
 * With --shoot it screenshots each page with headless Chrome to a .png next to it: open the PNGs and look.
 * --fixtures adds the demo characters of src/testing/fixtures.ts (one per rig and gimmick option).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AVATARS,
  type AvatarDef,
  type Expression,
  EXPRESSIONS,
  faceChanges,
  gimmickAnims,
  MOTION_IDS,
  MOTIONS,
  type MotionId,
  motionOrigin,
  poseMatrix,
  renderAvatar,
  resolveMotion,
  sampleGimmick,
  sampleTrack,
} from '../src';
import { FIXTURES } from '../src/testing/fixtures';

const ids: string[] = [];
let OUT = join(tmpdir(), 'sfa-sheets');
let shoot = false;
let fixtures = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i] ?? '';
  if (a === '--out') OUT = resolve(args[++i] ?? '.');
  else if (a === '--shoot') shoot = true;
  else if (a === '--fixtures') fixtures = true;
  else ids.push(a);
}

const GROUNDS = { app: '#0f1218', board: '#f7f8fa' };
const page = (body: string, bg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;background:${bg};` +
  `font:12px system-ui,sans-serif;color:#9aa3b5}.row{display:flex;gap:10px;align-items:center;margin-bottom:10px}` +
  `.cell{text-align:center}.label{width:70px;flex:none}</style></head><body>${body}</body></html>`;

function row(
  def: AvatarDef,
  size: number,
  crop: 'tile' | 'head',
  tag: string,
  captions: boolean,
  note = '',
): string {
  const cells = EXPRESSIONS.map(
    (e) =>
      `<div class="cell">${renderAvatar(def, { expression: e, size, crop, idPrefix: `${tag}-${e}` })}` +
      `${captions ? `<div>${e}</div>` : ''}</div>`,
  ).join('');
  return `<div class="row"><div class="label">${size}${crop === 'head' ? ' head' : ''}${note}</div>${cells}</div>`;
}

function sheet(def: AvatarDef): string {
  let body = '';
  for (const [name, bg] of Object.entries(GROUNDS)) {
    body += `<div style="background:${bg};padding:10px;margin:-2px -2px 10px">`;
    body += row(def, 160, 'tile', `${name}-160`, true);
    body += row(def, 48, 'tile', `${name}-48`, false);
    body += row(def, 24, 'tile', `${name}-24`, false);
    if (def.headBox) {
      body += row(def, 48, 'head', `${name}-h48`, false);
      body += row(def, 24, 'head', `${name}-h24`, false);
    }
    body += '</div>';
  }
  // A phone draws 24 pt with 3 px per point: the same sizes, zoomed 3x, crisp.
  body += `<div style="zoom:3">`;
  body += row(def, 24, 'tile', 'x3-24', false, ' ×3');
  if (def.headBox) body += row(def, 24, 'head', 'x3-h24', false, ' ×3');
  body += '</div>';
  return page(body, '#0f1218');
}

const matrix = (pose: Parameters<typeof poseMatrix>[0], origin: { x: number; y: number }) =>
  `transform="matrix(${poseMatrix(pose, origin)
    .map((v) => v.toFixed(3))
    .join(' ')})"`;

function film(def: AvatarDef): string {
  const frames = 10;
  let body = '';
  for (const id of MOTION_IDS) {
    const m = resolveMotion(def, id);
    body += `<div class="row"><div class="label">${id}${m.id !== id ? ` → ${m.id}` : ''}</div>`;
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      let face: Expression | 'base' = 'neutral';
      for (const c of faceChanges(m)) if (c.atMs <= t * m.durationMs) face = c.expression;
      let svg = renderAvatar(def, {
        expression: face === 'base' ? 'neutral' : face,
        size: 110,
        idPrefix: `${id}-${i}`,
      });
      for (const tr of m.tracks) {
        const pose = sampleTrack(tr, t, m.ease);
        if (tr.target === 'eyes')
          // every eye around its own centre (rig.ts drawEyes puts it on the eye's group)
          svg = svg.replace(
            /<g class="sfa-eye" style="--sfa-eyes:([\d.]+)px ([\d.]+)px">/g,
            (g: string, x: string, y: string) =>
              g.replace(
                '<g ',
                `<g ${matrix(pose, tr.origin === 'eyes' ? { x: +x, y: +y } : motionOrigin(def, tr.origin))} `,
              ),
          );
        else
          svg = svg.replace(
            `class="sfa-${tr.target}"`,
            `class="sfa-${tr.target}" ${matrix(pose, motionOrigin(def, tr.origin))}`,
          );
      }
      body += svg;
    }
    body += '</div>';
  }
  return page(body, '#0f1218');
}

/** The face a gimmick anim shows on: its first expression trigger, else its motion's face, else neutral. */
function faceFor(trigger: readonly string[]): Expression {
  for (const t of trigger) if ((EXPRESSIONS as readonly string[]).includes(t)) return t as Expression;
  for (const t of trigger) {
    const m = (MOTION_IDS as readonly string[]).includes(t) ? MOTIONS[t as MotionId] : undefined;
    if (m?.expression) return m.expression;
  }
  return 'neutral';
}

function gimmickFilm(def: AvatarDef): string {
  const frames = 10;
  let body = '';
  for (const g of def.gimmicks ?? [])
    gimmickAnims(g).forEach((anim, i) => {
      const face = faceFor(anim.trigger);
      body +=
        `<div class="row"><div class="label">${g.id}${gimmickAnims(g).length > 1 ? ` #${i}` : ''}<br>` +
        `${anim.trigger.join(', ')}${anim.loop ? ' ↻' : ''}</div>`;
      for (let k = 0; k < frames; k++) {
        const p = sampleGimmick(anim, k / (frames - 1));
        const svg = renderAvatar(def, {
          expression: face,
          size: 110,
          idPrefix: `g-${g.id}-${i}-${k}`,
        }).replace(
          new RegExp(`<g class="sfa-gimmick sfa-g-${g.id}"(?: opacity="0")?>`),
          `<g class="sfa-gimmick sfa-g-${g.id}" ${matrix(p, anim.origin)} opacity="${p.opacity.toFixed(3)}">`,
        );
        body += svg;
      }
      body += '</div>';
    });
  return page(body, '#0f1218');
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

function screenshot(html: string, png: string, width: number, height: number): void {
  if (!CHROME) throw new Error('Chrome not found: open the HTML files in a browser instead.');
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--screenshot=${png}`,
      pathToFileURL(html).href,
    ],
    { stdio: 'ignore' },
  );
}

const pool = fixtures ? [...AVATARS, ...FIXTURES] : AVATARS;
const chosen = ids.length ? pool.filter((a) => ids.includes(a.id)) : fixtures ? FIXTURES : AVATARS;
const unknown = ids.filter((id) => !pool.some((a) => a.id === id));
if (unknown.length) console.warn(`Unknown avatar ids: ${unknown.join(', ')}`);
mkdirSync(OUT, { recursive: true });
for (const def of chosen) {
  const files = [
    {
      name: `sheet-${def.id}`,
      html: sheet(def),
      w: 140 + EXPRESSIONS.length * 172,
      h: def.headBox ? 1560 : 1300,
    },
    { name: `film-${def.id}`, html: film(def), w: 1240, h: 1100 },
  ];
  const anims = (def.gimmicks ?? []).reduce((n, g) => n + gimmickAnims(g).length, 0);
  if (anims) files.push({ name: `gimmicks-${def.id}`, html: gimmickFilm(def), w: 1240, h: 40 + anims * 124 });
  for (const f of files) {
    const html = join(OUT, `${f.name}.html`);
    writeFileSync(html, f.html);
    if (shoot) {
      const png = join(OUT, `${f.name}.png`);
      screenshot(html, png, f.w, f.h);
      console.log(png);
    } else console.log(html);
  }
}
