import { avatarById, EXPRESSIONS, MOTION_IDS, renderStatic } from '@sudoku-fight/avatars';
import { AVATAR_IDS } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { drawnAvatarId, svgXmlsIn } from '../avatars/testing/avatarTesting';
import i18n from '../i18n';
import { AvatarLabScreen } from '../screens/AvatarLabScreen';
import { useSettings } from '../state/settings';

/** /dev/avatars: every character with every expression and motion, for Moshe's checks on a phone. */

const hidden = { includeHiddenElements: true };
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const stage = () =>
  svgXmlsIn(screen.getByTestId('dev-avatars-stage', hidden)).map((x) => x.props.xml as string);

async function show(onClose = jest.fn()) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AvatarLabScreen onClose={onClose} />
    </SafeAreaProvider>,
  );
  return onClose;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('AvatarLabScreen (/dev/avatars)', () => {
  it('lists every avatar by kind, and a button for each expression and each motion', async () => {
    const onClose = await show();
    expect(screen.getByRole('header', { name: 'אווטרים' })).toBeOnTheScreen();
    expect(
      screen.getAllByRole('radio').map((r) => String(r.props.testID).replace('dev-avatars-', '')),
    ).toEqual([...AVATAR_IDS]);
    for (const e of EXPRESSIONS) expect(screen.getByTestId(`dev-avatars-expression-${e}`)).toBeOnTheScreen();
    for (const m of MOTION_IDS) expect(screen.getByTestId(`dev-avatars-motion-${m}`)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'הבעה: חיוך' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'תנועה: סיבוב' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'סגירה' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('picks an avatar, an expression and a size; the idle switch stills the stage', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('dev-avatars-kettle'));
    expect(screen.getByTestId('dev-avatars-name')).toHaveTextContent(avatarById('kettle')!.name.he);
    // Idling: the layers, not one still picture.
    expect(stage().length).toBeGreaterThan(1);
    await fireEvent(screen.getByTestId('dev-avatars-idle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('dev-avatars-expression-sleepy'));
    await fireEvent.press(screen.getByTestId('dev-avatars-size-44'));
    expect(stage()).toEqual([renderStatic(avatarById('kettle')!, { size: 44, expression: 'sleepy' })]);
  });

  it("a motion plays once on the stage; the reduced-motion switch is this screen's own", async () => {
    useSettings.setState({ reduceMotion: 'system' });
    await show();
    await fireEvent(screen.getByTestId('dev-avatars-idle'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('dev-avatars-motion-spin'));
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(stage().every((x) => drawnAvatarId(x) === null)).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(drawnAvatarId(stage()[0])).toBe(AVATAR_IDS[0]);
    // On: a motion only changes the face, still; the app keeps following the phone.
    await fireEvent(screen.getByTestId('dev-avatars-reduce'), 'valueChange', true);
    expect(screen.getByTestId('dev-avatars-reduce')).toHaveProp('value', true);
    await fireEvent.press(screen.getByTestId('dev-avatars-motion-spin'));
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(stage()).toHaveLength(1);
    expect(drawnAvatarId(stage()[0])).toBe(AVATAR_IDS[0]);
    expect(useSettings.getState().reduceMotion).toBe('system');
  });
});
