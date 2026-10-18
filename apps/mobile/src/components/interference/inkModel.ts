import { createRng, shuffled } from '@sudoku-fight/engine';

import { INK } from './config';
import type { RegionRect } from './effectProps';

/**
 * [D47] "דיו" (`ink`), the plan (spec §7.1 "כתמי דיו שנמחקים בהדרגה", Moshe 2026-10-17): five blots splash over
 * the board one after another, cover about 40 % of it, hold, and fade away over the last 1.5 s. Each blot is a
 * dark ink body with a rim in the sender's colour and a few drops around it. The plan of a hit comes from its
 * seed (the game and the interference's event), so the reduced-motion frame shows the same blots.
 */

export type InkConfig = typeof INK;

export interface InkDrop {
  x: number;
  y: number;
  r: number;
}

export interface InkBlot {
  /** Centre and radius, in the region's coordinates. */
  x: number;
  y: number;
  r: number;
  /** When it lands, ms into the hit. */
  at: number;
  /** Its outline, an SVG path in the region's coordinates (a closed, smooth, uneven circle). */
  path: string;
  drops: readonly InkDrop[];
}

export interface InkPlan {
  blots: readonly InkBlot[];
}

const round = (v: number): number => Math.round(v * 10) / 10;

/** A smooth closed outline through `points` points around (x, y), each at radius r × (0.78 … 1.22). */
function blobPath(x: number, y: number, r: number, points: number, next: () => number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const th = ((i + (next() - 0.5) * 0.5) / points) * Math.PI * 2;
    const k = r * (0.78 + 0.44 * next());
    pts.push([x + Math.cos(th) * k, y + Math.sin(th) * k]);
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const start = mid(pts[points - 1]!, pts[0]!);
  let d = `M${round(start[0])} ${round(start[1])}`;
  for (let i = 0; i < points; i++) {
    const p = pts[i]!;
    const m = mid(p, pts[(i + 1) % points]!);
    d += `Q${round(p[0])} ${round(p[1])} ${round(m[0])} ${round(m[1])}`;
  }
  return `${d}Z`;
}

/** The blots of one hit over `board` (the region's board, or the whole region). */
export function inkPlan(seed: number, board: RegionRect, cfg: InkConfig = INK): InkPlan {
  const rng = createRng(seed ^ 0x1abc5);
  const next = () => rng.next();
  const side = Math.min(board.width, board.height);
  // Spread over the board: each blot in its own ninth of it, so they don't all pile up in one place.
  const areas = shuffled(rng, [0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, cfg.blots);
  const blots = areas.map((area, i): InkBlot => {
    const r = side * (cfg.radius[0] + (cfg.radius[1] - cfg.radius[0]) * next());
    const col = area % 3;
    const row = Math.floor(area / 3);
    const x = board.x + (board.width * (col + 0.2 + 0.6 * next())) / 3;
    const y = board.y + (board.height * (row + 0.2 + 0.6 * next())) / 3;
    const drops: InkDrop[] = [];
    for (let k = 0; k < cfg.droplets; k++) {
      const th = next() * Math.PI * 2;
      const away = r * (1.15 + 0.3 * next());
      drops.push({
        x: round(x + Math.cos(th) * away),
        y: round(y + Math.sin(th) * away),
        r: round(r * (0.07 + 0.07 * next())),
      });
    }
    return {
      x: round(x),
      y: round(y),
      r: round(r),
      at: cfg.firstMs + i * cfg.staggerMs,
      path: blobPath(x, y, r, cfg.points, next),
      drops,
    };
  });
  return { blots };
}

/** A blot at `t` ms into a hit of `totalMs`: its scale (about its centre) and opacity, before the hit's fade. */
export function inkPose(
  blot: Pick<InkBlot, 'at'>,
  t: number,
  totalMs: number,
  splatMs: number = INK.splatMs,
  fadeMs: number = INK.fadeMs,
): { scale: number; opacity: number } {
  'worklet';
  const local = t - blot.at;
  if (local < 0) return { scale: 0.25, opacity: 0 };
  // The splat: 0.25 → 1.08 by 65 % of it, then back to 1.
  let scale = 1;
  if (local < splatMs) {
    const p = local / splatMs;
    scale = p < 0.65 ? 0.25 + (1.08 - 0.25) * (1 - (1 - p / 0.65) ** 2) : 1.08 - 0.08 * ((p - 0.65) / 0.35);
  }
  const appear = Math.min(1, local / 80);
  // Wiped away over the last `fadeMs`: fainter, and a little smaller.
  const left = Math.max(0, Math.min(1, (totalMs - t) / fadeMs));
  return { scale: scale * (0.85 + 0.15 * left), opacity: appear * left };
}

/** The rumble of an ink hit: a light knock as each blot lands. */
export function inkRumble(totalMs: number, cfg: InkConfig = INK): number[] {
  const times: number[] = [];
  for (let i = 0; i < cfg.blots; i++) {
    const at = cfg.firstMs + i * cfg.staggerMs;
    if (at > 0 && at < totalMs) times.push(at);
  }
  return times;
}

/** How much of the board the blots cover, roughly (their discs, overlaps counted once on a grid). */
export function inkCoverage(plan: InkPlan, board: RegionRect, step = 4): number {
  let inside = 0;
  let all = 0;
  for (let y = board.y + step / 2; y < board.y + board.height; y += step) {
    for (let x = board.x + step / 2; x < board.x + board.width; x += step) {
      all += 1;
      if (plan.blots.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r)) inside += 1;
    }
  }
  return all ? inside / all : 0;
}
