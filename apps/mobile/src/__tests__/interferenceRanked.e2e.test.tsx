import {
  type CellIndex,
  type InterferenceKind,
  LEGACY_INTERFERENCE_KINDS,
  type PlayerId,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';

import { scoreText, signedText } from '../components/player';
import { useToast } from '../components/ui';
import { answerIn, emptyCellsOf, PUZZLE } from '../game/testing/practice';
import { track } from '../services/analytics';
import { cue } from '../services/feedback';
import { useSettings } from '../state/settings';
import { isolate } from '../screens/game/arsenal';
import { hidden, type Setup, setUp } from '../screens/game/connection/testing/setup';
import type { Rect } from '../screens/game/geometry';
import { isolateName } from '../screens/game/hit';
import { OnlineGame } from '../screens/game/online/OnlineGame';
import { liveOnlineSession, ME, OPP, type OnlineGame as Online, pass } from '../screens/game/testing/online';

/**
 * Interferences end to end in a ranked game [D44, D45]: the real game screen on an OnlineSession, whose
 * RemoteGameHost talks to a fake server built on the real engine (the server is the one that decides). A practice
 * against a bot has no interferences any more, so this is where the whole flow lives:
 *
 * - "הפרעה" on the opponent's card opens the picker aimed at that card; a kind in it launches at once (two taps,
 *   no drag). The server takes it: the opponent is hit, I pay the cost, and I see "חתולים ← Rival".
 * - The opponent hits me: the effect covers the whole screen [D35] with its banner until the view's deadline;
 *   with reduced motion it is a static cover for the same 5 s (spec §22).
 * - A room with an older app allows only the first three kinds (D47): the picker shows only those.
 *
 * Jest has no layout: the one view the picker measures in the window (the view around the opponent's card) says
 * where the card is.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const RIVAL = 'Rival';
/** The opponent's card as Dir-C-Game places it in Hebrew: at the left, under the status bar. */
const CARD: Rect = { x: 16, y: 56, width: 159, height: 160 };
const cells = emptyCellsOf(PUZZLE);

const cues = (): string[] => jest.mocked(cue).mock.calls.map((c) => String(c[0]));

type MeasureInWindow = (done: (x: number, y: number, width: number, height: number) => void) => void;

beforeAll(() => {
  const views = (View as unknown as { prototype: { measureInWindow: MeasureInWindow } }).prototype;
  jest.spyOn(views, 'measureInWindow').mockImplementation(function (
    this: { props?: { testID?: string } },
    done,
  ) {
    if (this.props?.testID === 'duel-hud-theirs') done(CARD.x, CARD.y, CARD.width, CARD.height);
  });
});

let setup: Setup;
let game: Online | null = null;

beforeEach(async () => {
  jest.clearAllMocks();
  setup = await setUp('he');
});

afterEach(() => {
  game?.session.close();
  game = null;
  setup.restore();
});

async function live(o: Parameters<typeof liveOnlineSession>[0] = {}) {
  game = await liveOnlineSession(o);
  const g = game;
  await render(
    <OnlineGame
      session={g.session}
      onEnded={jest.fn()}
      onHome={jest.fn()}
      onRetry={jest.fn()}
      onLeave={jest.fn()}
      onPractice={jest.fn()}
    />,
  );
  return g;
}

const scoreOf = (g: Online, id: PlayerId) => g.session.getView().players.find((p) => p.id === id)!.score;
const serverPlayer = (g: Online, id: PlayerId) => g.table.game!.state.players.find((p) => p.id === id)!;
const free = (g: Online): CellIndex[] => {
  const view = g.session.getView();
  return cells.filter((c) => view.grid[c] === 0 && !view.players.some((p) => p.lock?.cell === c));
};

/** I solve free cells through the board and the keypad until my score covers `points`. */
async function earn(g: Online, points = 2) {
  for (let i = 0; i < 20 && scoreOf(g, ME) < points; i++) {
    const cell = free(g)[0]!;
    await fireEvent.press(screen.getByTestId(`cell-${cellOf(cell)}`));
    await pass(g.table, 100);
    await fireEvent.press(screen.getByTestId(`key-${answerIn(PUZZLE, cell)}`));
    await pass(g.table, 100);
  }
  expect(scoreOf(g, ME)).toBeGreaterThanOrEqual(points);
}
const cellOf = (cell: CellIndex) => `${'ABCDEFGHI'[Math.floor(cell / 9)]}${(cell % 9) + 1}`;

/** The opponent solves cells at the server until its score covers `points`. */
async function opponentEarns(g: Online, points = 2) {
  for (let i = 0; i < 20 && serverPlayer(g, OPP).score < points; i++) {
    const cell = free(g).at(-1)!;
    await act(async () => {
      g.table.opponent({ type: 'select', cell });
      g.table.opponent({ type: 'place', cell, digit: answerIn(PUZZLE, cell) });
    });
    await pass(g.table, 100);
  }
}

describe('interferences in a ranked game, end to end [D45]', () => {
  it('two taps: "הפרעה" on the opponent’s card, then a kind; the server takes it, I pay, I see it went', async () => {
    const g = await live();
    // No points yet: "הפרעה" is dimmed, and a tap says why (D10) and opens nothing.
    const button = () => screen.getByTestId('interfere', hidden);
    expect(button()).toHaveProp('accessibilityLabel', `הפרעה ל־${RIVAL} · חסרות 2 נק׳`);
    expect(button()).toHaveTextContent('הפרעה', { exact: true });
    useToast.getState().clear();
    await fireEvent.press(button());
    await pass(g.table, 100);
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();
    // (The app's root layout shows the toast; here the store says what it shows.)
    expect(useToast.getState().current).toMatchObject({
      variant: 'error',
      message: 'אין מספיק נקודות להפרעה הבאה (2 נק׳)',
    });
    expect(cues()).toEqual(['nudge']);
    useToast.getState().clear();

    await earn(g);
    // The opponent is on a cell: its lock timer is what a hit stops (D11).
    const theirCell = free(g).at(-1)!;
    await act(async () => void g.table.opponent({ type: 'select', cell: theirCell }));
    // My last move's chip lands on my card and its count ends first.
    await pass(g.table, 1_500);
    const before = scoreOf(g, ME);

    // The first tap: the picker, aimed at Rival, every kind with its price.
    await fireEvent.press(screen.getByRole('button', { name: `הפרעה ל־${RIVAL} · עלות 2 נק׳` }));
    await pass(g.table, 300);
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    expect(screen.getByLabelText(`יעד: ${isolate(RIVAL)}`)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('duel-hud-theirs', hidden)).getByTestId('target-frame', hidden),
    ).toBeTruthy();
    expect(within(screen.getByTestId('arsenal-grid')).getAllByRole('button')).toHaveLength(6);

    // The second tap: cats, once.
    await fireEvent.press(screen.getByTestId('arsenal-kind-cats'));
    await fireEvent.press(screen.getByTestId('arsenal-kind-cats'));
    await pass(g.table, 300);
    const sent = g.table.game!.log.filter((e) => e.type === 'interference');
    expect(sent).toEqual([expect.objectContaining({ fromId: ME, targetId: OPP, kind: 'cats', cost: 2 })]);
    expect(serverPlayer(g, OPP).hitBy).toMatchObject({ fromId: ME, kind: 'cats' });
    expect(scoreOf(g, ME)).toBe(before - 2);
    await pass(g.table, 600);
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();

    // What I see (spec §7.4): "חתולים ← Rival", and the 2 points leaving my score.
    expect(useToast.getState().current).toMatchObject({
      variant: 'info',
      message: `חתולים ← ${isolate(RIVAL)}`,
    });
    expect(screen.getByTestId('card-me-delta', hidden)).toHaveTextContent(signedText(-2));
    expect(screen.getByTestId('card-me-score', hidden)).toHaveAnimatedProps({ text: scoreText(before - 2) });
    expect(track).toHaveBeenCalledWith('interference_sent', { kind: 'cats', cost: 2 });
    expect(cues()).toEqual(expect.arrayContaining(['arsenalOpen', 'launch']));
    expect(cues().filter((c) => c === 'launch')).toHaveLength(1);

    // Rival's card: the hit chip, its lock stopped; "הפרעה" dimmed until it can take another.
    expect(within(screen.getByTestId('card-opponent')).getByTestId('hit-chip', hidden)).toBeOnTheScreen();
    expect(button()).toHaveProp('accessibilityLabel', `הפרעה ל־${RIVAL} לא זמינה, כבר תחת הפרעה`);
    expect(button()).toBeDisabled();
    // The effect is Rival's, not on my screen.
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
  });

  it('the opponent hits me: the effect covers the whole screen [D35] with its banner, until its end', async () => {
    const g = await live();
    await opponentEarns(g);
    jest.mocked(cue).mockClear();
    await act(async () => {
      expect(g.table.opponent({ type: 'interfere', targetId: ME, kind: 'cats' })).toBeNull();
    });
    await pass(g.table, 100);
    const hit = g.session.getView().players.find((p) => p.id === ME)!.hitBy!;
    expect(hit).toMatchObject({ fromId: OPP, kind: 'cats' });

    const { width, height } = Dimensions.get('window');
    const region = () => screen.getByTestId('hit-layer-region', hidden);
    expect(StyleSheet.flatten(region().props.style)).toMatchObject({ left: 0, top: 0, width, height });
    expect(within(region()).getByTestId('hit-cats', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('hit-layer-banner', hidden)).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`${isolateName(RIVAL)} שלח/ה לך חתולים!`),
    );
    expect(cues().filter((c) => c === 'hitCats')).toHaveLength(1);

    // Gone at its end (the server's deadline).
    await pass(g.table, hit.expiresAt! - g.table.serverNow() + 200);
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
  });

  it('with reduced motion an interference on me is a static cover for the same time (spec §22)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await live();
    await opponentEarns(g);
    jest.mocked(cue).mockClear();
    await act(async () => void g.table.opponent({ type: 'interfere', targetId: ME, kind: 'fireworks' }));
    await pass(g.table, 100);
    const region = () => screen.getByTestId('hit-layer-region', hidden);
    expect(within(region()).getByTestId('hit-fireworks-still', hidden)).toBeOnTheScreen();
    expect(within(region()).queryByTestId('hit-fireworks', hidden)).toBeNull();
    expect(cues()).not.toContain('hitBurst');
    expect(cues()).not.toContain('hitPulse');
  });

  it('a room with an older app allows only the first three kinds: the picker shows only those (D47)', async () => {
    const g = await live({ rules: { interferenceKinds: LEGACY_INTERFERENCE_KINDS } });
    await earn(g);
    await fireEvent.press(screen.getByRole('button', { name: `הפרעה ל־${RIVAL} · עלות 2 נק׳` }));
    await pass(g.table, 300);
    const shown = within(screen.getByTestId('arsenal-grid'))
      .getAllByRole('button')
      .map((b) => String(b.props.testID).replace('arsenal-kind-', '') as InterferenceKind);
    expect(shown).toEqual(['fireworks', 'cats', 'warp']);
  });
});
