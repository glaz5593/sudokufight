/* Test-only level fixtures (staged practice, 1.0.2): one per digit kind, on bank puzzle #1 (testing/game.ts). */
import { botPlayer } from '../bot/levels';
import type { PlayerInfo } from '../game/types';
import { type AppLevel, levelGameConfig, type LevelSpecOf } from '../levels/spec';
import { pointStars } from '../levels/stars';
import { parseCellName } from '../sudoku/board';
import { seedFromString } from '../util/random';
import { GameDriver, PUZZLE } from './game';

/*
 * The rules of each kind on a board whose answers the tests know. They are not built levels: the builder's
 * levels (levels.json) are what levels:validate checks; these only play the rules (a chain here is not a
 * real chain, its cells are knowable in any order).
 */

const cells = (...names: string[]) => names.map(parseCellName);
const board = { grid: PUZZLE.givens, solution: PUZZLE.solution };

/** fillBox, chapter 1 (plan §2.3): box 5's five empty cells, 10 / 15 / 20 s. */
export const FILL_BOX_LEVEL: LevelSpecOf<'fillBox'> = {
  id: 'L002',
  rev: 1,
  chapter: 1,
  slot: 2,
  kind: 'fillBox',
  boss: false,
  seed: seedFromString('L002:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 20000,
  targets: { box: 4, cells: cells('D4', 'D5', 'E4', 'E5', 'F4') },
  stars: { by: 'timeMs', three: 10000, two: 15000, one: 20000 },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

/** duel, chapter 3 (plan §2.4): first to 30 against Pip in 30 s; a lead of 15 / 8 / any. */
export const DUEL_LEVEL: LevelSpecOf<'duel'> = {
  id: 'L021',
  rev: 1,
  chapter: 3,
  slot: 1,
  kind: 'duel',
  boss: false,
  seed: seedFromString('L021:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 30000,
  targets: { endAtScore: 30 },
  stars: { by: 'gap', three: 15, two: 8 },
  bot: { level: 1, pace: 1 },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

/**
 * pointHunter, chapter 7 (plan Idea-2): 3 moves in 30 s. The best line among the cells a single shows (the
 * builder searches it in full): A1 (8), then B2 (7.5), then F8 (8) = 23.5.
 */
export const POINT_HUNTER_LEVEL: LevelSpecOf<'pointHunter'> = {
  id: 'L066',
  rev: 1,
  chapter: 7,
  slot: 6,
  kind: 'pointHunter',
  boss: false,
  seed: seedFromString('L066:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 30000,
  targets: {
    maxMoves: 3,
    best: [
      { cell: parseCellName('A1'), digit: 8, points: 8 },
      { cell: parseCellName('B2'), digit: 2, points: 7.5 },
      { cell: parseCellName('F8'), digit: 1, points: 8 },
    ],
  },
  stars: pointStars(23.5),
  worthHint: true,
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

/** chain, chapter 9 (plan Idea-3): 3 steps in 24 s, 10 / 16 / 24 s. */
export const CHAIN_LEVEL: LevelSpecOf<'chain'> = {
  id: 'L085',
  rev: 1,
  chapter: 9,
  slot: 5,
  kind: 'chain',
  boss: false,
  seed: seedFromString('L085:r1'),
  gameType: 'fast',
  board,
  timeLimitMs: 24000,
  targets: { cells: cells('A1', 'B2', 'C1') },
  stars: { by: 'timeMs', three: 10000, two: 16000, one: 24000 },
  check: { techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] },
};

export const DIGIT_LEVELS = [FILL_BOX_LEVEL, DUEL_LEVEL, POINT_HUNTER_LEVEL, CHAIN_LEVEL] as const;

/** A level as the app ships it (AppLevel): without the build checks. */
export function appLevelOf<S extends AppLevel & { check?: unknown }>(spec: S): Omit<S, 'check'> {
  const { check: _check, ...level } = spec;
  return level;
}

/** The player of the level fixtures. */
export const ME: PlayerInfo = { id: 'me', name: 'Moshe' };
/** The duel's bot: Pip. */
export const PIP = botPlayer(1);

/** A level's attempt played through the pure API (GameDriver), as LocalGameHost would play it. */
export function levelDriver(
  spec: AppLevel,
  { attempt = 1, at = 0, start = true }: { attempt?: number; at?: number; start?: boolean } = {},
): GameDriver {
  return new GameDriver(levelGameConfig(spec, { id: 'game-1', player: ME, attempt }), { at, start });
}
