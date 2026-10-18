// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import {
  type GameView,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  type PlayerId,
  type Rules,
} from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { cardModel, PlayerCard } from '../../../../components/player';
import { useToast } from '../../../../components/ui';
import { answerIn, wrongIn } from '../../../../game/testing/practice';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import type { Rect } from '../../geometry';
import { BOT, type Duel, duel, ME } from '../../testing/duel';
import { ArsenalOverlay } from '../ArsenalOverlay';
import { ARSENAL_CONFIG } from '../config';
import { type Measurable, useArsenal } from '../useArsenal';
import { isolate } from '../wording';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const NAME = 'Mr. Hoot';
/** The opponent's card as Dir-C-Game places it in Hebrew: at the left, under the status bar. */
const CARD: Rect = { x: 16, y: 48, width: 159, height: 160 };
/** All six kinds open: most tests look at every kind, whatever the level table says. */
const ALL = INTERFERENCE_KINDS;

/** The view around the opponent's card, as the window measures it. */
const cardNode: Measurable = { measureInWindow: (done) => done(CARD.x, CARD.y, CARD.width, CARD.height) };

/** A small game screen: both cards (the screen spreads `cardProps`), "הפרעה" on the opponent's, the picker. */
function Harness({
  game,
  onLaunch,
  showRoute,
  unlocked,
}: {
  game: Duel;
  onLaunch: (id: PlayerId, kind: InterferenceKind) => void;
  showRoute?: boolean;
  unlocked?: readonly InterferenceKind[];
}) {
  const [view, setView] = useState<GameView>(() => game.host.getView());
  useEffect(() => game.session.subscribe(() => setView(game.host.getView())), [game]);
  const arsenal = useArsenal({ onLaunch });
  const { cardRef } = arsenal;
  useEffect(() => {
    cardRef(BOT.id)(cardNode);
    return () => cardRef(BOT.id)(null);
  }, [cardRef]);
  const now = game.clock.now();
  const open = arsenal.targetId !== null;
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <PlayerCard
        model={{ ...cardModel(view, ME, 0, now), name: 'אני' }}
        {...arsenal.cardProps(ME)}
        testID="card-me"
      />
      <View collapsable={false}>
        <PlayerCard
          model={{ ...cardModel(view, BOT.id, 0, now), name: NAME }}
          {...arsenal.cardProps(BOT.id)}
          onInterfere={() => arsenal.toggle(BOT.id)}
          onInterfereBlocked={(s) => (open ? arsenal.close() : arsenal.blocked(s, NAME))}
          testID="card-opponent"
        />
      </View>
      {/* Opens it whatever "הפרעה" says, to look at kinds that can't go. */}
      <Pressable testID="force-open" onPress={() => arsenal.open(BOT.id)} />
      <ArsenalOverlay
        arsenal={arsenal}
        view={view}
        unlocked={unlocked}
        describe={(id) =>
          id === ME
            ? { name: 'אני', colorIndex: 0, avatarId: 'lava-lamp' }
            : { name: NAME, colorIndex: 1, avatarId: 'owl', country: 'DE' }
        }
        showRoute={showRoute}
      />
    </GestureHandlerRootView>
  );
}

let game: Duel | null = null;
async function show({
  showRoute,
  unlocked = ALL,
  rules,
}: { showRoute?: boolean; unlocked?: readonly InterferenceKind[]; rules?: Partial<Rules> } = {}) {
  // A 2-player game with interferences on (a practice against a bot has none, D44).
  const g = (game = duel({ rules: { interferences: true, ...rules } }));
  const onLaunch = jest.fn((id: PlayerId, kind: InterferenceKind) => g.host.interfere(id, kind));
  await render(<Harness game={g} onLaunch={onLaunch} showRoute={showRoute} unlocked={unlocked} />);
  return { g, onLaunch };
}

/** I solve cells until my score covers the next interference. */
async function earn(g: Duel, points = 2) {
  await act(async () => {
    for (const cell of g.cells) {
      if (g.host.getView().players[0]!.score >= points) return;
      g.host.select(cell);
      g.host.place(cell, answerIn(g.puzzle, cell));
    }
  });
}

