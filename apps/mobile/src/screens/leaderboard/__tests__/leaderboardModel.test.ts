import { board, entry, fakeProgressApi, ranked } from '../../../api/testing/fakeProgress';
import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { LeaderboardFeed } from '../leaderboardFeed';
import {
  appendPage,
  captionOf,
  entryLabel,
  isGameTypeTab,
  leagueWords,
  type ProgressT,
  rankText,
  showsPlayersPicker,
  splitPodium,
} from '../leaderboardModel';

/** The leaderboard's pure model and its data (spec §14.2). */

const he = i18n.getFixedT('he', 'progress') as ProgressT;
const en = i18n.getFixedT('en', 'progress') as ProgressT;

describe('splitPodium', () => {
  it('the first three of a board that starts at the top are the podium; the rest are rows', () => {
    const { podium, rows } = splitPodium(ranked(5));
    expect(podium.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(rows.map((e) => e.rank)).toEqual([4, 5]);
  });

  it('a shorter board, an empty one, and one that does not start at 1', () => {
    expect(splitPodium(ranked(2)).podium).toHaveLength(2);
    expect(splitPodium([])).toEqual({ podium: [], rows: [] });
    expect(splitPodium(ranked(3, 51)).podium).toEqual([]);
  });

  it('a shared rank is the server’s: equal ratings, equal places', () => {
    const tied = [entry({ id: 'a', rank: 1 }), entry({ id: 'b', rank: 1 }), entry({ id: 'c', rank: 3 })];
    expect(splitPodium(tied).podium.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('appendPage', () => {
  it('appends the next page, without a player twice, and takes the newest pinned row and cursor', () => {
    const first = board({ entries: ranked(3), nextCursor: '3', me: entry({ id: 'me', rank: 90 }) });
    const next = board({ entries: [...ranked(1, 3), ...ranked(2, 4)], nextCursor: null, me: null });
    const merged = appendPage(first, next);
    expect(merged.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.nextCursor).toBeNull();
    expect(merged.me?.id).toBe('me');
  });
});

describe('words', () => {
  it('a rank is isolated, so "#" stays before the number in Hebrew', () => {
    expect(rankText(214)).toBe(ltr('#214'));
  });

  it('a row for screen readers, in Hebrew and English', () => {
    const e = entry({ id: 'x', displayName: 'PandaPro', rank: 4, rating: 1418, league: 'legend', level: 9 });
    expect(entryLabel(e, he, 'he', false)).toBe('מקום 4, PandaPro, ישראל, ליגת אגדה, רמה 9, דירוג 1418');
    expect(entryLabel(e, en, 'en', true)).toBe(
      'Place 4, PandaPro (you), Israel, Legend league, Level 9, Rating 1418',
    );
    const provisional = entry({ id: 'y', league: null, provisional: true, country: null, rating: 1200 });
    expect(entryLabel(provisional, he, 'he', false)).toBe('מקום 1, y, בדירוג זמני, רמה 5, דירוג 1200, זמני');
    expect(leagueWords({ league: null }, en)).toBe('Provisional rating');
  });

  it('the caption says what a tab ranks by', () => {
    expect(captionOf('general', null, he)).toBe('כללי · הדירוג הגבוה של כל שחקן');
    expect(captionOf('normal', board({ players: null }), he)).toBe('דירוג רגיל · כל העולם');
    expect(captionOf('fast', board({ players: 3 }), he)).toBe('דירוג מהיר · 3 שחקנים · כל העולם');
    expect(captionOf('hard', board({ players: 2 }), en)).toBe('Hard rating · 2 players · worldwide');
    expect(captionOf('friends', null, en)).toBe('Your recent opponents');
  });
});

describe('the 2 / 3 / 4 picker (spec §11.1)', () => {
  it('shows on a game-type tab only under option A (the server answers with a table size)', () => {
    expect(isGameTypeTab('fast')).toBe(true);
    expect(isGameTypeTab('general')).toBe(false);
    expect(showsPlayersPicker('normal', board({ players: 2 }))).toBe(true);
    expect(showsPlayersPicker('normal', board({ players: null }))).toBe(false);
    expect(showsPlayersPicker('general', board({ players: 2 }))).toBe(false);
    expect(showsPlayersPicker('normal', null)).toBe(false);
  });
});

describe('LeaderboardFeed', () => {
  it('reads a tab, then more pages by the cursor; keeps each tab for when it is opened again', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(120) }, pageSize: 50 });
    const feed = new LeaderboardFeed(api);
    const first = await feed.first('general', null);
    expect(first).toMatchObject({ status: 'ok' });
    expect(first.board?.entries).toHaveLength(50);
    const more = await feed.more('general', null);
    expect(more.board?.entries).toHaveLength(100);
    expect(api.queries.at(-1)).toEqual({ tab: 'general', players: null, cursor: '50' });
    await feed.more('general', null);
    const end = await feed.more('general', null);
    expect(end.board?.entries).toHaveLength(120);
    expect(api.queries).toHaveLength(3);
    expect(feed.peek('general', null).board?.entries).toHaveLength(120);
  });

  it('option A: the server’s own size is that size’s board too; the cursor keeps the size', async () => {
    const api = fakeProgressApi({ sized: { 'fast:2': ranked(60), 'fast:3': ranked(4) }, pageSize: 50 });
    const feed = new LeaderboardFeed(api);
    const first = await feed.first('fast', null);
    expect(first.board?.players).toBe(2);
    expect(feed.peek('fast', 2).board).toBe(first.board);
    await feed.more('fast', null);
    expect(api.queries.at(-1)).toEqual({ tab: 'fast', players: 2, cursor: '50' });
    expect((await feed.first('fast', 3)).board?.entries).toHaveLength(4);
  });

  it('offline: what was read stays, and the status says so', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(5) } });
    const feed = new LeaderboardFeed(api);
    await feed.first('general', null);
    api.failWith = 'network';
    await expect(feed.first('general', null)).resolves.toMatchObject({ status: 'offline' });
    expect((await feed.first('general', null)).board?.entries).toHaveLength(5);
    api.failWith = 'internal';
    expect((await feed.first('normal', null)).status).toBe('offline');
    api.failWith = 'badRequest';
    expect((await feed.first('normal', null)).status).toBe('error');
    api.failWith = 'notRegistered';
    expect((await feed.first('normal', null)).status).toBe('signedOut');
  });

  it('signed out: no requests', async () => {
    const feed = new LeaderboardFeed(null);
    await expect(feed.first('general', null)).resolves.toMatchObject({ status: 'signedOut', board: null });
    await expect(feed.more('general', null)).resolves.toMatchObject({ status: 'signedOut' });
  });
});
