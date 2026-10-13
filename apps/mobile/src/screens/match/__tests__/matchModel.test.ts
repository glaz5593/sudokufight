import { MATCH_RANGE } from '@sudoku-fight/protocol';

import { MatchmakingFailure, type MatchmakingInfo } from '../../../net/matchmaking';
import { MATCH_PLAYERS } from '../../../net/testing/fakeMatchmaking';
import { clockText, countdownStep, headerOf, matchScreenModel, rangeOf, seatsOf } from '../matchModel';

/** Which match screen, and with what (stage 9, spec §10): pure, from the search and the time. */

const T = 1_000_000;
const self = { name: 'Moshe', avatarId: 'lava-lamp' as const };

const base: MatchmakingInfo = {
  phase: 'connecting',
  queueKey: 'normal-2p',
  search: null,
  match: null,
  timeout: null,
  fellThrough: null,
  error: null,
  hasGame: false,
};
const info = (o: Partial<MatchmakingInfo>): MatchmakingInfo => ({ ...base, ...o });
const search = {
  rating: 1287,
  range: 75,
  extended: false,
  startedAt: T - 14_000,
  timeoutAt: T + 46_000,
  requeued: false,
};
const match = {
  matchId: 'm1',
  me: 'me',
  players: MATCH_PLAYERS,
  rematch: false,
  ready: ['me'],
  readyBy: T + 10_000,
  goAt: null,
};

describe('matchScreenModel', () => {
  it('connecting: the search screen with no rating or range yet', () => {
    expect(matchScreenModel(base, self, T)).toEqual({
      kind: 'search',
      header: { gameType: 'normal', players: 2 },
      connecting: true,
      elapsedMs: 0,
      me: { ...self, rating: null },
      range: null,
      openSeats: 1,
      requeued: false,
    });
  });

  it('searching: the search time, my rating and the range around it', () => {
    const m = matchScreenModel(info({ phase: 'searching', search }), self, T);
    expect(m).toMatchObject({
      kind: 'search',
      connecting: false,
      elapsedMs: 14_000,
      me: { rating: 1287 },
      range: { low: 1212, high: 1362, half: 75, extended: false },
    });
    // A match that fell through: back at the head of the queue, and the screen says so.
    expect(
      matchScreenModel(
        info({ phase: 'searching', search, fellThrough: { reason: 'noShow', missing: ['opp'] } }),
        self,
        T,
      ),
    ).toMatchObject({ requeued: true });
  });

  it('the range bar widens toward the cap, and runs to the ends with no cap', () => {
    expect(rangeOf(1200, MATCH_RANGE.initial, false).widened).toBe(0);
    expect(rangeOf(1200, 175, false).widened).toBe(0.5);
    expect(rangeOf(1200, MATCH_RANGE.cap, false).widened).toBe(1);
    expect(rangeOf(1200, 50, true)).toEqual({ low: 1150, high: 1250, half: 50, extended: true, widened: 1 });
  });

  it('timeout: how long and in what range it searched', () => {
    const timeout = { elapsedMs: 60_000, range: 300, extended: false, keepSearchingUntil: T + 60_000 };
    expect(matchScreenModel(info({ phase: 'timeout', search, timeout }), self, T)).toEqual({
      kind: 'timeout',
      header: { gameType: 'normal', players: 2 },
      elapsedMs: 60_000,
      range: { low: 987, high: 1587, half: 300, extended: false, widened: 1 },
    });
  });

  it('found: the seats in order, me as P1 and the others after, and who is ready', () => {
    const m = matchScreenModel(info({ phase: 'found', search, match }), self, T);
    expect(m).toMatchObject({ kind: 'found', readyCount: 1, allReady: false, rematch: false });
    if (m.kind !== 'found') throw new Error('found');
    expect(m.seats.map((s) => [s.id, s.isMe, s.colorIndex, s.ready, s.provisional])).toEqual([
      ['me', true, 0, true, false],
      ['opp', false, 1, false, true],
    ]);
    const all = matchScreenModel(
      info({ phase: 'found', match: { ...match, ready: ['me', 'opp'] } }),
      self,
      T,
    );
    expect(all).toMatchObject({ allReady: true, readyCount: 2 });
  });

  it('me in P1 whatever my seat, and a bad avatar id falls back to the empty one', () => {
    const players = [{ ...MATCH_PLAYERS[1]!, avatarId: 'zz' as never }, { ...MATCH_PLAYERS[0]! }];
    const seats = seatsOf(info({ phase: 'found', match: { ...match, players } }));
    expect(seats.map((s) => [s.id, s.colorIndex, s.avatarId])).toEqual([
      ['opp', 1, 'av00'],
      ['me', 0, 'lava-lamp'],
    ]);
  });

  it('countdown: 3 · 2 · 1 by the second, GO at goAt, and GO holds until the board is here', () => {
    const counting = (now: number) =>
      matchScreenModel(info({ phase: 'countdown', match: { ...match, goAt: T + 3000 } }), self, now);
    expect(
      [T, T + 999, T + 1000, T + 2500, T + 2999, T + 3000, T + 4000].map((t) => {
        const m = counting(t);
        return m.kind === 'countdown' ? m.step : m.kind;
      }),
    ).toEqual([3, 3, 2, 1, 1, 'go', 'go']);
    const m = counting(T);
    expect(m.kind === 'countdown' && m.seats.every((s) => s.ready)).toBe(true);
    expect(matchScreenModel(info({ phase: 'started', match }), self, T)).toMatchObject({
      kind: 'countdown',
      step: 'go',
    });
    expect(matchScreenModel(info({ phase: 'started', match, hasGame: true }), self, T)).toEqual({
      kind: 'play',
    });
    expect(matchScreenModel(info({ phase: 'found', match, hasGame: true }), self, T)).toEqual({
      kind: 'play',
    });
  });

  it('failed and cancelled', () => {
    const error = new MatchmakingFailure('alreadyQueued', 'x', 4215);
    expect(matchScreenModel(info({ phase: 'failed', error }), self, T)).toEqual({
      kind: 'failed',
      header: { gameType: 'normal', players: 2 },
      code: 'alreadyQueued',
      supportCode: 'alreadyQueued-4215',
    });
    expect(matchScreenModel(info({ phase: 'cancelled' }), self, T)).toEqual({ kind: 'cancelled' });
  });
});

describe('helpers', () => {
  it('reads a queue key, counts down, and writes the search time', () => {
    expect(headerOf('hard-4p')).toEqual({ gameType: 'hard', players: 4 });
    expect([3001, 3000, 2000, 1001, 1000, 1, 0, -5].map(countdownStep)).toEqual([
      3,
      3,
      2,
      2,
      1,
      1,
      'go',
      'go',
    ]);
    expect([0, 999, 14_000, 60_000, 75_500].map(clockText)).toEqual(['0:00', '0:00', '0:14', '1:00', '1:15']);
  });
});
