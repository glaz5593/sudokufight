import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import {
  type AppStateSource,
  BackgroundPause,
  holdLocalGames,
  localGamesHeld,
  type PauseState,
} from '../backgroundPause';

/**
 * A hold over the local games (1.0.4, friends-room.md §6.6): a room link that came mid-practice asks
 * "לעזוב את האימון?" over the frozen board, and the "3", "2", "1" comes only after "הישאר". A hold freezes like
 * the app going away; its release is the return. Without a hold, nothing changes (practicePause.test.ts).
 */

function fakeAppState() {
  let listener: ((state: string) => void) | null = null;
  const source: AppStateSource = {
    addEventListener: (_type, l) => {
      listener = l;
      return { remove: () => (listener = null) };
    },
  };
  return { source, set: (state: string) => listener?.(state) };
}

/** A local host: running until paused, and what it was told. */
function fakeHost() {
  const calls: string[] = [];
  let status = 'running';
  return {
    calls,
    setStatus: (s: string) => (status = s),
    host: {
      pause: () => {
        calls.push('pause');
        if (status === 'running') status = 'paused';
      },
      resume: () => {
        calls.push('resume');
        if (status === 'paused') status = 'running';
      },
      getView: () => ({ status }),
    },
  };
}

const STEP = 1000;

function rig({ backgroundPause = true, watched = true } = {}) {
  const clock = new ManualClock(0);
  const scheduler = new ManualScheduler(clock);
  const app = fakeAppState();
  const h = fakeHost();
  const states: PauseState[] = [];
  const freeze = new BackgroundPause({
    host: h.host,
    scheduler,
    settings: { backgroundPause, resumeCountdownMs: 3000 },
    appState: watched ? app.source : null,
    onError: (what, error) => {
      throw new Error(`${what}: ${String(error)}`);
    },
  });
  freeze.onChange((s) => states.push(s));
  const advance = (ms: number) => scheduler.advance(ms);
  return { freeze, app, h, states, advance };
}

const kinds = (states: PauseState[]) =>
  states.map((p) => (p.kind === 'countdown' ? String(p.count) : p.kind));

let releases: (() => void)[] = [];
const hold = () => {
  const release = holdLocalGames();
  releases.push(release);
  return release;
};
afterEach(() => {
  releases.forEach((r) => r());
  releases = [];
});

describe('holdLocalGames', () => {
  it('a running game freezes; at the release, "3", "2", "1", then it goes on', () => {
    const r = rig();
    const release = hold();
    expect(localGamesHeld()).toBe(true);
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    expect(r.h.calls).toEqual(['pause']);
    r.advance(10_000);
    expect(r.h.calls).toEqual(['pause']);
    release();
    expect(localGamesHeld()).toBe(false);
    r.advance(3 * STEP);
    expect(kinds(r.states)).toEqual(['paused', '3', '2', '1', 'none']);
    expect(r.h.calls).toEqual(['pause', 'resume']);
  });

  it('the app back while held (the link brought it back): no countdown until the release', () => {
    const r = rig();
    r.app.set('background');
    const release = hold();
    r.app.set('active');
    r.advance(5 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    release();
    r.advance(3 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'none' });
    expect(r.h.calls).toEqual(['pause', 'resume']);
  });

  it('a countdown already on (the app came back first) freezes again, and starts over at the release', () => {
    const r = rig();
    r.app.set('background');
    r.app.set('active');
    r.advance(STEP);
    expect(r.freeze.state).toEqual({ kind: 'countdown', count: 2 });
    const release = hold();
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    r.advance(10 * STEP);
    expect(r.h.calls).toEqual(['pause']);
    release();
    r.advance(3 * STEP);
    expect(kinds(r.states)).toEqual(['paused', '3', '2', 'paused', '3', '2', '1', 'none']);
  });

  it('released while the app is away: nothing until it is back', () => {
    const r = rig();
    const release = hold();
    r.app.set('background');
    release();
    r.advance(5 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    r.app.set('active');
    r.advance(3 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'none' });
  });

  it('two holds: frozen until both are released; a release twice does nothing more', () => {
    const r = rig();
    const a = hold();
    const b = hold();
    a();
    a();
    r.advance(5 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    b();
    r.advance(3 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'none' });
  });

  it('a game that is not running (over, not started) is left as it is', () => {
    const r = rig();
    r.h.setStatus('over');
    const release = hold();
    release();
    r.advance(5 * STEP);
    expect(r.states).toEqual([]);
    expect(r.h.calls).toEqual([]);
  });

  it('no freeze (backgroundPause off), or the game closed: a hold changes nothing', () => {
    const off = rig({ backgroundPause: false });
    const closed = rig();
    closed.freeze.close();
    hold()();
    off.advance(5 * STEP);
    expect(off.h.calls).toEqual([]);
    expect(closed.h.calls).toEqual([]);
  });

  it('a game that does not watch the app (tests, appState null) follows holds too', () => {
    const r = rig({ watched: false });
    const release = hold();
    expect(r.freeze.state).toEqual({ kind: 'paused' });
    release();
    r.advance(3 * STEP);
    expect(r.freeze.state).toEqual({ kind: 'none' });
  });
});
