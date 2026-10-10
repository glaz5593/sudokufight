import { botPlayer, ENGINE_VERSION, type GameEvent, type GameResult, replay } from '@sudoku-fight/engine';

import {
  type Migration,
  MIGRATIONS,
  migrate,
  type NewPracticeGame,
  openPracticeRepo,
  type PracticeRepo,
} from '../practiceRepo';
import { answerIn, emptyCellsOf, PUZZLE, testHost, wrongIn } from '../testing/practice';
import { memoryDb, type SqlJsDb } from '../testing/sqlJsDb';

const newGame = (id: string, o: Partial<NewPracticeGame> = {}): NewPracticeGame => ({
  id,
  mode: 'solo',
  gameType: 'fast',
  puzzleId: PUZZLE.id,
  playerId: 'me',
  seed: 42,
  startedAt: 1_000_000,
  ...o,
});

/** A real game's log: two correct moves, one wrong, and (with `finish`) every other cell to the end. */
function playedLog({ finish = false } = {}) {
  const { host, scheduler } = testHost();
  const empty = emptyCellsOf(PUZZLE);
  for (const cell of empty.slice(0, 2)) {
    scheduler.advance(1500);
    host.select(cell);
    host.place(cell, answerIn(PUZZLE, cell));
  }
  scheduler.advance(1500);
  host.select(empty[2]!);
  host.place(empty[2]!, wrongIn(PUZZLE, empty[2]!));
  if (finish)
    for (const cell of empty.slice(2)) {
      scheduler.advance(1500);
      host.select(cell);
      host.place(cell, answerIn(PUZZLE, cell));
    }
  return { events: [...host.events], state: host.state };
}

/** Level 2: { id: 'bot-2', name: 'Biscuit', isBot: true }. */
const BOT = botPlayer(2);

/**
 * Me against a bot whose moves the test dispatches: `who` fills the empty cells, a second apart (all of them,
 * so the game ends, or the first `cutAfter`).
 */
function duelLog(who: 'me' | 'bot', { cutAfter = Infinity } = {}) {
  const { host, scheduler } = testHost({ mode: 'bot', players: [{ id: 'me' }, BOT] });
  for (const cell of emptyCellsOf(PUZZLE).slice(0, cutAfter)) {
    scheduler.advance(1000);
    const digit = answerIn(PUZZLE, cell);
    if (who === 'me') {
      host.select(cell);
      host.place(cell, digit);
    } else {
      host.dispatch({ type: 'select', cell, playerId: BOT.id });
      host.dispatch({ type: 'place', cell, digit, playerId: BOT.id });
    }
  }
  return { events: [...host.events], state: host.state };
}

const tables = async (db: SqlJsDb) =>
  (
    await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    )
  ).map((r) => r.name);

const userVersion = async (db: SqlJsDb) =>
  (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))!.user_version;

let db: SqlJsDb;
let repo: PracticeRepo;

beforeEach(async () => {
  db = await memoryDb();
  repo = await openPracticeRepo(db);
});
afterEach(() => db.close());

/** The newest schema version. */
const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version;

