import { fourPlayerGame, soloGame, T0 } from '../../replay/testing/games';
import {
  botDuelTable,
  fakeHistoryApi,
  historyGameOf,
  memoryRepo,
  rankedDuel,
  savePractice,
} from '../../replay/testing/sources';
import { HistoryLoader } from '../historyLoader';
import { dayOf, type HistoryEntry, mergeEntries, practiceEntry, rankedEntry } from '../historyModel';

/**
 * The history's cards and paging (spec §14.1): ranked games from the server and practices from the phone,
 * merged newest first, 20 more at a time, with the filters and the offline fallback.
 */

const MIN = 60_000;

describe('cards', () => {
  it('a ranked duel: win, place 1, both scores, my rating change, the opponent’s profile', () => {
    const table = rankedDuel();
    const result = table.state.result!;
    const mine = result.ratingChanges.find((c) => c.playerId === 'me')!;
    const nina = result.ranking.find((r) => r.playerId === 'nina')!;
    expect(rankedEntry(historyGameOf(table))).toEqual<HistoryEntry>({
      id: 'ranked-1',
      source: 'ranked',
      mode: 'ranked',
      gameType: 'fast',
      startedAt: table.state.startedAt!,
      outcome: 'win',
      place: 1,
      playerCount: 2,
      opponents: [
        { id: 'nina', name: 'NinaVolt', avatar: 'maya', isBot: false, country: 'DE', colorIndex: 1 },
      ],
      myScore: result.ranking.find((r) => r.playerId === 'me')!.score,
      opponentScore: nina.score,
      ratingDelta: Math.round(mine.after - mine.before),
    });
    // From her seat: a loss.
    expect(rankedEntry(historyGameOf(table, 'nina'))).toMatchObject({ outcome: 'loss', place: 2 });
  });

  it('a four-player game: my place, three opponents, no single opponent score', () => {
    const table = fourPlayerGame();
    const entry = rankedEntry(historyGameOf(table, 'p2'));
    const place = table.state.result!.ranking.find((r) => r.playerId === 'p2')!.place;
    expect(entry).toMatchObject({ place, playerCount: 4, opponentScore: null });
    expect(entry.outcome).toBe(place === 1 ? 'win' : 'loss');
    expect(entry.opponents.map((o) => [o.id, o.colorIndex])).toEqual([
      ['p1', 1],
      ['p3', 2],
      ['p4', 3],
    ]);
  });

  it('practices: solo (how it ended) and against a bot (the outcome, the bot’s score, no rating)', async () => {
    const repo = await memoryRepo();
    const solo = soloGame({ id: 'solo-1' });
    const bot = botDuelTable('bot-1', T0 + MIN);
    await savePractice(repo, solo);
    await savePractice(repo, bot);
    const [botRecord, soloRecord] = await repo.listRecent(10);
    expect(practiceEntry(soloRecord!)).toMatchObject({
      id: 'solo-1',
      source: 'practice',
      mode: 'solo',
      outcome: 'ended',
      place: null,
      playerCount: 1,
      opponents: [],
      opponentScore: null,
      ratingDelta: null,
    });
    const result = (await repo.getGame('bot-1'))!.result!;
    expect(practiceEntry(botRecord!, result)).toMatchObject({
      id: 'bot-1',
      mode: 'bot',
      outcome: 'win',
      place: 1,
      playerCount: 2,
      opponents: [{ id: 'bot-3', name: 'Mr. Hoot', isBot: true, colorIndex: 1 }],
      opponentScore: result.ranking.find((r) => r.playerId === 'bot-3')!.score,
      ratingDelta: null,
    });
  });

  it('merges newest first, and filters', () => {
    const e = (id: string, source: 'ranked' | 'practice', startedAt: number) =>
      ({ id, source, startedAt }) as HistoryEntry;
    const ranked = [e('r2', 'ranked', 30), e('r1', 'ranked', 10)];
    const practice = [e('p2', 'practice', 30), e('p1', 'practice', 20)];
    expect(mergeEntries(ranked, practice, 'all', 10).map((x) => x.id)).toEqual(['r2', 'p2', 'p1', 'r1']);
    expect(mergeEntries(ranked, practice, 'all', 2).map((x) => x.id)).toEqual(['r2', 'p2']);
    expect(mergeEntries(ranked, practice, 'ranked', 10).map((x) => x.id)).toEqual(['r2', 'r1']);
    expect(mergeEntries(ranked, practice, 'practice', 10).map((x) => x.id)).toEqual(['p2', 'p1']);
  });

  it('a game with friends (1.0.4): marked, never a rating change, and not under "מדורג" [D81a]', () => {
    const game = { ...historyGameOf(rankedDuel()), friends: true };
    // The server sends null ratings for it; even if a seat had numbers, the card shows none.
    const entry = rankedEntry(game);
    expect(entry).toMatchObject({ source: 'ranked', mode: 'ranked', friends: true, ratingDelta: null });
    expect(rankedEntry(historyGameOf(rankedDuel())).friends).toBeUndefined();
    const e = (id: string, startedAt: number, friends = false) =>
      ({ id, source: 'ranked', startedAt, ...(friends && { friends: true }) }) as HistoryEntry;
    const ranked = [e('f1', 40, true), e('r1', 30)];
    expect(mergeEntries(ranked, [], 'all', 10).map((x) => x.id)).toEqual(['f1', 'r1']);
    expect(mergeEntries(ranked, [], 'ranked', 10).map((x) => x.id)).toEqual(['r1']);
    expect(mergeEntries(ranked, [], 'practice', 10).map((x) => x.id)).toEqual([]);
  });

  it('"היום", "אתמול", or a date', () => {
    const now = new Date(2026, 9, 10, 9, 0).getTime();
    expect(dayOf(new Date(2026, 9, 10, 0, 5).getTime(), now)).toBe('today');
    expect(dayOf(new Date(2026, 9, 9, 23, 59).getTime(), now)).toBe('yesterday');
    expect(dayOf(new Date(2026, 9, 6, 12).getTime(), now)).toBeNull();
  });
});

