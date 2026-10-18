import { DEFAULT_PROGRESS_RULES, INTERFERENCE_KINDS } from '@sudoku-fight/engine';

import { myProgress } from '../../../api/testing/fakeProgress';
import { leagueFloor, leagueProgress, nextLeague } from '../../../components/player';
import {
  FUTURE_INTERFERENCES,
  interferenceCollection,
  interferenceFacts,
  leagueLadder,
  levelView,
  provisionalGames,
  xpRules,
} from '../progressModel';

/** The progress tab's and the collection's pure models (spec §7.1, §11.3, §15). */

describe('levelView', () => {
  it('my level, the XP in it, and what is left to the next one', () => {
    expect(levelView(myProgress())).toEqual({
      level: 14,
      nextLevel: 15,
      into: 2380,
      total: 3000,
      toGo: 620,
      share: 2380 / 3000,
    });
  });

  it('clamps what a server could get wrong', () => {
    expect(levelView({ level: 1, xpIntoLevel: 500, xpForNext: 200 })).toMatchObject({
      into: 200,
      toGo: 0,
      share: 1,
    });
    expect(levelView({ level: 1, xpIntoLevel: -5, xpForNext: 0 })).toMatchObject({
      into: 0,
      total: 1,
      share: 0,
    });
  });
});

describe('leagues (spec §11.3) [D38]: the engine’s thresholds', () => {
  it('the ladder: five leagues from 0, 1100, 1250, 1400, 1600; mine and the ones below it reached', () => {
    expect(leagueLadder('gold')).toEqual([
      { league: 'bronze', floor: 0, current: false, reached: true },
      { league: 'silver', floor: 1100, current: false, reached: true },
      { league: 'gold', floor: 1250, current: true, reached: true },
      { league: 'diamond', floor: 1400, current: false, reached: false },
      { league: 'legend', floor: 1600, current: false, reached: false },
    ]);
    expect(leagueLadder(null).some((s) => s.reached)).toBe(false);
  });

  it('the way to the next league', () => {
    expect(leagueProgress(1276)).toEqual({ league: 'gold', next: 'diamond', toNext: 124, share: 26 / 150 });
    expect(leagueProgress(1100)).toMatchObject({ league: 'silver', toNext: 150, share: 0 });
    expect(leagueProgress(1700)).toEqual({ league: 'legend', next: null, toNext: null, share: 1 });
    expect(leagueProgress(1399.5).toNext).toBe(1);
    expect(leagueFloor('bronze')).toBe(0);
    expect(nextLeague('legend')).toBeNull();
  });

  it('a league shows after the provisional games', () => {
    expect(provisionalGames()).toBe(DEFAULT_PROGRESS_RULES.provisionalGames);
  });
});

describe('xpRules (spec §15)', () => {
  it('50 for a win, 20 for any other result, 10 solo, 1 per correct move', () => {
    expect(xpRules()).toEqual([
      { key: 'win', xp: 50 },
      { key: 'played', xp: 20 },
      { key: 'solo', xp: 10 },
      { key: 'perCorrect', xp: 1 },
    ]);
  });
});

describe('the interferences collection (spec §7.1) [D17]', () => {
  it('the three first open from the start; the scramble, ink and the keypad at their levels; four "soon"', () => {
    const c = interferenceCollection(null);
    expect(c.open.map((e) => e.kind)).toEqual(['fireworks', 'cats', 'warp']);
    expect(c.locked.map((e) => e.kind)).toEqual(['scramble', 'ink', 'keypad', ...FUTURE_INTERFERENCES]);
    expect(c.locked.slice(0, 3)).toEqual([
      { kind: 'scramble', future: false, unlockLevel: 2, open: false },
      { kind: 'ink', future: false, unlockLevel: 3, open: false },
      { kind: 'keypad', future: false, unlockLevel: 4, open: false },
    ]);
    expect(c.locked.slice(3).every((e) => e.future && e.unlockLevel === null)).toBe(true);
    expect(c.total).toBe(10);
  });

  it('opens each kind at its level (D17: 2, 3, 4)', () => {
    expect(interferenceCollection(2).open.map((e) => e.kind)).toEqual([
      'fireworks',
      'cats',
      'warp',
      'scramble',
    ]);
    expect(interferenceCollection(3).open.map((e) => e.kind)).toContain('ink');
    expect(interferenceCollection(4).open.map((e) => e.kind)).toEqual([...INTERFERENCE_KINDS]);
    expect(interferenceCollection(4).locked.every((e) => e.future)).toBe(true);
  });

  it('the future ones are the kinds not built yet: earthquake, fog, bubbles and the torch (ink is a kind now) [D47]', () => {
    expect([...FUTURE_INTERFERENCES]).toEqual(['earthquake', 'fog', 'bubbles', 'torch']);
    for (const kind of FUTURE_INTERFERENCES) expect(INTERFERENCE_KINDS).not.toContain(kind);
  });

  it('a kind above my level is locked, at its level', () => {
    const levels = { fireworks: 0, cats: 0, warp: 12, scramble: 0, ink: 0, keypad: 0 };
    const c = interferenceCollection(3, levels);
    expect(c.open.map((e) => e.kind)).toEqual(['fireworks', 'cats', 'scramble', 'ink', 'keypad']);
    expect(c.locked[0]).toEqual({ kind: 'warp', future: false, unlockLevel: 12, open: false });
  });

  it('the rules it states: 5 seconds, 2 · 4 · 8', () => {
    expect(interferenceFacts()).toEqual({ seconds: 5, costs: [2, 4, 8] });
  });
});
