// Builds the placeholder sound effects (docs/design/motion.md §8) into assets/sounds/placeholder/<sound>.wav,
// until the final CC0 files arrive (work plan, stage 4). Every sound is synthesised here from sine, triangle
// and noise voices: no third-party material, so no license to clear. A seeded PRNG drives the noise, so a
// re-run writes byte-identical files.
// Format: mono, 16-bit PCM, 22.05 kHz, shorter than 0.4 s (so under 20 KB), peak at -2 dBFS.
//   node apps/mobile/scripts/gen-placeholder-sounds.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', '..', 'assets', 'sounds', 'placeholder');

const RATE = 22050;
const MAX_SECONDS = 0.39;
const PEAK = 0.8; // about -2 dBFS
const TAU = Math.PI * 2;

/** mulberry32: a small deterministic PRNG in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pitch path: a number, or [[t0..1, hz], ...] interpolated in log frequency. */
function pitchAt(path, x) {
  if (typeof path === 'number') return path;
  for (let i = 1; i < path.length; i++) {
    const [x1, f1] = path[i];
    const [x0, f0] = path[i - 1];
    if (x <= x1) return f0 * (f1 / f0) ** ((x - x0) / (x1 - x0 || 1));
  }
  return path[path.length - 1][1];
}

const WAVES = {
  sine: (p) => Math.sin(p),
  triangle: (p) => (2 / Math.PI) * Math.asin(Math.sin(p)),
  // A rounded square: odd harmonics 1..7, so it buzzes without aliasing.
  soft: (p) => (Math.sin(p) + Math.sin(3 * p) / 3 + Math.sin(5 * p) / 5 + Math.sin(7 * p) / 7) * 0.8,
};

/** Envelope: linear attack, exponential decay, and a 6 ms release at the end of the voice. */
function envelope(t, dur, attack, decay) {
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  const d = t > attack ? Math.exp(-(t - attack) / decay) : 1;
  const r = Math.min(1, (dur - t) / 0.006);
  return a * d * Math.max(0, r);
}

/** A pitched voice. `partials` are [ratio, amplitude] pairs over the fundamental (bells, chimes). */
function tone(buf, o) {
  const { f, at = 0, dur, gain = 0.5, attack = 0.003, decay = dur / 3, wave = 'sine' } = o;
  const { partials = [[1, 1]], vib = 0, vibRate = 6 } = o;
  const start = Math.round(at * RATE);
  const n = Math.min(Math.round(dur * RATE), buf.length - start);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const hz = pitchAt(f, t / dur) + vib * Math.sin(TAU * vibRate * t);
    phase += (TAU * hz) / RATE;
    let s = 0;
    for (const [ratio, amp] of partials) s += amp * WAVES[wave](phase * ratio);
    buf[start + i] += gain * envelope(t, dur, attack, decay) * s;
  }
}

/** A noise voice through a one-pole low-pass whose cutoff follows `lp` (a pitch path), optionally high-passed. */
function noise(buf, random, o) {
  const { at = 0, dur, gain = 0.4, attack = 0.001, decay = dur / 3, lp = 8000, hp = false } = o;
  const start = Math.round(at * RATE);
  const n = Math.min(Math.round(dur * RATE), buf.length - start);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const k = 1 - Math.exp((-TAU * pitchAt(lp, t / dur)) / RATE);
    const white = random() * 2 - 1;
    low += k * (white - low);
    const s = hp ? white - low : low;
    buf[start + i] += gain * envelope(t, dur, attack, decay) * s;
  }
}

/** Note frequencies (equal temperament, A4 = 440). */
const N = { C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5 };

/** A pitch path from flat pairs: path(0, 520, 0.35, 820, 1, 480). `glide(a, b)` is path(0, a, 1, b). */
const path = (...xs) => xs.flatMap((x, i) => (i % 2 ? [] : [[x, xs[i + 1]]]));
const glide = (from, to) => path(0, from, 1, to);
/** Partials from flat pairs: harm(1, 1, 2, 0.25) = the fundamental and a quiet octave. */
const harm = path;
const BELL = harm(1, 1, 2.76, 0.22, 5.4, 0.06);
const GONG = harm(1, 1, 1.48, 0.6, 2, 0.45, 2.76, 0.3, 3.9, 0.12);

