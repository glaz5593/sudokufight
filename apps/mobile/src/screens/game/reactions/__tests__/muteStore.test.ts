import { act, renderHook } from '@testing-library/react-native';

import { isReactionMuted, mutedIn, useMutedPlayers, useReactionMutes } from '../muteStore';

beforeEach(() => useReactionMutes.getState().reset());

describe('the mutes of a game (spec §8, D19)', () => {
  it('mutes and unmutes a player of the game', () => {
    const { toggle } = useReactionMutes.getState();
    expect(isReactionMuted('g1', 'nina')).toBe(false);
    expect(toggle('g1', 'nina')).toBe(true);
    expect(isReactionMuted('g1', 'nina')).toBe(true);
    expect(useReactionMutes.getState().muted).toEqual(['nina']);
    expect(toggle('g1', 'nina')).toBe(false);
    expect(isReactionMuted('g1', 'nina')).toBe(false);
  });

  it('keeps several, in the order they were muted', () => {
    const { toggle, setMuted } = useReactionMutes.getState();
    toggle('g1', 'p3');
    toggle('g1', 'p2');
    setMuted('g1', 'p3', true); // already muted: no change
    expect(useReactionMutes.getState().muted).toEqual(['p3', 'p2']);
    setMuted('g1', 'p3', false);
    expect(useReactionMutes.getState().muted).toEqual(['p2']);
  });

  it('belongs to one game: another game starts with nobody muted', () => {
    const { toggle } = useReactionMutes.getState();
    toggle('g1', 'nina');
    expect(isReactionMuted('g2', 'nina')).toBe(false);
    expect(mutedIn(useReactionMutes.getState(), 'g2')).toEqual([]);
    toggle('g2', 'bot-3');
    expect(useReactionMutes.getState()).toMatchObject({ gameId: 'g2', muted: ['bot-3'] });
    expect(isReactionMuted('g1', 'nina')).toBe(false);
  });

  it('hands React a stable list, which changes only with a mute', async () => {
    const { result, rerender } = await renderHook(() => useMutedPlayers('g1'));
    const before = result.current;
    expect(before).toEqual([]);
    await rerender({});
    expect(result.current).toBe(before);
    await act(async () => void useReactionMutes.getState().toggle('g1', 'nina'));
    expect(result.current).toEqual(['nina']);
    await act(async () => void useReactionMutes.getState().toggle('g2', 'other'));
    expect(result.current).toEqual([]);
  });

  it('forgets everything on reset', () => {
    useReactionMutes.getState().toggle('g1', 'nina');
    useReactionMutes.getState().reset();
    expect(useReactionMutes.getState()).toMatchObject({ gameId: null, muted: [] });
  });
});