describe('migrations (PRAGMA user_version)', () => {
  it('creates the schema on a new database', async () => {
    expect(LATEST).toBe(2);
    expect(await userVersion(db)).toBe(LATEST);
    expect(await tables(db)).toEqual(['practice_events', 'practice_games', 'puzzle_plays']);
  });

  it('runs nothing on a database that is up to date, and keeps its data', async () => {
    await repo.createGame(newGame('g1'));
    const before = db.statements;
    expect(await migrate(db)).toBe(LATEST);
    expect(db.statements - before).toBe(1); // reading user_version
    expect(await (await openPracticeRepo(db)).listRecent()).toHaveLength(1);
  });

  it('moves an older database forward, step by step, keeping its data', async () => {
    await repo.createGame(newGame('g1'));
    const next: Migration[] = [
      ...MIGRATIONS,
      { version: LATEST + 2, sql: 'CREATE TABLE third (x INTEGER);' },
      { version: LATEST + 1, sql: 'ALTER TABLE practice_games ADD COLUMN note TEXT;' },
    ];
    expect(await migrate(db, next)).toBe(LATEST + 2);
    expect(await userVersion(db)).toBe(LATEST + 2);
    expect(await tables(db)).toContain('third');
    const row = await db.getFirstAsync<{ id: string; note: string | null }>(
      'SELECT id, note FROM practice_games',
      [],
    );
    expect(row).toEqual({ id: 'g1', note: null });
  });

  it('a step that fails leaves no trace: version and schema stay', async () => {
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: LATEST + 1, sql: 'CREATE TABLE half (x INTEGER); THIS IS NOT SQL;' },
    ];
    await expect(migrate(db, broken)).rejects.toThrow();
    expect(await userVersion(db)).toBe(LATEST);
    expect(await tables(db)).not.toContain('half');
  });

  it('a stage-4 database (v1) moves to v2: its games read as solo practices, with no opponents and no outcome', async () => {
    const old = await memoryDb();
    try {
      expect(await migrate(old, MIGRATIONS.slice(0, 1))).toBe(1);
      await old.runAsync(
        'INSERT INTO practice_games (id, mode, game_type, puzzle_id, player_id, seed, started_at, status, ' +
          "score, engine_version) VALUES ('old', 'solo', 'fast', 'p', 'me', 1, 5, 'finished', 12.5, '0.1.0')",
        [],
      );
      const upgraded = await openPracticeRepo(old);
      expect(await userVersion(old)).toBe(2);
      expect(await upgraded.listRecent()).toEqual([
        expect.objectContaining({ id: 'old', score: 12.5, opponents: [], place: null, outcome: null }),
      ]);
      expect(await upgraded.listByMode('solo')).toHaveLength(1);
    } finally {
      old.close();
    }
  });

  it('refuses a database newer than the app', async () => {
    await db.execAsync('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/v99/);
  });
});

describe('a game and its full event log [D25]', () => {
  it('saves the row and the puzzle play together', async () => {
    await repo.createGame(newGame('g1'));
    expect(await repo.getGame('g1')).toEqual({
      ...newGame('g1'),
      endedAt: null,
      status: 'playing',
      endReason: null,
      score: null,
      mistakes: null,
      correct: null,
      durationMs: null,
      opponents: [],
      place: null,
      outcome: null,
      engineVersion: ENGINE_VERSION,
      result: null,
    });
    expect(await repo.playHistory('fast')).toEqual([{ puzzleId: PUZZLE.id, playedAt: 1_000_000 }]);
  });

  it('row and play go in together or not at all', async () => {
    await repo.createGame(newGame('g1'));
    await expect(repo.createGame(newGame('g1', { startedAt: 5 }))).rejects.toThrow(); // same id
    expect(await repo.playHistory('fast')).toHaveLength(1);
    db.failOnce('INSERT INTO puzzle_plays');
    await expect(repo.createGame(newGame('g2'))).rejects.toThrow(/on purpose/);
    expect(await repo.getGame('g2')).toBeNull();
    expect(await repo.playHistory('fast')).toHaveLength(1);
  });

  it('keeps every event, solution included, and gives them back in seq order', async () => {
    const { events, state } = playedLog();
    await repo.createGame(newGame('g1'));
    await repo.appendEvents('g1', events.slice(0, 3));
    await repo.appendEvents('g1', events.slice(3).reverse()); // order inside a batch doesn't matter
    const saved = await repo.loadEvents('g1');
    expect(saved).toEqual(events);
    expect(saved[0]).toMatchObject({
      type: 'gameCreated',
      config: { puzzle: { solution: PUZZLE.solution } },
    });
    expect(replay(saved).at(-1)).toEqual(state);
  });

  it('is idempotent on seq: a batch sent twice, or overlapping, adds nothing', async () => {
    const { events } = playedLog();
    await repo.createGame(newGame('g1'));
    await repo.appendEvents('g1', events.slice(0, 4));
    await repo.appendEvents('g1', events.slice(0, 4));
    await repo.appendEvents('g1', events.slice(2));
    await repo.appendEvents('g1', []);
    expect(await repo.loadEvents('g1')).toEqual(events);
  });

  it('writes a batch in one transaction: a failure in the middle keeps none of it', async () => {
    const { events } = playedLog();
    await repo.createGame(newGame('g1'));
    db.failOnce('INSERT OR IGNORE INTO practice_events', 2);
    await expect(repo.appendEvents('g1', events)).rejects.toThrow(/on purpose/);
    expect(await repo.loadEvents('g1')).toEqual([]);
    await repo.appendEvents('g1', events);
    expect(await repo.loadEvents('g1')).toEqual(events);
  });

  it('runs calls in the order they were made, even when nobody waits', async () => {
    const { events } = playedLog();
    const calls = [
      repo.createGame(newGame('g1')),
      ...events.map((e) => repo.appendEvents('g1', [e])),
      repo.loadEvents('g1'),
    ];
    const results = await Promise.all(calls);
    expect(results.at(-1)).toEqual(events);
  });

  it('a failed call does not stop the ones after it', async () => {
    db.failOnce('INSERT INTO practice_games');
    const failed = repo.createGame(newGame('g1'));
    const ok = repo.createGame(newGame('g2'));
    await expect(failed).rejects.toThrow();
    await expect(ok).resolves.toBeUndefined();
    expect((await repo.listRecent()).map((g) => g.id)).toEqual(['g2']);
  });
});