/** The 30 sounds of motion.md §8, keyed by their file name. Each entry: [length in s, draw(buf, random)]. */
const SOUNDS = {
  // Board
  cell_select: [
    0.06,
    (b, r) => {
      tone(b, { f: 1250, dur: 0.05, gain: 0.6, attack: 0.001, decay: 0.012, partials: harm(1, 1, 2.7, 0.3) });
      noise(b, r, { dur: 0.012, gain: 0.25, decay: 0.003, lp: 4000 });
    },
  ],
  cell_denied: [
    0.14,
    (b, r) => {
      tone(b, { f: glide(190, 120), dur: 0.14, gain: 0.8, decay: 0.04, wave: 'triangle' });
      noise(b, r, { dur: 0.03, gain: 0.3, decay: 0.01, lp: 600 });
    },
  ],
  cell_release: [
    0.12,
    (b) => tone(b, { f: glide(700, 1050), dur: 0.11, gain: 0.5, attack: 0.08, decay: 0.5 }),
  ],
  correct: [
    0.38,
    (b) => {
      tone(b, { f: N.B5, dur: 0.09, gain: 0.45, decay: 0.05, partials: harm(1, 1, 2, 0.25) });
      const ding = harm(1, 1, 2, 0.3, 3, 0.08);
      tone(b, { f: 1318.5, at: 0.07, dur: 0.31, gain: 0.55, decay: 0.12, partials: ding });
      tone(b, { f: 2637, at: 0.07, dur: 0.2, gain: 0.15, decay: 0.05 });
    },
  ],
  count_tick: [0.03, (b) => tone(b, { f: 2100, dur: 0.025, gain: 0.6, attack: 0.001, decay: 0.006 })],
  wrong: [
    0.18,
    (b) => {
      tone(b, { f: 150, dur: 0.17, gain: 0.5, attack: 0.005, decay: 0.08, wave: 'soft' });
      tone(b, { f: 155, dur: 0.17, gain: 0.3, attack: 0.005, decay: 0.08, wave: 'soft' });
    },
  ],
  lock_tick: [
    0.05,
    (b, r) => {
      noise(b, r, { dur: 0.008, gain: 0.5, decay: 0.002, lp: 2000, hp: true });
      tone(b, { f: 3200, dur: 0.02, gain: 0.35, attack: 0.001, decay: 0.004 });
      tone(b, { f: 1600, dur: 0.03, gain: 0.25, attack: 0.001, decay: 0.008 });
    },
  ],
  lead_take: [
    0.22,
    (b, r) => {
      tone(b, { f: glide(520, 1040), dur: 0.2, gain: 0.45, attack: 0.02, decay: 0.1 });
      noise(b, r, { dur: 0.2, gain: 0.15, attack: 0.05, decay: 0.06, lp: glide(1000, 4000) });
    },
  ],
  lead_lose: [
    0.22,
    (b, r) => {
      tone(b, { f: glide(1040, 520), dur: 0.2, gain: 0.45, attack: 0.02, decay: 0.1 });
      noise(b, r, { dur: 0.2, gain: 0.15, attack: 0.05, decay: 0.06, lp: glide(4000, 1000) });
    },
  ],

  // Interferences
  arsenal_open: [
    0.24,
    (b, r) => noise(b, r, { dur: 0.22, gain: 0.5, attack: 0.05, decay: 0.1, lp: glide(800, 3000) }),
  ],
  interfere_whoosh: [
    0.36,
    (b, r) => {
      const sweep = path(0, 500, 0.5, 2500, 1, 900);
      noise(b, r, { dur: 0.35, gain: 0.6, attack: 0.15, decay: 0.12, lp: sweep });
    },
  ],
  interfere_launch: [
    0.36,
    (b, r) => {
      tone(b, { f: glide(120, 45), dur: 0.3, gain: 0.8, decay: 0.09 });
      noise(b, r, { dur: 0.3, gain: 0.5, decay: 0.07, lp: glide(3000, 400) });
    },
  ],
  hit_fireworks: [
    0.39,
    (b, r) => {
      for (let i = 0; i < 9; i++) {
        const at = (i / 9) * 0.33 + r() * 0.02;
        noise(b, r, { at, dur: 0.04, gain: 0.4 + r() * 0.3, decay: 0.008, lp: 3000 + r() * 3000 });
      }
      tone(b, { f: glide(900, 300), dur: 0.12, gain: 0.2, decay: 0.04 });
    },
  ],
  hit_cats: [
    0.39,
    (b) => {
      const meow = {
        f: path(0, 520, 0.35, 820, 1, 480),
        wave: 'triangle',
        partials: harm(1, 1, 2, 0.35, 3, 0.15),
      };
      tone(b, { ...meow, dur: 0.37, gain: 0.55, attack: 0.03, decay: 0.2, vib: 15, vibRate: 7 });
    },
  ],
  hit_warp: [
    0.39,
    (b) => {
      tone(b, {
        f: 330,
        dur: 0.38,
        gain: 0.5,
        attack: 0.02,
        decay: 0.3,
        wave: 'triangle',
        vib: 80,
        vibRate: 11,
      });
      tone(b, { f: 495, dur: 0.38, gain: 0.25, attack: 0.02, decay: 0.3, vib: 60, vibRate: 13 });
    },
  ],

  // Reactions (received from an opponent)
  react_laugh: [
    0.33,
    (b) => {
      const ha = { dur: 0.08, gain: 0.5, decay: 0.03, wave: 'triangle', vib: 20, vibRate: 30 };
      [760, 700, 640].forEach((f, i) => tone(b, { ...ha, f, at: i * 0.1 }));
    },
  ],
  react_scream: [
    0.32,
    (b) => {
      const rise = { f: glide(600, 1500), wave: 'triangle', vib: 30, vibRate: 9 };
      tone(b, { ...rise, dur: 0.3, gain: 0.5, attack: 0.02, decay: 0.25 });
    },
  ],
  react_cool: [
    0.26,
    (b, r) => {
      noise(b, r, { dur: 0.015, gain: 0.7, decay: 0.003, lp: 2500, hp: true });
      tone(b, { f: N.G5, at: 0.06, dur: 0.2, gain: 0.4, decay: 0.08, partials: harm(1, 1, 2, 0.3) });
      tone(b, { f: N.B5, at: 0.06, dur: 0.2, gain: 0.3, decay: 0.08 });
    },
  ],
  react_facepalm: [
    0.2,
    (b, r) => {
      noise(b, r, { dur: 0.08, gain: 0.7, decay: 0.02, lp: 1200 });
      tone(b, { f: glide(210, 150), dur: 0.12, gain: 0.4, decay: 0.04 });
    },
  ],
  react_fire: [
    0.34,
    (b, r) => {
      noise(b, r, { dur: 0.33, gain: 0.6, attack: 0.12, decay: 0.15, lp: glide(300, 1800) });
      tone(b, { f: 90, dur: 0.3, gain: 0.2, attack: 0.05, decay: 0.15 });
    },
  ],
  react_eyes: [
    0.32,
    (b) => tone(b, { f: glide(260, 620), dur: 0.3, gain: 0.55, decay: 0.14, vib: 40, vibRate: 14 }),
  ],
  react_pop: [0.1, (b) => tone(b, { f: glide(500, 1300), dur: 0.07, gain: 0.6, decay: 0.02 })],

  // Match, connection and UI
  match_found: [
    0.38,
    (b) => {
      tone(b, { f: N.G5, dur: 0.2, gain: 0.5, decay: 0.08, partials: BELL });
      tone(b, { f: N.C6, at: 0.13, dur: 0.25, gain: 0.55, decay: 0.1, partials: BELL });
    },
  ],
  countdown_beat: [
    0.26,
    (b, r) => {
      tone(b, { f: glide(120, 55), dur: 0.25, gain: 0.9, decay: 0.07 });
      noise(b, r, { dur: 0.04, gain: 0.35, decay: 0.01, lp: 2000 });
    },
  ],
  go: [
    0.39,
    (b, r) => {
      tone(b, { f: 196, dur: 0.39, gain: 0.6, attack: 0.006, decay: 0.18, partials: GONG });
      noise(b, r, { at: 0.05, dur: 0.34, gain: 0.15, attack: 0.1, decay: 0.2, lp: 1500 });
    },
  ],
  win: [
    0.39,
    (b) => {
      const note = { dur: 0.1, gain: 0.4, decay: 0.06, wave: 'triangle' };
      [N.C5, N.E5, N.G5].forEach((f, i) => tone(b, { ...note, f, at: i * 0.07 }));
      tone(b, { f: N.C6, at: 0.21, dur: 0.18, gain: 0.45, decay: 0.12, wave: 'triangle' });
    },
  ],
  lose: [
    0.38,
    (b) => {
      const note = { dur: 0.16, gain: 0.5, decay: 0.08, partials: harm(1, 1, 2, 0.2) };
      [N.G4, N.E4, N.C4].forEach((f, i) => tone(b, { ...note, f, at: i * 0.11 }));
    },
  ],
  disconnect: [
    0.32,
    (b) => {
      const partials = harm(1, 1, 3, 0.1);
      tone(b, { f: 660, dur: 0.13, gain: 0.5, decay: 0.06, partials });
      tone(b, { f: 440, at: 0.15, dur: 0.16, gain: 0.5, decay: 0.07, partials });
    },
  ],
  reconnect: [
    0.32,
    (b) => {
      const partials = harm(1, 1, 3, 0.1);
      tone(b, { f: 440, dur: 0.13, gain: 0.5, decay: 0.06, partials });
      tone(b, { f: 660, at: 0.15, dur: 0.16, gain: 0.5, decay: 0.07, partials });
    },
  ],
  ui_tap: [
    0.045,
    (b, r) => {
      tone(b, { f: 900, dur: 0.04, gain: 0.5, attack: 0.001, decay: 0.008 });
      noise(b, r, { dur: 0.005, gain: 0.2, decay: 0.0015, lp: 3000 });
    },
  ],
};

