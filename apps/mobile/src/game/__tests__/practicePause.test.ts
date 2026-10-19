import { type GameEvent, ManualClock, ManualScheduler, type PlayerId } from '@sudoku-fight/engine';

import { PRACTICE_UI } from '../../config/practice';
import { soloStats } from '../../screens/game/model';
import { buildReplay } from '../../screens/replay/replayModel';
import type { AppStateSource, PauseState } from '../backgroundPause';
import { puzzleById } from '../offlinePool';
import { openPracticeRepo, type PracticeRepo } from '../practiceRepo';
import { type PracticeDeps, type PracticeSession, startBotPractice, startPractice } from '../session';
import { answerIn, emptyCellsOf, smallPool } from '../testing/practice';
import { memoryDb, type SqlJsDb } from '../testing/sqlJsDb';

/**
 * [D65, extended by Moshe 2026-10-18] The background freeze in solo practice and in practice against a bot, as in
 * the stages: away, the game stands still (its clock, the lock timer, the bot); back, "3", "2", "1" over the
 * covered board, then it goes on from the very same point. The saved game, its duration and its replay leave the
 * freeze out, and a game saved before 1.0.2 (no freeze in its log) loads as before.
 */

/** A fake AppState: the test says when the app goes and comes back. */
function fakeAppState() {
  let listener: ((state: string) => void) | null = null;
  const source: AppStateSource = {
    addEventListener: (_type, l) => {
      listener = l;
      return { remove: () => (listener = null) };
    },
  };
  return { source, set: (state: string) => listener?.(state), listening: () => listener !== null };
}

interface Rig {
  db: SqlJsDb;
  repo: PracticeRepo;
  clock: ManualClock;
  scheduler: ManualScheduler;
  app: ReturnType<typeof fakeAppState>;
  deps: PracticeDeps;
}

const T0 = 1_700_000_000_000;

async function rig(over: Partial<PracticeDeps> = {}): Promise<Rig> {
  const db = await memoryDb();
  const repo = await openPracticeRepo(db);
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const app = fakeAppState();
  const deps: PracticeDeps = {
    repo,
    clock,
    scheduler,
    pool: smallPool(3),
    seed: 7,
    track: () => undefined,
    onError: (what, error) => {
      throw new Error(`${what}: ${String(error)}`);
    },
    appState: app.source,
    ...over,
  };
  return { db, repo, clock, scheduler, app, deps };
}

const puzzleOf = (s: PracticeSession) => puzzleById(s.puzzleId)!;
const myLock = (s: PracticeSession) => s.getView().players.find((p) => p.id === s.playerId)!.lock;
const kinds = (states: PauseState[]) =>
  states.map((p) => (p.kind === 'countdown' ? String(p.count) : p.kind));
const eventsSince = (s: PracticeSession, seq: number) => s.events.filter((e) => e.seq > seq);
const plain = (events: readonly GameEvent[]) => JSON.parse(JSON.stringify(events)) as GameEvent[];

let open: PracticeSession[] = [];
afterEach(() => {
  open.forEach((s) => s.close());
  open = [];
});

async function solo(r: Rig): Promise<PracticeSession> {
  const s = await startPractice({ gameType: 'fast' }, r.deps);
  open.push(s);
  return s;
}

