import { type BotConfig, botPlayer, levelBotConfig, type MsRange } from '../../bot/levels';
import { attachBot } from '../../bot/runner';
import { LocalGameHost } from '../../game/host';
import type { PlayerInfo } from '../../game/types';
import { boxOf, CELL_COUNT, type CellIndex, colOf, type Digit, type Grid, rowOf } from '../../sudoku/board';
import { knowablePlacements } from '../../sudoku/reading';
import { missedPoints, moveScore } from '../../sudoku/scoring';
import { ManualClock } from '../../util/clock';
import { createRng, pick, type Rng, seedFromString, shuffled } from '../../util/random';
import { ManualScheduler } from '../../util/scheduler';
import { applyFind, createFind, type FindState, nextFindDeadline, tickFind } from '../find';
import { actOf } from '../levels.config';
import { LEVEL_RULES, levelOutcome, levelStars } from '../progress';
import {
  type FindTarget,
  LEVEL_PENALTY_MS,
  levelGameConfig,
  type LevelSpec,
  type LevelSpecOf,
  type Stars,
} from '../spec';
import { starsFor } from '../stars';
import { boxEmpties, withoutNeeded } from './common';
import {
  type PlayerProfile,
  PROFILE_IDS,
  type ProfileId,
  PROFILES,
  SEARCH_FACTORS,
  TARGET_STARS,
  TARGET_TOLERANCE,
  type ModelNumber,
  modelNumbers,
} from './profiles';

/**
 * The profile simulation (plan §4.4; dev-plan §2ד): how many stars a casual, a good and an excellent player
 * get on their first attempt at each level, against the targets per act. It warns; it never fails a build.
 *
 * - The tap kinds (find, the race, spot the error) play the tap engine itself (levels/find.ts) with the
 *   level's bot, the player's taps drawn from the profile.
 * - fillBox and the duel play LocalGameHost, the player's seat played by a bot whose level row is the
 *   profile (its think time and mistakes; the bot's own difficulty model stretches hard cells), the duel's
 *   bot by levelBotConfig of the level's pace, as on the phone.
 * - The point hunter and the chain are a Monte Carlo of the profile's move or step times and mistakes.
 * Deterministic per seed: each level and profile draws from its own seed.
 */

export const DEFAULT_RUNS = 100;

const ME: PlayerInfo = { id: 'me', name: 'Me' };

const draw = (rng: Rng, r: MsRange): number => r.min + rng.next() * (r.max - r.min);

