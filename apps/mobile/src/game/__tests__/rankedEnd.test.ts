import {
  DEFAULT_RATING_RULES,
  type Digit,
  type GameState,
  ManualClock,
  ManualScheduler,
  type PlayerInfo,
  type Rules,
} from '@sudoku-fight/engine';
import type { Me, RatingEntry } from '@sudoku-fight/protocol';

import { FakeGame, ME, OPP, rankedConfig } from '../../net/testing/fakeServer';
import { rankedEndOf, rankedLeftOf, storedIn } from '../rankedEnd';

/**
 * The end of a rated ranked game, as the account's numbers will follow it (Moshe's device test of 1.0.0: the
 * rating did not follow a ranked game until the app restarted): its rating key, my games in it before the
 * game, my change, and whether the server will count it. Real games of the engine, ended by a surrender.
 */

const RATED: PlayerInfo[] = [
  { id: ME, name: 'Moshe', rating: 1287, ratedGames: 9 },
  { id: OPP, name: 'Rival', rating: 1305, ratedGames: 30 },
];

function game(players: PlayerInfo[] = RATED, rules: Partial<Rules> = {}) {
  const clock = new ManualClock(1_700_000_000_000);
  const g = new FakeGame(rankedConfig({ players, rules }), () => clock.now(), new ManualScheduler(clock));
  g.apply({ type: 'start' });
  return g;
}

/**
 * A game the opponent gave up on (2 players: over at once, I win). With `iMoved`, I place a right digit
 * first: an opponent who leaves before my first move gives me no rating (a leave guard, spec §11.2).
 */
function over(players?: PlayerInfo[], rules?: Partial<Rules>, { iMoved = false } = {}): GameState {
  const g = game(players, rules);
  if (iMoved) {
    const cell = g.state.grid.findIndex((v) => v === 0);
    g.act(ME, { type: 'select', cell });
    g.act(ME, { type: 'place', cell, digit: Number(g.state.config.puzzle.solution[cell]) as Digit });
  }
  g.act(players?.[1]?.id ?? OPP, { type: 'surrender' });
  expect(g.state.status).toBe('over');
  return g.state;
}

const withMode = (state: GameState, mode: GameState['config']['mode']): GameState => ({
  ...state,
  config: { ...state.config, mode },
});

const entry = (key: string, games: number, rating = 1300): RatingEntry => ({
  key,
  rating,
  games,
  provisional: games < 10,
  peak: rating,
});

const meWith = (...ratings: RatingEntry[]): Me => ({
  id: ME,
  displayName: 'Moshe',
  avatarId: 'sun',
  country: 'IL',
  email: null,
  emailVerified: true,
  createdAt: 1,
  displayNameChangedAt: null,
  nextRenameAt: null,
  ratings,
});

