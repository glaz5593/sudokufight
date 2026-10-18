import {
  type CellIndex,
  type Digit,
  type GameConfig,
  type GameType,
  ManualClock,
  ManualScheduler,
  type PlayerId,
} from '@sudoku-fight/engine';
import { ratingKeysFor } from '@sudoku-fight/protocol';

import type { Db } from '../db';
import { puzzles, ratings, users } from '../db/schema';
import type { GamePuzzle } from '../game/puzzles';
import { ServerGame } from '../game/serverGame';
import type { GameRecorder, RecorderLog } from '../persistence';

/** Test helpers for ranked games on the database (stage 9): accounts, ranked puzzles, a game to play. */

export const T0 = Date.UTC(2026, 9, 9, 12);

export interface TestAccount {
  id: string;
  name?: string;
  /** In every key of option B (and A with `option: 'A'`): rating and games already played. */
  rating?: number;
  games?: number;
  option?: 'A' | 'B';
  deleted?: boolean;
}

/** users rows (and their ratings, like a registration with RATING_OPTION B or A). */
export async function addAccounts(db: Db, accounts: readonly TestAccount[]): Promise<void> {
  for (const a of accounts) {
    await db.insert(users).values({
      id: a.id,
      firebaseUid: `uid-${a.id}`,
      displayName: a.name ?? a.id,
      deletedAt: a.deleted ? new Date(T0) : null,
    });
    const rating = a.rating ?? 1200;
    const games = a.games ?? 0;
    await db.insert(ratings).values(
      ratingKeysFor(a.option ?? 'B').map((ratingKey) => ({
        userId: a.id,
        ratingKey,
        rating,
        games,
        provisional: games < 10,
        peak: rating,
        updatedAt: new Date(T0),
      })),
    );
  }
}

/** Puzzles rows; ids are kept, givens and solution taken as they are. `retired`: left the bank [D43]. */
export async function addPuzzles(
  db: Db,
  list: readonly GamePuzzle[],
  {
    gameType = 'fast',
    pool = 'ranked',
    retired = false,
  }: { gameType?: GameType; pool?: 'ranked' | 'offline'; retired?: boolean } = {},
): Promise<void> {
  if (list.length === 0) return;
  await db.insert(puzzles).values(
    list.map((p) => ({
      ...p,
      gameType,
      techniques: ['nakedSingle'],
      givensCount: [...p.givens].filter((c) => c !== '0').length,
      source: 'test',
      pool,
      retiredAt: retired ? new Date(T0) : null,
    })),
  );
}

/** `n` stand-in puzzles (ids `${prefix}-001` …): for selection, where only the ids matter. */
export function standInPuzzles(n: number, prefix: string): GamePuzzle[] {
  return Array.from({ length: n }, (_, k) => ({
    id: `${prefix}-${String(k + 1).padStart(3, '0')}`,
    givens: '0'.repeat(81),
    solution: '1'.repeat(81),
  }));
}

/** A log that keeps what it is told. */
export function recordingLog(): RecorderLog & { lines: string[]; errors: unknown[] } {
  const lines: string[] = [];
  const errors: unknown[] = [];
  return {
    lines,
    errors,
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m, e) => {
      lines.push(m);
      errors.push(e);
    },
  };
}

/**
 * A ServerGame on a manual clock (from T0), its updates fed to `recorder` as the room does (the creation
 * first). Not started.
 */
export function tableFor(config: GameConfig, recorder?: GameRecorder) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const game = new ServerGame({
    config,
    clock,
    scheduler,
    onUpdate: (u) => recorder?.push(u),
    onError: (e) => {
      throw e;
    },
  });
  recorder?.push({ events: game.events, state: game.state });

  const empty = (): CellIndex[] => game.state.grid.flatMap((v, i) => (v === 0 ? [i] : []));
  const answer = (cell: CellIndex) => Number(config.puzzle.solution[cell]) as Digit;

  /** `who` locks `cell` and, `thinkMs` later, places the right digit (or `digit`). */
  function move(who: PlayerId, cell: CellIndex, thinkMs = 2000, digit?: Digit): void {
    const locked = game.act(who, { type: 'select', cell });
    if (locked.rejected) throw new Error(`${who} can't select ${cell}: ${locked.rejected}`);
    scheduler.advance(thinkMs);
    const placed = game.act(who, { type: 'place', cell, digit: digit ?? answer(cell) });
    if (placed.rejected) throw new Error(`${who} can't place in ${cell}: ${placed.rejected}`);
    scheduler.advance(300);
  }

  /** Fills every empty cell, in order; `who(k)` plays the k-th. */
  function fillAll(who: (k: number) => PlayerId, thinkMs: (k: number) => number = () => 2000): void {
    let k = 0;
    while (game.state.status === 'running') {
      const cell = empty()[0];
      if (cell === undefined) break;
      move(who(k), cell, thinkMs(k));
      k++;
    }
  }

  return { game, clock, scheduler, empty, answer, move, fillAll };
}
