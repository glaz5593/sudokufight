// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import type { GameView, InterferenceKind, PlayerId } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { BackHandler, DeviceEventEmitter, Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { cardModel, PlayerCard } from '../../../../components/player';
import { useToast } from '../../../../components/ui';
import { answerIn, wrongIn } from '../../../../game/testing/practice';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { color } from '../../../../theme';
import type { Point, Rect } from '../../geometry';
import { BOT, type Duel, duel, ME } from '../../testing/duel';
import { dropZoneOf } from '../arsenalModel';
import { ArsenalOverlay } from '../ArsenalOverlay';
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
const ZONE = dropZoneOf(CARD);
const INSIDE: Point = { x: ZONE.x + 60, y: ZONE.y + 90 };
const OUTSIDE: Point = { x: 300, y: 420 };
/** Where the finger first touches a token, low in the tray. */
const TOKEN_AT: Point = { x: 195, y: 700 };

/** The view around the opponent's card, as the window measures it. */
const cardNode: Measurable = { measureInWindow: (done) => done(CARD.x, CARD.y, CARD.width, CARD.height) };

/** A small game screen: both cards (the screen spreads `cardProps`), ⚡ on the opponent's, and the overlay. */
function Harness({
  game,
  onLaunch,
  showRoute,
}: {
  game: Duel;
  onLaunch: (id: PlayerId, kind: InterferenceKind) => void;
  showRoute?: boolean;
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
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <PlayerCard
        model={{ ...cardModel(view, ME, 0, now), name: 'אני' }}
        {...arsenal.cardProps(ME, 'אני')}
        testID="card-me"
      />
      <View collapsable={false}>
        <PlayerCard
          model={{ ...cardModel(view, BOT.id, 0, now), name: NAME }}
          {...arsenal.cardProps(BOT.id, NAME)}
          onInterfere={() => arsenal.toggle(BOT.id)}
          onInterfereBlocked={arsenal.blocked}
          testID="card-opponent"
        />
      </View>
      {/* Opens it whatever ⚡ says, to look at tokens that can't go. */}
      <Pressable testID="force-open" onPress={() => arsenal.open(BOT.id)} />
      <ArsenalOverlay
        arsenal={arsenal}
        view={view}
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
async function show({ showRoute }: { showRoute?: boolean } = {}) {
  const g = (game = duel());
  const onLaunch = jest.fn((id: PlayerId, kind: InterferenceKind) => g.host.interfere(id, kind));
  await render(<Harness game={g} onLaunch={onLaunch} showRoute={showRoute} />);
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

/** Lets scheduled work run: the gesture's calls to JS (microtasks) and `ms` of animation frames. */
const step = (ms = 16) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/**
 * A finger on a token, step by step, as the gesture handler's native side reports it (the same events
 * fireGestureHandler sends, which always ends the gesture): down on the token at TOKEN_AT, moves, and up.
 */
function finger(kind: InterferenceKind) {
  const { handlerTag } = getByGestureTestId(`arsenal-drag-${kind}`);
  let state: State = State.UNDETERMINED;
  const at = (p: Point) => ({
    handlerTag,
    numberOfPointers: 1,
    x: 54,
    y: 68,
    absoluteX: p.x,
    absoluteY: p.y,
    translationX: p.x - TOKEN_AT.x,
    translationY: p.y - TOKEN_AT.y,
    velocityX: 0,
    velocityY: 0,
  });
  const become = (next: State, p: Point) => {
    DeviceEventEmitter.emit('onGestureHandlerStateChange', { ...at(p), state: next, oldState: state });
    state = next;
  };
  return {
    down: async () => {
      await act(async () => {
        become(State.BEGAN, TOKEN_AT);
        become(State.ACTIVE, { x: TOKEN_AT.x, y: TOKEN_AT.y - 12 });
      });
      await step();
    },
    move: async (p: Point) => {
      await act(async () => {
        DeviceEventEmitter.emit('onGestureHandlerEvent', { ...at(p), state: State.ACTIVE });
      });
      await step();
    },
    up: async (p: Point) => {
      await act(async () => become(State.END, p));
      await step();
    },
  };
}

/** A pan on a token from TOKEN_AT to `to`, let go there unless `hold`. */
async function dragTo(kind: InterferenceKind, to: Point, { hold = false } = {}) {
  const f = finger(kind);
  await f.down();
  await f.move({ x: (TOKEN_AT.x + to.x) / 2, y: (TOKEN_AT.y + to.y) / 2 });
  await f.move(to);
  if (!hold) await f.up(to);
  return f;
}

const tap = async (kind: InterferenceKind) => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`arsenal-tap-${kind}`), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
  await step();
};

const openFromBolt = async () => {
  await fireEvent.press(screen.getByTestId('interfere'));
  await step(400);
};

const hidden = { includeHiddenElements: true };
const live = () => screen.getByTestId('arsenal-live', hidden);
/** The live region speaks at most every 1.5 s. */
const spoken = () => step(1600);

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

describe('the arsenal (spec §7.3.1, Arsenal)', () => {
  it('closed, it draws nothing', async () => {
    await show();
    expect(screen.queryByTestId('arsenal')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('drop-zone')).not.toBeOnTheScreen();
  });

  it('⚡ opens it aimed at that card: the drop zone, the tokens with their cost, what to do', async () => {
    const { g } = await show();
    await earn(g);
    const score = g.host.getView().players[0]!.score;
    await openFromBolt();
    expect(cues()).toContain('arsenalOpen');
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    expect(screen.getByText('ארסנל ההפרעות')).toBeOnTheScreen();
    expect(screen.getByLabelText(`יעד: ${isolate(NAME)}`)).toBeOnTheScreen();
    // The card it was opened from is the one drop zone; ⚡ on it reads "close".
    // (Behind the modal tray, so screen readers and these queries skip them.)
    expect(screen.getByTestId('drop-zone', hidden)).toBeOnTheScreen();
    expect(screen.getByLabelText('סגירת ארסנל ההפרעות', hidden)).toBeOnTheScreen();
    // The next cost and the ones after it, my score after paying (D10).
    expect(screen.getByTestId('arsenal-cost')).toHaveAccessibleName(
      `ההפרעה הבאה שלך עולה 2 נקודות, אחריה 4, 8. הניקוד שלך ${score}, אחרי שיגור ${score - 2}`,
    );
    expect(screen.getByText('כל הפרעה נמשכת 5 שניות · שיגור בגרירה בלבד')).toBeOnTheScreen();
    for (const [kind, title] of [
      ['fireworks', 'זיקוקים'],
      ['cats', 'חתולים'],
      ['warp', 'עיוות'],
    ] as const) {
      expect(screen.getByTestId(`arsenal-token-${kind}`)).toHaveAccessibleName(
        `${title} · 2 נק׳ · גרור אל הכרטיס של ${isolate(NAME)}`,
      );
      expect(screen.getByTestId(`token-art-${kind}`, hidden)).toBeOnTheScreen();
    }
    expect(screen.getByText(`גרור אל הכרטיס של ${isolate(NAME)} כדי לשגר`)).toBeOnTheScreen();
  });

  it('closes from its close button, from the scrim, and from ⚡ again', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    await fireEvent.press(screen.getByTestId('arsenal-close'));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('drop-zone')).not.toBeOnTheScreen();

    await openFromBolt();
    await fireEvent.press(screen.getByTestId('arsenal-scrim'));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();

    await openFromBolt();
    await fireEvent.press(screen.getByTestId('interfere', hidden));
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
  });

  it('short of points ⚡ does not open it: it says why, with a light haptic (§8.1)', async () => {
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

  it('ends with "נפתחות בהמשך": the four after V1, locked and "בקרוב" (Arsenal, Interference-Target)', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    const coming = screen.getByTestId('arsenal-coming');
    expect(coming).toHaveAccessibleName('נפתחות בהמשך: דיו, רעידת אדמה, ערפל, בועות. בקרוב');
    for (const kind of ['ink', 'earthquake', 'fog', 'bubbles']) {
      expect(within(coming).getByTestId(`arsenal-coming-${kind}`, hidden)).toBeOnTheScreen();
    }
    // Never a token: nothing there can be dragged.
    expect(screen.queryByTestId('arsenal-token-ink')).not.toBeOnTheScreen();
  });
});

