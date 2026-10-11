import { act, renderHook } from '@testing-library/react-native';

import { type Duel, duel } from '../../testing/duel';
import { useReactionMutes } from '../muteStore';
import { useReactions } from '../useReactions';

/**
 * The picker's handlers go to my memo'd card (spec §22: it renders only when what it shows changes). The
 * screen re-reads the time 4 times a second, so they must stay the same functions from one re-read to the next,
 * and still act on the picker as it is when they run (the cooldown, D19).
 */

let game: Duel | null = null;

beforeEach(() => useReactionMutes.getState().reset());
afterEach(() => {
  game?.session.close();
  game = null;
});

describe('useReactions: the handlers my card gets', () => {
  it('keep their identity as the time passes, and read the cooldown as it is when pressed', async () => {
    game = duel();
    const emoji = game.host.getView().rules.reactions[0]!;
    game.host.react(emoji);
    const view = game.host.getView();
    const ready = view.reactionReadyAt;
    const onReact = jest.fn();
    const { result, rerender } = await renderHook(
      ({ now }: { now: number }) => useReactions({ view, now, onReact }),
      { initialProps: { now: ready - 1000 } },
    );
    const { togglePicker, pick } = result.current;

    // Cooling down: the button opens nothing.
    await act(async () => togglePicker());
    expect(result.current.pickerOpen).toBe(false);

    // Re-reads of the time: the same functions, now acting on a picker that is ready.
    for (const now of [ready - 750, ready - 500, ready + 1]) await rerender({ now });
    expect(result.current.togglePicker).toBe(togglePicker);
    expect(result.current.pick).toBe(pick);
    await act(async () => togglePicker());
    expect(result.current.pickerOpen).toBe(true);
    await act(async () => pick(emoji));
    expect(onReact).toHaveBeenCalledWith(emoji);
    expect(result.current.pickerOpen).toBe(false);
  });
});