/** Lets scheduled work run: `ms` of timers and animation frames. */
const step = (ms = 16) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** The first tap: "הפרעה" on the opponent's card; then past the arm delay. */
const openFromButton = async () => {
  await fireEvent.press(screen.getByTestId('interfere'));
  await step(400);
};
/** The second tap: a kind in the picker. */
const tapKind = async (kind: InterferenceKind) => {
  await fireEvent.press(screen.getByTestId(`arsenal-kind-${kind}`));
  await step();
};

const hidden = { includeHiddenElements: true };
const live = () => screen.getByTestId('arsenal-live', hidden);

const TITLES: Record<InterferenceKind, string> = {
  fireworks: 'זיקוקים',
  cats: 'חתולים',
  warp: 'עיוות',
  scramble: 'מספרים מתערבלים',
  ink: 'דיו',
  keypad: 'מקלדת מתערבלת',
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  useToast.getState().clear();
  useSettings.setState({ reduceMotion: 'off' });
  await i18n.changeLanguage('he');
});

afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

describe('the interference picker (spec §7.3, components.md §13) [D45]', () => {
  it('closed, it draws nothing', async () => {
    await show();
    expect(screen.queryByTestId('arsenal')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('target-frame')).not.toBeOnTheScreen();
  });

  it('"הפרעה" opens it aimed at that card: the target framed, the price, every kind with its price', async () => {
    const { g } = await show();
    await earn(g);
    const score = g.host.getView().players[0]!.score;
    await openFromButton();
    expect(cues()).toEqual(['arsenalOpen']);
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    expect(screen.getByText('בחר הפרעה')).toBeOnTheScreen();
    expect(screen.getByLabelText(`יעד: ${isolate(NAME)}`)).toBeOnTheScreen();
    // The card it was opened from is the target, framed with "יעד"; its button reads "close".
    // (Behind the modal sheet, so screen readers and these queries skip them.)
    const frame = screen.getByTestId('target-frame', hidden);
    expect(within(frame).getByText('יעד', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('card-opponent-summary', hidden)).toHaveProp('accessibilityHint', 'יעד ההפרעה');
    expect(screen.getByLabelText('סגירת חלון ההפרעות', hidden)).toBeOnTheScreen();
    // The price, the next one, my score before and after (D10).
    expect(screen.getByTestId('arsenal-cost')).toHaveAccessibleName(
      `מחיר ההפרעה 2 נקודות. הניקוד שלך ${score}, ואחרי שיגור ${score - 2}. ההפרעה שאחריה תעלה 4`,
    );
    expect(screen.getByTestId('arsenal-price')).toHaveTextContent('⁦−2⁩');
    expect(screen.getByText('כל הפרעה נמשכת 5 שניות · הקשה משגרת')).toBeOnTheScreen();
    // Six kinds, in the engine's order, each with its name, its preview and a clear price chip.
    const grid = screen.getByTestId('arsenal-grid');
    expect(
      within(grid)
        .getAllByRole('button')
        .map((b) => b.props.testID),
    ).toEqual(INTERFERENCE_KINDS.map((k) => `arsenal-kind-${k}`));
    for (const kind of INTERFERENCE_KINDS) {
      const button = screen.getByTestId(`arsenal-kind-${kind}`);
      expect(button).toHaveAccessibleName(`${TITLES[kind]} · 2 נק׳ · הקשה משגרת אל ${isolate(NAME)}`);
      expect(button).toHaveProp('accessibilityState', { disabled: false });
      expect(screen.getByTestId(`arsenal-kind-${kind}-chip`, hidden)).toHaveTextContent('⁦−2⁩נק׳');
      expect(screen.getByTestId(`token-art-${kind}`, hidden)).toBeOnTheScreen();
    }
  });

  it('two taps launch it once, at that card: the engine takes it, the sheet closes with a ripple', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    const before = g.host.getView().players[0]!.score;
    await openFromButton();
    await tapKind('scramble');
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'scramble');
    expect(cues()).toEqual(['arsenalOpen', 'launch']);
    const view = g.host.getView();
    expect(view.players[1]!.hitBy).toMatchObject({ fromId: ME, kind: 'scramble' });
    expect(view.players[0]!.score).toBe(before - 2);
    expect(screen.getByTestId('arsenal-ripple', hidden)).toBeOnTheScreen();
    expect(live()).toHaveTextContent(`שיגרת מספרים מתערבלים אל ${isolate(NAME)}`);
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-ripple', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('target-frame', hidden)).not.toBeOnTheScreen();
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('a quick double tap launches once; a second tap on the closing sheet does nothing', async () => {
    const { g, onLaunch } = await show();
    await earn(g, 6);
    await openFromButton();
    await fireEvent.press(screen.getByTestId('arsenal-kind-fireworks'));
    await fireEvent.press(screen.getByTestId('arsenal-kind-fireworks'));
    await fireEvent.press(screen.getByTestId('arsenal-kind-cats'));
    await step(1000);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(cues().filter((c) => c === 'launch')).toHaveLength(1);
  });

  it(`taps in the first ${ARSENAL_CONFIG.armMs} ms after it opened are ignored, silently`, async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await fireEvent.press(screen.getByTestId('interfere'));
    await step(100);
    await fireEvent.press(screen.getByTestId('arsenal-kind-cats'));
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('arsenal-bubble-cats')).not.toBeOnTheScreen();
    expect(cues()).toEqual(['arsenalOpen']);
    await step(ARSENAL_CONFIG.armMs);
    await tapKind('cats');
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'cats');
  });

  it('a kind I can’t afford is dimmed and says why on a tap, with a light haptic; nothing is launched', async () => {
    const { onLaunch } = await show();
    await fireEvent.press(screen.getByTestId('force-open'));
    await step(400);
    const button = screen.getByTestId('arsenal-kind-fireworks');
    expect(button).toHaveAccessibleName('זיקוקים · חסרות 2 נק׳ להפרעה הזאת');
    expect(button).toHaveProp('accessibilityState', { disabled: true });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ opacity: 0.5 });
    // Six chips and the price row say what I miss.
    expect(screen.getAllByText('חסרות 2 נק׳')).toHaveLength(7);
    await tapKind('fireworks');
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-bubble-fireworks')).toHaveTextContent('חסרות 2 נק׳ להפרעה הזאת');
    expect(cues()).toEqual(['arsenalOpen', 'nudge']);
    await step(2100);
    expect(screen.queryByTestId('arsenal-bubble-fireworks')).not.toBeOnTheScreen();
  });

  it('a target under interference: every kind is blocked, and a tap says so', async () => {
    const { g, onLaunch } = await show();
    await earn(g, 6);
    await act(async () => void g.host.interfere(BOT.id, 'warp'));
    await fireEvent.press(screen.getByTestId('force-open'));
    await step(400);
    expect(screen.getAllByText('תחת הפרעה')).toHaveLength(6);
    await tapKind('ink');
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-bubble-ink')).toHaveTextContent(
      `${isolate(NAME)} כבר תחת הפרעה, אפשר לשגר עוד רגע`,
    );
  });

  it('kinds above my level stay in the grid, dimmed, with "רמה N", and can’t be launched [D17, D47]', async () => {
    const { g, onLaunch } = await show({ unlocked: ARSENAL_CONFIG.unlocked });
    await earn(g);
    await openFromButton();
    for (const [kind, level] of [
      ['scramble', 2],
      ['ink', 3],
      ['keypad', 4],
    ] as const) {
      expect(screen.getByTestId(`arsenal-kind-${kind}-chip`, hidden)).toHaveTextContent(`רמה ${level}`);
      expect(
        within(screen.getByTestId(`arsenal-kind-${kind}-chip`, hidden)).getByTestId('icon-lock', hidden),
      );
      expect(screen.getByTestId(`arsenal-kind-${kind}`)).toHaveProp('accessibilityState', { disabled: true });
      expect(screen.getByTestId(`arsenal-kind-${kind}`)).toHaveAccessibleName(
        `${TITLES[kind]} · נפתחת ברמה ${level}`,
      );
    }
    await tapKind('keypad');
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-bubble-keypad')).toHaveTextContent('נפתחת ברמה 4');
    // The open ones go.
    await tapKind('warp');
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'warp');
  });

  it('only the kinds this game allows are shown (a room with an older app, D47)', async () => {
    const { g } = await show({ rules: { interferenceKinds: ['fireworks', 'cats', 'warp'] } });
    await earn(g);
    await openFromButton();
    const grid = screen.getByTestId('arsenal-grid');
    expect(within(grid).getAllByRole('button')).toHaveLength(3);
    for (const kind of ['scramble', 'ink', 'keypad'])
      expect(screen.queryByTestId(`arsenal-kind-${kind}`)).not.toBeOnTheScreen();
  });

  it('closes from its close button, from the scrim, from "הפרעה" again and from Android back', async () => {
    const back = jest.spyOn(BackHandler, 'addEventListener');
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromButton();
    await fireEvent.press(screen.getByTestId('arsenal-close'));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('target-frame')).not.toBeOnTheScreen();

    await openFromButton();
    await fireEvent.press(screen.getByTestId('arsenal-scrim'));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();

    await openFromButton();
    await fireEvent.press(screen.getByTestId('interfere', hidden));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();

    await openFromButton();
    const [event, handler] = back.mock.calls.at(-1)!;
    expect(event).toBe('hardwareBackPress');
    await act(async () => {
      expect((handler as () => boolean)()).toBe(true);
    });
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(onLaunch).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('a blocked "הפרעה" does not open it: it says why in a toast, with a light haptic (§8.1)', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('interfere'));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(useToast.getState().current).toMatchObject({
      variant: 'error',
      message: 'אין מספיק נקודות להפרעה הבאה (2 נק׳)',
    });
    expect(cues()).toEqual(['nudge']);
  });

  it('closes by itself when the target leaves the game, or the game ends', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromButton();
    await act(async () => {
      g.host.dispatch({ type: 'surrender', playerId: BOT.id });
    });
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('if my score drops under the price while it is open, the kinds turn blocked and the row says so', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromButton();
    // Wrong digits until I can't pay any more (spec §6.5: each one costs points).
    await act(async () => {
      for (const cell of g.cells.slice(-6)) {
        if (g.host.getView().interference!.missingPoints > 0) break;
        g.host.select(cell);
        g.host.place(cell, wrongIn(g.puzzle, cell));
      }
    });
    expect(g.host.getView().interference!.missingPoints).toBeGreaterThan(0);
    await tapKind('fireworks');
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-after')).toHaveTextContent(/^חסרות [\d.]+ נק׳$/);
    expect(screen.getByTestId('arsenal-cost')).toHaveAccessibleName(/, חסרות [\d.]+ נקודות$/);
  });

  it('nothing of the drag is left: no gesture on a kind, no ghost, no "נפתחות בהמשך"', async () => {
    const { g } = await show();
    await earn(g);
    await openFromButton();
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByText('בגרירה…', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-coming', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByText(/גרור/, hidden)).not.toBeOnTheScreen();
  });
});

