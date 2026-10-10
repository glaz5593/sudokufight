import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { GAME_TYPES, type GameType } from '@sudoku-fight/engine';
import { z } from 'zod';

import type { NodeEnv } from '../config';

/**
 * Where a server game's puzzle comes from (spec §20, §21).
 *
 * Stage 7 reads the bank file (packages/engine/data/puzzles.json) and takes a random puzzle of the game type
 * from the 'ranked' pool, which never ships in the app. The bank has no ranked puzzles yet, so outside
 * production it falls back to the 'offline' pool (dev and test rooms only). Rated rooms (stage 9) don't use
 * it: their puzzle comes from the `puzzles` table's ranked pool without repeats (src/puzzles/rankedSource.ts,
 * loaded by `npm run db:seed-puzzles`).
 */

export interface GamePuzzle {
  id: string;
  givens: string;
  solution: string;
}

export interface PuzzleSource {
  pick(gameType: GameType): GamePuzzle;
}

/** Always the same puzzle (tests). */
export const fixedPuzzleSource = (puzzle: GamePuzzle): PuzzleSource => ({ pick: () => puzzle });

const bankSchema = z.object({
  puzzles: z.array(
    z.object({
      id: z.string().min(1),
      givens: z.string().length(81),
      solution: z.string().length(81),
      gameType: z.enum(GAME_TYPES),
      pool: z.enum(['offline', 'ranked']),
    }),
  ),
});
type BankPuzzle = z.infer<typeof bankSchema>['puzzles'][number];

/** packages/engine/data/puzzles.json. */
export function puzzleBankPath(): string {
  return path.join(
    path.dirname(require.resolve('@sudoku-fight/engine/package.json')),
    'data',
    'puzzles.json',
  );
}

export interface BankPuzzleSourceOptions {
  nodeEnv: NodeEnv;
  /** Default puzzleBankPath(). */
  file?: string;
  /** An integer in [0, n) (default crypto's randomInt). */
  random?: (n: number) => number;
}

/** Reads the bank on the first pick, then keeps it in memory. */
export function bankPuzzleSource({
  nodeEnv,
  file = puzzleBankPath(),
  random = randomInt,
}: BankPuzzleSourceOptions): PuzzleSource {
  let byType: Map<GameType, BankPuzzle[]> | null = null;
  const load = (): Map<GameType, BankPuzzle[]> => {
    const all = bankSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).puzzles;
    const map = new Map<GameType, BankPuzzle[]>();
    for (const gameType of GAME_TYPES) {
      const ofType = all.filter((p) => p.gameType === gameType);
      const ranked = ofType.filter((p) => p.pool === 'ranked');
      map.set(gameType, ranked.length > 0 || nodeEnv === 'production' ? ranked : ofType);
    }
    return map;
  };
  return {
    pick(gameType) {
      byType ??= load();
      const pool = byType.get(gameType) ?? [];
      if (pool.length === 0) throw new Error(`No ${gameType} puzzles for server games in ${file}`);
      const { id, givens, solution } = pool[random(pool.length)]!;
      return { id, givens, solution };
    },
  };
}
