import { FILL_BOX_LEVEL, ME } from '../testing/levels';
import { makeConfig } from '../testing/game';
import { ManualClock } from '../util/clock';
import { ManualScheduler } from '../util/scheduler';
import { levelGameConfig } from '../levels/spec';
import { type GameConfig } from './types';
import { type HostUpdate, LocalGameHost } from './host';

/*
 * The puzzle's move (1.0.3; levels-content.md §5.4): `swapBoxes` is LocalPuzzleHost's alone. The game engine's
 * host refuses it at once, as a tap: one 'badAction' update, nothing applied, nothing logged.
 */

function setup(config: GameConfig, playerId: string) {
  const clock = new ManualClock(0);
  const scheduler = new ManualScheduler(clock);
  const host = new LocalGameHost({ config, playerId, clock, scheduler });
  const updates: HostUpdate[] = [];
  host.subscribe((u) => updates.push(u));
  return { host, updates };
}

describe('LocalGameHost.swapBoxes', () => {
  it('a game refuses it: one rejected update with the swap as asked, the log untouched', () => {
    const { host, updates } = setup(makeConfig(), 'p1');
    const log = host.events.slice();
    host.swapBoxes(1, 5);
    expect(updates).toEqual([
      {
        kind: 'rejected',
        action: { type: 'swapBoxes', from: 1, to: 5 },
        reason: 'badAction',
        view: host.getView(),
      },
    ]);
    expect(host.events).toEqual(log);
  });

  it('a digit level refuses it too, and plays on', () => {
    const config = levelGameConfig(FILL_BOX_LEVEL, { id: 'g', player: ME, attempt: 1 });
    const { host, updates } = setup(config, ME.id);
    host.swapBoxes(0, 8);
    expect(updates.map((u) => (u.kind === 'rejected' ? u.reason : u.kind))).toEqual(['badAction']);
    expect(host.getView().status).toBe('running');
  });

  it('after close: throws, as every other action', () => {
    const { host } = setup(makeConfig(), 'p1');
    host.close();
    expect(() => host.swapBoxes(1, 2)).toThrow('closed');
  });
});