/** How many wrong tries before the right one: each with the profile's chance, at most `max`. */
function wrongTries(rng: Rng, share: number, max: number): number {
  let n = 0;
  while (n < max && rng.next() < share) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// The tap kinds

interface Tap {
  at: number;
  cell: CellIndex;
}

/** The cells of a target's scope that are empty and wrong: where a wrong tap goes. */
function wrongCells(grid: Grid, t: FindTarget): CellIndex[] {
  const out: CellIndex[] = [];
  for (let c = 0; c < CELL_COUNT; c++) {
    if (grid[c] !== 0 || t.accept.includes(c)) continue;
    const s = t.scope;
    const inScope =
      s.kind === 'board' ||
      (s.kind === 'box' ? boxOf(c) : s.kind === 'row' ? rowOf(c) : colOf(c)) === s.index;
    if (inScope) out.push(c);
  }
  return out;
}

/** A target's search: the profile's, by its scope, tier and box. */
function searchMs(rng: Rng, p: PlayerProfile, grid: Grid, t: FindTarget): number {
  const f = SEARCH_FACTORS;
  const cell = t.cell ?? t.accept[0]!;
  const empties = Math.max(0, boxEmpties(grid, boxOf(cell)) - 3);
  return draw(rng, p.findMs) * f.scope[t.scope.kind] * f.tier[t.tier] * (1 + f.perEmpty * empties);
}

/** My taps on the target shown at `now`: maybe wrong ones first (at 30–80% of the search), then the right one. */
function tapsFor(
  rng: Rng,
  p: PlayerProfile,
  state: FindState,
  t: FindTarget,
  now: number,
  maxWrong: number,
): Tap[] {
  const search = searchMs(rng, p, state.grid, t);
  const wrong = wrongCells(state.grid, t);
  const taps: Tap[] = [];
  const n = wrong.length ? wrongTries(rng, p.mistakeShare, maxWrong) : 0;
  for (let k = 0; k < n; k++)
    taps.push({ at: now + search * (0.3 + 0.5 * rng.next()), cell: pick(rng, wrong) });
  taps.sort((a, b) => a.at - b.at);
  const right = t.cell ?? pick(rng, knownOrAny(state.grid, t));
  taps.push({ at: now + search, cell: right });
  return taps;
}

/** The whole board: a tap goes to a cell the logic knows (with every technique), else any accepted one. */
function knownOrAny(grid: Grid, t: FindTarget): CellIndex[] {
  const known = knowablePlacements(grid).filter((k) => t.accept.includes(k.cell) && k.digit === t.digit);
  return known.length ? known.map((k) => k.cell) : [...t.accept];
}

/** Plays a tap level to its end: `plan` gives my taps each time a new target shows (or once, for spotError). */
function playTap(
  spec: LevelSpecOf<'find' | 'findDuel' | 'spotError'>,
  rng: Rng,
  plan: (state: FindState, now: number) => Tap[],
): Stars {
  let { state } = createFind(
    { id: `sim-${spec.id}`, spec, player: ME },
    { clock: new ManualClock(0), attempt: 1, rng },
  );
  state = applyFind(state, { type: 'start' }, 0).state;
  let now = 0;
  let shown = -1;
  let taps: Tap[] = [];
  for (let guard = 0; guard < 500 && state.status !== 'over'; guard++) {
    if (state.spot !== shown) {
      shown = state.spot;
      taps = plan(state, now);
    }
    const due = nextFindDeadline(state) ?? Infinity;
    const tap = taps[0];
    if (tap && tap.at <= due) {
      now = Math.max(now, tap.at);
      const r = applyFind(state, { type: 'tap', playerId: ME.id, cell: tap.cell }, now);
      state = r.state;
      taps.shift();
      // Frozen after a wrong tap: the same tap once the freeze is over.
      const me = state.players[0]!;
      if (r.rejected === 'frozen' && me.frozenUntil !== null && !me.out)
        taps.unshift({ ...tap, at: me.frozenUntil });
    } else if (due !== Infinity) {
      now = due;
      state = tickFind(state, now).state;
    } else break;
  }
  return state.result ? levelOutcome(spec, state.result).stars : 0;
}

function simFind(spec: LevelSpecOf<'find'>, p: PlayerProfile, rng: Rng): Stars {
  return playTap(spec, rng, (state, now) => tapsFor(rng, p, state, spec.targets.target, now, 2));
}

function simRace(spec: LevelSpecOf<'findDuel'>, p: PlayerProfile, rng: Rng): Stars {
  return playTap(spec, rng, (state, now) => tapsFor(rng, p, state, spec.targets.spots[state.spot]!, now, 2));
}

function simSpotError(spec: LevelSpecOf<'spotError'>, p: PlayerProfile, rng: Rng): Stars {
  return playTap(spec, rng, (state) => {
    const errors = new Set(spec.targets.errors.map((e) => e.cell));
    const right: CellIndex[] = [];
    for (let c = 0; c < CELL_COUNT; c++) if (state.owner[c] === 0 && !errors.has(c)) right.push(c);
    let t = 0;
    const taps: Tap[] = [];
    for (const e of shuffled(rng, spec.targets.errors)) {
      const ms = draw(rng, p.spotErrorMs) * (e.visible ? 1 : SEARCH_FACTORS.silentFactor);
      const n = right.length ? wrongTries(rng, p.mistakeShare, 3) : 0;
      for (let k = 0; k < n; k++)
        taps.push({ at: t + ms * (0.3 + 0.5 * rng.next()), cell: pick(rng, right) });
      t += ms;
      taps.push({ at: t, cell: e.cell });
    }
    return taps.sort((a, b) => a.at - b.at);
  });
}

// ---------------------------------------------------------------------------------------------------------
// The digit kinds on the game engine

/** The bot config that plays a profile in my seat: its level row is the profile, no lingering, no adaptation. */
function profileBot(think: MsRange, mistakeRate: number): Partial<BotConfig> {
  return {
    ...levelBotConfig(1),
    levels: [
      {
        level: 1,
        name: 'profile',
        avatar: 'hatchling',
        thinkMs: think,
        mistakeRate,
        interference: { maxPerGame: 0, minDeficit: null, chance: 0 },
        reactions: {},
        adaptive: false,
      },
    ],
  };
}

function playGame(spec: LevelSpecOf<'fillBox' | 'duel'>, me: Partial<BotConfig>, rng: Rng): Stars {
  const config = levelGameConfig(spec, { id: `sim-${spec.id}`, player: ME, attempt: 1 });
  const clock = new ManualClock(0);
  const scheduler = new ManualScheduler(clock);
  const host = new LocalGameHost({ config, playerId: ME.id, clock, scheduler });
  const seed = rng.next() * 2 ** 32;
  attachBot(host, { botId: ME.id, level: 1, clock, scheduler, rng: createRng(seed), config: me });
  if (spec.kind === 'duel' && spec.bot) {
    const bot = botPlayer(spec.bot.level);
    attachBot(host, {
      botId: bot.id,
      level: spec.bot.level,
      clock,
      scheduler,
      rng: createRng(seed + 1),
      config: levelBotConfig(spec.bot.pace),
    });
  }
  for (let t = 0; t < LEVEL_RULES.levelMaxMs + 5000 && host.state.status !== 'over'; t += 500)
    scheduler.advance(500);
  const result = host.state.result;
  host.close();
  return result ? levelOutcome(spec, result).stars : 0;
}

// ---------------------------------------------------------------------------------------------------------
// The point hunter and the chain: Monte Carlo

const parse = (text: string): number[] => [...text].map(Number);

function simPointHunter(spec: LevelSpecOf<'pointHunter'>, p: PlayerProfile, rng: Rng): Stars {
  const board = parse(spec.board.grid);
  const solution = parse(spec.board.solution);
  const techniques = spec.check?.techniques;
  let score = 0;
  let t = 0;
  let moves = 0;
  while (moves < spec.targets.maxMoves) {
    t += draw(rng, p.pointMoveMs);
    if (t > spec.timeLimitMs) break;
    const known = knowablePlacements(board, techniques);
    if (!known.length) break;
    const worth = known.map((k) => ({ cell: k.cell, points: moveScore(board, k.cell, k.digit).points }));
    const best = worth.reduce((a, b) => (b.points > a.points ? b : a));
    const cell = rng.next() < p.pointBestShare ? best.cell : pick(rng, worth).cell;
    moves++;
    if (rng.next() < p.mistakeShare) {
      score -= missedPoints(board, cell, solution[cell] as Digit).points;
      continue;
    }
    score += moveScore(board, cell, solution[cell] as Digit).points;
    board[cell] = solution[cell]!;
  }
  return levelStars(spec.stars, moves === spec.targets.maxMoves ? 'completed' : 'timeUp', score, t);
}

function simChain(spec: LevelSpecOf<'chain'>, p: PlayerProfile, rng: Rng): Stars {
  const board = parse(spec.board.grid);
  const solution = parse(spec.board.solution);
  const lean = spec.check ? withoutNeeded(spec.check) : [];
  let t = 0;
  for (const cell of spec.targets.cells) {
    const hard = spec.check?.mustNeed.length && !knowablePlacements(board, lean).some((k) => k.cell === cell);
    t += draw(rng, p.chainStepMs) * (hard ? SEARCH_FACTORS.eliminationFactor : 1);
    t += wrongTries(rng, p.mistakeShare, 3) * LEVEL_PENALTY_MS;
    if (t >= spec.timeLimitMs) return 0;
    board[cell] = solution[cell]!;
  }
  return starsFor(spec.stars, t);
}

// ---------------------------------------------------------------------------------------------------------
// Levels and chapters

/** One first attempt of a profile at a level. */
export function simulateOnce(spec: LevelSpec, p: PlayerProfile, rng: Rng): Stars {
  switch (spec.kind) {
    case 'find':
      return simFind(spec, p, rng);
    case 'findDuel':
      return simRace(spec, p, rng);
    case 'spotError':
      return simSpotError(spec, p, rng);
    case 'fillBox':
      return playGame(spec, profileBot(p.fillBoxCellMs, p.mistakeShare), rng);
    case 'duel':
      return playGame(spec, profileBot(p.duelMoveMs, p.mistakeShare), rng);
    case 'pointHunter':
      return simPointHunter(spec, p, rng);
    case 'chain':
      return simChain(spec, p, rng);
  }
}

export interface LevelSimulation {
  id: string;
  /** How many runs ended with 0, 1, 2 and 3 stars. */
  counts: [number, number, number, number];
  mean: number;
}

/** `runs` first attempts of a profile at a level, from the level's and the profile's own seed. */
export function simulateLevel(spec: LevelSpec, p: PlayerProfile, runs: number, salt = 0): LevelSimulation {
  const rng = createRng(seedFromString(`${spec.id}:r${spec.rev}:${p.id}`, salt));
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (let k = 0; k < runs; k++) counts[simulateOnce(spec, p, rng)]++;
  const mean = (counts[1] + 2 * counts[2] + 3 * counts[3]) / runs;
  return { id: spec.id, counts, mean };
}

export interface ChapterRow {
  chapter: number;
  act: number;
  /** The stars of the chapter's first attempts (mean, of 30), and the target, by profile. */
  stars: Record<ProfileId, number>;
  target: Record<ProfileId, number>;
}

/** What the report flags; never a failure. */
export type SimWarning =
  | { type: 'offTarget'; chapter: number; profile: ProfileId; stars: number; target: number; text: string }
  | { type: 'order'; chapter: number; text: string }
  | { type: 'tooHard'; id: string; kind: LevelSpec['kind']; zeroShare: number; text: string };

export interface ChapterReport {
  runs: number;
  chapters: ChapterRow[];
  /** Per level and profile, in the order of the levels. */
  levels: { id: string; kind: LevelSpec['kind']; byProfile: Record<ProfileId, LevelSimulation> }[];
  /** Chapters off their target, profiles out of order, levels too hard. */
  warnings: SimWarning[];
  /** Every number of the model, and whether real play set it (none yet). */
  assumptions: ModelNumber[];
}

export interface ReportOptions {
  runs?: number;
  profiles?: Readonly<Record<ProfileId, PlayerProfile>>;
  salt?: number;
}

/** A level the good player leaves at 0 stars this often is too hard (plan §5.5's rule, for the good profile). */
const TOO_HARD_ZERO_SHARE = 0.6;

export function chapterReport(levels: readonly LevelSpec[], o: ReportOptions = {}): ChapterReport {
  const runs = o.runs ?? DEFAULT_RUNS;
  const profiles = o.profiles ?? PROFILES;
  const rows = levels.map((spec) => ({
    id: spec.id,
    kind: spec.kind,
    byProfile: Object.fromEntries(
      PROFILE_IDS.map((id) => [id, simulateLevel(spec, profiles[id], runs, o.salt)]),
    ) as Record<ProfileId, LevelSimulation>,
  }));
  const byChapter = new Map<number, ChapterRow>();
  levels.forEach((spec, k) => {
    let row = byChapter.get(spec.chapter);
    if (!row) {
      const act = actOf(spec.chapter);
      row = {
        chapter: spec.chapter,
        act,
        stars: { casual: 0, good: 0, excellent: 0 },
        target: { ...TARGET_STARS[act - 1]! },
      };
      byChapter.set(spec.chapter, row);
    }
    for (const id of PROFILE_IDS) row.stars[id] += rows[k]!.byProfile[id].mean;
  });
  const chapters = [...byChapter.values()].sort((a, b) => a.chapter - b.chapter);
  const warnings: SimWarning[] = [];
  const tenth = (x: number) => Math.round(x * 10) / 10;
  for (const c of chapters) {
    for (const id of PROFILE_IDS) {
      c.stars[id] = tenth(c.stars[id]);
      const off = c.stars[id] - c.target[id];
      if (Math.abs(off) > TARGET_TOLERANCE)
        warnings.push({
          type: 'offTarget',
          chapter: c.chapter,
          profile: id,
          stars: c.stars[id],
          target: c.target[id],
          text: `chapter ${c.chapter}: ${id} ${c.stars[id]} stars, target ${c.target[id]} (${off > 0 ? 'easier' : 'harder'} by ${tenth(Math.abs(off))})`,
        });
    }
    if (!(c.stars.excellent >= c.stars.good && c.stars.good >= c.stars.casual))
      warnings.push({
        type: 'order',
        chapter: c.chapter,
        text: `chapter ${c.chapter}: the profiles are out of order`,
      });
  }
  for (const row of rows) {
    const zeroShare = row.byProfile.good.counts[0] / runs;
    if (zeroShare > TOO_HARD_ZERO_SHARE)
      warnings.push({
        type: 'tooHard',
        id: row.id,
        kind: row.kind,
        zeroShare,
        text: `${row.id} (${row.kind}): good gets 0 stars in ${Math.round(100 * zeroShare)}%`,
      });
  }
  return { runs, chapters, levels: rows, warnings, assumptions: modelNumbers(profiles) };
}