describe('HistoryLoader: 20 at a time from both sources', () => {
  // 45 ranked games every 2 minutes, and 30 practices in between.
  const ranked = Array.from({ length: 45 }, (_, k) => rankedDuel(`r${k}`, T0 + k * 2 * MIN));
  let repoPromise: ReturnType<typeof memoryRepo> | null = null;
  const repo = () =>
    (repoPromise ??= (async () => {
      const r = await memoryRepo();
      for (let k = 0; k < 30; k++)
        await savePractice(r, soloGame({ id: `s${k}`, at: T0 + k * 3 * MIN + MIN }));
      return r;
    })());

  const allIds = async () => {
    const r = await repo();
    const practice = (await r.listRecent(100)).map((x) => practiceEntry(x));
    return mergeEntries(
      ranked.map((t) => rankedEntry(historyGameOf(t))),
      practice,
      'all',
      1000,
    ).map((e) => e.id);
  };

  it('pages through everything in order, without gaps or repeats', async () => {
    const loader = new HistoryLoader({ practice: repo, ranked: fakeHistoryApi(ranked) });
    const expected = await allIds();
    expect(expected).toHaveLength(75);
    let snap = await loader.show('all');
    expect(snap.entries.map((e) => e.id)).toEqual(expected.slice(0, 20));
    expect(snap.hasMore).toBe(true);
    for (const n of [40, 60]) {
      snap = await loader.more();
      expect(snap.entries.map((e) => e.id)).toEqual(expected.slice(0, n));
      expect(snap.hasMore).toBe(true);
    }
    snap = await loader.more();
    expect(snap.entries.map((e) => e.id)).toEqual(expected);
    expect(snap.hasMore).toBe(false);
    expect(snap).toMatchObject({ ranked: 'ok', practiceOk: true });
  });

  it('filters: ranked only asks the server, practice only the phone', async () => {
    const api = fakeHistoryApi(ranked);
    const loader = new HistoryLoader({ practice: repo, ranked: api });
    const practice = await loader.show('practice');
    expect(api.calls).toEqual([]);
    expect(practice.entries).toHaveLength(20);
    expect(practice.entries.every((e) => e.source === 'practice')).toBe(true);
    const only = await loader.show('ranked');
    expect(only.entries.map((e) => e.id)).toEqual(
      [...ranked]
        .reverse()
        .slice(0, 20)
        .map((t) => t.config.id),
    );
    expect(api.calls).toEqual(['games:']);
  });

  it('offline: the practices still show, and the screen is told', async () => {
    const loader = new HistoryLoader({
      practice: repo,
      ranked: fakeHistoryApi(ranked, { failWith: 'network' }),
    });
    const snap = await loader.show('all');
    expect(snap.ranked).toBe('offline');
    expect(snap.entries).toHaveLength(20);
    expect(snap.entries.every((e) => e.source === 'practice')).toBe(true);
  });

  it('signed out: practices only; no database: ranked only, with a note', async () => {
    const signedOut = await new HistoryLoader({ practice: repo, ranked: null }).show('all');
    expect(signedOut.ranked).toBe('signedOut');
    expect(signedOut.entries.every((e) => e.source === 'practice')).toBe(true);
    const noDb = await new HistoryLoader({ practice: async () => null, ranked: fakeHistoryApi(ranked) }).show(
      'all',
    );
    expect(noDb.practiceOk).toBe(false);
    expect(noDb.entries.every((e) => e.source === 'ranked')).toBe(true);
  });
});
