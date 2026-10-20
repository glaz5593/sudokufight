import type { HostUpdate, LocalGameHost } from '../game/host';
import { ME } from '../testing/levels';
import { lockedPuzzle, PUZZLE_LEVEL } from '../testing/puzzleLevels';
import { ManualClock } from '../util/clock';
import { ManualScheduler } from '../util/scheduler';
import { replayPuzzle } from './puzzle';
import { LocalPuzzleHost, type LocalPuzzleHostOptions } from './puzzleHost';
import type { AppLevelOf, PuzzleEvent, PuzzleEventType } from './spec';

/* LocalPuzzleHost: a puzzle behind the GameHost interface (levels-content.md §5.4), and its freeze [D65]. */

/** The GameHost interface (packages/protocol), as LocalGameHost implements it: protocol checks that one. */
type GameHostShape = Pick<
  LocalGameHost,
  | 'playerId'
  | 'getView'
  | 'subscribe'
  | 'select'
  | 'release'
  | 'place'
  | 'interfere'
  | 'react'
  | 'surrender'
  | 'tap'
  | 'swapBoxes'
  | 'pause'
  | 'resume'
  | 'close'
>;
// Fails to compile the day LocalPuzzleHost stops satisfying it.
const asGameHost = (host: LocalPuzzleHost): GameHostShape => host;

function setup(spec: AppLevelOf<'puzzle'> = PUZZLE_LEVEL, o: Partial<LocalPuzzleHostOptions> = {}) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const host = new LocalPuzzleHost({ id: 'puzzle-1', spec, player: ME, attempt: 1, clock, scheduler, ...o });
  const updates: HostUpdate[] = [];
  host.subscribe((u) => updates.push(u));
  const puzzleEvents = () => updates.flatMap((u) => (u.kind === 'events' ? (u.puzzleEvents ?? []) : []));
  const types = () => host.events.map((e) => e.type);
  const last = <T extends PuzzleEventType>(type: T) =>
    host.events.filter((e): e is Extract<PuzzleEvent, { type: T }> => e.type === type).at(-1);
  const rejections = () =>
    updates.flatMap((u) => (u.kind === 'rejected' ? [[u.action.type, u.reason] as const] : []));
  return { clock, scheduler, host, updates, puzzleEvents, types, last, rejections };
}

