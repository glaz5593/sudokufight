import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { boardModel } from '../../board';
import { useToast } from '../../ui';
import {
  BoardSection,
  ButtonSection,
  CardSection,
  ColorSection,
  HudSection,
  KeypadSection,
  NavSection,
  OverlaySection,
  ToastSection,
  TypeSection,
} from '..';
import { AvatarSection } from '../IdentitySection';
import { boardScene } from '../fixtures';
import { ICON_NAMES } from '../../Icon';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

// The board section's test steps a whole lock through: over 3 s under the full parallel run.
jest.setTimeout(30_000);

const hidden = { includeHiddenElements: true };
const show = (el: ReactElement) => render(<SafeAreaProvider>{el}</SafeAreaProvider>);
/** Lets enter animations finish (Jest's fake timers drive Reanimated). */
const settle = () => act(async () => void jest.advanceTimersByTime(motion.duration.sheetIn * 2));

describe('design-system sections', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    useToast.getState().clear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('colours: a swatch per token with its ratio, and the four palettes with their shapes', async () => {
    await show(<ColorSection />);
    expect(
      screen.getByLabelText(/^color\.text, #eef1f6, ניגודיות 16\.\d\d:1 מול color\.bg, מתאים לטקסט$/),
    ).toBeTruthy();
    expect(screen.getByLabelText(/^color\.iconFaint, .*טקסט גדול וסימנים בלבד$/)).toBeTruthy();
    for (const name of ['P1', 'P2', 'P3', 'P4']) expect(screen.getByTestId(`palette-${name}`)).toBeTruthy();
    expect(screen.getByLabelText(/^P1 · אני, צורה: עיגול/)).toBeTruthy();
  });

  it('type: every type token, and every icon', async () => {
    await show(<TypeSection />);
    expect(screen.getByTestId('type-scoreXL')).toBeTruthy();
    expect(screen.getByText('Rubik 700 · 22/25')).toBeTruthy();
    for (const name of ['alert', 'warning', 'bot', 'target', 'pause']) expect(ICON_NAMES).toContain(name);
    expect(screen.getAllByTestId(/^icon-/, hidden)).toHaveLength(ICON_NAMES.length);
  });

  it('buttons: disabled and loading states are real states', async () => {
    await show(<ButtonSection />);
    expect(screen.getByTestId('primary-hero-disabled')).toBeDisabled();
    expect(screen.getByTestId('primary-lg-loading')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true }),
    );
    expect(screen.getByRole('button', { name: 'תגובות', expanded: true })).toBeTruthy();
  });

  it('identity: avatars in every size, flags, ratings and the five leagues', async () => {
    await show(<AvatarSection />);
    expect(screen.getByRole('image', { name: 'MosheG' })).toBeTruthy();
    expect(screen.getAllByRole('image', { name: 'מדינה: ישראל' }).length).toBeGreaterThan(1);
    expect(screen.getByRole('image', { name: 'מדינה: יפן' })).toBeTruthy();
    for (const tier of ['bronze', 'silver', 'gold', 'diamond', 'legend']) {
      // The text variant and the hexagon variant, side by side.
      expect(within(screen.getByTestId(`league-row-${tier}`)).getAllByTestId(`league-${tier}`)).toHaveLength(
        2,
      );
    }
    expect(screen.getByTestId('bot-chip', hidden)).toBeTruthy();
  });

  it('cards: the pair opens the arsenal and the picker; a short ⚡ raises the error toast', async () => {
    await show(<CardSection />);
    const pair = screen.getByTestId('card-pair');
    await fireEvent.press(within(pair).getByRole('button', { name: /^הפרעה ל־NinaVolt/ }));
    expect(within(pair).getByRole('button', { name: 'סגירת ארסנל ההפרעות' })).toBeTruthy();
    await fireEvent.press(within(pair).getByRole('button', { name: 'תגובות' }));
    expect(within(pair).getByRole('button', { name: 'תגובות', expanded: true })).toBeTruthy();

    const short = screen.getByTestId('opponent-unaffordable');
    await fireEvent.press(within(short).getByRole('button', { name: /חסרות 2 נק׳/ }));
    expect(useToast.getState().current).toMatchObject({ variant: 'error' });

    expect(screen.getByTestId('compact-3')).toBeTruthy();
    expect(screen.getAllByTestId('compact-4')).toHaveLength(2);
    expect(screen.getByTestId('opponent-bot')).toBeTruthy();
  });

  it('hud: a lead bar per state and the lock strip in each state', async () => {
    await show(<HudSection />);
    expect(screen.getByLabelText('שוויון בניקוד')).toBeTruthy();
    expect(screen.getByLabelText(/^MosheG מוביל ב־/)).toBeTruthy();
    // NinaVolt leads when I am behind, and when my score is under zero.
    expect(screen.getAllByLabelText(/^NinaVolt מובילה ב־/)).toHaveLength(2);
    expect(screen.getByLabelText('המשבצת שלך F8, נותרו 7 שניות')).toBeTruthy();
    expect(screen.getByLabelText('המשבצת שלך F8, הטיימר עצור')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('nudge'));
  });

  it('board: a tap shows a pending cell, the clock runs the timers, and the rails can be shown', async () => {
    const start = boardScene();
    const empty = boardModel(start.view, start.mySeat, start.now).cells.find(
      (c) => c.kind === 'empty' && c.wrong.length === 0,
    )!;
    await show(<BoardSection />);
    // The demo board (the close-ups under it have cells of their own).
    const board = () => within(screen.getByTestId('ds-board'));
    expect(screen.getByTestId('ds-clock')).toHaveTextContent('שעון המשחק: 16 שניות');
    expect(board().getByRole('button', { name: /^F8, ריקה, נעולה אצלך, 7 שניות/ })).toBeTruthy();

    await fireEvent.press(board().getByTestId(`cell-${empty.name}`));
    expect(board().getByRole('button', { name: `${empty.name}, ריקה, ממתינה לאישור הנעילה` })).toBeTruthy();

    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByTestId('ds-advance'));
    expect(screen.getByTestId('ds-clock')).toHaveTextContent(/20 שניות$/);
    expect(board().getByRole('button', { name: /^F8, ריקה, נעולה אצלך, 3 שניות/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'תפוסה' }));
    await fireEvent.press(screen.getByRole('button', { name: 'מהלך נכון' }));
    await fireEvent.press(screen.getByRole('button', { name: 'טעות' }));

    await fireEvent(screen.getByTestId('ds-coordinates'), 'valueChange', true);
    expect(screen.getByTestId('ds-board-with-coordinates')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('ds-reset'));
    expect(screen.getByTestId('ds-clock')).toHaveTextContent(/16 שניות$/);
  });

  it('board close-ups: my lock running, urgent and stopped, a pending tap, and an opponent lock', async () => {
    await show(<BoardSection />);
    expect(within(screen.getByTestId('closeup-myLock')).getByTestId('cell-pill', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('closeup-urgent')).getByTestId('cell-pill-urgent', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('closeup-paused')).getByTestId('cell-pill-paused', hidden)).toBeTruthy();
    expect(screen.getByTestId('closeup-paused')).toHaveProp(
      'accessibilityLabel',
      'F8, ריקה, נעולה אצלך, הטיימר עצור',
    );
    expect(screen.getByTestId('closeup-pending').props.accessibilityLabel).toMatch(/ממתינה לאישור הנעילה$/);
    expect(within(screen.getByTestId('closeup-oppLock')).getByTestId('cell-avatar', hidden)).toBeTruthy();
  });

  it('keypad: armed and idle rows, and "ביטול בחירה" enabled and disabled', async () => {
    await show(<KeypadSection />);
    expect(within(screen.getByTestId('keypad-armed')).getAllByRole('button')).toHaveLength(9);
    expect(screen.getByTestId('cancel-enabled')).toBeEnabled();
    expect(screen.getByTestId('cancel-disabled')).toBeDisabled();
    await fireEvent.press(within(screen.getByTestId('keypad-idle')).getAllByRole('button')[0]!);
  });

  it('toasts: the five variants, and one sent through the queue', async () => {
    await show(<ToastSection />);
    for (const v of ['success', 'warning', 'error', 'connection', 'info']) {
      expect(screen.getByTestId(`toast-${v}`)).toBeTruthy();
    }
    expect(screen.getByLabelText(/^היריב מתנתק…, נותרו 11 שניות$/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('toast-send'));
    expect(useToast.getState().current).toMatchObject({ variant: 'success' });
  });

  it('overlays: the sheet and the surrender confirm open on demand', async () => {
    await show(<OverlaySection />);
    expect(screen.queryByText('ארסנל ההפרעות')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-sheet'));
    await settle();
    expect(screen.getByRole('header', { name: 'ארסנל ההפרעות' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'סגירה' }));
    await settle();

    await fireEvent.press(screen.getByTestId('open-surrender'));
    await settle();
    expect(screen.getByRole('header', { name: 'אתה בטוח שאתה רוצה להיכנע?' })).toBeTruthy();
    expect(screen.getByText(/−15/)).toBeTruthy();
  });

  it('navigation: the bar with each tab active', async () => {
    await show(<NavSection />);
    for (const tab of ['home', 'leaderboard', 'history', 'achievements']) {
      const nav = screen.getByTestId(`nav-${tab}`);
      expect(within(nav).getByRole('tab', { selected: true })).toHaveProp('testID', `nav-${tab}-${tab}`);
    }
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await show(<BoardSection />);
    expect(screen.getByTestId('ds-clock')).toHaveTextContent('Game clock: 16 seconds');
  });
});
