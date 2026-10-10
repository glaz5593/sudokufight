// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import { type CellIndex, cellName, type InterferenceKind, type PlayerId } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { DeviceEventEmitter, StyleSheet, View, type ViewStyle } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { paletteAt } from '../../../components/player';
import { answerIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { dropZoneOf, isolate } from '../arsenal';
import { GameScreen, type GameSession } from '../GameScreen';
import type { Point, Rect } from '../geometry';
import { useReactionMutes } from '../reactions';
import { type Group, group, ME } from '../testing/group';

/**
 * Work plan stage 10 on the game screen (spec §6.6–§6.8, §7.3, §7.4; Game-3P, Game-4P, Interference-Target):
 * games of 3 and 4 players on a LocalGameHost, the others' moves dispatched by the test.
 *
 * - One row of compact cards in a fixed seat order (me first), each with its place; widths as components.md
 *   §7.1; the lead bar by place.
 * - Every opponent's lock on the board with that player's avatar, in their colour.
 * - ⚡ on the SECOND opponent's card aims the arsenal at that card only: it is the one drop zone, the others
 *   dim, the ghost carries the route "אני ← Biscuit" with both avatars, and the drop hits Biscuit, not Pip.
 * - A hit between two others shows on the target's card.
 * - Someone surrenders (D36): out, dimmed, a fixed place after everyone still in, no ⚡; the game goes on.
 *   My own surrender takes me out the same way; I watch to the end and the results open then.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));
// Every avatar a source of its own, so a test can tell which one an image shows (Metro's asset ids in the app).
jest.mock('../../../assets/avatars', () => {
  const actual = jest.requireActual<typeof import('../../../assets/avatars')>('../../../assets/avatars');
  return {
    ...actual,
    AVATARS: Object.fromEntries(Object.keys(actual.AVATARS).map((id) => [id, { uri: id }])),
  };
});

const hidden = { includeHiddenElements: true };
const PIP = 'bot-1';
const BISCUIT = 'bot-2';
const MAESTRO = 'bot-4';

// ---- where the cards are in the window (Jest has no layout): 3 players in Hebrew, me at the right ----

const CARDS: Record<PlayerId, Rect> = {
  [ME]: { x: 260, y: 58, width: 114, height: 160 },
  [PIP]: { x: 138, y: 58, width: 114, height: 160 },
  [BISCUIT]: { x: 16, y: 58, width: 114, height: 160 },
};
/** Where the finger first touches a token, low in the tray. */
const TOKEN_AT: Point = { x: 195, y: 1150 };
const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

type MeasureInWindow = (done: (x: number, y: number, width: number, height: number) => void) => void;

beforeAll(() => {
  // The view around each opponent's card answers where it is; the rest of Jest's views stay silent.
  const views = (View as unknown as { prototype: { measureInWindow: MeasureInWindow } }).prototype;
  jest.spyOn(views, 'measureInWindow').mockImplementation(function (
    this: { props?: { testID?: string } },
    done,
  ) {
    const id = /^group-hud-(.+)$/.exec(this.props?.testID ?? '')?.[1];
    const rect = id ? CARDS[id] : undefined;
    if (rect) done(rect.x, rect.y, rect.width, rect.height);
  });
});

let game: Group | null = null;
async function show(
  options: Parameters<typeof group>[0] = {},
  extra: Partial<Pick<GameSession, 'profiles'>> = {},
) {
  const g = (game = group(options));
  const onEnded = jest.fn();
  const session: GameSession = { ...g.session, ...extra };
  await render(
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <GameScreen session={session} onEnded={onEnded} />
    </GestureHandlerRootView>,
  );
  return { ...g, onEnded };
}

/** The phone's timers in frames (animations, the live region, the count-ups). */
async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}
const step = (ms = 16) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
/** The live region speaks at most every 1.5 s. */
const spoken = () => frames(1_600);
const live = () => screen.getByTestId('game-live');

/** Another player's moves, inside act(). */
const by = async (g: Group, id: PlayerId, play: (hand: ReturnType<Group['as']>) => void) => {
  await act(async () => play(g.as(id)));
};

