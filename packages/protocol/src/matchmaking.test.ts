import {
  COUNTDOWN_MS,
  isQueueKey,
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  MATCHMAKING_ERRORS,
  MATCHMAKING_SERVER_MESSAGE_TYPES,
  matchmakingErrorOf,
  matchRange,
  OPEN_QUEUE_PLAYER_COUNTS,
  parseQueueKey,
  QUEUE_KEYS,
  QUEUE_PLAYER_COUNTS,
  queueKey,
  rangeCovering,
  READY_TIMEOUT_MS,
} from './index';

describe('queues (spec §10: one per game type and number of players)', () => {
  it('has nine queue keys, fast-2p … hard-4p', () => {
    expect(QUEUE_KEYS).toEqual([
      'fast-2p',
      'fast-3p',
      'fast-4p',
      'normal-2p',
      'normal-3p',
      'normal-4p',
      'hard-2p',
      'hard-3p',
      'hard-4p',
    ]);
    expect(queueKey('normal', 2)).toBe('normal-2p');
  });

  it('parses a queue key back, and nothing else', () => {
    expect(parseQueueKey('hard-4p')).toEqual({ gameType: 'hard', players: 4 });
    for (const bad of ['hard-5p', 'hard-1p', 'easy-2p', 'normal', 'normal-2', ' fast-2p', 2, null, undefined])
      expect(parseQueueKey(bad)).toBeNull();
    expect(QUEUE_KEYS.every(isQueueKey)).toBe(true);
  });

  it('opens the queues of 2, 3 and 4 players (3–4 since stage 10)', () => {
    expect(OPEN_QUEUE_PLAYER_COUNTS).toEqual([2, 3, 4]);
    expect(OPEN_QUEUE_PLAYER_COUNTS).toEqual([...QUEUE_PLAYER_COUNTS]);
  });
});

describe('the rating range [D6]', () => {
  it('starts at ±50 and widens by 25 every 5 s', () => {
    expect(MATCH_RANGE).toEqual({ initial: 50, step: 25, stepMs: 5000, cap: 300 });
    expect(matchRange(0)).toBe(50);
    expect(matchRange(4999)).toBe(50);
    expect(matchRange(5000)).toBe(75);
    // The design's note: 14 s into the search the range is ±100.
    expect(matchRange(14_000)).toBe(100);
  });

  it('reaches the cap of ±300 at 50 s and stays there', () => {
    expect(matchRange(49_999)).toBe(275);
    expect(matchRange(50_000)).toBe(300);
    expect(matchRange(MATCH_TIMEOUT_MS)).toBe(300);
    expect(matchRange(10 * 60_000)).toBe(300);
  });

  it('"keep searching" removes the cap: the range goes on widening', () => {
    expect(matchRange(50_000, true)).toBe(300);
    expect(matchRange(60_000, true)).toBe(350);
    expect(matchRange(65_000, true)).toBe(375);
  });

  it('treats a negative elapsed time as zero', () => {
    expect(matchRange(-3000)).toBe(50);
  });
});

describe('the next range: the narrowest D6 range that covers a distance (nextRange)', () => {
  it('rounds up to the grid: ±50, then steps of 25', () => {
    expect([0, 50, 51, 75, 76, 150, 151, 299, 300].map((d) => rangeCovering(d))).toEqual([
      50, 50, 75, 75, 100, 150, 175, 300, 300,
    ]);
    // Never narrower than the range a search starts with.
    expect(rangeCovering(-10)).toBe(50);
  });

  it('is a range the search reaches: the same grid as matchRange', () => {
    for (let d = 0; d <= 300; d += 7) {
      const r = rangeCovering(d);
      expect(r).toBeGreaterThanOrEqual(d);
      const at = Math.max(0, ((r - MATCH_RANGE.initial) / MATCH_RANGE.step) * MATCH_RANGE.stepMs);
      expect(matchRange(at)).toBe(r);
    }
  });

  it('stops at the cap of ±300, unless "keep searching" lifted it', () => {
    expect(rangeCovering(350)).toBe(300);
    expect(rangeCovering(350, true)).toBe(350);
    expect(rangeCovering(351, true)).toBe(375);
  });

  it('follows custom rules', () => {
    const rules = { initial: 40, step: 20, stepMs: 1000, cap: 290 };
    expect(rangeCovering(30, false, rules)).toBe(40);
    expect(rangeCovering(280, false, rules)).toBe(280);
    expect(rangeCovering(285, false, rules)).toBe(290);
    expect(rangeCovering(285, true, rules)).toBe(300);
  });
});

describe('timings and messages', () => {
  it('times out after 60 s; ready within 10 s; a 3-second countdown', () => {
    expect(MATCH_TIMEOUT_MS).toBe(60_000);
    expect(READY_TIMEOUT_MS).toBe(10_000);
    expect(COUNTDOWN_MS).toBe(3000);
  });

  it('lists the server messages', () => {
    expect(MATCHMAKING_SERVER_MESSAGE_TYPES).toEqual([
      'searching',
      'found',
      'ready',
      'countdown',
      'started',
      'matchCancelled',
      'timeout',
      'cancelled',
      'pong',
    ]);
  });

  it('reads the refusal at the start of an error message', () => {
    expect(matchmakingErrorOf('queueClosed: 3–4 players come later')).toBe('queueClosed');
    expect(matchmakingErrorOf('alreadyQueued: searching on another device')).toBe('alreadyQueued');
    expect(matchmakingErrorOf('room "x" not found')).toBeNull();
    expect(matchmakingErrorOf('emailNotVerified: Ranked games need a verified email address')).toBe(
      'emailNotVerified',
    );
    expect(MATCHMAKING_ERRORS).toContain('unauthenticated');
  });
});
