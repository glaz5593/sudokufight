import { readFileSync } from 'node:fs';

import { GAME_TYPES } from '@sudoku-fight/engine';
import { z } from 'zod';

import { PUZZLE_POOLS } from '../db/schema';
import { puzzleBankPath } from '../game/puzzles';

/**
 * The puzzle bank file (packages/engine/data/puzzles.json, spec §20), as `npm run db:seed-puzzles` reads it.
 * Every puzzle is checked again here: the file is the only way puzzles reach the ranked pool.
 */

const bankSchema = z.object({
  puzzles: z.array(
    z.object({
      id: z.string().min(1).max(64),
      givens: z.string().regex(/^[0-9]{81}$/, '81 digits, 0 for an empty cell'),
      solution: z.string().regex(/^[1-9]{81}$/, '81 digits from 1 to 9'),
      gameType: z.enum(GAME_TYPES),
      techniques: z.array(z.string()),
      givensCount: z.int().min(17).max(80),
      source: z.string().min(1),
      pool: z.enum(PUZZLE_POOLS),
    }),
  ),
});

export type BankPuzzle = z.infer<typeof bankSchema>['puzzles'][number];

export function readPuzzleBank(file = puzzleBankPath()): BankPuzzle[] {
  return bankSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).puzzles;
}
