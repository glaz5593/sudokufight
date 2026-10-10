import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  HISTORY_PAGE_SIZE,
  HISTORY_PATHS,
  type HistoryGame,
  type HistoryPlayer,
  isHistoryGame,
  isHistoryPage,
  isReplayAnswer,
  replayPath,
} from './index';

const player = (seat: number, overrides: Partial<HistoryPlayer> = {}): HistoryPlayer => ({
  seat,
  userId: `u${seat}`,
  displayName: `P${seat}`,
  avatarId: 'av07',
  country: 'IL',
  score: 40.5,
  mistakes: 1,
  place: seat + 1,
  status: 'active',
  ratingKey: 'normal',
  ratingBefore: 1200,
  ratingAfter: 1216,
  ...overrides,
});

const game = (overrides: Partial<HistoryGame> = {}): HistoryGame => ({
  id: 'g1',
  mode: 'ranked',
  gameType: 'normal',
  playerCount: 2,
  startedAt: 1_760_000_000_000,
  endedAt: 1_760_000_400_000,
  endReason: 'boardComplete',
  mySeat: 0,
  players: [player(0), player(1)],
  ...overrides,
});

describe('history routes (spec §14.1, work plan stage 11)', () => {
  it('names the routes, 20 games a page', () => {
    expect(HISTORY_PATHS).toEqual({ myGames: '/v1/me/games', replay: '/v1/games/:id/replay' });
    expect(replayPath('a1-b2')).toBe('/v1/games/a1-b2/replay');
    expect(replayPath('a/b')).toBe('/v1/games/a%2Fb/replay');
    expect(HISTORY_PAGE_SIZE).toBe(20);
  });

  it('round-trips the cursor and refuses anything else', () => {
    const c = { startedAt: 1_760_000_000_123, id: '4b8e2f5c-1d1a-4c9e-9d0a-0f1e2d3c4b5a' };
    expect(decodeHistoryCursor(encodeHistoryCursor(c))).toEqual(c);
    expect(decodeHistoryCursor('12_g_1')).toEqual({ startedAt: 12, id: 'g_1' });
    for (const bad of ['', '_g1', 'x_g1', '12_', '12_a b', '12', 12, null, undefined, '1.5_g1', '-1_g1'])
      expect(decodeHistoryCursor(bad)).toBeNull();
  });
});

describe('answer checks (the app refuses what it can not read)', () => {
  it('takes a well-formed game, page and replay', () => {
    expect(isHistoryGame(game())).toBe(true);
    expect(isHistoryGame(game({ endedAt: null, endReason: null }))).toBe(true);
    expect(
      isHistoryGame(
        game({ players: [player(0), player(1, { userId: null, displayName: null, avatarId: null })] }),
      ),
    ).toBe(true);
    expect(isHistoryPage({ games: [game()], nextCursor: '1_g1' })).toBe(true);
    expect(isHistoryPage({ games: [], nextCursor: null })).toBe(true);
    const events = [
      { seq: 1, t: 5, type: 'gameCreated', config: {} },
      { seq: 2, t: 6, type: 'gameStarted' },
    ];
    expect(isReplayAnswer({ game: game(), events })).toBe(true);
  });

  it('refuses broken games', () => {
    expect(isHistoryGame(game({ mode: 'private' as never }))).toBe(false);
    expect(isHistoryGame(game({ gameType: 'easy' as never }))).toBe(false);
    expect(isHistoryGame(game({ mySeat: 3 }))).toBe(false);
    expect(isHistoryGame(game({ endReason: 'timeout' as never }))).toBe(false);
    expect(isHistoryGame(game({ players: [player(0, { avatarId: 'av36' as never })] }))).toBe(false);
    expect(isHistoryGame(game({ players: [player(0, { status: 'gone' as never })] }))).toBe(false);
    expect(isHistoryGame(game({ players: [player(0, { score: Number.NaN })] }))).toBe(false);
    expect(isHistoryGame(null)).toBe(false);
    expect(isHistoryPage({ games: [game()] })).toBe(false);
    expect(isHistoryPage({ games: [{}], nextCursor: null })).toBe(false);
  });

  it('refuses a replay without its log, or one that does not start with gameCreated', () => {
    expect(isReplayAnswer({ game: game(), events: [] })).toBe(false);
    expect(isReplayAnswer({ game: game(), events: [{ seq: 1, t: 5, type: 'gameStarted' }] })).toBe(false);
    expect(isReplayAnswer({ game: game(), events: [{ seq: 1, type: 'gameCreated' }] })).toBe(false);
    expect(isReplayAnswer({ events: [{ seq: 1, t: 5, type: 'gameCreated' }] })).toBe(false);
  });
});