describe('the drag launch (spec §7.3.2–4, Interference-Drag; D18: drag only)', () => {
  it('lift: the ghost carries the name and the cost, the slot says "בגרירה…", the hint says how to cancel', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('fireworks', { x: 200, y: 500 }, { hold: true });
    expect(cues()).toContain('tokenLift');
    expect(screen.getByTestId('arsenal-ghost', hidden)).toHaveTextContent('זיקוקים · 2 נק׳');
    expect(screen.getByText('בגרירה…')).toBeOnTheScreen();
    expect(screen.getByText('שחרור מחוץ לאזור מבטל')).toBeOnTheScreen();
    // A second token can't be picked up meanwhile.
    expect(getByGestureTestId('arsenal-drag-cats').config.enabled).toBe(false);
  });

  it('over the card: it lights up (drop-hover), says so, and buzzes once per entry', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('cats', INSIDE, { hold: true });
    expect(cues().filter((c) => c === 'dropZoneEnter')).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId('drop-zone', hidden).props.style)).toMatchObject({
      backgroundColor: color.accentSubtle,
    });
    expect(screen.getByTestId('card-opponent-summary', hidden)).toHaveProp(
      'accessibilityHint',
      `שחרר כאן: שיגור חתולים אל ${isolate(NAME)}`,
    );
    await spoken();
    expect(live()).toHaveTextContent(`מעל הכרטיס של ${isolate(NAME)}: שחרר כדי לשגר`, { exact: false });
  });

  it('let go on the card: launches once, at that card; the token lands, the tray closes', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    const before = g.host.getView().players[0]!.score;
    await openFromBolt();
    await dragTo('fireworks', INSIDE);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'fireworks');
    expect(cues()).toEqual(expect.arrayContaining(['arsenalOpen', 'tokenLift', 'dropZoneEnter', 'launch']));
    // The engine took it: the bot is under fireworks and I paid 2.
    const view = g.host.getView();
    expect(view.players[1]!.hitBy).toMatchObject({ fromId: ME, kind: 'fireworks' });
    expect(view.players[0]!.score).toBe(before - 2);
    // The token shrinks into the card with a ripple out of it; then all of it is gone.
    expect(screen.getByTestId('arsenal-ripple', hidden)).toBeOnTheScreen();
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-ripple', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('drop-zone', hidden)).not.toBeOnTheScreen();
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it('let go anywhere else: nothing is launched, the token flies back, the tray stays', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    const before = g.host.getView().players[0]!.score;
    await openFromBolt();
    await dragTo('warp', OUTSIDE);
    expect(onLaunch).not.toHaveBeenCalled();
    expect(cues()).not.toContain('launch');
    expect(g.host.getView().players[0]!.score).toBe(before);
    // Still on its way back to the slot (the settle spring), then home.
    expect(screen.getByTestId('arsenal-ghost', hidden)).toBeOnTheScreen();
    await step(1000);
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByText('בגרירה…')).not.toBeOnTheScreen();
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    await spoken();
    expect(live()).toHaveTextContent('השיגור בוטל', { exact: false });
  });

  it('passing over the card and letting go outside it cancels: only the release point counts', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    const f = await dragTo('cats', INSIDE, { hold: true });
    await f.move(OUTSIDE);
    expect(StyleSheet.flatten(screen.getByTestId('drop-zone', hidden).props.style).backgroundColor).not.toBe(
      color.accentSubtle,
    );
    await f.move(INSIDE);
    await f.move(OUTSIDE);
    await f.up(OUTSIDE);
    await step(1000);
    expect(onLaunch).not.toHaveBeenCalled();
    // Each entry buzzed once; the tray is still open, aimed at the same card.
    expect(cues().filter((c) => c === 'dropZoneEnter')).toHaveLength(2);
    expect(screen.getByTestId('drop-zone', hidden)).toBeOnTheScreen();
  });

  it('3–4 players: the ghost also shows the route, "אני ← NinaVolt" (spec §7.3.5)', async () => {
    const { g } = await show({ showRoute: true });
    await earn(g);
    await openFromBolt();
    await dragTo('cats', { x: 200, y: 500 }, { hold: true });
    const ghost = screen.getByTestId('arsenal-ghost', hidden);
    expect(ghost).toHaveTextContent(`חתולים · 2 נק׳אני←${isolate(NAME)}`);
    // The tag: from me (P1, ●) to the card it was opened from (its seat colour, ▲), both avatars.
    const route = within(ghost).getByTestId('arsenal-route', hidden);
    expect(within(route).getByTestId('arsenal-route-avatar-0', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('arsenal-route-avatar-1', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('glyph-circle', hidden)).toBeOnTheScreen();
    expect(within(route).getByTestId('glyph-triangle', hidden)).toBeOnTheScreen();
  });

  it('2 players: no route tag on the ghost', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('cats', { x: 200, y: 500 }, { hold: true });
    expect(screen.getByTestId('arsenal-ghost', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-route', hidden)).not.toBeOnTheScreen();
  });

  it('if my score drops under the cost mid-drag, the drop does not launch', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    const f = await dragTo('fireworks', INSIDE, { hold: true });
    // Wrong digits until I can't pay any more (spec §6.5: each one costs points).
    await act(async () => {
      for (const cell of g.cells.slice(-6)) {
        if (g.host.getView().interference!.missingPoints > 0) break;
        g.host.select(cell);
        g.host.place(cell, wrongIn(g.puzzle, cell));
      }
    });
    expect(g.host.getView().interference!.missingPoints).toBeGreaterThan(0);
    await f.up(INSIDE);
    await step(1000);
    expect(onLaunch).not.toHaveBeenCalled();
    expect(g.host.getView().players[1]!.hitBy).toBeNull();
    // The three tokens and the cost row say what I miss; no "score after launch" for a launch that can't be.
    expect(screen.getAllByText(/^חסרות [\d.]+ נק׳$/)).toHaveLength(4);
    expect(screen.getByTestId('arsenal-after')).toHaveTextContent(/^חסרות [\d.]+ נק׳$/);
    expect(screen.queryByText(/אחרי שיגור/)).not.toBeOnTheScreen();
    expect(screen.getByTestId('arsenal-cost')).toHaveAccessibleName(/, חסרות [\d.]+ נקודות$/);
  });

  it('a token I can’t afford can’t start a drag; its pill says how much I miss', async () => {
    const { onLaunch } = await show();
    await fireEvent.press(screen.getByTestId('force-open'));
    await step(400);
    expect(screen.getByTestId('arsenal-token-fireworks')).toHaveAccessibleName(
      'זיקוקים · חסרות 2 נק׳ להפרעה הזאת',
    );
    expect(screen.getAllByText('חסרות 2 נק׳')).toHaveLength(4); // three tokens and the cost row
    // The gesture is off, so the native side never starts it (fireGestureHandler honours that).
    const pan = getByGestureTestId('arsenal-drag-fireworks');
    expect(pan.config.enabled).toBe(false);
    await act(async () => {
      fireGestureHandler(pan, [
        { state: State.BEGAN, absoluteX: TOKEN_AT.x, absoluteY: TOKEN_AT.y },
        { state: State.ACTIVE, absoluteX: INSIDE.x, absoluteY: INSIDE.y },
        { state: State.END, absoluteX: INSIDE.x, absoluteY: INSIDE.y },
      ]);
    });
    await step();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(cues()).not.toContain('tokenLift');
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
  });

  it('a tap never launches (D18): it explains, for 2 seconds', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    await tap('cats');
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-bubble-cats')).toHaveTextContent(
      `גרור אל ${isolate(NAME)} — הקשה לא משגרת`,
    );
    await step(2100);
    expect(screen.queryByTestId('arsenal-bubble-cats')).not.toBeOnTheScreen();
  });

  it('a screen reader’s activate on a token explains too, and does not launch', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    await fireEvent(screen.getByTestId('arsenal-token-warp'), 'accessibilityAction', {
      nativeEvent: { actionName: 'activate' },
    });
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByTestId('arsenal-bubble-warp')).toBeOnTheScreen();
  });

  it('closes by itself when the target leaves the game', async () => {
    const { g } = await show();
    await earn(g);
    await openFromBolt();
    await act(async () => {
      g.host.dispatch({ type: 'surrender', playerId: BOT.id });
    });
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
  });
});

