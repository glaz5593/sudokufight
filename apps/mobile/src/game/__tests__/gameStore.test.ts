import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { createGameStore, type GameStoreDeps } from '../gameStore';
import { allOfflinePuzzles } from '../offlinePool';
import { openPracticeRepo, type PracticeRepo } from '../practiceRepo';
import { answerIn, emptyCellsOf, smallPool } from '../testing/practice';
import { memoryDb } from '../testing/sqlJsDb';

async function setup(repoOf: (repo: PracticeRepo) => Promise<PracticeRepo | null> = async (r) => r) {
  const repo = await openPracticeRepo(await memoryDb());
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const deps: GameStoreDeps = {
    repo: () => repoOf(repo),
    session: { clock, scheduler, pool: smallPool(5), track: () => undefined, onError: () => undefined },
  };
  return { repo, clock, scheduler, useStore: createGameStore(deps) };
}

describe('the game store', () => {
  it('starts a practice and follows its host: view and last update', async () => {
    const { useStore, repo } = await setup();
    expect(useStore.getState()).toMatchObject({ session: null, view: null, lastUpdate: null });

    const session = await useStore.getState().startPractice({ gameType: 'fast' });
    expect(session).not.toBeNull();
    const state = useStore.getState();
    expect(state.session).toBe(session);
    expect(state.view).toEqual(session!.getView());
    expect(state.lastUpdate).toBeNull();

    const puzzle = allOfflinePuzzles().find((p) => p.id === session!.puzzleId)!;
    const cell = emptyCellsOf(puzzle)[0]!;
    session!.host.select(cell);
    expect(useStore.getState().lastUpdate?.kind).toBe('events');
    expect(useStore.getState().view?.players[0]!.lock?.cell).toBe(cell);
    session!.host.place(cell, answerIn(puzzle, cell));
    expect(useStore.getState().view?.grid[cell]).toBe(answerIn(puzzle, cell));

    useStore.getState().endPractice();
    expect(useStore.getState().view?.status).toBe('over');
    expect(useStore.getState().session).toBe(session); // still there for the results
    await session!.flush();
    expect((await repo.getGame(session!.id))?.status).toBe('finished');
  });

  it('clear() closes the session (a running game is interrupted) and forgets it', async () => {
    const { useStore, repo, scheduler } = await setup();
    const session = (await useStore.getState().startPractice({ gameType: 'fast' }))!;
    useStore.getState().clear();
    expect(useStore.getState()).toMatchObject({ session: null, view: null, lastUpdate: null });
    expect(scheduler.pending).toBe(0);
    await session.flush();
    expect((await repo.getGame(session.id))?.status).toBe('interrupted');
    useStore.getState().endPractice(); // no session: nothing happens
  });

  it('a new start closes the game in progress', async () => {
    const { useStore } = await setup();
    const first = (await useStore.getState().startPractice({ gameType: 'fast' }))!;
    const second = (await useStore.getState().startPractice({ gameType: 'fast' }))!;
    expect(useStore.getState().session).toBe(second);
    expect(() => first.host.release()).toThrow(/closed/);
    second.host.select(emptyCellsOf(allOfflinePuzzles().find((p) => p.id === second.puzzleId)!)[0]!);
    expect(useStore.getState().view?.gameId).toBe(second.id);
  });

  it('the newer of two overlapping starts wins; a clear() cancels a start', async () => {
    const { useStore } = await setup();
    const a = useStore.getState().startPractice({ gameType: 'fast' });
    const b = useStore.getState().startPractice({ gameType: 'fast' });
    expect(await a).toBeNull();
    const won = await b;
    expect(useStore.getState().session).toBe(won);

    const c = useStore.getState().startPractice({ gameType: 'fast' });
    useStore.getState().clear();
    expect(await c).toBeNull();
    expect(useStore.getState().session).toBeNull();
  });

  it('plays without saving when the database is unavailable', async () => {
    const { useStore } = await setup(async () => null);
    const session = await useStore.getState().startPractice({ gameType: 'fast' });
    expect(useStore.getState().view?.status).toBe('running');
    session!.close();
  });
});

describe('the game store, against a bot (stage 5)', () => {
  it('starts a practice against the bot of a level, and follows the bot’s moves too', async () => {
    const { useStore, repo, scheduler } = await setup();
    const session = (await useStore.getState().startBotPractice({ gameType: 'fast', level: 4 }))!;
    expect(session).toMatchObject({ mode: 'bot', gameType: 'fast', botLevel: 4 });
    expect(useStore.getState().view?.players.map((p) => p.id)).toEqual(['me', 'bot-4']);

    // Nobody touches the board: the bot's own moves reach the store.
    scheduler.advance(30_000);
    const bot = useStore.getState().view!.players[1]!;
    expect(bot.correct + bot.mistakes).toBeGreaterThan(0);
    expect(useStore.getState().lastUpdate?.kind).toBe('events');

    useStore.getState().endPractice();
    expect(useStore.getState().view?.status).toBe('over');
    await session.flush();
    expect(await repo.getGame(session.id)).toMatchObject({ status: 'finished', outcome: 'loss' });
  });

  it('clear() stops the bot with the game: nothing is left scheduled, the game is interrupted', async () => {
    const { useStore, repo, scheduler } = await setup();
    const session = (await useStore.getState().startBotPractice({ gameType: 'fast', level: 5 }))!;
    scheduler.advance(10_000);
    useStore.getState().clear();
    expect(scheduler.pending).toBe(0);
    await session.flush();
    expect((await repo.getGame(session.id))?.status).toBe('interrupted');
  });

  it('a start of either kind replaces the other; the newer one wins', async () => {
    const { useStore, scheduler } = await setup();
    const solo = useStore.getState().startPractice({ gameType: 'fast' });
    const bot = useStore.getState().startBotPractice({ gameType: 'fast', level: 1 });
    expect(await solo).toBeNull();
    const won = (await bot)!;
    expect(useStore.getState().session).toBe(won);

    const next = (await useStore.getState().startPractice({ gameType: 'fast' }))!;
    expect(next.botLevel).toBeNull();
    expect(() => won.host.release()).toThrow(/closed/);
    // The first game's bot is gone with it: only the new game's timers are left.
    const before = next.events.length;
    scheduler.advance(60_000);
    expect(next.events.slice(before).every((e) => !('playerId' in e) || e.playerId === 'me')).toBe(true);
    useStore.getState().clear();
    expect(scheduler.pending).toBe(0);
  });
});
