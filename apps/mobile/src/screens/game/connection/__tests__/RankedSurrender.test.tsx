import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { color } from '../../../../theme';
import { RankedSurrender, type RankedSurrenderProps } from '../RankedSurrender';
import { iso, type Setup, setUp } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const flexOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}).flex ?? 0;

let env: Setup;
afterEach(() => env.restore());

const surrender = (props: Partial<RankedSurrenderProps> = {}) => (
  <RankedSurrender visible players={2} onConfirm={jest.fn()} onCancel={jest.fn()} {...props} />
);

describe('RankedSurrender (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('asks the question of spec §6.6, as a labelled dialog', async () => {
    await render(surrender());
    expect(screen.getByRole('header', { name: 'אתה בטוח שאתה רוצה להיכנע?' })).toBeOnTheScreen();
    expect(screen.getByText('כניעה')).toBeOnTheScreen();
    expect(screen.getByText('המשחק ייחשב כהפסד')).toBeOnTheScreen();
    expect(screen.getByText('המשחק ממשיך ברקע')).toBeOnTheScreen();
    expect(screen.getByLabelText('אישור כניעה')).toHaveProp('role', 'dialog');
  });

  it('makes "ביטול" the prominent one: first, gold and wider than "כן, להיכנע"', async () => {
    await render(surrender());
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('ביטול');
    expect(second).toHaveAccessibleName('כן, להיכנע');
    expect(screen.getByTestId('ranked-surrender-cancel-shadow')).toBeOnTheScreen();
    expect(screen.queryByTestId('ranked-surrender-confirm-shadow')).not.toBeOnTheScreen();
    expect(flexOf(first!)).toBeGreaterThan(flexOf(second!));
  });

  it('surrenders only on "כן, להיכנע"; everything else cancels', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(surrender({ onConfirm, onCancel }));
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    await fireEvent(screen.getByTestId('ranked-surrender'), 'requestClose');
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'כן, להיכנע' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the estimated rating change in red, kept in order inside Hebrew', async () => {
    await render(surrender({ rating: { delta: -15, guard: null } }));
    const body = screen.getByTestId('ranked-surrender-body');
    expect(body).toHaveTextContent('המשחק ייחשב כהפסד · שינוי דירוג משוער ⁦−15⁩');
    expect(body).toHaveProp('accessibilityLabel', 'המשחק ייחשב כהפסד · שינוי דירוג משוער ⁦−15⁩');
    expect(screen.getByText('⁦−15⁩')).toHaveStyle({ color: color.danger });
  });

  it.each([
    ['leftBeforeMoving', 'המשחק ייחשב כהפסד · הדירוג שלך לא ירד, כי עוד לא ביצעת מהלך'],
    ['leftNotBehind', 'המשחק ייחשב כהפסד · הדירוג שלך לא ירד, כי אין לך פיגור'],
  ] as const)(
    "says my rating won't drop when a leave guard holds (§11.2, %s): muted, with no red number",
    async (guard, line) => {
      await render(surrender({ rating: { delta: 0, guard } }));
      const body = screen.getByTestId('ranked-surrender-body');
      expect(body).toHaveTextContent(line);
      expect(body).toHaveStyle({ color: color.textMuted });
      // No red Teko delta: the body is one plain line, with no isolated number in it.
      expect(screen.queryByText(/⁦/)).not.toBeOnTheScreen();
    },
  );

  it("says my rating won't drop in a game of 3–4 when nobody still in is ahead (§11.2)", async () => {
    await render(surrender({ players: 4, noLossMany: true }));
    expect(
      screen.getByText(
        'תצא מהמשחק, והמשבצות שפתרת יישארו בצבע שלך. הדירוג שלך לא ירד מול אף שחקן שנשאר במשחק.',
      ),
    ).toBeOnTheScreen();
  });

  it('says I leave the game in a game of 3–4 [D36], without a score line', async () => {
    await render(
      surrender({
        players: 3,
        rating: { delta: -15, guard: null },
        summary: {
          myName: 'MosheG',
          myScore: 1,
          opponentName: 'NinaVolt',
          opponentScore: 2,
          opponentColorIndex: 1,
        },
      }),
    );
    expect(screen.getByText('תצא מהמשחק, והמשבצות שפתרת יישארו בצבע שלך.')).toBeOnTheScreen();
    expect(screen.queryByTestId('ranked-surrender-summary')).not.toBeOnTheScreen();
  });

  it('shows the score line of a duel', async () => {
    await render(
      surrender({
        summary: {
          myName: 'MosheG',
          myScore: 55,
          opponentName: 'NinaVolt',
          opponentScore: -2,
          opponentColorIndex: 1,
        },
      }),
    );
    expect(screen.getByTestId('ranked-surrender-summary')).toHaveAccessibleName(
      `${iso('MosheG')}: 55, ${iso('NinaVolt')}: ⁦−2⁩`,
    );
  });

  it('spins the confirm while the surrender goes out', async () => {
    await render(surrender({ confirming: true }));
    expect(screen.getByRole('button', { name: 'כן, להיכנע, טוען' })).toBeBusy();
  });

  it('renders nothing while closed', async () => {
    await render(surrender({ visible: false }));
    expect(screen.queryByText('אתה בטוח שאתה רוצה להיכנע?')).not.toBeOnTheScreen();
  });
});

describe('RankedSurrender (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('asks in English', async () => {
    await render(surrender({ rating: { delta: -15, guard: null } }));
    expect(screen.getByRole('header', { name: 'Are you sure you want to surrender?' })).toBeOnTheScreen();
    expect(screen.getByTestId('ranked-surrender-body')).toHaveTextContent(
      'The game counts as a loss · estimated rating change ⁦−15⁩',
    );
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('Cancel');
    expect(second).toHaveAccessibleName('Yes, surrender');
    expect(screen.getByLabelText('Confirm surrender')).toHaveProp('role', 'dialog');
    expect(screen.getByText('The game goes on in the background')).toBeOnTheScreen();
  });

  it('explains a guarded surrender in English', async () => {
    await render(surrender({ rating: { delta: 0, guard: 'leftNotBehind' } }));
    expect(screen.getByTestId('ranked-surrender-body')).toHaveTextContent(
      "The game counts as a loss · your rating won't drop: you're not behind",
    );
    await render(surrender({ rating: { delta: 0, guard: 'leftBeforeMoving' } }));
    expect(
      screen.getByText("The game counts as a loss · your rating won't drop: you haven't made a move yet"),
    ).toBeOnTheScreen();
  });

  it('and the 3–4 player body with nothing to lose, in English', async () => {
    await render(surrender({ players: 3, noLossMany: true }));
    expect(
      screen.getByText(
        "You leave the game, and the cells you solved keep your colour. Your rating won't drop against anyone still in the game.",
      ),
    ).toBeOnTheScreen();
  });

  it('and the 3–4 player body in English', async () => {
    await render(surrender({ players: 4 }));
    expect(
      screen.getByText('You leave the game, and the cells you solved keep your colour.'),
    ).toBeOnTheScreen();
  });
});
