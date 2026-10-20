import {
  type AppLevelOf,
  type HostUpdate,
  ManualClock,
  ManualScheduler,
  type PuzzleEvent,
} from '@sudoku-fight/engine';

import { LEVEL_UI } from '../../config/levels';
import type { LevelFinisher } from '../appLevels';
import { type LevelSession, type LevelSessionDeps, startLevel } from '../levelSession';
import { firstLevelOf, levelsOf } from './helpers/levelsOf';

/**
 * A puzzle stage's move through its session (levels-ui.md §4.3; UI-3): session.swap(from, to) goes to the host
 * (GameHost.swapBoxes) and the engine decides everything: a fixed box is refused ('boxFixed'), a swap that puts
 * neither box home costs its penalty and counts as a mistake, the right arrangement ends the stage, whose end is
 * stored with its mistakes; after close() a swap does nothing. Any other stage's host refuses a swap.
 */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

const PUZZLE = firstLevelOf('puzzle');
/** The puzzle with the most moving boxes: one where a swap can put neither box home. */
const BIG = [...levelsOf('puzzle')].sort((a, b) => a.targets.fixed.length - b.targets.fixed.length)[0]!;
const BOX = firstLevelOf('fillBox');

const sessions: LevelSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

async function start(level: Parameters<typeof startLevel>[0]) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const finish = jest.fn<ReturnType<LevelFinisher>, Parameters<LevelFinisher>>(async () => null);
  const deps: LevelSessionDeps = {
    clock,
    scheduler,
    finish,
    track: jest.fn(),
    appState: null,
    attemptOf: async () => 1,
    bestStarsOf: () => 0,
    settings: LEVEL_UI,
  };
  const session = await startLevel(level, {}, deps);
  sessions.push(session);
  const updates: HostUpdate[] = [];
  session.subscribe((u) => updates.push(u));
  return { session, clock, finish, updates };
}

/** The arrangement as it starts: at[place] = the home of the box there (the stage as played: attempt 1). */
const startOf = (level: AppLevelOf<'puzzle'>) => level.targets.start.slice();

/** Swaps that put every box home, from `at` (one box home each). */
function solve(at: number[]): [number, number][] {
  const moves: [number, number][] = [];
  const now = at.slice();
  for (let p = 0; p < 9; p++)
    while (now[p] !== p) {
      const q = now.indexOf(p);
      moves.push([p, q]);
      [now[p], now[q]] = [now[q]!, now[p]!];
    }
  return moves;
}

const swapsIn = (updates: HostUpdate[]) =>
  updates.flatMap((u) =>
    u.kind === 'events'
      ? (u.puzzleEvents ?? []).filter(
          (e): e is Extract<PuzzleEvent, { type: 'boxesSwapped' }> => e.type === 'boxesSwapped',
        )
      : [],
  );

describe('session.swap: the puzzle’s move through the host', () => {
  it('a fixed box is refused by the engine (boxFixed); nothing moves', async () => {
    const { session, updates } = await start(PUZZLE);
    const fixed = PUZZLE.targets.fixed[0]!;
    const movable = [...Array(9).keys()].find((p) => !PUZZLE.targets.fixed.includes(p))!;
    const before = session.getView().level?.puzzle?.slots;
    session.swap(movable, fixed);
    expect(updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'swapBoxes', from: movable, to: fixed },
      reason: 'boxFixed',
    });
    expect(session.getView().level?.puzzle?.slots).toEqual(before);
    expect(session.getView().level?.puzzle?.swaps).toBe(0);
  });

  it('the right swaps end the stage: solved, stored once, with no mistakes', async () => {
    const { session, finish, clock } = await start(PUZZLE);
    for (const [from, to] of solve(startOf(PUZZLE))) {
      clock.advance(1500);
      session.swap(from, to);
    }
    expect(session.over).toMatchObject({ reason: 'targetReached', mistakes: 0, penaltyMs: 0 });
    const result = await session.result;
    expect(result.outcome.stars).toBeGreaterThan(0);
    expect(result.mistakes).toBe(0);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('a swap that puts neither box home costs its penalty and counts as a mistake', async () => {
    const { session, updates } = await start(BIG);
    const at = startOf(BIG);
    const moving = [...Array(9).keys()].filter((p) => !BIG.targets.fixed.includes(p));
    const pair = moving
      .flatMap((p) => moving.map((q) => [p, q] as const))
      .find(([p, q]) => p < q && at[q] !== p && at[p] !== q);
    if (!pair) throw new Error(`${BIG.id}: every swap puts a box home`);
    session.swap(pair[0], pair[1]);
    expect(swapsIn(updates).at(-1)).toMatchObject({ from: pair[0], to: pair[1], penaltyMs: 5000 });
    expect(session.getView().level).toMatchObject({
      penaltyMs: 5000,
      progress: { kind: 'swaps', mistakes: 1 },
    });
  });

  it('after close() a swap does nothing', async () => {
    const { session, updates } = await start(PUZZLE);
    session.close();
    const n = updates.length;
    expect(() => session.swap(0, 1)).not.toThrow();
    expect(updates).toHaveLength(n);
  });

  it('any other stage’s host refuses a swap (badAction), the stage untouched', async () => {
    const { session, updates } = await start(BOX);
    session.swap(0, 1);
    expect(updates.at(-1)).toMatchObject({ kind: 'rejected', reason: 'badAction' });
    expect(session.over).toBeNull();
  });
});
