import { BOT_CONFIG, type BotConfig } from '../../bot/levels';
import { createRng, type Rng } from '../../util/random';
import { type LevelPlan, levelPlan } from '../levels.config';
import { LEVEL_RULES, type LevelRules, maxLevel } from '../progress';
import type { LevelSpec } from '../spec';
import { transformLevel } from '../transform';
import { buildChain } from './chain';
import { BuildError } from './common';
import { buildDuel } from './duel';
import { buildFillBox } from './fillBox';
import { buildFind, type Built } from './find';
import { buildFindDuel } from './findDuel';
import { buildPointHunter } from './pointHunter';
import { buildSpotError } from './spotError';
import { botConfigFingerprint, type LevelsFile, validateLevel } from './validate';

/**
 * Builds the 300 levels (`npm run levels:build`, dev-plan §2ד): each from its plan (levels.config) with a fresh
 * Rng of its own seed, by its kind's builder, kept only when it passes levels:validate, on its stored board
 * and on the equivalent boards of attempts 2–8 ("שוב" [D63], CHECKED_ATTEMPTS); else the same Rng draws
 * again. Pure and deterministic: the same config and engine give the same file. The script
 * (scripts/levels-build.ts) does the file I/O; this folder is never exported from the engine (Node-only, kept
 * out of the app and server bundles).
 */

/**
 * The attempts whose equivalent boards a level must pass too (levels.data.test checks the same ones). More than
 * the plan's 2 and 3: the solver's reading of eliminations can depend on the order it scans the units in, so an
 * equivalent board now and then reads differently (1 in 125 boards of attempts 4–13 when only 2 and 3 were
 * checked). With these checked, none of attempts 9–50 of the 300 levels fails (2026-10-18).
 */
export const CHECKED_ATTEMPTS = [2, 3, 4, 5, 6, 7, 8] as const;

/** How many times a level is drawn again when it fails a check, before the build gives up. */
export const MAX_REDRAWS = 30;

export function buildByKind(plan: LevelPlan, rng: Rng, config: BotConfig = BOT_CONFIG): Built<LevelSpec> {
  switch (plan.kind) {
    case 'find':
      return buildFind(plan, rng);
    case 'findDuel':
      return buildFindDuel(plan, rng, config);
    case 'fillBox':
      return buildFillBox(plan, rng);
    case 'duel':
      return buildDuel(plan, rng);
    case 'spotError':
      return buildSpotError(plan, rng);
    case 'pointHunter':
      return buildPointHunter(plan, rng);
    case 'chain':
      return buildChain(plan, rng);
  }
}

/** Every problem of a level and of its checked equivalent boards. */
export function levelProblems(spec: LevelSpec, rules: LevelRules = LEVEL_RULES): string[] {
  return [
    ...validateLevel(spec, rules),
    ...CHECKED_ATTEMPTS.flatMap((a) =>
      validateLevel(transformLevel(spec, a), rules).map((p) => `${p} (attempt ${a})`),
    ),
  ];
}

export interface LevelBuild {
  spec: LevelSpec;
  /** Boards (or searches) the kind's builder tried, over every draw. */
  attempts: number;
  /** Draws refused by a check (validation, a board another level or the ranked bank has). */
  redraws: number;
  /** Why the refused draws were refused (the first problem of each). */
  refused: string[];
}

export interface BuildOptions {
  rules?: LevelRules;
  config?: BotConfig;
  /** Why a built level may not be used (its board is a ranked puzzle's, or another level's), or null. */
  avoid?: (spec: LevelSpec) => string | null;
}

export function buildLevel(
  n: number,
  { rules = LEVEL_RULES, config = BOT_CONFIG, avoid }: BuildOptions = {},
): LevelBuild {
  const plan = levelPlan(n, rules);
  const rng = createRng(plan.seed);
  let attempts = 0;
  const refused: string[] = [];
  for (let draw = 0; draw <= MAX_REDRAWS; draw++) {
    const built = buildByKind(plan, rng, config);
    attempts += built.attempts;
    const why = levelProblems(built.spec, rules)[0] ?? avoid?.(built.spec) ?? null;
    if (why === null) return { spec: built.spec, attempts, redraws: draw, refused };
    refused.push(why);
  }
  throw new BuildError(plan.id, `refused ${MAX_REDRAWS + 1} times; last: ${refused[refused.length - 1]}`);
}

export interface BuildAllOptions extends BuildOptions {
  /** After each level (the script prints progress). */
  onLevel?: (build: LevelBuild) => void;
}

/** All the levels, in order: no two share givens or a solution, and none is in `avoid`. */
export function buildLevels({ onLevel, avoid, ...opts }: BuildAllOptions = {}): {
  file: LevelsFile;
  builds: LevelBuild[];
} {
  const rules = opts.rules ?? LEVEL_RULES;
  const grids = new Map<string, string>();
  const solutions = new Map<string, string>();
  const builds: LevelBuild[] = [];
  for (let n = 1; n <= maxLevel(rules); n++) {
    const build = buildLevel(n, {
      ...opts,
      avoid: (spec) => {
        const other = grids.get(spec.board.grid) ?? solutions.get(spec.board.solution);
        return other ? `the board of ${other}` : (avoid?.(spec) ?? null);
      },
    });
    grids.set(build.spec.board.grid, build.spec.id);
    solutions.set(build.spec.board.solution, build.spec.id);
    builds.push(build);
    onLevel?.(build);
  }
  return {
    file: { botConfigFingerprint: botConfigFingerprint(opts.config), levels: builds.map((b) => b.spec) },
    builds,
  };
}
