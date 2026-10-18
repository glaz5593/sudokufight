import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type CellIndex, type Digit, type GameType, moveScore } from '@sudoku-fight/engine';

import {
  connectingPercent,
  LAST_CELL_POINTS,
  LOADING_TIPS,
  matchLoadingOf,
  tipOf,
  TOP_MOVE_POINTS,
} from '../loadingModel';

/**
 * The loading card of a ranked match's room (Loading.dc.html): the players as "found" gave them, me first in
 * P1's colour, who is ready (D37), the percent of the steps, a stable tip.
 */

const PROFILES = {
  nina: { avatarId: 'maya', country: 'DE', name: 'NinaVolt', rating: 1305, provisional: true },
  me: { avatarId: 'lava-lamp', country: 'IL', name: 'Moshe', rating: 1287, provisional: false },
};

describe('matchLoadingOf', () => {
  it('me first in P1, the others after; ratings and flags as "found" gave them', () => {
    const m = matchLoadingOf({
      profiles: PROFILES,
      myId: 'me',
      gameType: 'normal',
      step: 'room',
      seed: 'g',
    })!;
    expect(m.gameType).toBe('normal');
    expect(m.players).toEqual([
      {
        id: 'me',
        name: 'Moshe',
        avatarId: 'lava-lamp',
        country: 'IL',
        rating: 1287,
        provisional: false,
        isMe: true,
        colorIndex: 0,
        ready: false,
      },
      {
        id: 'nina',
        name: 'NinaVolt',
        avatarId: 'maya',
        country: 'DE',
        rating: 1305,
        provisional: true,
        isMe: false,
        colorIndex: 1,
        ready: true,
      },
    ]);
    expect(m.percent).toBe(33);
  });

  it('I am ready once in the room (the snapshot on its way); the others are in their match already', () => {
    const at = (step: 'server' | 'room' | 'sync') =>
      matchLoadingOf({ profiles: PROFILES, myId: 'me', gameType: 'fast', step, seed: 'g' })!.players.map(
        (p) => p.ready,
      );
    expect(at('server')).toEqual([false, true]);
    expect(at('room')).toEqual([false, true]);
    expect(at('sync')).toEqual([true, true]);
  });

  it('four players: colours 0–3; an unknown avatar is the empty one; no rating, none shown', () => {
    const m = matchLoadingOf({
      profiles: {
        a: { avatarId: 'nope', country: null, name: 'A', rating: 1200 },
        me: { avatarId: 'lava-lamp', country: 'IL', name: 'Moshe' },
        b: { avatarId: 'microphone', country: 'FR', name: 'B', rating: 1210 },
        c: { avatarId: 'balloon', country: 'US', name: 'C', rating: 1190 },
      },
      myId: 'me',
      gameType: 'hard',
      step: 'server',
      seed: 'x',
    })!;
    expect(m.players.map((p) => [p.id, p.colorIndex])).toEqual([
      ['me', 0],
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    expect(m.players[0]!.rating).toBeNull();
    expect(m.players[1]!.avatarId).toBe('av00');
    expect(m.percent).toBe(0);
  });

  it('none for a room by code (no profiles, or profiles without names)', () => {
    const base = { myId: 'me', gameType: 'fast' as const, step: 'server' as const, seed: 's' };
    expect(matchLoadingOf({ ...base, profiles: null })).toBeNull();
    expect(
      matchLoadingOf({
        ...base,
        profiles: { me: { avatarId: 'lava-lamp', country: 'IL' }, nina: { avatarId: 'maya', country: 'DE' } },
      }),
    ).toBeNull();
  });
});

describe('the percent and the tip', () => {
  it('the steps done so far, of three', () => {
    expect([connectingPercent('server'), connectingPercent('room'), connectingPercent('sync')]).toEqual([
      0, 33, 67,
    ]);
  });

  it('a stable tip per seed, and every tip gets picked by some seed', () => {
    expect(tipOf('online-7')).toBe(tipOf('online-7'));
    const seen = new Set(Array.from({ length: 40 }, (_, k) => tipOf(`online-${k}`)));
    expect([...seen].sort()).toEqual([...LOADING_TIPS].sort());
  });

  it('the tips’ numbers are the rules’: the last cell 1.5, the bank’s best move per game type (not 13.5)', () => {
    // The last empty cell: every count is 8 (the formula of spec §6.4).
    const solution = '864371259325849761971265843436192587198657432257483916689734125713528694542916378';
    const last = [...solution].map(Number);
    last[0] = 0;
    expect(moveScore(last, 0 as CellIndex, 8 as Digit).points).toBe(LAST_CELL_POINTS);

    // A move is worth the most on the board as given (every count only grows as cells fill): the best of
    // every empty cell of every board in the bank the app and the server play (both pools), per game type.
    const bank = join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'packages', 'engine', 'data');
    const { puzzles } = JSON.parse(readFileSync(join(bank, 'puzzles.json'), 'utf8')) as {
      puzzles: { givens: string; solution: string; gameType: GameType }[];
    };
    const best: Record<GameType, number> = { fast: 0, normal: 0, hard: 0 };
    for (const p of puzzles) {
      const grid = [...p.givens].map(Number);
      grid.forEach((v, cell) => {
        if (v !== 0) return;
        const points = moveScore(grid, cell as CellIndex, Number(p.solution[cell]) as Digit).points;
        best[p.gameType] = Math.max(best[p.gameType], points);
      });
    }
    expect(best).toEqual(TOP_MOVE_POINTS);
  });
});
