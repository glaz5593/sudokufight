import { MOTIONS } from '@sudoku-fight/avatars';
import { act, renderHook } from '@testing-library/react-native';
import { useEffect, useState } from 'react';

import { AVATAR_REACTIONS } from '../../avatars/reactions';
import { type Duel, duel, ME } from '../../screens/game/testing/duel';
import { answerIn, wrongIn } from '../testing/practice';
import { type FaceSource, useAvatarFaces } from '../useAvatarFaces';
import { useNow } from '../useNow';

/**
 * useAvatarFaces (spec §3.4): a practice against a bot on a manual clock, followed as the game screen follows
 * it (the view re-read on each update, the time from useNow's tick in the game's clock). The bot's moves are the
 * test's own.
 */

/** The screen's way of following a session: its view, its tick, and the faces. */
function useFollow(session: FaceSource & { getView: Duel['session']['getView'] }) {
  const [view, setView] = useState(() => session.getView());
  useEffect(() => session.subscribe(() => setView(session.getView())), [session]);
  const now = useNow(250, { clock: session.clock });
  return useAvatarFaces(session, view, now);
}

let game: Duel | null = null;
async function follow() {
  // Interferences on, for the dizzy face (a practice against a bot has none, D44).
  game = duel({ rules: { interferences: true } });
  const g = game;
  const hook = await renderHook(({ session }: { session: Duel['session'] }) => useFollow(session), {
    initialProps: { session: g.session },
  });
  const faces = () => hook.result.current;
  return {
    ...g,
    hook,
    mine: () => faces()[ME]!,
    theirs: () => faces()[g.session.host.getView().players[1]!.id]!,
  };
}

/** The phone's timers on by `ms` (useNow ticks), with the game's clock where the test left it. */
async function tick(ms = 250) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

describe('useAvatarFaces: reactions from the session’s events', () => {
  it('starts calm, with nothing to play', async () => {
    const g = await follow();
    expect(g.mine()).toEqual({ expression: 'neutral', reaction: null });
    expect(g.theirs()).toEqual({ expression: 'neutral', reaction: null });
  });

  it('my correct digit: smile and nod on my face; the bot’s mistake: sad and shake on its own', async () => {
    const g = await follow();
    const [a, b] = g.cells;
    await act(async () => {
      g.host.select(a!);
      g.host.place(a!, answerIn(g.puzzle, a!));
    });
    expect(g.mine().reaction).toMatchObject({ expression: 'smile', motion: 'nod', faceMs: 1200 });
    expect(g.theirs().reaction).toBeNull();
    await act(async () => g.clock.advance(5_000));
    await act(async () => g.bot.miss(b!));
    expect(g.theirs().reaction).toMatchObject({ expression: 'sad', motion: 'shake' });
    // Mine stays the one it played (AvatarArt plays a key once).
    expect(g.mine().reaction).toMatchObject({ expression: 'smile' });
  });

  it('two updates in one render are both read (straight from the host)', async () => {
    const g = await follow();
    const [a, b] = g.cells;
    await act(async () => {
      g.bot.solve(a!);
      g.clock.advance(5_000);
      g.host.select(b!);
      g.host.place(b!, wrongIn(g.puzzle, b!));
    });
    expect(g.theirs().reaction).toMatchObject({ expression: 'smile' });
    expect(g.mine().reaction).toMatchObject({ expression: 'sad' });
  });

  it('an interference: the target dizzy (its mood) and wobbling again while it lasts; the sender winks', async () => {
    const g = await follow();
    await act(async () => g.bot.solve(g.cells[0]!)); // the bot needs the points (D10)
    await act(async () => g.clock.advance(5_000));
    await act(async () => g.bot.interfere('cats'));
    expect(g.mine()).toMatchObject({
      expression: 'dizzy',
      reaction: { expression: 'dizzy', motion: 'wobble' },
    });
    expect(g.theirs().reaction).toEqual({ expression: 'wink', key: expect.any(String) });
    const first = g.mine().reaction!.key;
    await act(async () => g.scheduler.advance(MOTIONS.wobble.durationMs));
    await tick();
    expect(g.mine().reaction!.key).toBe(`${first}:1`);
    // Over: the mood goes, the wobble stops coming back.
    await act(async () => g.scheduler.advance(5_000));
    await tick();
    expect(g.mine().expression).toBe('neutral');
    const last = g.mine().reaction!.key;
    await act(async () => g.clock.advance(10_000));
    await tick();
    expect(g.mine().reaction!.key).toBe(last);
  });

  it('a reaction emoji plays on its sender', async () => {
    const g = await follow();
    await act(async () => g.bot.react('😱'));
    expect(g.theirs().reaction).toMatchObject({ expression: 'surprised', motion: 'squash' });
    await act(async () => g.clock.advance(3_000));
    await act(async () => g.host.react('🔥'));
    expect(g.mine().reaction).toMatchObject({ expression: 'laugh', motion: 'spin' });
  });

  it('the end: I surrender (sad), the bot wins (laugh and spin), and the moods stay', async () => {
    const g = await follow();
    await act(async () => g.host.surrender());
    expect(g.mine()).toMatchObject({ expression: 'sad', reaction: { expression: 'sad' } });
    expect(g.theirs()).toMatchObject({
      expression: 'smile',
      reaction: { expression: 'laugh', motion: 'spin' },
    });
  });
});

describe('useAvatarFaces: asleep after 20 s without an action of mine', () => {
  const after = AVATAR_REACTIONS.sleepy!.afterMs;

  it('falls asleep on the tick that crosses 20 s; my next action wakes it; the bot never sleeps', async () => {
    const g = await follow();
    await act(async () => g.clock.advance(after - 1));
    await tick();
    expect(g.mine().expression).toBe('neutral');
    await act(async () => g.clock.advance(1));
    await tick();
    expect(g.mine().expression).toBe('sleepy');
    expect(g.theirs().expression).toBe('neutral');

    await act(async () => g.host.select(g.cells[0]!));
    expect(g.mine().expression).toBe('neutral');
    // A lock that runs out is not an action of mine: asleep 20 s after the select.
    await act(async () => g.scheduler.advance(after));
    await tick();
    expect(g.mine().expression).toBe('sleepy');
  });

  it('an action the host refuses wakes it too (a tap on a taken cell)', async () => {
    const g = await follow();
    const a = g.cells[0]!;
    await act(async () => g.bot.select(a));
    await act(async () => g.clock.advance(after));
    await tick();
    expect(g.mine().expression).toBe('sleepy');
    await act(async () => g.host.select(a)); // taken: refused
    expect(g.mine().expression).toBe('neutral');
  });

  it('a new session starts afresh', async () => {
    const g = await follow();
    await act(async () => g.bot.react('😂'));
    expect(g.theirs().reaction).not.toBeNull();
    const next = duel();
    await g.hook.rerender({ session: next.session });
    const bot = next.host.getView().players[1]!.id;
    expect(g.hook.result.current[bot]).toEqual({ expression: 'neutral', reaction: null });
    next.session.close();
  });
});