describe('finishing', () => {
  it('keeps the result and my numbers', async () => {
    const { events, state } = playedLog({ finish: true });
    const result = state.result as GameResult;
    await repo.createGame(newGame('g1', { startedAt: events[0]!.t }));
    await repo.appendEvents('g1', events);
    await repo.finishGame('g1', { result, endedAt: state.endedAt! });
    const me = result.ranking[0]!;
    expect(await repo.getGame('g1')).toMatchObject({
      status: 'finished',
      endReason: 'boardComplete',
      endedAt: state.endedAt,
      score: me.score,
      mistakes: 1,
      correct: emptyCellsOf(PUZZLE).length,
      durationMs: result.durationMs,
      result,
    });
    expect(me.score % 0.5).toBe(0); // half points survive the REAL column
  });

  it('refuses a game it does not know', async () => {
    const { state } = playedLog({ finish: true });
    await expect(repo.finishGame('nope', { result: state.result!, endedAt: 1 })).rejects.toThrow(/nope/);
  });
});

describe('interrupted games', () => {
  it('on app start, every game left playing becomes interrupted, with the numbers its log reaches', async () => {
    const { events, state } = playedLog();
    await repo.createGame(newGame('cut', { startedAt: events[0]!.t }));
    await repo.appendEvents('cut', events);
    await repo.createGame(newGame('empty', { startedAt: 2_000_000 }));

    const restarted = await openPracticeRepo(db); // the next app run
    expect(await restarted.markInterrupted()).toBe(2);
    const me = state.players[0]!;
    expect(await restarted.getGame('cut')).toMatchObject({
      status: 'interrupted',
      endReason: null,
      endedAt: state.lastEventAt,
      score: me.score,
      mistakes: 1,
      correct: 2,
      durationMs: state.lastEventAt - state.startedAt!,
      result: null,
    });
    expect(await restarted.getGame('empty')).toMatchObject({ status: 'interrupted', score: null });
    expect(await restarted.loadEvents('cut')).toEqual(events); // kept for the replay
    expect((await restarted.listRecent()).map((g) => [g.id, g.status])).toEqual([
      ['empty', 'interrupted'],
      ['cut', 'interrupted'],
    ]);
    expect(await restarted.markInterrupted()).toBe(0);
  });

  it('a log that reached gameOver is finished, not interrupted', async () => {
    const { events, state } = playedLog({ finish: true });
    await repo.createGame(newGame('g1'));
    await repo.appendEvents('g1', events); // the app died before finishGame
    await repo.markInterrupted();
    expect(await repo.getGame('g1')).toMatchObject({
      status: 'finished',
      endReason: 'boardComplete',
      result: state.result,
    });
  });

  it('a damaged log counts as far as it replays', async () => {
    const { events } = playedLog();
    await repo.createGame(newGame('g1'));
    const gap = events.filter((e) => e.seq !== 4);
    await repo.appendEvents('g1', gap);
    await repo.markInterrupted();
    const upTo = replay(events.slice(0, 3)).at(-1)!;
    expect(await repo.getGame('g1')).toMatchObject({ status: 'interrupted', endedAt: upTo.lastEventAt });
  });

  it('with an id, only that game; finished games are never touched', async () => {
    const { state } = playedLog({ finish: true });
    await repo.createGame(newGame('a'));
    await repo.createGame(newGame('b'));
    await repo.createGame(newGame('done'));
    await repo.finishGame('done', { result: state.result!, endedAt: 5 });
    expect(await repo.markInterrupted('a')).toBe(1);
    expect(await repo.markInterrupted('done')).toBe(0);
    const status = Object.fromEntries((await repo.listRecent()).map((g) => [g.id, g.status]));
    expect(status).toEqual({ a: 'interrupted', b: 'playing', done: 'finished' });
  });
});