describe('rankedEndOf', () => {
  it('a rated 2-player game that is over: its key, my games before it, my change, stored by the server', () => {
    const state = over(RATED, {}, { iMoved: true });
    const mine = state.result!.ratingChanges.find((c) => c.playerId === ME)!;
    expect(rankedEndOf(state, ME)).toEqual({
      gameId: state.config.id,
      playerId: ME,
      key: state.config.gameType,
      gamesBefore: 9,
      provisionalGames: DEFAULT_RATING_RULES.provisionalGames,
      change: mine,
      expectsStored: true,
      left: false,
      waitMs: 0,
    });
    expect(mine.after).toBeGreaterThan(mine.before);
  });

  it('the key follows rules.rating.option [D7]: per type (B), or per type and players (A)', () => {
    const a = { rating: { ...DEFAULT_RATING_RULES, option: 'A' as const } };
    const type = rankedConfig().gameType;
    expect(rankedEndOf(over(RATED, a), ME)?.key).toBe(`${type}-2p`);
    const three: PlayerInfo[] = [...RATED, { id: 'p3', rating: 1250, ratedGames: 12 }];
    const g = game(three, a);
    g.act(OPP, { type: 'surrender' });
    g.act('p3', { type: 'surrender' });
    expect(g.state.status).toBe('over');
    expect(rankedEndOf(g.state, ME)).toMatchObject({ key: `${type}-3p`, expectsStored: true });
  });

  it('nothing to follow: not over, a practice, a dev room (no ratings), or a game I am not in', () => {
    expect(rankedEndOf(game().state, ME)).toBeNull();
    const state = over();
    expect(rankedEndOf({ ...state, result: null }, ME)).toBeNull();
    expect(rankedEndOf(withMode(state, 'bot'), ME)).toBeNull();
    expect(rankedEndOf(withMode(state, 'solo'), ME)).toBeNull();
    expect(rankedEndOf(over([{ id: ME }, { id: OPP }]), ME)).toBeNull();
    expect(rankedEndOf(over([{ id: ME, rating: 1200 }, { id: OPP }]), ME)).toBeNull();
    expect(rankedEndOf(state, 'someone-else')).toBeNull();
  });

  it('a 0 the leave guards held (the opponent left before my first move) is still a change the server counts', () => {
    const state = over();
    const mine = state.result!.ratingChanges.find((c) => c.playerId === ME)!;
    expect(mine).toMatchObject({ delta: 0, after: mine.before });
    expect(rankedEndOf(state, ME)).toMatchObject({ change: mine, expectsStored: true });
  });

  it('no ratedGames in the config counts as 0 games before', () => {
    const state = over([
      { id: ME, rating: 1200 },
      { id: OPP, rating: 1200, ratedGames: 4 },
    ]);
    expect(rankedEndOf(state, ME)).toMatchObject({ gamesBefore: 0, expectsStored: true });
  });

  it('a rated game whose result moved no rating of mine: no change, nothing the server counts for me', () => {
    const state = over();
    const without: GameState = {
      ...state,
      result: {
        ...state.result!,
        ratingChanges: state.result!.ratingChanges.filter((c) => c.playerId !== ME),
      },
    };
    expect(rankedEndOf(without, ME)).toMatchObject({ change: null, expectsStored: false, left: false });
  });
});

describe('rankedLeftOf', () => {
  it('leaving a running rated 2-player game: stored after the grace (abandonment, D32)', () => {
    const g = game(RATED, { graceMs: 15_000 });
    expect(rankedLeftOf(g.state, ME, 2000)).toEqual({
      gameId: g.state.config.id,
      playerId: ME,
      key: g.state.config.gameType,
      gamesBefore: 9,
      provisionalGames: DEFAULT_RATING_RULES.provisionalGames,
      change: null,
      expectsStored: true,
      left: true,
      waitMs: 17_000,
    });
  });

  it('nothing to wait for: a game that is over, 3–4 players (stored when the whole game ends), unrated', () => {
    expect(rankedLeftOf(over(), ME, 2000)).toBeNull();
    const three: PlayerInfo[] = [...RATED, { id: 'p3', rating: 1250, ratedGames: 12 }];
    expect(rankedLeftOf(game(three).state, ME, 2000)).toBeNull();
    expect(rankedLeftOf(game([{ id: ME }, { id: OPP }]).state, ME, 2000)).toBeNull();
    expect(rankedLeftOf(withMode(game().state, 'bot'), ME, 2000)).toBeNull();
  });
});

describe('storedIn', () => {
  it('true once the server counts more games in the key than before the game', () => {
    const end = rankedEndOf(over(), ME)!;
    expect(storedIn(meWith(entry(end.key, 9)), end)).toBe(false);
    expect(storedIn(meWith(entry(end.key, 10)), end)).toBe(true);
    // Another key moving says nothing about this game.
    expect(storedIn(meWith(entry(end.key, 9), entry('hard', 50)), end)).toBe(false);
    // A key the server does not list (the rating option changed meanwhile).
    expect(storedIn(meWith(entry('hard', 50)), end)).toBe(false);
  });

  it('false for a game the server will not count for me', () => {
    const end = { ...rankedEndOf(over(), ME)!, change: null, expectsStored: false };
    expect(storedIn(meWith(entry(end.key, 99)), end)).toBe(false);
  });
});
