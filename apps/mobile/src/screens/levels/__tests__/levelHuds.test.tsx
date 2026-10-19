import 'react-native-reanimated';

import {
  type AppLevel,
  type Digit,
  DIGITS,
  type GameView,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { signedText } from '../../../components/player/format';
import i18n from '../../../i18n';
import { type LevelSession, startLevel } from '../../../levels/levelSession';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { color } from '../../../theme';
import { BoxHud } from '../hud/BoxHud';
import { DuelLevelHud } from '../hud/DuelLevelHud';
import { RaceTo30 } from '../hud/RaceTo30';

/**
 * The digit stages' HUDs (dev-plan §2ח, §3.1; Lv-Box, Lv-Sprint): the duel's lead meter "פער ‎+10.5" (an LTR
 * isolate) with its marks at 8 and 15; "מרוץ ל־30" with ● and ▲ on its tracks, which fill at once under Reduced
 * Motion; fill the box's "1/4 משבצות"; and a boss's crown and "בוס" chip. The views are the engine's (a real
 * session on a manual clock).
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

const sessions: LevelSession[] = [];
async function sessionOf(level: AppLevel) {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startLevel(
    level,
    {},
    {
      clock,
      scheduler,
      appState: null,
      finish: async () => null,
      track: jest.fn(),
      attemptOf: async () => 1,
    },
  );
  sessions.push(session);
  return { session, clock, scheduler };
}

/** A duel's view with these scores (the engine's own view, its scores set as a moment of the game). */
function withScores(view: GameView, mine: number, theirs: number): GameView {
  return {
    ...view,
    players: view.players.map((p) => ({ ...p, score: p.id === view.me ? mine : theirs })),
    level: { ...view.level!, progress: { kind: 'score', mine, opponent: theirs, target: 30 } },
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  jest.useRealTimers();
});

describe('DuelLevelHud', () => {
  it('the lead meter reads "פער ⁦+10.5⁩", the number an LTR isolate, with its marks at 8 and 15', async () => {
    const L021 = levelById('L021')!;
    const { session, clock } = await sessionOf(L021);
    await render(
      <DuelLevelHud
        level={L021}
        view={withScores(session.getView(), 15, 4.5)}
        now={clock.now()}
        myAvatar="av00"
      />,
    );
    expect(screen.getByTestId('duel-gap-text')).toHaveTextContent(`פער ${signedText(10.5)}`);
    expect(signedText(10.5)).toBe('⁦+10.5⁩');
    expect(screen.getByTestId('duel-gap-bar-number-2', hidden)).toHaveTextContent('8');
    expect(screen.getByTestId('duel-gap-bar-number-3', hidden)).toHaveTextContent('15');
    expect(screen.getByTestId('duel-me-score')).toHaveTextContent('15');
    expect(screen.getByTestId('duel-bot-score')).toHaveTextContent('4.5');
    expect(screen.getByTestId('duel-bot')).toHaveProp(
      'accessibilityLabel',
      'Pip, בוט רמה 1, 4.5 מתוך 30 נקודות',
    );
    // The clock counts down the stage's 30 s; no interference button, no reactions (D62).
    expect(screen.getByTestId('duel-clock')).toHaveTextContent('0:30');
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(screen.queryByTestId('duel-reactions')).toBeNull();
  });

  it('a lead the bot holds: "פער ⁦−3⁩"', async () => {
    const L021 = levelById('L021')!;
    const { session, clock } = await sessionOf(L021);
    await render(
      <DuelLevelHud
        level={L021}
        view={withScores(session.getView(), 2, 5)}
        now={clock.now()}
        myAvatar="av00"
      />,
    );
    expect(screen.getByTestId('duel-gap-text')).toHaveTextContent(`פער ${signedText(-3)}`);
  });

  it('a boss duel: its crown and the "בוס" chip', async () => {
    const L030 = levelById('L030')!;
    const { session, clock } = await sessionOf(L030);
    await render(<DuelLevelHud level={L030} view={session.getView()} now={clock.now()} myAvatar="av00" />);
    const badge = screen.getByTestId('stage-boss', hidden);
    expect(within(badge).getByText('בוס', hidden)).toBeTruthy();
    expect(within(badge).getByTestId('icon-crown', hidden)).toBeTruthy();
    expect(screen.getByTestId('stage-tile-crown', hidden)).toBeTruthy();
  });
});

describe('RaceTo30', () => {
  const props = { target: 30, myName: 'אני', botName: 'Pip', botLevel: 1 } as const;

  it('two tracks to the target, mine with ● in P1 and the bot’s with ▲ in P2', async () => {
    await render(<RaceTo30 {...props} mine={15} theirs={6} />);
    expect(
      within(screen.getByTestId('race-to-30-me', hidden)).getByTestId('glyph-circle', hidden),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('race-to-30-bot', hidden)).getByTestId('glyph-triangle', hidden),
    ).toBeTruthy();
    expect(styleOf(screen.getByTestId('race-to-30-me-fill', hidden)).backgroundColor).toBe(
      color.players[0].ring,
    );
    expect(styleOf(screen.getByTestId('race-to-30-bot-fill', hidden)).backgroundColor).toBe(
      color.players[1].ring,
    );
    expect(styleOf(screen.getByTestId('race-to-30', hidden)).direction).toBe('ltr');
  });

  it('a new score slides the fill; under Reduced Motion it is there at once', async () => {
    jest.useFakeTimers();
    const view = await render(<RaceTo30 {...props} mine={0} theirs={0} />);
    await view.rerender(<RaceTo30 {...props} mine={15} theirs={6} />);
    expect(screen.getByTestId('race-to-30-me-fill', hidden)).not.toHaveAnimatedStyle({ width: '50%' });
    await act(async () => void jest.advanceTimersByTime(400));
    expect(screen.getByTestId('race-to-30-me-fill', hidden)).toHaveAnimatedStyle({ width: '50%' });
    await view.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    const still = await render(<RaceTo30 {...props} mine={0} theirs={0} />);
    await still.rerender(<RaceTo30 {...props} mine={15} theirs={6} />);
    await act(async () => void jest.advanceTimersByTime(16));
    expect(screen.getByTestId('race-to-30-me-fill', hidden)).toHaveAnimatedStyle({ width: '50%' });
    expect(screen.getByTestId('race-to-30-bot-fill', hidden)).toHaveAnimatedStyle({ width: '20%' });
  });
});

