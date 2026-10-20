import {
  createRng,
  kindOfLevel,
  LEVEL_KINDS,
  LEVEL_METRIC,
  LEVEL_RULES,
  maxLevel,
  maxMsOf,
} from '@sudoku-fight/engine';

import { LEVEL_SKILLS, sampleAttempt, sampleBotLevel, sampleLevelKind } from './levels';

/**
 * The sample data's levels (levels-content.md §11, §12 lane ה): the kinds are the engine's own (kindOfLevel, as
 * levels.json has them, through catalog.ts), so every rebuild shows in the admin's "שלבים" page; times stay
 * within each kind's limit (maxMsOf) [D68].
 */

const LEVELS = Array.from({ length: maxLevel(LEVEL_RULES) }, (_, k) => k + 1);

describe('the sample levels', () => {
  it('each level is of the kind the engine says (kindOfLevel), and every kind is there', () => {
    expect(LEVELS.map(sampleLevelKind)).toEqual(LEVELS.map((n) => kindOfLevel(n)));
    expect(new Set(LEVELS.map(sampleLevelKind))).toEqual(new Set(LEVEL_KINDS));
  });

  it('a bot only where the kind has one', () => {
    for (const n of LEVELS) {
      const kind = sampleLevelKind(n);
      const bot = sampleBotLevel(n, kind);
      const withBot = kind === 'findDuel' || kind === 'duel';
      expect({ n, kind, bot: bot !== null }).toEqual({ n, kind, bot: withBot });
    }
  });

  it('an attempt lasts at most its kind’s limit (60 s for the fill kinds and the puzzle), and a time kind that ran out took all of it', () => {
    const rng = createRng(20261020);
    for (const n of LEVELS)
      for (const skill of LEVEL_SKILLS)
        for (const attempt of [1, 2]) {
          const kind = sampleLevelKind(n);
          const a = sampleAttempt(rng, skill, n, attempt);
          expect({ n, ok: a.durationMs >= 0 && a.durationMs <= maxMsOf(kind) }).toEqual({ n, ok: true });
          if (LEVEL_METRIC[kind] === 'timeMs' && a.reason === 'timeUp')
            expect({ n, durationMs: a.durationMs }).toEqual({ n, durationMs: maxMsOf(kind) });
        }
  });
});
