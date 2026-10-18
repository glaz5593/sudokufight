// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import type { BlockedPlayer } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ModerationApi } from '../../../api/moderationApi';
import { createFakeModeration, type FakeModeration } from '../../../api/testing/fakeModeration';
import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer } from '../../../auth/testing/testAuth';
import { useToast } from '../../../components/ui';
import i18n from '../../../i18n';
import { resetBlocks, setModerationApi } from '../../../moderation/moderation';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { type ModerationFlow, useModerationFlow } from '../useModerationFlow';

/**
 * The flow's sheet and dialog as the game screen needs them at a game's end (Moshe's black screens of 1.0.0):
 * whether one is on the screen (`mounted`, from its opening until it has left), closing both at once even while a
 * block is being sent (`closeAll`), and being told when both have left (`onExited`).
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const NOW = 1_760_000_000_000;
const NINA = { id: 'nina', name: 'NinaVolt' };

let server: FakeModeration;
let flow: ModerationFlow;
const onExited = jest.fn();

function Harness({ capture }: { capture: (f: ModerationFlow) => void }) {
  const current = useModerationFlow({ placement: 'bottom', onExited, now: () => NOW });
  useEffect(() => capture(current));
  return (
    <View>
      <Text testID="mounted">{String(current.mounted)}</Text>
      <Pressable testID="close-all" onPress={current.closeAll} />
      {current.view}
    </View>
  );
}

const harness = () => (
  <Harness
    capture={(f) => {
      flow = f;
    }}
  />
);

const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const mounted = () => screen.getByTestId('mounted');
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
/** Opening, then the sheet or dialog is fully up. */
const open = async (go: () => void) => {
  await act(async () => go());
  await wait(motion.duration.sheetIn + 50);
};
/** Long enough for any exit (sheet.out, the dialog's) to be over and reported. */
const exits = () => wait(motion.duration.sheetOut + motion.duration.stateChange + 100);

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useToast.getState().clear();
  await installSignedInPlayer();
  await initAuth();
  server = createFakeModeration({ me: useAuth.getState().me!.id, now: NOW });
  server.addPlayer({ id: 'nina', displayName: 'NinaVolt' });
  setModerationApi(() => server.api);
  resetBlocks();
  onExited.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  setModerationApi(null);
  setAuthDeps(null);
});

describe('useModerationFlow: mounted, closeAll, onExited', () => {
  it('the report sheet: mounted from its opening until it has left the screen; onExited once', async () => {
    await render(harness());
    expect(mounted()).toHaveTextContent('false');
    await open(() => flow.openReport(NINA, 'game-1'));
    expect(screen.getByTestId('report-sheet')).toBeOnTheScreen();
    expect(mounted()).toHaveTextContent('true');

    await press('report-sheet-close');
    // Still sliding away: still on the screen.
    expect(mounted()).toHaveTextContent('true');
    expect(onExited).not.toHaveBeenCalled();
    await exits();
    expect(screen.queryByTestId('report-sheet')).toBeNull();
    expect(mounted()).toHaveTextContent('false');
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('closeAll closes the block dialog; onExited once it has gone', async () => {
    await render(harness());
    await open(() => flow.openBlock(NINA));
    expect(screen.getByTestId('block-confirm')).toBeOnTheScreen();
    expect(mounted()).toHaveTextContent('true');
    await press('close-all');
    await exits();
    expect(screen.queryByTestId('block-confirm')).toBeNull();
    expect(mounted()).toHaveTextContent('false');
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('closeAll closes the dialog even while the block is being sent; the block still goes through', async () => {
    let answer: (b: BlockedPlayer) => void = () => undefined;
    const slow: ModerationApi = {
      ...server.api,
      block: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    };
    setModerationApi(() => slow);
    const blocked = await server.api.block('nina');
    await render(harness());
    await open(() => flow.openBlock(NINA));
    await press('block-confirm-confirm');
    // Busy: its own "ביטול" does not close it…
    await press('block-confirm-cancel');
    await wait(50);
    expect(screen.getByTestId('block-confirm')).toBeOnTheScreen();
    // …but the screen's end does.
    await press('close-all');
    await exits();
    expect(screen.queryByTestId('block-confirm')).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
    await act(async () => answer(blocked));
    expect(useToast.getState().queue.at(-1)?.message ?? useToast.getState().current?.message).toContain(
      'NinaVolt',
    );
  });

  it('the sheet and the dialog both up: onExited only once both have gone', async () => {
    await render(harness());
    await open(() => flow.openReport(NINA));
    await open(() => flow.openBlock(NINA));
    expect(mounted()).toHaveTextContent('true');
    await act(async () => {
      flow.closeAll();
    });
    await exits();
    expect(mounted()).toHaveTextContent('false');
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('nothing opened, nothing to say: closeAll does nothing', async () => {
    await render(harness());
    await press('close-all');
    await exits();
    expect(mounted()).toHaveTextContent('false');
    expect(onExited).not.toHaveBeenCalled();
  });
});