describe('BoxHud', () => {
  it('"מלא את ריבוע 8", "1/4 משבצות" once a cell is filled, and a mistake with its "⁦+5⁩ ש׳"', async () => {
    const L002 = levelById('L002')!;
    if (L002.kind !== 'fillBox') throw new Error('L002 is a fill-box');
    const { session, clock, scheduler } = await sessionOf(L002);
    const [first, second] = L002.targets.cells;
    const right = (c: number) => Number(L002.board.solution[c]) as Digit;
    session.host.select(first!);
    session.host.place(first!, right(first!));
    session.host.select(second!);
    const wrong = DIGITS.find((d) => d !== right(second!) && session.getView().keypad.remaining[d - 1]! > 0)!;
    session.host.place(second!, wrong);
    expect(session.getView().players[0]!.mistakes).toBe(1);
    scheduler.advance(2000);
    await render(<BoxHud level={L002} view={session.getView()} now={clock.now()} />);
    expect(screen.getByTestId('box-task')).toHaveTextContent(`מלא את ריבוע ${L002.targets.box + 1}`);
    expect(screen.getByTestId('box-cells')).toHaveTextContent('1/4 משבצות');
    expect(screen.getByTestId('box-mistakes')).toHaveTextContent(`טעות ${signedText(5)} ש׳`);
    // The clock is the stage's: the time played plus the penalty.
    expect(screen.getByTestId('box-clock')).toHaveTextContent('0:07');
    expect(screen.getByTestId('box-mini-lit', hidden)).toBeTruthy();
  });

  it('a boss fill-box: the crown and "בוס"', async () => {
    const L010 = levelById('L010')!;
    const { session, clock } = await sessionOf(L010);
    await render(<BoxHud level={L010} view={session.getView()} now={clock.now()} />);
    expect(within(screen.getByTestId('stage-boss', hidden)).getByText('בוס', hidden)).toBeTruthy();
    expect(screen.getByTestId('box-cells')).toHaveTextContent('0/5 משבצות');
  });

  it('in English: "1/4 cells"', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    const L002 = levelById('L002')!;
    const { session, clock } = await sessionOf(L002);
    await render(<BoxHud level={L002} view={session.getView()} now={clock.now()} />);
    expect(screen.getByTestId('box-cells')).toHaveTextContent('0/4 cells');
    expect(screen.getByTestId('stage-title')).toHaveTextContent('Stage 2');
  });
});
