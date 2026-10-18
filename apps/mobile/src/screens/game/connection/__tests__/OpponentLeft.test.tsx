import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { color } from '../../../../theme';
import type { OpponentLeftModel } from '../connectionModel';
import { OpponentLeft } from '../OpponentLeft';
import { iso, type Setup, setUp, wait } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const model = (over: Partial<OpponentLeftModel> = {}): OpponentLeftModel => ({
  kind: 'opponentLeft',
  playerId: 'nina',
  name: 'NinaVolt',
  colorIndex: 1,
  me: { id: 'me', name: 'MosheG', score: 55 },
  opponentScore: 39.5,
  ratingDelta: 9,
  ratingGuard: null,
  gameType: 'normal',
  graceSeconds: 15,
  ...over,
});

let env: Setup;
afterEach(() => env.restore());

/** A 0 rating change as the chip writes it: an LTR isolate (CLAUDE.md). */
const ZERO = '⁦0⁩';

const screenFor = (
  over: Partial<OpponentLeftModel> = {},
  props: { gender?: 'female'; opponentCountry?: string | null } = {},
) => {
  const onResults = jest.fn();
  const onHome = jest.fn();
  return {
    onResults,
    onHome,
    ui: <OpponentLeft model={model(over)} onResults={onResults} onHome={onHome} {...props} />,
  };
};

describe('OpponentLeft (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('says who left and that I won by abandonment', async () => {
    await render(screenFor().ui);
    expect(screen.getByText('הזמן נגמר · 15 שניות בלי חיבור')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent(`${iso('NinaVolt')} עזב את המשחק`);
    expect(screen.getByTestId('opponent-left-win')).toHaveTextContent('ניצחת בנטישה');
    expect(screen.getByTestId('opponent-left-win')).toHaveStyle({ color: color.accent });
    expect(screen.getByTestId('opponent-left')).toHaveProp('accessibilityViewIsModal', true);
  });

  it('shows my rating change, signed and isolated, with the game type', async () => {
    await render(screenFor().ui);
    expect(screen.getByTestId('opponent-left-rating')).toHaveAccessibleName('שינוי בדירוג: ⁦+9⁩, רגיל');
    expect(screen.getByText('⁦+9⁩')).toBeOnTheScreen();
  });

  it('a gain is gold, with no reason line', async () => {
    await render(screenFor().ui);
    expect(screen.getByTestId('opponent-left-rating-delta')).toHaveStyle({ color: color.accent });
    expect(screen.queryByTestId('opponent-left-rating-reason', { includeHiddenElements: true })).toBeNull();
  });

  it.each([
    ['opponentLeftBeforeMyMove', 'הדירוג לא השתנה: היציאה הייתה לפני המהלך הראשון שלך'],
    ['opponentLeftAhead', 'הדירוג לא השתנה: היית בפיגור ברגע היציאה'],
  ] as const)(
    'a 0 a leave guard held (§11.2, %s): muted, the reason under the chip, said with the chip',
    async (guard, line) => {
      await render(screenFor({ ratingDelta: 0, ratingGuard: guard }).ui);
      const delta = screen.getByTestId('opponent-left-rating-delta');
      expect(delta).toHaveTextContent(ZERO);
      expect(delta).toHaveStyle({ color: color.textMuted });
      const reason = screen.getByTestId('opponent-left-rating-reason', { includeHiddenElements: true });
      expect(reason).toHaveTextContent(line);
      expect(reason).toHaveProp('accessibilityElementsHidden', true);
      expect(screen.getByTestId('opponent-left-rating')).toHaveAccessibleName(
        `שינוי בדירוג: ${ZERO}, רגיל. ${line}`,
      );
    },
  );

  it('a 0 without a guard (a result from before the guards) is muted, with no reason line', async () => {
    await render(screenFor({ ratingDelta: 0 }).ui);
    expect(screen.getByTestId('opponent-left-rating-delta')).toHaveStyle({ color: color.textMuted });
    expect(screen.queryByTestId('opponent-left-rating-reason', { includeHiddenElements: true })).toBeNull();
  });

  it('puts the leaver’s flag on the avatar’s other corner, dimmed and silent; none without a country', async () => {
    const { unmount } = await render(screenFor({}, { opponentCountry: 'DE' }).ui);
    const badge = screen.getByTestId('opponent-left-flag', { includeHiddenElements: true });
    expect(badge).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.getByTestId('flag-DE', { includeHiddenElements: true })).toHaveStyle({ opacity: 0.7 });
    // The exit badge keeps its corner (end); the flag takes the start.
    expect(badge).toHaveStyle({ position: 'absolute' });
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({ start: expect.any(Number) });
    await unmount();
    for (const opponentCountry of [null, 'not a country']) {
      const { unmount: again } = await render(screenFor({}, { opponentCountry }).ui);
      expect(screen.queryByTestId('opponent-left-flag', { includeHiddenElements: true })).toBeNull();
      await again();
    }
  });

  it('has no rating chip in an unrated game', async () => {
    await render(screenFor({ ratingDelta: null }).ui);
    expect(screen.queryByTestId('opponent-left-rating')).not.toBeOnTheScreen();
  });

  it('shows the final scores, me first, as one element', async () => {
    await render(screenFor().ui);
    expect(screen.getByTestId('opponent-left-scores')).toHaveAccessibleName(
      `${iso('MosheG')}: 55, ${iso('NinaVolt')}: 39.5`,
    );
    expect(screen.getByText('39.5')).toHaveStyle({ color: color.players[1].ring });
    expect(screen.getByText('55')).toHaveStyle({ color: color.players[0].ring });
  });

  it('goes to the results (the one primary) or home', async () => {
    const { ui, onResults, onHome } = screenFor();
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('opponent-left-results-shadow')).toBeOnTheScreen();
  });

  it('is announced once, and the focus starts on "לתוצאות"', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await render(screenFor().ui);
    expect(env.announced()).toEqual([`${iso('NinaVolt')} עזב את המשחק. ניצחת בנטישה`]);
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    focus.mockRestore();
  });

  it('uses the feminine form when asked, and "היריב" without a name', async () => {
    const { unmount } = await render(screenFor({}, { gender: 'female' }).ui);
    expect(screen.getByRole('header')).toHaveTextContent(`${iso('NinaVolt')} עזבה את המשחק`);
    await unmount();
    await render(screenFor({ name: null, me: { id: 'me', name: null, score: 0 } }).ui);
    expect(screen.getByRole('header')).toHaveTextContent('היריב עזב את המשחק');
    expect(screen.getByTestId('opponent-left-scores')).toHaveAccessibleName('אני: 0, היריב: 39.5');
  });

  it('slams the win in, in full motion', async () => {
    await render(screenFor().ui);
    await wait(1500);
    expect(screen.getByTestId('opponent-left-win')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ scale: 1 }],
    });
  });
});