/** 16-bit mono PCM WAV with the canonical 44-byte header. */
function wav(samples) {
  const data = samples.length * 2;
  const out = Buffer.alloc(44 + data);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + data, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(data, 40);
  samples.forEach((s, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return out;
}

/** Renders one sound: draw, normalise to PEAK, fade the last 8 ms so nothing clicks. */
export function render(name) {
  const [seconds, draw] = SOUNDS[name];
  if (seconds > MAX_SECONDS) throw new Error(`${name}: ${seconds}s is longer than ${MAX_SECONDS}s`);
  const buf = new Float32Array(Math.round(seconds * RATE));
  draw(buf, rng([...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)));
  const peak = buf.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
  const fade = Math.round(0.008 * RATE);
  return wav(buf.map((s, i) => (s / peak) * PEAK * Math.min(1, (buf.length - 1 - i) / fade)));
}

export const SOUND_NAMES = Object.keys(SOUNDS);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(target, { recursive: true });
  for (const old of readdirSync(target)) if (old.endsWith('.wav')) rmSync(join(target, old));
  const seen = new Map();
  for (const name of SOUND_NAMES) {
    const bytes = render(name);
    const hash = createHash('sha1').update(bytes).digest('hex');
    if (seen.has(hash)) throw new Error(`${name} is identical to ${seen.get(hash)}`);
    seen.set(hash, name);
    writeFileSync(join(target, `${name}.wav`), bytes);
    console.log(`${name}.wav  ${bytes.length} bytes`);
  }
  console.log(`Wrote ${SOUND_NAMES.length} files to ${target}`);
}