describe('LocalPuzzleHost behind the GameHost interface', () => {
  it('satisfies GameHost: the view of a puzzle, level.puzzle set, no keypad, lock or interference', () => {
    const { host } = setup();
    const gameHost = asGameHost(host);
    expect(gameHost.playerId).toBe(ME.id);
    const view = gameHost.getView();
    expect(view).toMatchObject({
      status: 'running',
      mode: 'solo',
      me: ME.id,
      interference: null,
      turn: null,
      result: null,
      solution: null,
      keypad: { enabled: false, disabled: [] },
    });
    expect(view.level).toMatchObject({
      id: 'L003',
      kind: 'puzzle',
      attempt: 1,
      limitMs: 45000,
      endsAt: 45000,
    });
    expect(view.level!.puzzle).toMatchObject({ moving: 3, swaps: 0, minSwaps: 2 });
    expect(view.players).toEqual([expect.objectContaining({ id: ME.id, seat: 0, isBot: false, lock: null })]);
  });

  it('refuses select, release, place, interfere, tap and react at once (badAction), the log untouched', () => {
    const { host, rejections } = setup();
    const n = host.events.length;
    host.select(30);
    host.release();
    host.place(30, 5);
    host.interfere('bot-1', 'cats');
    host.tap(30);
    host.react('😂');
    expect(rejections()).toEqual([
      ['select', 'badAction'],
      ['release', 'badAction'],
      ['place', 'badAction'],
      ['interfere', 'badAction'],
      ['tap', 'badAction'],
      ['react', 'badAction'],
    ]);
    expect(host.events).toHaveLength(n);
    expect(host.getView().rules.reactions).toEqual([]);
  });

  it('swapBoxes plays; updates carry the puzzle events (puzzleEvents), and `events` stays empty', () => {
    const { host, updates, puzzleEvents } = setup();
    host.swapBoxes(1, 5);
    const u = updates.at(-1)!;
    expect(u.kind).toBe('events');
    if (u.kind !== 'events') return;
    expect(u.events).toEqual([]);
    expect(u.levelEvents).toBeUndefined();
    expect(u.puzzleEvents!.map((e) => e.type)).toEqual(['boxesSwapped']);
    expect(u.view.level!.puzzle!.slots[1]).toEqual({ id: 5, state: 'movable' });
    host.swapBoxes(3, 5);
    // The start came before anyone subscribed (autoStart, in the constructor).
    expect(puzzleEvents().map((e) => e.type)).toEqual(['boxesSwapped', 'boxesSwapped', 'levelOver']);
    expect(host.over).toMatchObject({ reason: 'targetReached', stars: 3, swaps: 2 });
    expect(host.getView().level!.puzzle!.over).toEqual(host.over);
    expect(JSON.stringify(replayPuzzle(host.events))).toBe(JSON.stringify(host.state));
  });

  it("a refused swap comes back as the screen's action: boxFixed, badCell", () => {
    const { host, updates, rejections } = setup();
    host.swapBoxes(0, 1);
    expect(updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'swapBoxes', from: 0, to: 1 },
      reason: 'boxFixed',
    });
    host.swapBoxes(3, 3);
    expect(rejections()).toEqual([
      ['swapBoxes', 'boxFixed'],
      ['swapBoxes', 'badCell'],
    ]);
  });

  it('a wrong swap shows its penalty: +5 s on the clock, a mistake', () => {
    const { host, clock } = setup();
    clock.advance(1000);
    host.swapBoxes(1, 5);
    clock.advance(1000);
    host.swapBoxes(1, 3);
    expect(host.events.at(-1)).toMatchObject({ type: 'boxesSwapped', penaltyMs: 5000 });
    expect(host.getView().level).toMatchObject({ elapsedMs: 7000, penaltyMs: 5000, endsAt: 40000 });
  });

  it('updates come in order: a listener that swaps while being told waits its turn', () => {
    const { host, updates } = setup();
    let once = true;
    host.subscribe((u) => {
      if (once && u.kind === 'events') {
        once = false;
        host.swapBoxes(3, 5); // inside the delivery of the first swap
      }
    });
    host.swapBoxes(1, 5);
    const seqs = updates.flatMap((u) => (u.kind === 'events' ? u.puzzleEvents!.map((e) => e.seq) : []));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(host.over?.reason).toBe('targetReached');
  });

  it("a listener's error comes back to the caller once every listener had the update", () => {
    const { host, updates } = setup();
    host.subscribe(() => {
      throw new Error('broken screen');
    });
    const after: HostUpdate[] = [];
    host.subscribe((u) => after.push(u));
    expect(() => host.swapBoxes(1, 5)).toThrow('broken screen');
    expect(updates.at(-1)?.kind).toBe('events');
    expect(after).toHaveLength(1);
  });

  it('surrender is the X: the level ends quit', () => {
    const { host, clock } = setup();
    clock.advance(2000);
    host.surrender();
    expect(host.over).toMatchObject({ reason: 'quit', stars: 0, elapsedMs: 2000 });
  });

  it('the scheduler ends it at the deadline (timeUp), and the solution shows', () => {
    const { host, scheduler, last } = setup();
    scheduler.advance(44999);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 45000, stars: 0 });
    expect(host.getView().solution).toBe(PUZZLE_LEVEL.board.solution);
    expect(scheduler.pending).toBe(0);
  });

  it('a penalty moves the timer: the limit comes 5 s sooner', () => {
    const { host, scheduler, last } = setup();
    scheduler.advance(1000);
    host.swapBoxes(1, 5);
    host.swapBoxes(1, 3); // wrong: the limit is now 40 s
    scheduler.advance(38999);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 40000, elapsedMs: 45000 });
  });

  it('with the lock on, the update says which box locked (boxPlaced)', () => {
    const { host, puzzleEvents } = setup(lockedPuzzle(PUZZLE_LEVEL));
    host.swapBoxes(1, 5);
    expect(puzzleEvents().at(-1)).toMatchObject({ type: 'boxPlaced', place: 1 });
    expect(host.getView().level!.puzzle!.slots[1]!.state).toBe('placed');
  });

  it('waits for start with autoStart off; close() stops everything', () => {
    const { host, scheduler, types, rejections } = setup(PUZZLE_LEVEL, { autoStart: false });
    expect(types()).toEqual(['puzzleCreated']);
    expect(host.getView().status).toBe('waiting');
    host.swapBoxes(1, 5);
    expect(rejections()).toEqual([['swapBoxes', 'notStarted']]);
    host.dispatch({ type: 'start' });
    expect(types()).toEqual(['puzzleCreated', 'levelStarted']);
    expect(scheduler.pending).toBe(1);
    host.close();
    expect(scheduler.pending).toBe(0);
    expect(() => host.swapBoxes(1, 5)).toThrow('closed');
    expect(() => host.tap(30)).toThrow('closed');
  });
});

describe('the app out of the foreground mid-puzzle [D65]', () => {
  it('paused at 10 s, 2 min away, back: the same 35 s left', () => {
    const { host, scheduler, last } = setup();
    scheduler.advance(10_000);
    host.pause();
    expect(host.getView()).toMatchObject({ status: 'paused', pausedAt: 10_000 });
    const n = host.events.length;
    scheduler.advance(120_000);
    expect(host.events).toHaveLength(n); // nothing ran out
    expect(host.getView().level).toMatchObject({ elapsedMs: 10_000, remainingMs: 35_000, endsAt: null });
    host.resume();
    expect(last('levelResumed')).toMatchObject({ pausedMs: 120_000, t: 130_000 });
    expect(host.getView().level).toMatchObject({ remainingMs: 35_000, endsAt: 165_000 });
    scheduler.advance(34_999);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 165_000, elapsedMs: 45_000 });
  });

  it("a swap while paused is refused 'paused'; pause and resume are idempotent; the X works while frozen", () => {
    const { host, scheduler, types, updates, rejections } = setup();
    host.resume(); // not frozen: nothing
    scheduler.advance(3000);
    host.pause();
    host.pause();
    host.swapBoxes(1, 5);
    expect(rejections()).toEqual([['swapBoxes', 'paused']]);
    scheduler.advance(10_000);
    host.resume();
    host.resume();
    expect(types().filter((t) => t === 'levelPaused' || t === 'levelResumed')).toEqual([
      'levelPaused',
      'levelResumed',
    ]);
    scheduler.advance(1000);
    host.pause();
    scheduler.advance(5000);
    host.surrender(); // the X during the 3, 2, 1
    expect(host.over).toMatchObject({ reason: 'quit', elapsedMs: 4000 });
    host.pause();
    host.resume();
    expect(types().at(-1)).toBe('levelOver');
    expect(updates.filter((u) => u.kind === 'rejected')).toHaveLength(1);
  });
});
