import { ENGINE_VERSION } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../i18n';
import en from '../i18n/locales/en/common.json';
import he from '../i18n/locales/he/common.json';
import { HelloScreen, rttText } from '../screens/HelloScreen';
import { useHelloStore } from '../state/helloStore';

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));

// Skia draws natively; here the canvas is a plain view.
jest.mock('@shopify/react-native-skia', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Canvas: View, Circle: () => null };
});

// A fake echo room: pong comes back on the next turn of the event loop.
const mockEchoRoom = {
  handlers: new Map<string, (m: unknown) => void>(),
  onMessage(type: string, cb: (m: unknown) => void) {
    this.handlers.set(type, cb);
  },
  send(type: string, m: { t: number }) {
    if (type === 'ping') setTimeout(() => this.handlers.get('pong')?.({ t: m.t - 42, serverTime: 0 }), 0);
  },
  leave: jest.fn(() => Promise.resolve()),
};
jest.mock('@colyseus/sdk', () => ({
  Client: jest.fn().mockImplementation(() => ({ joinOrCreate: () => Promise.resolve(mockEchoRoom) })),
}));

/** Every key of one language file exists in the other (spec §22: Hebrew and English). */
function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('HelloScreen (stage 0)', () => {
  beforeEach(async () => {
    useHelloStore.setState({ taps: 0 });
    await i18n.changeLanguage('he');
  });

  it('shows text that comes from the engine package, and a Skia canvas', async () => {
    await render(<HelloScreen />);
    expect(screen.getByText('סודוקו פייט')).toBeTruthy();
    expect(screen.getByTestId('engine-line')).toHaveTextContent('שלום מה־engine · משבצת D5');
    expect(screen.getByTestId('versions')).toHaveTextContent(`engine ${ENGINE_VERSION} · protocol 1`);
    expect(screen.getByTestId('skia-circle')).toBeTruthy();
  });

  it('joins the echo room and shows the round-trip time', async () => {
    await render(<HelloScreen />);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByTestId('rtt')).toHaveTextContent(/^שרת: RTT \d+ ms$/);
  });

  it('counts taps in the Zustand store and buzzes', async () => {
    const Haptics = jest.requireMock<{ selectionAsync: jest.Mock }>('expo-haptics');
    await render(<HelloScreen />);
    await fireEvent.press(screen.getByTestId('tap'));
    await fireEvent.press(screen.getByTestId('tap'));
    expect(screen.getByText('לחיצות: 2')).toBeTruthy();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<HelloScreen />);
    expect(screen.getByTestId('engine-line')).toHaveTextContent('Hello from the engine · cell D5');
  });

  it('words the connection state', () => {
    const t = i18n.getFixedT('en');
    expect(rttText({ kind: 'connecting' }, t)).toBe('Server: connecting…');
    expect(rttText({ kind: 'connected', rttMs: null, samples: 0 }, t)).toBe('Server: connected');
    expect(rttText({ kind: 'connected', rttMs: 37, samples: 3 }, t)).toBe('Server: RTT 37 ms');
    expect(rttText({ kind: 'error', message: 'offline' }, t)).toBe('Server: offline');
  });

  it('has the same keys in Hebrew and English', () => {
    expect(keys(he).sort()).toEqual(keys(en).sort());
  });
});