/** I solve free cells until my score covers the next interference. */
async function earn(g: Group, points = 2) {
  await act(async () => {
    for (const cell of g.cells) {
      const view = g.host.getView();
      if (view.players[0]!.score >= points) return;
      if (view.grid[cell] !== 0 || view.players.some((p) => p.lock?.cell === cell)) continue;
      g.host.select(cell);
      g.host.place(cell, answerIn(g.puzzle, cell));
    }
  });
  await frames(1_000);
}

/** The free cells nobody holds, in board order. */
const free = (g: Group): CellIndex[] => {
  const view = g.host.getView();
  return g.cells.filter((c) => view.grid[c] === 0 && !view.players.some((p) => p.lock?.cell === c));
};

const styleOf = (el: { props: { style?: unknown } }): ViewStyle =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

interface Node {
  props: Record<string, unknown>;
  children: readonly (Node | string)[];
}
/** The avatar ids of every image under an element (the mocked sources are `{ uri: id }`). */
function avatarsIn(el: Node): string[] {
  const sources = ([] as unknown[]).concat(el.props.source ?? []) as { uri?: unknown }[];
  const own = sources.flatMap((s) => (typeof s?.uri === 'string' ? [s.uri] : []));
  return [...own, ...el.children.flatMap((c) => (typeof c === 'string' ? [] : avatarsIn(c)))];
}

const card = (id: PlayerId) => screen.getByTestId(id === ME ? 'card-me' : `card-${id}`, hidden);
const rankOf = (id: PlayerId) => within(card(id)).getByText(/^#\d$/, hidden).props.children as string;
const summaryOf = (id: PlayerId) =>
  screen.getByTestId(id === ME ? 'card-me-summary' : `card-${id}-summary`, hidden).props
    .accessibilityLabel as string;

// ---- the finger on a token (the events the gesture handler's native side sends) ----

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

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useReactionMutes.getState().reset();
  useProfile.setState({ avatarId: 'av07' });
});

afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------------------------------------

