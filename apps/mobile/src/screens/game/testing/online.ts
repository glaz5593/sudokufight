/* Test-only: an online session (OnlineSession over the net tests' fake server) for the game screen's tests. */
import { act } from '@testing-library/react-native';

import { type OnlineProfiles, OnlineSession } from '../../../game/onlineSession';
import { elapse, FakeTable, type FakeTableOptions } from '../../../net/testing/fakeServer';

export { CODE, ME, OPP } from '../../../net/testing/fakeServer';

export interface OnlineGame {
  table: FakeTable;
  session: OnlineSession;
  tracked: { name: string; props: Record<string, unknown> }[];
}

/** A session that created the fake room (it is in the lobby once `table.lobby()` arrives). */
export function onlineSession(o: FakeTableOptions = {}, profiles: OnlineProfiles | null = null): OnlineGame {
  const table = new FakeTable(o);
  const tracked: OnlineGame['tracked'] = [];
  const session = new OnlineSession({
    host: table.host,
    request: { kind: 'create', options: { gameType: 'fast', playerCount: 2 } },
    track: (name, props) => tracked.push({ name, props }),
    profiles,
  });
  return { table, session, tracked };
}

/**
 * A session whose game has started: in the room, snapshot and start received, the clock synced. `profiles`:
 * the other players' public profiles, as a ranked match's "found" gives them.
 */
export async function liveOnlineSession(
  o: FakeTableOptions = {},
  profiles: OnlineProfiles | null = null,
): Promise<OnlineGame> {
  const game = onlineSession(o, profiles);
  await game.session.ready;
  game.table.lobby();
  game.table.startGame();
  await elapse(game.table, 300);
  return game;
}

/**
 * Moves the fake server's clock (its network, the engine's timers, the host's reconnecting) and the phone's
 * timers (the screen's ticks and animations) on together, in steps, inside act().
 */
export async function pass(table: FakeTable, ms: number, step = 50): Promise<void> {
  for (let done = 0; done < ms; done += step) {
    const d = Math.min(step, ms - done);
    await act(async () => {
      await elapse(table, d, Math.min(10, d));
      jest.advanceTimersByTime(d);
    });
  }
}