describe('[D65] solo practice: the background freeze', () => {
  it.each(['background', 'inactive'])(
    "AppState '%s' at a lock with 5 s left, a minute away: 3, 2, 1, and the lock still has its 5 s",
    async (away) => {
      const r = await rig();
      const s = await solo(r);
      const states: PauseState[] = [];
      s.onPause((p) => states.push(p));
      const [a] = emptyCellsOf(puzzleOf(s));
      s.host.select(a!); // fast: 8 s
      r.scheduler.advance(3000);
      expect(myLock(s)).toMatchObject({ cell: a, remainingMs: 5000 });

      r.app.set(away);
      expect(s.getView().status).toBe('paused');
      expect(s.pause).toEqual({ kind: 'paused' });
      const seq = s.getView().seq;
      r.scheduler.advance(60_000);
      // Nothing runs out meanwhile: the lock is still mine, with the same time left.
      expect(eventsSince(s, seq)).toEqual([]);
      expect(myLock(s)).toMatchObject({ cell: a, expiresAt: null, remainingMs: 5000 });

      r.app.set('active');
      expect(s.pause).toEqual({ kind: 'countdown', count: 3 });
      r.scheduler.advance(1000);
      expect(s.pause).toEqual({ kind: 'countdown', count: 2 });
      r.scheduler.advance(1000);
      expect(s.pause).toEqual({ kind: 'countdown', count: 1 });
      // Still frozen under the countdown: it is no thinking time.
      expect(s.getView().status).toBe('paused');
      r.scheduler.advance(1000);
      expect(s.pause).toEqual({ kind: 'none' });
      expect(s.getView().status).toBe('running');
      expect(myLock(s)).toMatchObject({ cell: a, remainingMs: 5000, expiresAt: r.clock.now() + 5000 });
      expect(kinds(states)).toEqual(['paused', '3', '2', '1', 'none']);
      // The HUD's clock leaves the freeze and the countdown out.
      expect(soloStats(s.getView(), r.clock.now()).elapsedMs).toBe(3000);
      // The lock runs out 5 s later, not before.
      r.scheduler.advance(4999);
      expect(myLock(s)).not.toBeNull();
      r.scheduler.advance(1);
      expect(myLock(s)).toBeNull();
    },
  );

  it('the saved game, its duration and its replay leave the freeze out', async () => {
    const r = await rig();
    const s = await solo(r);
    const puzzle = puzzleOf(s);
    const [a] = emptyCellsOf(puzzle);
    r.scheduler.advance(2000);
    s.host.select(a!);
    r.scheduler.advance(1000);
    r.app.set('background');
    r.scheduler.advance(10 * 60_000);
    r.app.set('active');
    r.scheduler.advance(PRACTICE_UI.resumeCountdownMs);
    r.scheduler.advance(500);
    s.host.place(a!, answerIn(puzzle, a!));
    r.scheduler.advance(1500);
    s.endPractice();
    await s.flush();

    const played = 2000 + 1000 + 500 + 1500;
    expect(s.getView().result).toMatchObject({ reason: 'practiceEnded', durationMs: played });
    expect(await r.repo.getGame(s.id)).toMatchObject({ status: 'finished', durationMs: played });
    // The freeze is in the saved log as the engine emitted it.
    const saved = await r.repo.loadEvents(s.id);
    expect(saved).toEqual(plain(s.events));
    expect(saved.filter((e) => e.type === 'gamePaused' || e.type === 'gameResumed')).toEqual([
      expect.objectContaining({ type: 'gamePaused', reason: 'background' }),
      expect.objectContaining({
        type: 'gameResumed',
        reason: 'foreground',
        pausedMs: 10 * 60_000 + PRACTICE_UI.resumeCountdownMs,
      }),
    ]);
    // The replay: the same duration, and the move's time on the game clock (3.5 s, not ten minutes later).
    const replay = buildReplay(saved, { me: s.playerId });
    expect(replay.durationMs).toBe(played);
    expect(replay.steps.find((step) => step.kind === 'correct')).toMatchObject({ clockMs: 3500 });
    expect(replay.startedAt).toBe(T0);
  });

  it('killed while away: the next start saves it interrupted, its time without the freeze', async () => {
    const r = await rig();
    const s = await solo(r);
    const [a] = emptyCellsOf(puzzleOf(s));
    r.scheduler.advance(4000);
    s.host.select(a!);
    r.app.set('background');
    r.scheduler.advance(30_000);
    await s.flush(); // … and the app is killed here
    const nextRun = await openPracticeRepo(r.db);
    expect(await nextRun.markInterrupted()).toBe(1);
    expect(await nextRun.getGame(s.id)).toMatchObject({ status: 'interrupted', durationMs: 4000 });
  });

  it('a game saved before 1.0.2 (no freeze in its log) loads as before', async () => {
    const r = await rig({ appState: null });
    const s = await solo(r);
    const puzzle = puzzleOf(s);
    const [a] = emptyCellsOf(puzzle);
    r.scheduler.advance(2500);
    s.host.select(a!);
    r.scheduler.advance(1500);
    s.host.place(a!, answerIn(puzzle, a!));
    r.scheduler.advance(1000);
    s.endPractice();
    await s.flush();
    const saved = await r.repo.loadEvents(s.id);
    expect(saved.some((e) => e.type === 'gamePaused')).toBe(false);
    const replay = buildReplay(saved, { me: s.playerId });
    expect(replay.durationMs).toBe(5000);
    expect(replay.steps.find((step) => step.kind === 'correct')).toMatchObject({ clockMs: 4000 });
    expect(replay.states.at(-1)).not.toHaveProperty('frozenMs');
    expect(await r.repo.getGame(s.id)).toMatchObject({ status: 'finished', durationMs: 5000 });
  });

  it('PRACTICE_UI.backgroundPause off: the app is not watched, and nothing freezes', async () => {
    const r = await rig({ settings: { ...PRACTICE_UI, backgroundPause: false } });
    const s = await solo(r);
    expect(r.app.listening()).toBe(false);
    s.background();
    expect(s.getView().status).toBe('running');
    expect(s.pause).toEqual({ kind: 'none' });
  });

  it('PRACTICE_UI.resumeCountdownMs is the countdown’s length', async () => {
    const r = await rig({ settings: { ...PRACTICE_UI, resumeCountdownMs: 1000 } });
    const s = await solo(r);
    r.app.set('background');
    r.app.set('active');
    expect(s.pause).toEqual({ kind: 'countdown', count: 1 });
    r.scheduler.advance(1000);
    expect(s.getView().status).toBe('running');
  });

  it('away again during the countdown: frozen again, and the countdown starts over at the return', async () => {
    const r = await rig();
    const s = await solo(r);
    r.app.set('background');
    r.app.set('active');
    r.scheduler.advance(1500);
    r.app.set('background');
    expect(s.pause).toEqual({ kind: 'paused' });
    r.scheduler.advance(10_000);
    expect(s.getView().status).toBe('paused');
    r.app.set('active');
    expect(s.pause).toEqual({ kind: 'countdown', count: 3 });
  });

  it('"סיום אימון" is still possible while frozen; the cover goes, and nothing freezes after the end', async () => {
    const r = await rig();
    const s = await solo(r);
    r.scheduler.advance(2000);
    r.app.set('background');
    r.scheduler.advance(20_000);
    s.endPractice();
    expect(s.getView().result).toMatchObject({ reason: 'practiceEnded', durationMs: 2000 });
    expect(s.pause).toEqual({ kind: 'none' });
    r.app.set('active');
    r.app.set('background');
    expect(s.pause).toEqual({ kind: 'none' });
  });

  it('close() stops listening to the app', async () => {
    const r = await rig();
    const s = await solo(r);
    expect(r.app.listening()).toBe(true);
    s.close();
    expect(r.app.listening()).toBe(false);
    expect(r.scheduler.pending).toBe(0);
  });
});