describe('lists', () => {
  it('recent games: newest first, interrupted included, up to the limit', async () => {
    for (let k = 0; k < 5; k++) await repo.createGame(newGame(`g${k}`, { startedAt: 1000 * k }));
    await repo.markInterrupted('g3');
    expect((await repo.listRecent(3)).map((g) => g.id)).toEqual(['g4', 'g3', 'g2']);
    expect(await repo.listRecent(0)).toEqual([]);
    expect(await repo.getGame('nope')).toBeNull();
    expect(await repo.loadEvents('nope')).toEqual([]);
  });

  it('play history: per game type, oldest first, every play counted', async () => {
    await repo.createGame(newGame('g1', { puzzleId: 'a', startedAt: 30 }));
    await repo.createGame(newGame('g2', { puzzleId: 'b', startedAt: 10 }));
    await repo.createGame(newGame('g3', { puzzleId: 'c', gameType: 'hard', startedAt: 20 }));
    await repo.createGame(newGame('g4', { puzzleId: 'a', startedAt: 30 }));
    expect(await repo.playHistory('fast')).toEqual([
      { puzzleId: 'b', playedAt: 10 },
      { puzzleId: 'a', playedAt: 30 },
      { puzzleId: 'a', playedAt: 30 },
    ]);
    expect(await repo.playHistory('hard')).toEqual([{ puzzleId: 'c', playedAt: 20 }]);
    expect(await repo.playHistory('normal')).toEqual([]);
  });

  it('by mode: every game of the mode, newest first', async () => {
    await repo.createGame(newGame('s1', { startedAt: 10 }));
    await repo.createGame(newGame('b1', { mode: 'bot', startedAt: 20, opponents: [BOT] }));
    await repo.createGame(newGame('b2', { mode: 'bot', startedAt: 30, opponents: [BOT] }));
    await repo.createGame(newGame('s2', { startedAt: 40 }));
    expect((await repo.listByMode('bot')).map((g) => g.id)).toEqual(['b2', 'b1']);
    expect((await repo.listByMode('solo')).map((g) => g.id)).toEqual(['s2', 's1']);
    expect(await repo.listByMode('ranked')).toEqual([]);
  });
});

