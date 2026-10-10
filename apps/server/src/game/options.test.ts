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
        rules: { graceMs: 500, thinkTimeMs: 3000, turnModel: 'turns', mistakePenaltyCap: null },
      }),
    ).toEqual({
      code: 'ABC234',
      gameType: 'hard',
      playerCount: 4,
      rules: { graceMs: 500, thinkTimeMs: 3000, turnModel: 'turns', mistakePenaltyCap: null },
      rated: false,
    });
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
    ['a grace period out of bounds', { private: true, rules: { graceMs: 10 } }, 'rules.graceMs'],
    ['a fractional time', { private: true, rules: { thinkTimeMs: 1000.5 } }, 'rules.thinkTimeMs'],
  ])('refuses %s', (_why, options, where) => {
    expect(error(options)).toContain(where);
  });

  it('refuses every private room in production (stage 7: outside production only)', () => {
    expect(error({ private: true }, 'production')).toContain('outside production');
  });
});