describe('3–4 players: the route in the header (original §17)', () => {
  it('"אני ← Mr. Hoot" with both avatars and shapes; one target, no way to change it in here', async () => {
    const { g, onLaunch } = await show({ showRoute: true });
    await earn(g);
    await openFromButton();
    const route = screen.getByTestId('arsenal-route');
    expect(route).toHaveAccessibleName(`הפרעה ממני אל ${isolate(NAME)}`);
    expect(route).toHaveTextContent(`אני←${NAME}`, { exact: false });
    // From me (P1, ●) to the card it was opened from (its seat colour, ▲), both avatars.
    expect(within(route).getByTestId('arsenal-route-avatar-0', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('arsenal-route-avatar-1', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('glyph-circle', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('glyph-triangle', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-target')).not.toBeOnTheScreen();
    await tapKind('ink');
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'ink');
  });

  it('2 players: the target line, no route', async () => {
    const { g } = await show();
    await earn(g);
    await openFromButton();
    expect(screen.getByTestId('arsenal-target')).toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-route')).not.toBeOnTheScreen();
  });
});

describe('reduced motion (spec §22)', () => {
  beforeEach(() => useSettings.setState({ reduceMotion: 'on' }));

  it('a tap still launches, once; still previews, no ripple', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromButton();
    const art = screen.getAllByTestId('token-art-motion', hidden)[0]!;
    const early = JSON.stringify(art.props.jestAnimatedStyle?.value ?? art.props.style);
    await step(900);
    expect(JSON.stringify(art.props.jestAnimatedStyle?.value ?? art.props.style)).toEqual(early);
    await tapKind('cats');
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'cats');
    expect(screen.queryByTestId('arsenal-ripple', hidden)).not.toBeOnTheScreen();
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
  });
});
