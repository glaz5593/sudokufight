import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../../../i18n';
import { levelById } from '../../../levels/levelsData';
import { track } from '../../../services/analytics';
import { HowToPlay, TUTORIAL_PANELS, tutorialFor, useTutorials } from '../HowToPlay';

/**
 * "איך משחקים" (components.md §19.8): the shell of three panels, "הבנתי" and "דלג", once per kind (and once
 * before the first boss), and `level_tutorial` with whether it was skipped. The panels' pictures come from the
 * stage screens (HowToPlayPanels); every panel says its line to a screen reader.
 */

jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const L001 = levelById('L001')!;
const L010 = levelById('L010')!;
const L012 = levelById('L012')!;

const show = (node: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useTutorials.setState({ seen: {} });
  jest.mocked(track).mockClear();
});

describe('HowToPlay', () => {
  it('shows three panels, each with its line for a screen reader', async () => {
    await show(<HowToPlay kind="find" level={L001} onDone={jest.fn()} />);
    expect(TUTORIAL_PANELS).toBe(3);
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`how-to-play-panel-${n}`)).toBeTruthy();
    expect(screen.getByTestId('how-to-play-panel-2')).toHaveProp(
      'accessibilityLabel',
      'תמונה 2 מתוך 3: מצא את המשבצת היחידה שבה הספרה חייבת להיות, והקש עליה.',
    );
    expect(screen.getByRole('header', { name: 'איפה ה־7?' })).toBeTruthy();
  });

  it('the panels’ pictures come from the stage screens when given', async () => {
    await show(
      <HowToPlay
        kind="find"
        level={L001}
        onDone={jest.fn()}
        renderPanel={(kind, i) => <Text testID={`picture-${kind}-${i}`}>board</Text>}
      />,
    );
    expect(screen.getByTestId('picture-find-0')).toBeTruthy();
    expect(screen.getByTestId('picture-find-2')).toBeTruthy();
  });

  it('"הבנתי": seen, reported (not skipped), and the stage goes on', async () => {
    const onDone = jest.fn();
    await show(<HowToPlay kind="find" level={L001} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'הבנתי' }));
    expect(onDone).toHaveBeenCalledWith(false);
    expect(track).toHaveBeenCalledWith('level_tutorial', { kind: 'find', skipped: false });
    expect(useTutorials.getState().seen).toEqual({ find: true });
  });

  it('"דלג": seen too, and reported as skipped', async () => {
    const onDone = jest.fn();
    await show(<HowToPlay kind="findDuel" level={L012} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'דלג' }));
    expect(onDone).toHaveBeenCalledWith(true);
    expect(track).toHaveBeenCalledWith('level_tutorial', { kind: 'findDuel', skipped: true });
    expect(useTutorials.getState().seen.findDuel).toBe(true);
  });

  it('once per kind: before the first stage of a kind, and before the first boss', () => {
    expect(tutorialFor(L001, {})).toBe('find');
    expect(tutorialFor(L001, { find: true })).toBeNull();
    // L010 is chapter 1's boss, a box: the boss's card first, then nothing (the box was seen at L002).
    expect(tutorialFor(L010, { find: true, fillBox: true })).toBe('boss');
    expect(tutorialFor(L010, { find: true, fillBox: true, boss: true })).toBeNull();
    expect(tutorialFor(L012, { find: true, fillBox: true, boss: true })).toBe('findDuel');
  });

  it('the boss’s card', async () => {
    await show(<HowToPlay kind="boss" level={L010} onDone={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'שלב בוס' })).toBeTruthy();
    expect(screen.getByTestId('how-to-play-panel-1')).toHaveProp(
      'accessibilityLabel',
      'תמונה 1 מתוך 3: השלב העשירי בכל פרק הוא שלב בוס.',
    );
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show(<HowToPlay kind="find" level={L001} onDone={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('header', { name: "Where's the 7?" })).toBeTruthy();
  });
});
