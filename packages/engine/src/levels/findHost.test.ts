import type { HostUpdate, LocalGameHost } from '../game/host';
import { REACTIONS } from '../game/rules';
import { parseCellName } from '../sudoku/board';
import { FIND_LEVEL, pinnedRace, RACE_SPOTS } from '../testing/findLevels';
import { ME } from '../testing/levels';
import { ManualClock } from '../util/clock';
import { ManualScheduler } from '../util/scheduler';
import { replayFind } from './find';
import { LocalFindHost, type LocalFindHostOptions } from './findHost';
import type { AppLevel, LevelEvent, LevelEventType } from './spec';

/* LocalFindHost: a tap level behind the GameHost interface (spec §17.2; dev-plan §2ג), and its freeze [D65]. */

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
// Fails to compile the day LocalFindHost stops satisfying it.
const asGameHost = (host: LocalFindHost): GameHostShape => host;

function setup(spec: AppLevel, o: Partial<LocalFindHostOptions> = {}) {
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const host = new LocalFindHost({ id: 'level-1', spec, player: ME, attempt: 1, clock, scheduler, ...o });
  const updates: HostUpdate[] = [];
  host.subscribe((u) => updates.push(u));
  const levelEvents = () => updates.flatMap((u) => (u.kind === 'events' ? (u.levelEvents ?? []) : []));
  const types = () => host.events.map((e) => e.type);
  const last = <T extends LevelEventType>(type: T) =>
    host.events.filter((e): e is Extract<LevelEvent, { type: T }> => e.type === type).at(-1);
  return { clock, scheduler, host, updates, levelEvents, types, last };
}

const race = (ms: number) => pinnedRace(RACE_SPOTS.map(() => ms));

describe('LocalFindHost behind the GameHost interface (§17.2)', () => {
  it('satisfies GameHost: the view of a tap level, level.find set, no keypad, lock or interference', () => {
    const { host } = setup(FIND_LEVEL);
    const gameHost = asGameHost(host);
    expect(gameHost.playerId).toBe(ME.id);
    const view = gameHost.getView();
    expect(view).toMatchObject({
      status: 'running',
      mode: 'solo',
      gameType: 'fast',
      me: ME.id,
      interference: null,
      turn: null,
      result: null,
      solution: null,
      keypad: { enabled: false, disabled: [] },
    });
    expect(view.level).toMatchObject({
      id: 'L001',
      kind: 'find',
      attempt: 1,
      limitMs: 20000,
      endsAt: 20000,
      lockTimer: false,
      progress: null,
      editableCells: null,
      final: false,
    });
    expect(view.level!.find).toMatchObject({ digit: 9, scope: { kind: 'box', index: 4 } });
    expect(view.players).toEqual([expect.objectContaining({ id: ME.id, seat: 0, isBot: false, lock: null })]);
  });

  it('refuses select, release, place and interfere at once (badAction), the log untouched', () => {
    const { host, updates } = setup(FIND_LEVEL);
    const n = host.events.length;
    host.select(parseCellName('D5'));
    host.release();
    host.place(parseCellName('D5'), 9);
    host.interfere('bot-1', 'cats');
    expect(updates.map((u) => (u.kind === 'rejected' ? [u.action.type, u.reason] : u.kind))).toEqual([
      ['select', 'badAction'],
      ['release', 'badAction'],
      ['place', 'badAction'],
      ['interfere', 'badAction'],
    ]);
    expect(host.events).toHaveLength(n);
  });

  it("refuses the puzzle's swapBoxes at once (badAction), the log untouched; plays on after it (1.0.3)", () => {
    const { host, updates, last } = setup(FIND_LEVEL);
    const n = host.events.length;
    host.swapBoxes(1, 5);
    expect(updates).toEqual([
      {
        kind: 'rejected',
        action: { type: 'swapBoxes', from: 1, to: 5 },
        reason: 'badAction',
        view: host.getView(),
      },
    ]);
    expect(host.events).toHaveLength(n);
    host.tap(parseCellName('D5'));
    expect(last('levelOver')).toMatchObject({ reason: 'targetReached' });
    host.close();
    expect(() => host.swapBoxes(1, 5)).toThrow('closed');
  });

  it('has no reactions button by default [D62]; LEVEL_UI.reactions brings it back', () => {
    const off = setup(race(11000));
    off.host.react('😂');
    expect(off.updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'react' },
      reason: 'badAction',
    });
    expect(off.host.getView().rules.reactions).toEqual([]);
    const on = setup(race(11000), { reactions: REACTIONS });
    on.host.react('🔥');
    expect(on.last('reacted')).toMatchObject({ playerId: ME.id, emoji: '🔥' });
    on.host.react('🔥');
    expect(on.updates.at(-1)).toMatchObject({ kind: 'rejected', reason: 'tooSoon' });
  });

  it('a tap plays; updates carry the level events (levelEvents), and `events` stays empty', () => {
    const { host, updates } = setup(FIND_LEVEL);
    host.tap(parseCellName('D5'));
    const u = updates.at(-1)!;
    expect(u.kind).toBe('events');
    if (u.kind !== 'events') return;
    expect(u.events).toEqual([]);
    expect(u.levelEvents!.map((e) => e.type)).toEqual(['tapped', 'spotWon', 'levelOver']);
    expect(u.view.level).toMatchObject({ final: true, stars: 3 });
    expect(host.over).toMatchObject({ reason: 'targetReached', stars: 3 });
  });

  it('surrender is the X: the level ends quit', () => {
    const { host, clock } = setup(FIND_LEVEL);
    clock.advance(2000);
    host.surrender();
    expect(host.over).toMatchObject({ reason: 'quit', stars: 0, elapsedMs: 2000 });
    expect(host.getView().level!.find!.over).toEqual(host.over);
  });

  it('the scheduler ends it at the deadline (timeUp), with the answer shown', () => {
    const { host, scheduler, last } = setup(FIND_LEVEL);
    scheduler.advance(19999);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 20000, stars: 0 });
    expect(host.getView().level!.find!.answer).toEqual([parseCellName('D5')]);
    expect(scheduler.pending).toBe(0);
  });

  it('the bot plays its plan on the scheduler; a tap while frozen is refused (frozen)', () => {
    const { host, scheduler, updates, last } = setup(race(11000));
    expect(host.getView().players.map((p) => [p.id, p.isBot])).toEqual([
      [ME.id, false],
      ['bot-1', true],
    ]);
    host.tap(parseCellName('D1'));
    host.tap(parseCellName('F1'));
    expect(updates.at(-1)).toMatchObject({ kind: 'rejected', action: { type: 'tap' }, reason: 'frozen' });
    scheduler.advance(11000);
    expect(last('spotWon')).toMatchObject({ playerId: 'bot-1', t: 11000 });
    expect(host.getView().players[1]).toMatchObject({ score: 1, place: 1, isLeader: true });
    expect(JSON.stringify(replayFind(host.events))).toBe(JSON.stringify(host.state));
  });

  it('waits for start with autoStart off; close() stops everything', () => {
    const { host, scheduler, types } = setup(FIND_LEVEL, { autoStart: false });
    expect(types()).toEqual(['levelCreated']);
    host.tap(parseCellName('D5'));
    host.dispatch({ type: 'start' });
    expect(types()).toEqual(['levelCreated', 'levelStarted', 'targetShown']);
    expect(scheduler.pending).toBe(1);
    host.close();
    expect(scheduler.pending).toBe(0);
    expect(() => host.tap(parseCellName('D5'))).toThrow('closed');
  });
});