describe('the tray goes away under a held token', () => {
  /** The drag is over: no ghost, no slot saying "בגרירה…", and the card is no drop zone. */
  const expectNoDrag = () => {
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByText('בגרירה…', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('drop-zone', hidden)).not.toBeOnTheScreen();
  };

  it('the target leaves mid-drag: the ghost goes with the tray, and letting go later launches nothing', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    const f = await dragTo('fireworks', INSIDE, { hold: true });
    expect(screen.getByTestId('arsenal-ghost', hidden)).toBeOnTheScreen();
    await act(async () => {
      g.host.dispatch({ type: 'surrender', playerId: BOT.id });
    });
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expectNoDrag();
    await f.up(INSIDE);
    await step(1000);
    expectNoDrag();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('the game ends mid-drag: the tray closes, the ghost goes, nothing is launched or charged', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('cats', INSIDE, { hold: true });
    // I fill the rest of the board: the game is over, the bot still in it.
    await act(async () => {
      for (const cell of g.cells) {
        if (g.host.getView().status === 'over') break;
        if (g.host.getView().grid[cell] !== 0) continue;
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
    });
    const view = g.host.getView();
    expect(view.status).toBe('over');
    expect(view.players[1]!.status).toBe('active');
    const score = view.players[0]!.score;
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expectNoDrag();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(g.host.getView().players[0]!.score).toBe(score);
  });

  it('Android back mid-drag closes the tray and ends the drag; the token can open again cleanly', async () => {
    const back = jest.spyOn(BackHandler, 'addEventListener');
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    const f = await dragTo('warp', INSIDE, { hold: true });
    const [event, handler] = back.mock.calls.at(-1)!;
    expect(event).toBe('hardwareBackPress');
    await act(async () => {
      expect((handler as () => boolean)()).toBe(true);
    });
    await step(1000);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
    expectNoDrag();
    await f.up(INSIDE);
    await step(1000);
    expect(onLaunch).not.toHaveBeenCalled();
    // Opened again: no ghost left over, every token can be picked up.
    await openFromBolt();
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByText('בגרירה…')).not.toBeOnTheScreen();
    for (const kind of ['fireworks', 'cats', 'warp'] as const) {
      expect(getByGestureTestId(`arsenal-drag-${kind}`).config.enabled).toBe(true);
    }
    back.mockRestore();
  });
});

describe('reduced motion (spec §22)', () => {
  beforeEach(() => useSettings.setState({ reduceMotion: 'on' }));

  it('a cancel snaps: the ghost is gone at once, no flight back', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('fireworks', { x: 200, y: 500 }, { hold: true });
    // The ghost still follows the finger: it is what is being dragged.
    expect(screen.getByTestId('arsenal-ghost', hidden)).toBeOnTheScreen();
    await dragTo('fireworks', OUTSIDE);
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it('a drop on the card still launches, once; no flight into the card and no ripple', async () => {
    const { g, onLaunch } = await show();
    await earn(g);
    await openFromBolt();
    await dragTo('cats', INSIDE);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(BOT.id, 'cats');
    expect(screen.queryByTestId('arsenal-ghost', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('arsenal-ripple', hidden)).not.toBeOnTheScreen();
    await step(400);
    expect(screen.queryByTestId('arsenal-sheet')).not.toBeOnTheScreen();
  });
});
