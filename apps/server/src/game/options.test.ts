import { INTERFERENCE_KINDS } from '@sudoku-fight/engine';

import { parseCreateOptions, RoomOptionsError } from './options';

const parse = (options: unknown) => parseCreateOptions(options, 'development');
const error = (options: unknown, nodeEnv: 'development' | 'production' = 'development') => {
  try {
    parseCreateOptions(options, nodeEnv);
  } catch (e) {
    if (e instanceof RoomOptionsError) return e.message;
    throw e;
  }
  throw new Error('expected a refusal');
};

describe('create options of the game room', () => {
  it('defaults: a fast game for two, a drawn code, the default rules', () => {
    expect(parse({ private: true, devUserId: 'ana', name: 'Ana' })).toEqual({
      code: null,
      gameType: 'fast',
      playerCount: 2,
      rules: {},
      rated: false,
    });
  });

  it('takes a game type, 2–4 players, a code (normalised) and dev rule overrides', () => {
    expect(
      parse({
        private: true,
        code: 'ab-c 234',
        gameType: 'hard',
        playerCount: 4,
        rules: { graceMs: 500, thinkTimeMs: 3000, turnModel: 'turns', relockCooldownMs: 0 },
      }),
    ).toEqual({
      code: 'ABC234',
      gameType: 'hard',
      playerCount: 4,
      rules: { graceMs: 500, thinkTimeMs: 3000, turnModel: 'turns', relockCooldownMs: 0 },
      rated: false,
    });
  });

  it('takes the soft phase of a lost connection [D42]: 0 (off) to 60 s', () => {
    for (const softGraceMs of [0, 300, 10_000, 60_000])
      expect(parse({ private: true, rules: { softGraceMs } }).rules).toEqual({ softGraceMs });
  });

  it('takes the room’s interference kinds outright [D47]: kinds the engine knows, in the order given', () => {
    for (const interferenceKinds of [[], ['cats'], ['keypad', 'fireworks'], [...INTERFERENCE_KINDS]])
      expect(parse({ private: true, rules: { interferenceKinds } }).rules).toEqual({ interferenceKinds });
  });

  it('takes the creator’s declared kinds [D47] (the room reads them again when he joins)', () => {
    const declared = { private: true, devUserId: 'ana', name: 'Ana' };
    expect(parse({ ...declared, interferenceKinds: [...INTERFERENCE_KINDS] }).rules).toEqual({});
    // A newer app may declare kinds this server does not know: they are ignored, not refused.
    expect(parse({ ...declared, interferenceKinds: ['cats', 'fog'] }).gameType).toBe('fast');
  });

  it('rated: a ranked game by code (stage 9, development and tests)', () => {
    expect(parse({ private: true, rated: true }).rated).toBe(true);
    expect(error({ private: true, rated: 'yes' })).toContain('rated');
  });

  it.each([
    ['no private flag (matchmaking is stage 9)', {}, 'private'],
    ['private: false', { private: false }, 'private'],
    ['one player', { private: true, playerCount: 1 }, 'playerCount'],
    ['five players', { private: true, playerCount: 5 }, 'playerCount'],
    ['an unknown game type', { private: true, gameType: 'blitz' }, 'gameType'],
    ['a bad code', { private: true, code: 'ABC10O' }, 'code'],
    ['a rule that is not open to change', { private: true, rules: { negativeScore: false } }, 'rules'],
    // The old mistake ladder is gone for good (Moshe, 2026-10-15): neither its cap nor a switch back to it.
    ['the removed [D14] penalty cap', { private: true, rules: { mistakePenaltyCap: 8 } }, 'rules'],
    ['a removed penalty rule (§6.5)', { private: true, rules: { mistakePenalty: 'doubling' } }, 'rules'],
    ['the same, as missed points', { private: true, rules: { mistakePenalty: 'missedPoints' } }, 'rules'],
    ['a grace period out of bounds', { private: true, rules: { graceMs: 10 } }, 'rules.graceMs'],
    ['a soft phase over 60 s', { private: true, rules: { softGraceMs: 60_001 } }, 'rules.softGraceMs'],
    ['a negative soft phase', { private: true, rules: { softGraceMs: -1 } }, 'rules.softGraceMs'],
    ['a soft phase that is not whole', { private: true, rules: { softGraceMs: 0.5 } }, 'rules.softGraceMs'],
    // The other rules of [D42] are not open to change by a room's creator.
    ['the offline moves', { private: true, rules: { offlineMovesMax: 20 } }, 'rules'],
    ['a fractional time', { private: true, rules: { thinkTimeMs: 1000.5 } }, 'rules.thinkTimeMs'],
    // [D47]: the room's kinds must be kinds the engine knows; a declaration must be short strings.
    [
      'an unknown interference kind',
      { private: true, rules: { interferenceKinds: ['fog'] } },
      'rules.interferenceKinds',
    ],
    [
      'kinds that are not a list',
      { private: true, rules: { interferenceKinds: 'cats' } },
      'rules.interferenceKinds',
    ],
    [
      'more than 16 kinds',
      { private: true, rules: { interferenceKinds: Array.from({ length: 17 }, () => 'cats') } },
      'rules.interferenceKinds',
    ],
    ['a declaration that is not a list', { private: true, interferenceKinds: 'cats' }, 'interferenceKinds'],
    [
      'a declared kind of 33 characters',
      { private: true, interferenceKinds: ['x'.repeat(33)] },
      'interferenceKinds',
    ],
    [
      'a declaration of 17 kinds',
      { private: true, interferenceKinds: Array.from({ length: 17 }, () => 'cats') },
      'interferenceKinds',
    ],
  ])('refuses %s', (_why, options, where) => {
    expect(error(options)).toContain(where);
  });

  it('refuses every private room in production (stage 7: outside production only)', () => {
    expect(error({ private: true }, 'production')).toContain('outside production');
  });
});