describe('the app out of the foreground mid-level [D65]', () => {
  it('race: paused at 9 s with the bot due at 11 s, 120 s away, back: the bot taps 2 s later, not at once', () => {
    const { host, scheduler, clock, types, last } = setup(race(11000));
    scheduler.advance(9000);
    host.pause();
    expect(host.getView()).toMatchObject({ status: 'paused', pausedAt: 9000 });
    const n = host.events.length;
    scheduler.advance(120_000);
    expect(host.events).toHaveLength(n); // nothing ran out, the bot did nothing
    expect(host.getView().level).toMatchObject({ elapsedMs: 9000, remainingMs: 21000, endsAt: null });
    host.resume();
    expect(last('levelResumed')).toMatchObject({ pausedMs: 120_000, t: 129_000 });
    scheduler.advance(1999);
    expect(types()).not.toContain('spotWon');
    scheduler.advance(1);
    expect(last('spotWon')).toMatchObject({ playerId: 'bot-1', t: 131_000 });
    expect(clock.now()).toBe(131_000);
    // The level's 30 s: 21 s were left at the freeze, so it ends 21 s after the resume.
    scheduler.advance(20_999 - 2000);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 150_000, elapsedMs: 30000 });
  });

  it("race: my 3 s freeze keeps what it had left; a tap while paused is refused 'paused'", () => {
    const { host, scheduler, updates, last } = setup(race(11000));
    scheduler.advance(7000);
    host.tap(parseCellName('D1')); // frozen until 10 s
    scheduler.advance(2000);
    host.pause();
    host.tap(parseCellName('F1'));
    expect(updates.at(-1)).toMatchObject({ kind: 'rejected', reason: 'paused' });
    scheduler.advance(60_000);
    host.resume(); // at 69 s: 1 s of the freeze left
    expect(host.getView().level!.find!.frozenUntil).toBe(70_000);
    scheduler.advance(999);
    host.tap(parseCellName('F1'));
    expect(updates.at(-1)).toMatchObject({ kind: 'rejected', reason: 'frozen' });
    scheduler.advance(1);
    host.tap(parseCellName('F1'));
    expect(last('spotWon')).toMatchObject({ playerId: ME.id, t: 70_000 });
  });

  it('find: the 20 s count only the time in the foreground', () => {
    const { host, scheduler, last } = setup(FIND_LEVEL);
    scheduler.advance(5000);
    host.pause();
    scheduler.advance(60_000);
    host.resume();
    scheduler.advance(14_999);
    expect(host.state.status).toBe('running');
    expect(host.getView().level).toMatchObject({ elapsedMs: 19_999, remainingMs: 1 });
    scheduler.advance(1);
    expect(last('levelOver')).toMatchObject({ reason: 'timeUp', t: 80_000, elapsedMs: 20000 });
  });

  it('pause and resume are idempotent; resume without a pause does nothing; quitting while frozen works', () => {
    const { host, scheduler, types, updates } = setup(FIND_LEVEL);
    host.resume();
    scheduler.advance(3000);
    host.pause();
    host.pause();
    scheduler.advance(10_000);
    host.resume();
    host.resume();
    expect(types().filter((t) => t === 'levelPaused' || t === 'levelResumed')).toEqual([
      'levelPaused',
      'levelResumed',
    ]);
    expect(updates.filter((u) => u.kind === 'rejected')).toEqual([]);
    scheduler.advance(1000);
    host.pause();
    scheduler.advance(5000);
    host.surrender(); // the X during the 3, 2, 1
    expect(host.over).toMatchObject({ reason: 'quit', elapsedMs: 4000 });
    host.pause();
    host.resume();
    expect(types().at(-1)).toBe('levelOver');
  });
});