describe('OpponentLeft, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('only fades the win in: it never scales', async () => {
    await render(screenFor().ui);
    expect(screen.getByTestId('opponent-left-win')).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
    await wait(300);
    expect(screen.getByTestId('opponent-left-win')).toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('OpponentLeft (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(screenFor({ ratingDelta: -3 }).ui);
    expect(screen.getByText("Time's up · 15 seconds without a connection")).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent(`${iso('NinaVolt')} left the game`);
    expect(screen.getByTestId('opponent-left-win')).toHaveTextContent('You win by abandonment');
    expect(screen.getByTestId('opponent-left-rating')).toHaveAccessibleName('Rating change: ⁦−3⁩, Normal');
    expect(screen.getByRole('button', { name: 'See results' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Home' })).toBeOnTheScreen();
  });

  it('explains a 0 a leave guard held, in English', async () => {
    await render(screenFor({ ratingDelta: 0, ratingGuard: 'opponentLeftBeforeMyMove' }).ui);
    const line = 'Rating unchanged: they left before your first move';
    expect(
      screen.getByTestId('opponent-left-rating-reason', { includeHiddenElements: true }),
    ).toHaveTextContent(line);
    expect(screen.getByTestId('opponent-left-rating')).toHaveAccessibleName(
      `Rating change: ${ZERO}, Normal. ${line}`,
    );
  });
});