describe('[D65] practice against a bot: the background freeze', () => {
  /** The bot's first digit, in a game left to the bot, frozen `awayMs` at 1.5 s (0: never). */
  async function botsFirstDigit(awayMs: number) {
    const r = await rig({ pool: smallPool(1) });
    const s = await startBotPractice({ gameType: 'fast', level: 3 }, r.deps);
    open.push(s);
    const bot: PlayerId = s.getView().players[1]!.id;
    r.scheduler.advance(1500);
    let seq = 0;
    if (awayMs) {
      r.app.set('background');
      seq = s.getView().seq;
      r.scheduler.advance(awayMs);
      // The bot places nothing (it does nothing at all) while the game stands still.
      expect(eventsSince(s, seq)).toEqual([]);
      r.app.set('active');
      r.scheduler.advance(PRACTICE_UI.resumeCountdownMs - 1);
      expect(eventsSince(s, seq)).toEqual([]);
      r.scheduler.advance(1);
    }
    for (let i = 0; i < 600 && !s.events.some((e) => isBotDigit(e, bot)); i++) r.scheduler.advance(100);
    return s.events.find((e) => isBotDigit(e, bot))!;
  }

  const isBotDigit = (e: GameEvent, bot: PlayerId) =>
    (e.type === 'placedCorrect' || e.type === 'placedWrong') && e.playerId === bot;

  it('the bot keeps the think time it had left: its digit comes the freeze and the countdown later', async () => {
    const plainGame = await botsFirstDigit(0);
    const away = await botsFirstDigit(5 * 60_000);
    expect(away).toMatchObject({ type: plainGame.type, cell: (plainGame as { cell: number }).cell });
    expect(away.t - plainGame.t).toBe(5 * 60_000 + PRACTICE_UI.resumeCountdownMs);
    expect(plainGame.t).toBeGreaterThan(T0 + 1500); // it was still thinking when the app went away
  });
});
