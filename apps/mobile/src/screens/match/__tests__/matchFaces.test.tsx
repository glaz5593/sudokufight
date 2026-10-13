import { act, render, renderHook, screen } from '@testing-library/react-native';

import { shownFace } from '../../../avatars/testing/avatarTesting';
import { useAfter, useReadyFace } from '../../../avatars/useFaces';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import type { SeatModel } from '../matchModel';
import { SeatTile } from '../parts';

/**
 * Before a game (spec §3.4, §10): a player who is in smiles, and one who turns ready on screen smiles and nods
 * (D37: ready as soon as they are in the room). The hooks for the faces outside a game: useReadyFace, useAfter.
 */

const hidden = { includeHiddenElements: true };

const seat = (ready: boolean): SeatModel => ({
  id: 'opp',
  name: 'NinaVolt',
  avatarId: 'fox',
  country: 'DE',
  rating: 1305,
  provisional: false,
  isMe: false,
  colorIndex: 1,
  ready,
});

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('the VS (Match-Found): SeatTile', () => {
  const face = () => shownFace(screen.getByTestId('seat-opp-avatar-image', hidden));

  it('connecting: calm; ready: a smile and a nod, then the smile stays', async () => {
    const view = await render(<SeatTile seat={seat(false)} showReady reduce={false} />);
    expect(face()).toBe('neutral');
    await view.rerender(<SeatTile seat={seat(true)} showReady reduce={false} />);
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(face()).toBe('smile');
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(face()).toBe('smile');
  });

  it('ready from the start: the smile, with nothing to play', async () => {
    await render(<SeatTile seat={seat(true)} showReady reduce={false} />);
    expect(face()).toBe('smile');
  });
});

describe('useReadyFace and useAfter', () => {
  it('useReadyFace: a new key each time it turns ready, none while it stays', async () => {
    const { result, rerender } = await renderHook(({ ready }: { ready: boolean }) => useReadyFace(ready), {
      initialProps: { ready: true },
    });
    expect(result.current).toEqual({ expression: 'smile', reaction: null });
    await rerender({ ready: false });
    expect(result.current).toEqual({ expression: 'neutral', reaction: null });
    await rerender({ ready: true });
    expect(result.current.reaction).toEqual({ expression: 'smile', motion: 'nod', key: 'ready:1' });
    await rerender({ ready: true });
    expect(result.current.reaction?.key).toBe('ready:1');
    await rerender({ ready: false });
    await rerender({ ready: true });
    expect(result.current.reaction?.key).toBe('ready:2');
  });

  it('useAfter: false until the time is up, then true', async () => {
    const { result } = await renderHook(() => useAfter(300));
    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });
});