describe('the cards of 3–4 players (spec §6.8, components.md §6–§9)', () => {
  it('3 players: one row of compact cards, me first then by seat, 114 each, each with its place', async () => {
    await show();
    expect(screen.queryByTestId('duel-hud')).toBeNull();
    expect(screen.queryByTestId('solo-hud')).toBeNull();
    const row = screen.getByTestId('group-hud');
    expect(row.children.map((c) => (c as unknown as Node).props.testID)).toEqual([
      'group-hud-mine',
      `group-hud-${PIP}`,
      `group-hud-${BISCUIT}`,
    ]);
    for (const id of [ME, PIP, BISCUIT]) expect(styleOf(card(id)).width).toBe(114);
    // Nobody has scored: a three-way tie for #1, and the bar says so.
    expect([ME, PIP, BISCUIT].map(rankOf)).toEqual(['#1', '#1', '#1']);
    expect(screen.getByLabelText('שוויון בניקוד')).toBeOnTheScreen();
    // The cards speak their place (components.md §7.4); the others' rating and presence too.
    expect(summaryOf(PIP)).toMatch(/^Pip · מקום 1 · 0 נקודות · חושב, אין טעויות, בוט, דירוג 1305, מחובר$/);
    expect(summaryOf(ME)).toMatch(/^אני · מקום 1 · 0 נקודות/);
    // My card: "כניעה" (ranked) and reactions; each opponent's: its own ⚡, waiting for my first 2 points.
    expect(screen.getByRole('button', { name: 'כניעה' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'הפרעה ל־Pip · חסרות 2 נק׳' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'הפרעה ל־Biscuit · חסרות 2 נק׳' })).toBeDisabled();
    // Ownership never by colour alone: each card's shape.
    expect(within(card(ME)).getByTestId('glyph-circle', hidden)).toBeOnTheScreen();
    expect(within(card(PIP)).getByTestId('glyph-triangle', hidden)).toBeOnTheScreen();
    expect(within(card(BISCUIT)).getByTestId('glyph-square', hidden)).toBeOnTheScreen();
  });

  it('4 players: mine 106 and 78 for the others; the order stays as the places change', async () => {
    const g = await show({ count: 4 });
    const order = () =>
      screen.getByTestId('group-hud').children.map((c) => (c as unknown as Node).props.testID);
    const before = order();
    expect(before).toEqual([
      'group-hud-mine',
      `group-hud-${PIP}`,
      `group-hud-${BISCUIT}`,
      `group-hud-${MAESTRO}`,
    ]);
    expect([ME, PIP, BISCUIT, MAESTRO].map((id) => styleOf(card(id)).width)).toEqual([106, 78, 78, 78]);
    expect(within(card(MAESTRO)).getByTestId('glyph-diamond', hidden)).toBeOnTheScreen();

    // Maestro scores, then Biscuit twice: places move, the cards don't (spec §6.8: targets never move).
    const [a, b, c] = free(g);
    await by(g, MAESTRO, (h) => h.solve(a!));
    await by(g, BISCUIT, (h) => h.solve(b!));
    await by(g, BISCUIT, (h) => h.solve(c!));
    await frames(1_500);
    const view = g.host.getView();
    const placeOf = (id: PlayerId) => view.players.find((p) => p.id === id)!.place;
    expect(placeOf(BISCUIT)).toBe(1);
    expect(placeOf(MAESTRO)).toBe(2);
    expect(rankOf(BISCUIT)).toBe('#1');
    expect(rankOf(MAESTRO)).toBe('#2');
    expect([rankOf(ME), rankOf(PIP)]).toEqual(['#3', '#3']);
    expect(order()).toEqual(before);
    // The lead bar by place, with the leader's shape on its tag (components.md §9.2).
    const tag = screen.getByTestId('lead-tag', hidden);
    expect(within(tag).getByTestId('glyph-square', hidden)).toBeOnTheScreen();
    await spoken();
    expect(live()).toHaveTextContent(/Biscuit מוביל/);
  });

  it('every opponent’s lock is on the board with its holder’s avatar, in its colour', async () => {
    const g = await show({ count: 4 });
    const [a, b, c] = free(g);
    await by(g, PIP, (h) => h.select(a!));
    await by(g, BISCUIT, (h) => h.select(b!));
    await by(g, MAESTRO, (h) => h.select(c!));
    const expectLock = (cell: CellIndex, name: string, avatar: string, colorIndex: number) => {
      const el = screen.getByTestId(`cell-${cellName(cell)}`);
      expect(el).toHaveProp('accessibilityLabel', `${cellName(cell)}, ריקה, נעולה על ידי ${name}, 8 שניות`);
      expect(avatarsIn(within(el).getByTestId('cell-avatar', hidden))).toEqual([avatar]);
      const ring = within(el).getByTestId('cell-ring', hidden).children[0] as unknown as Node;
      expect(styleOf(ring as never).borderColor).toBe(paletteAt(colorIndex).ring);
    };
    expectLock(a!, 'Pip', 'av44', 1);
    expectLock(b!, 'Biscuit', 'av42', 2);
    expectLock(c!, 'Maestro', 'av39', 3);
    // Each card says what its player is choosing.
    expect(summaryOf(BISCUIT)).toContain(`בוחר ${cellName(b!)}`);
    // And my own lock is mine: P1, no avatar.
    const [d] = free(g);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(d!)}`));
    const mine = screen.getByTestId(`cell-${cellName(d!)}`);
    expect(within(mine).queryByTestId('cell-avatar', hidden)).toBeNull();
    expect(avatarsIn(card(ME) as unknown as Node)).toEqual(['av07']);
  });

  it('a ranked match’s profiles give the others their avatars (cards, locks and the arsenal)', async () => {
    const g = await show({}, { profiles: { [PIP]: { avatarId: 'av12', country: 'DE' }, [BISCUIT]: null } });
    expect(avatarsIn(card(PIP) as unknown as Node)).toEqual(['av12']);
    expect(avatarsIn(card(BISCUIT) as unknown as Node)).toEqual(['av42']); // none given: its level's
    const [a] = free(g);
    await by(g, PIP, (h) => h.select(a!));
    const el = screen.getByTestId(`cell-${cellName(a!)}`);
    expect(avatarsIn(within(el).getByTestId('cell-avatar', hidden))).toEqual(['av12']);
  });
});

describe('interferences between 3–4 players (spec §7.3, §7.4)', () => {
  it('⚡ on the second opponent aims at that card only: its drop zone, the route, and the hit on it', async () => {
    const g = await show();
    await earn(g);
    const myScore = g.host.getView().players[0]!.score;
    await fireEvent.press(screen.getByRole('button', { name: 'הפרעה ל־Biscuit · עלות 2 נק׳' }));
    await step(400);
    // The tray is aimed at Biscuit; Biscuit's card is the one drop zone; Pip's and mine dim.
    expect(screen.getByLabelText(`יעד: ${isolate('Biscuit')}`)).toBeOnTheScreen();
    expect(within(card(BISCUIT)).queryByTestId('drop-zone', hidden)).toBeNull(); // the zone wraps the card
    expect(
      within(screen.getByTestId(`group-hud-${BISCUIT}`, hidden)).getByTestId('drop-zone', hidden),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`group-hud-${PIP}`, hidden)).queryByTestId('drop-zone', hidden),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'סגירת ארסנל ההפרעות', ...hidden })).toBeOnTheScreen();

    // Drag the fireworks: the ghost carries the route, from me to Biscuit, both avatars.
    const f = finger('fireworks');
    await f.down();
    const ghost = screen.getByTestId('arsenal-ghost', hidden);
    expect(ghost).toHaveTextContent(`זיקוקים · 2 נק׳אני←${isolate('Biscuit')}`);
    const route = within(ghost).getByTestId('arsenal-route', hidden);
    expect(avatarsIn(route as unknown as Node)).toEqual(['av07', 'av42']);
    // Over Pip's card nothing happens: it is not a drop zone.
    await f.move(centre(CARDS[PIP]!));
    await f.move(centre(dropZoneOf(CARDS[BISCUIT]!)));
    await f.up(centre(dropZoneOf(CARDS[BISCUIT]!)));
    await frames(600);

    const view = g.host.getView();
    const of = (id: PlayerId) => view.players.find((p) => p.id === id)!;
    expect(of(BISCUIT).hitBy).toMatchObject({ fromId: ME, kind: 'fireworks' });
    expect(of(PIP).hitBy).toBeNull();
    expect(of(ME).score).toBe(myScore - 2);
    // The tag on the target's card (spec §7.4); none on Pip's.
    expect(within(card(BISCUIT)).getByTestId('hit-chip', hidden)).toBeOnTheScreen();
    expect(within(card(PIP)).queryByTestId('hit-chip', hidden)).toBeNull();
    // Biscuit can't take another now; Pip can (the next one costs 4).
    expect(screen.getByRole('button', { name: /^הפרעה ל־Biscuit לא זמינה/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^הפרעה ל־Pip/ })).toBeOnTheScreen();
  });

  it('a hit between two others: the chip on the target’s card, and a line said', async () => {
    const g = await show();
    const [a, b] = free(g);
    await by(g, PIP, (h) => h.solve(a!));
    await by(g, PIP, (h) => h.solve(b!));
    await by(g, PIP, (h) => h.interfere(BISCUIT, 'cats'));
    await frames(300);
    expect(within(card(BISCUIT)).getByTestId('hit-chip', hidden)).toBeOnTheScreen();
    expect(within(card(PIP)).queryByTestId('hit-chip', hidden)).toBeNull();
    expect(within(card(ME)).queryByTestId('hit-chip', hidden)).toBeNull();
    // Not on me: no banner over my screen.
    expect(screen.queryByTestId('hit-banner')).toBeNull();
    await spoken();
    expect(live()).toHaveTextContent('Pip שלח חתולים אל Biscuit', { exact: false });
  });
});

describe('leaving a game of 3–4 (spec §6.6, §6.7, D36)', () => {
  it('an opponent surrenders: out, dimmed with a fixed last place, no ⚡; the game goes on', async () => {
    const g = await show();
    const [a, b] = free(g);
    await by(g, PIP, (h) => h.solve(a!));
    const pipCell = a!;
    await by(g, PIP, (h) => h.select(b!));
    await by(g, PIP, (h) => h.surrender());
    await frames(300);

    const view = g.host.getView();
    expect(view.status).toBe('running');
    expect(view.players.find((p) => p.id === PIP)).toMatchObject({
      status: 'surrendered',
      place: 3,
      lock: null,
    });
    expect(rankOf(PIP)).toBe('#3');
    expect(summaryOf(PIP)).toMatch(/^Pip · מקום 3 · .* · נכנע/);
    expect(screen.queryByRole('button', { name: /^הפרעה ל־Pip/ })).toBeNull();
    // Its solved cell keeps its colour (▲), its lock is gone.
    expect(
      within(screen.getByTestId(`cell-${cellName(pipCell)}`)).getByTestId('cell-glyph-triangle', hidden),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(`cell-${cellName(b!)}`)).queryByTestId('cell-avatar', hidden),
    ).toBeNull();
    await spoken();
    expect(live()).toHaveTextContent('Pip נכנע ויצא מהמשחק, מקום 3', { exact: false });

    // Play goes on: I take a cell; Biscuit still scores; Pip stays third, even with more points than us.
    const [c] = free(g);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(c!)}`));
    expect(g.host.getView().players[0]!.lock?.cell).toBe(c);
    expect(screen.getByTestId('lock-strip')).toBeOnTheScreen();
    expect(rankOf(PIP)).toBe('#3');
  });

  it('my surrender in a game of 4: "תצא מהמשחק", then I watch to the end; the results open then', async () => {
    const g = await show({ count: 4 });
    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    const dialog = screen.getByTestId('ranked-surrender');
    expect(within(dialog).getByText('תצא מהמשחק, והמשבצות שפתרת יישארו בצבע שלך.')).toBeOnTheScreen();
    await fireEvent.press(within(dialog).getByRole('button', { name: 'כן, להיכנע' }));
    await frames(300);

    // Out, last (the first one out), and the game goes on without me.
    expect(g.host.getView().status).toBe('running');
    expect(screen.getByTestId('out-strip')).toHaveTextContent(/נכנעת · מקום 4/);
    expect(screen.getByLabelText('נכנעת · מקום 4. המשחק ממשיך עד הסוף')).toBeOnTheScreen();
    expect(screen.queryByTestId('lock-strip')).toBeNull();
    expect(screen.queryByTestId('out-strip-home')).toBeNull(); // a local game: nowhere else to go
    expect(rankOf(ME)).toBe('#4');
    expect(screen.getByRole('button', { name: 'כניעה' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^הפרעה ל־/ })).toBeNull(); // I can't send any now
    expect(g.onEnded).not.toHaveBeenCalled();
    await spoken();
    expect(live()).toHaveTextContent('יצאת מהמשחק במקום 4. המשחק ממשיך עד הסוף', { exact: false });

    // The board is there to watch: a tap takes nothing.
    const [a] = free(g);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(a!)}`));
    expect(g.host.getView().players[0]!.lock).toBeNull();
    // The others play on; Pip and then Biscuit go too: Maestro, the last one in, wins.
    await by(g, MAESTRO, (h) => h.solve(a!));
    await by(g, PIP, (h) => h.surrender());
    expect(g.onEnded).not.toHaveBeenCalled();
    await by(g, BISCUIT, (h) => h.surrender());
    await frames(300);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
    const ranking = g.host.getView().result!.ranking.map((r) => [r.playerId, r.place, r.status]);
    expect(ranking).toEqual([
      [MAESTRO, 1, 'active'],
      [BISCUIT, 2, 'surrendered'],
      [PIP, 3, 'surrendered'],
      [ME, 4, 'surrendered'],
    ]);
  });
});

describe('in English', () => {
  it('the route arrow points the other way; the out strip speaks English', async () => {
    await i18n.changeLanguage('en');
    const g = await show();
    await earn(g);
    await fireEvent.press(screen.getByRole('button', { name: 'Interfere with Pip · costs 2 pts' }));
    await step(400);
    const f = finger('cats');
    await f.down();
    expect(screen.getByTestId('arsenal-ghost', hidden)).toHaveTextContent(`Cats · 2 ptsMe→${isolate('Pip')}`);
    await f.up(TOKEN_AT);
    await frames(600);
    await fireEvent.press(screen.getByTestId('arsenal-close'));
    await frames(400);
    await act(async () => g.host.surrender());
    await frames(300);
    expect(screen.getByTestId('out-strip')).toHaveTextContent(/You surrendered · place 3/);
  });
});