describe('a practice against a bot (stage 5)', () => {
  it('keeps the opponent (id, name, bot) and nothing else of them', async () => {
    await repo.createGame(
      newGame('b', { mode: 'bot', opponents: [{ ...BOT, rating: 1500, ratedGames: 3 }] }),
    );
    expect(await repo.getGame('b')).toMatchObject({
      mode: 'bot',
      opponents: [{ id: 'bot-2', name: 'Biscuit', isBot: true }],
      place: null,
      outcome: null,
    });
    await repo.createGame(newGame('nameless', { mode: 'bot', opponents: [{ id: 'x' }] }));
    expect((await repo.getGame('nameless'))?.opponents).toEqual([{ id: 'x', name: null, isBot: false }]);
  });

  it.each([
    ['me', 'win', 1],
    ['bot', 'loss', 2],
  ] as const)(
    'a finished game where %s fills the board is a %s for me, place %d',
    async (who, outcome, place) => {
      const { events, state } = duelLog(who);
      const result = state.result as GameResult;
      await repo.createGame(newGame('b', { mode: 'bot', startedAt: events[0]!.t, opponents: [BOT] }));
      await repo.appendEvents('b', events);
      await repo.finishGame('b', { result, endedAt: state.endedAt! });
      const me = result.ranking.find((r) => r.playerId === 'me')!;
      expect(await repo.getGame('b')).toMatchObject({
        status: 'finished',
        score: me.score,
        place,
        outcome,
        result,
      });
    },
  );

  it('a tie is first place shared', async () => {
    const { state } = duelLog('me');
    const result = state.result as GameResult;
    const tied: GameResult = { ...result, ranking: result.ranking.map((r) => ({ ...r, place: 1 })) };
    await repo.createGame(newGame('t', { mode: 'bot', opponents: [BOT] }));
    await repo.finishGame('t', { result: tied, endedAt: 9 });
    expect(await repo.getGame('t')).toMatchObject({ place: 1, outcome: 'tie' });
  });

  it('a solo practice has no place and no outcome, even though it is ranked first', async () => {
    const { state } = playedLog({ finish: true });
    await repo.createGame(newGame('s'));
    await repo.finishGame('s', { result: state.result!, endedAt: 9 });
    expect(state.result!.ranking[0]!.place).toBe(1);
    expect(await repo.getGame('s')).toMatchObject({ status: 'finished', place: null, outcome: null });
  });

  it('a log that reached gameOver gets its outcome on the next start; an interrupted one has none', async () => {
    const lost = duelLog('bot');
    const cut = duelLog('me', { cutAfter: 6 });
    await repo.createGame(newGame('lost', { mode: 'bot', opponents: [BOT] }));
    await repo.appendEvents('lost', lost.events);
    await repo.createGame(newGame('cut', { mode: 'bot', opponents: [BOT] }));
    await repo.appendEvents('cut', cut.events);
    expect(await repo.markInterrupted()).toBe(2);
    expect(await repo.getGame('lost')).toMatchObject({ status: 'finished', place: 2, outcome: 'loss' });
    expect(await repo.getGame('cut')).toMatchObject({ status: 'interrupted', place: null, outcome: null });
  });

  it('a damaged opponents value lists nobody, and the list still reads', async () => {
    await repo.createGame(newGame('b', { mode: 'bot', opponents: [BOT] }));
    for (const bad of ['not json', '{"id":"x"}', '[null, 3, {"name":"no id"}]']) {
      await db.runAsync('UPDATE practice_games SET opponents_json = ? WHERE id = ?', [bad, 'b']);
      expect((await repo.listRecent()).map((g) => g.opponents)).toEqual([[]]);
    }
    await db.runAsync("UPDATE practice_games SET outcome = 'maybe' WHERE id = ?", ['b']);
    expect((await repo.getGame('b'))?.outcome).toBeNull();
  });
});

// The events of a real game type-check as GameEvent (not only as plain objects).
const _typed: GameEvent[] = playedLog().events;
void _typed;
