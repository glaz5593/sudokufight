// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { type FindLevelOver, levelIdOf, THINK_TIME_MS } from '@sudoku-fight/engine';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';

import { useAuth } from '../../../auth/authStore';
import { paletteAt } from '../../../components/player';
import { directionProblems, PHONE, textWidth } from '../../../components/ui/testing/layout';
import { useToast } from '../../../components/ui';
import { FRIENDS_UI } from '../../../config/friends';
import { useGameStore } from '../../../game/gameStore';
import { openPracticeRepo, type PracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { measuredWidth } from '../../../testing/fontMetrics';
import { type LevelsRepo, openLevelsRepo } from '../../../levels/levelsRepo';
import { forgetLevels } from '../../../levels/levelsStore';
import { useProfile } from '../../../state/profile';
import { color, contrast, size, tokens } from '../../../theme';
import { hidden, styleOf } from '../../game/connection/testing/setup';
import type { ModeKey } from '../homeModel';
import { renderApp } from '../testing/homeTesting';

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);
// levels.db: sql.js, the test's own (the "אימון בשלבים" row reads its summary from it).
let mockLevelsRepo: Promise<LevelsRepo> | null = null;
jest.mock('../../../levels/levelsStorage', () => ({
  openLevelsStorage: () => mockLevelsRepo ?? Promise.reject(new Error('no levels.db')),
  levelsStorageOrNull: async () => (mockLevelsRepo ? await mockLevelsRepo : null),
}));

const storage = jest.mocked(practiceStorageOrNull);
let repo: PracticeRepo;

beforeEach(async () => {
  jest.useRealTimers();
  repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null });
  useToast.getState().clear();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  useAuth.setState({ status: 'loading', user: null });
  forgetLevels();
  mockLevelsRepo = null;
  jest.useRealTimers();
});

/** The six options, top to bottom (Moshe's device test, 15.10.2026: the bot above solo; D48: the stages last). */
const KEYS: readonly ModeKey[] = ['ranked2', 'ranked3', 'ranked4', 'bot', 'solo', 'levels'];

/** The map's route, a stand-in here (screens/levels has its own tests). */
const LEVELS_STUB = { 'levels/index': () => <Text testID="stub-levels">levels</Text> };

/** What a row's tagline says: a new player sees staged practice's "300 שלבים קצרים · 0–3 כוכבים". */
const taglineOf = (key: ModeKey, fresh = true): string =>
  key === 'levels' && fresh
    ? i18n.t('home:modes.levels.taglineNew', { total: 300 })
    : i18n.t(`home:modes.${key}.tagline`);

describe('"משחק חדש" (spec §5.1)', () => {
  it('offers six modes, all open: ranked 2 · 3 · 4, the bot above solo practice, then staged practice (D48)', async () => {
    await renderApp('/modes');
    expect(screen.getByRole('header', { name: 'משחק חדש' })).toBeTruthy();
    // On screen, top to bottom: the bot practice above the solo one (Moshe's device test, 15.10.2026).
    expect(screen.getAllByTestId(/^mode-(ranked\d|bot|solo|levels)$/).map((c) => c.props.testID)).toEqual(
      KEYS.map((k) => `mode-${k}`),
    );
    const keys = KEYS;
    const cards = keys.map((k) => screen.getByTestId(`mode-${k}`));
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.props.accessibilityState.disabled)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    for (const k of keys) expect(screen.queryByTestId(`soon-${k}`)).toBeNull();
    expect(screen.getByTestId('mode-ranked2')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 2 שחקנים, אחד על אחד · אותו לוח',
    );
    expect(screen.getByTestId('mode-ranked4')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 4 שחקנים, כולם נגד כולם',
    );
    // Only the solo row's title changed (D48): "אימון לבד · לוח מלא". Its history and results still say "אימון לבד".
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityLabel',
      'אימון לבד · לוח מלא, בקצב שלך, ללא דירוג, עובד גם בלי אינטרנט',
    );
    expect(i18n.t('home:modes.solo.name')).toBe('אימון לבד');
    expect(screen.getByTestId('mode-bot')).toHaveProp(
      'accessibilityLabel',
      'אימון מול בוט, 5 רמות, ללא דירוג, עובד גם בלי אינטרנט',
    );
    // A new player: the stages there are, no progress chip, no "ללא דירוג" (and no "דורש חיבור", it works offline).
    expect(screen.getByTestId('mode-levels')).toHaveProp(
      'accessibilityLabel',
      'אימון בשלבים, 300 שלבים קצרים · ⁦0–3⁩ כוכבים, עובד גם בלי אינטרנט',
    );
    expect(screen.queryByTestId('levels-progress-chip')).toBeNull();
    expect(within(screen.getByTestId('mode-levels')).queryByText('ללא דירוג')).toBeNull();
    expect(directionProblems(screen.getByTestId('mode-solo'))).toEqual([]);
    expect(directionProblems(screen.getByTestId('mode-levels'))).toEqual([]);
  });

  it('"אימון בשלבים" opens the level map, not the game type', async () => {
    const app = await renderApp('/modes', LEVELS_STUB);
    await fireEvent.press(screen.getByRole('button', { name: /^אימון בשלבים/ }));
    expect(app.pathname()).toBe('/levels');
    expect(screen.getByTestId('stub-levels')).toBeOnTheScreen();
    expect(useGameStore.getState().session).toBeNull();
  });

  it('after 13 stages: the row shows my stage and stars, "שלב 14 · ★ n", and my stage on its tile', async () => {
    const levels = await openLevelsRepo(await memoryDb());
    mockLevelsRepo = Promise.resolve(levels);
    const found: FindLevelOver = {
      reason: 'targetReached',
      elapsedMs: 4000,
      penaltyMs: 0,
      spots: 1,
      found: 0,
      stars: 3,
    };
    for (let n = 1; n <= 13; n++)
      await levels.recordAttempt({
        owner: 'uid-1',
        level: {
          id: levelIdOf(n),
          rev: 1,
          kind: 'find',
          chapter: Math.ceil(n / 10),
          stars: { by: 'timeMs', three: n % 2 ? 5000 : 3000, two: 10000, one: 20000 },
        },
        end: found,
        startedAt: 1,
        endedAt: 2,
      });
    await act(async () =>
      useAuth.setState({
        status: 'ready',
        user: { uid: 'uid-1', email: null, emailVerified: true, methods: [] },
      }),
    );
    await renderApp('/modes');
    const chip = await screen.findByTestId('levels-progress-chip');
    // 7 stages at ★★★ (5 s) and 6 at ★★ (3 s is ★★★'s limit there): 33 stars; the 14th is next.
    expect(chip).toHaveTextContent('שלב 14 ·33');
    expect(within(chip).getByTestId('icon-star', { includeHiddenElements: true })).toHaveProp(
      'fill',
      expect.stringMatching(/#ffcf3f/i),
    );
    expect(within(screen.getByTestId('mode-levels')).getByText('שלבים קצרים · עד 3 כוכבים')).toBeTruthy();
    expect(screen.getByTestId('mode-levels')).toHaveProp(
      'accessibilityLabel',
      'אימון בשלבים, שלבים קצרים · עד 3 כוכבים, שלב 14 · 33 כוכבים, עובד גם בלי אינטרנט',
    );
    expect(
      within(screen.getByTestId('mode-levels')).getByTestId('mode-levels-lead-number', {
        includeHiddenElements: true,
      }),
    ).toHaveTextContent('14');
  });

  it('the header ends with me, as on the Modes board: my name (isolated) and my avatar', async () => {
    useProfile.setState({ name: 'MosheG', avatarId: 'lava-lamp' });
    await renderApp('/modes');
    const me = screen.getByTestId('modes-me');
    expect(me).toHaveTextContent('⁨MosheG⁩');
    expect(within(me).getByTestId('modes-me-avatar', { includeHiddenElements: true })).toBeTruthy();
    expect(directionProblems(screen.getByTestId('modes-me'))).toEqual([]);

    // No name yet (before the fighter is made): the avatar alone.
    await act(async () => useProfile.setState({ name: null }));
    expect(screen.getByTestId('modes-me')).toHaveTextContent('');
    expect(
      within(screen.getByTestId('modes-me')).getByTestId('modes-me-avatar', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('ranked 3 and 4 players open the game type of their table (stage 10)', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-ranked3'));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'ranked', players: '3' });
    expect(screen.getByText('מדורג · 3 שחקנים')).toBeOnTheScreen();
    expect(screen.getByText(/יריבים קרובים לדירוג שלך.*המשחק מתחיל כשהשולחן מלא/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'מצא יריבים' })).toHaveProp(
      'accessibilityHint',
      'מחפש יריבים למשחק מדורג רגיל',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    await fireEvent.press(screen.getByTestId('mode-ranked4'));
    expect(app.searchParams()).toEqual({ mode: 'ranked', players: '4' });
    expect(screen.getByText('מדורג · 4 שחקנים')).toBeOnTheScreen();
  });

  it('practice against a bot opens the game type of a bot practice, the last bot game type preselected', async () => {
    useProfile.setState({ lastPlay: { mode: 'bot', gameType: 'fast', botLevel: 2 } });
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByRole('button', { name: /^אימון מול בוט/ }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'bot', gameType: 'fast' });
    expect(screen.getByText('אימון מול בוט')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^מהיר\./ })).toHaveProp('accessibilityState', {
      checked: true,
    });
  });

  it('solo practice opens the game type, with the last game type preselected', async () => {
    useProfile.setState({ lastPlay: { mode: 'solo', gameType: 'hard' } });
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByRole('button', { name: /^אימון לבד/ }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'solo', gameType: 'hard' });
    expect(screen.getByRole('radio', { name: /^קשה\./ })).toHaveProp('accessibilityState', { checked: true });
  });

  it('the back button returns to Home', async () => {
    const app = await renderApp('/');
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(app.pathname()).toBe('/modes');
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(app.pathname()).toBe('/');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/modes');
    expect(screen.getByRole('header', { name: 'New game' })).toBeTruthy();
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityLabel',
      'Solo · full board, At your own pace, Unrated, Works offline',
    );
    expect(screen.getByTestId('mode-levels')).toHaveProp(
      'accessibilityLabel',
      'Staged practice, 300 short stages · 0–3 stars, Works offline',
    );
    expect(i18n.t('home:modes.levels.tagline')).toBe('Short stages · up to 3 stars');
    expect(screen.queryByText('Soon')).toBeNull();
  });
});

/** The friends screens' routes, stand-ins here (screens/friends has its own tests). */
const FRIENDS_STUBS = {
  'friends/room': () => <Text testID="stub-friends-room">room</Text>,
  'friends/join': () => <Text testID="stub-friends-join">join</Text>,
};

describe('"עם חברים" (1.0.4, friends-room.md §2, D80a)', () => {
  afterEach(() => {
    Object.assign(FRIENDS_UI, { modesGroup: true, groupName: 'short', rankedChip: false });
  });

  it('sits between the ranked tables and the practices: one row, "צור חדר" | "הצטרף עם קוד"', async () => {
    await renderApp('/modes');
    expect(screen.getAllByTestId(/^modes-group-/).map((g) => g.props.testID)).toEqual([
      'modes-group-ranked',
      'modes-group-friends',
      'modes-group-practice',
    ]);
    const group = screen.getByTestId('modes-group-friends');
    expect(within(group).getByRole('header', { name: 'עם חברים' })).toBeTruthy();
    expect(within(group).getByText('חדר פרטי · עד 4 · בלי דירוג')).toBeTruthy();
    const create = screen.getByTestId('modes-friends-create');
    const join = screen.getByTestId('modes-friends-join');
    expect(create).toHaveProp('accessibilityLabel', 'צור חדר');
    expect(create).toHaveProp('accessibilityHint', 'פותח חדר המתנה עם קוד ששולחים לחברים');
    expect(join).toHaveProp('accessibilityLabel', 'הצטרף עם קוד');
    expect([create, join].map((b) => b.props.accessibilityState.disabled)).toEqual([false, false]);
    // One row of two: each a touch target high, "צור חדר" in the accent.
    expect(styleOf(create)).toMatchObject({ minHeight: size.touch, flex: 1, borderColor: color.accent });
    expect(styleOf(join)).toMatchObject({ minHeight: size.touch, flex: 1 });
    expect(within(create).getByText('צור חדר')).toHaveStyle({ color: color.accent });
    expect(contrast(color.accent, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(directionProblems(group)).toEqual([]);
    // The ranked rows are two lines now: no "דירוג" chip [D80a].
    for (const k of ['ranked2', 'ranked3', 'ranked4'])
      expect(within(screen.getByTestId(`mode-${k}`)).queryByText('דירוג')).toBeNull();
  });

  it('"צור חדר" opens the room at once; "הצטרף עם קוד" the six boxes', async () => {
    const app = await renderApp('/modes', FRIENDS_STUBS);
    await fireEvent.press(screen.getByTestId('modes-friends-create'));
    expect(app.pathname()).toBe('/friends/room');
    expect(app.searchParams()).toEqual({ create: '1' });
    expect(screen.getByTestId('stub-friends-room')).toBeOnTheScreen();
    await act(async () => {
      router.back();
    });
    await fireEvent.press(screen.getByTestId('modes-friends-join'));
    expect(app.pathname()).toBe('/friends/join');
    expect(useGameStore.getState().online).toBeNull();
  });

  it('settings: Moshe’s name for the group [D80b], the ranked chip back, or no group at all (1.0.3’s screen)', async () => {
    FRIENDS_UI.groupName = 'moshe';
    await renderApp('/modes');
    expect(
      within(screen.getByTestId('modes-group-friends')).getByRole('header', {
        name: 'חברים אמיתיים בזמן אמת',
      }),
    ).toBeTruthy();

    FRIENDS_UI.modesGroup = false;
    FRIENDS_UI.rankedChip = true;
    await renderApp('/modes');
    expect(screen.queryByTestId('modes-group-friends')).toBeNull();
    expect(screen.getByText(i18n.t('home:modes.footnote'))).toBeOnTheScreen();
    expect(within(screen.getByTestId('mode-ranked2')).getByText('דירוג')).toBeTruthy();
    expect(screen.getByTestId('mode-ranked2')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 2 שחקנים, אחד על אחד · אותו לוח, דירוג',
    );
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/modes');
    const group = screen.getByTestId('modes-group-friends');
    expect(within(group).getByRole('header', { name: 'With friends' })).toBeTruthy();
    expect(within(group).getByText('Private room · up to 4 · unrated')).toBeTruthy();
    expect(screen.getByTestId('modes-friends-create')).toHaveProp('accessibilityLabel', 'Create room');
    expect(screen.getByTestId('modes-friends-join')).toHaveProp('accessibilityLabel', 'Join with code');
    expect(screen.getByTestId('mode-ranked2')).toHaveProp(
      'accessibilityLabel',
      'Ranked · 2 players, One on one · same board',
    );
  });
});

/**
 * Moshe's phone (layout.ts PHONE: Samsung S22, 360 × 780 dp) with 3-button navigation: the system bars around the
 * screen, which Jest can't see. The status bar is 24–32 dp (the camera's cut-out): the most of it. Gesture
 * navigation leaves about 30 dp more.
 */
const STATUS_BAR = 32;
const NAV_BAR_BUTTONS = 48;
/**
 * The six options (the sixth is "אימון בשלבים": Moshe's device test, 15.10.2026; D48) in their two groups, and
 * between them (1.0.4, D80a) the "עם חברים" group: its label and one row of two buttons.
 */
const GROUPS_TO_FIT = ['modes-group-ranked', 'modes-group-friends', 'modes-group-practice'] as const;

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const textStyleOf = (el: { props: { style?: unknown } }): TextStyle =>
  (StyleSheet.flatten(el.props.style as TextStyle) ?? {}) as TextStyle;

interface Node {
  props: { style?: unknown; testID?: string };
  parent: Node | null;
  children: readonly (Node | string)[];
}

/** A row's height as laid out: its line heights, chips, padding and border, or its minimum. */
function rowHeight(key: ModeKey): number {
  const card = screen.getByTestId(`mode-${key}`) as unknown as Node;
  const box = styleOf(card);
  const title = within(screen.getByTestId(`mode-${key}`)).getByText(
    i18n.t(`home:modes.${key}.title`),
  ) as unknown as Node;
  const texts = title.parent!;
  const [, tagline, chips] = texts.children as Node[];
  // A ranked row has no chips since 1.0.4 [D80a]: two lines.
  const chip = chips ? (chips.children as Node[])[0]! : null;
  const stack =
    num(textStyleOf(title).lineHeight) +
    num(textStyleOf(tagline!).lineHeight) +
    (chips && chip ? num(styleOf(chips).marginTop) + num(styleOf(chip).height) : 0) +
    (chips ? 2 : 1) * num(styleOf(texts).gap);
  return Math.max(num(box.minHeight), stack + 2 * (num(box.paddingVertical) + num(box.borderWidth)));
}

describe('the rows (Moshe’s device test, 15.10.2026)', () => {
  it('every option is a row of its own, ranked 3 and 4 too: the chevron, an 18 title, a one-line tagline', async () => {
    await renderApp('/modes');
    for (const key of KEYS) {
      const card = screen.getByTestId(`mode-${key}`);
      expect(card).toHaveStyle({ flexDirection: 'row' });
      expect((card as unknown as Node).parent?.props.testID).toBe(
        key.startsWith('ranked') ? 'modes-group-ranked' : 'modes-group-practice',
      );
      expect(within(card).getByTestId('icon-chevronForward', hidden)).toBeTruthy();
      expect(within(card).getByText(i18n.t(`home:modes.${key}.title`))).toHaveStyle({
        fontSize: tokens.type.sheetTitle.size,
        lineHeight: tokens.type.sheetTitle.lineHeight,
      });
      expect(within(card).getByText(taglineOf(key))).toHaveProp('numberOfLines', 1);
    }
    expect(directionProblems(screen.getByTestId('mode-ranked3'))).toEqual([]);
    expect(directionProblems(screen.getByTestId('mode-bot'))).toEqual([]);
  });

  it.each(['he', 'en'] as const)(
    'on Moshe’s phone, the six rows and the friends group fit without scrolling (%s)',
    async (lang) => {
      await i18n.changeLanguage(lang);
      await renderApp('/modes');
      const rows = Object.fromEntries(KEYS.map((k) => [k, rowHeight(k)]));
      // The header row (56), around "me" at its end.
      const header = num(styleOf((screen.getByTestId('modes-me') as unknown as Node).parent!).minHeight);
      const content = (StyleSheet.flatten(screen.getByTestId('modes-scroll').props.contentContainerStyle) ??
        {}) as ViewStyle;
      // Each group: its label, then its rows (or the friends' one row of buttons), the group's gap between.
      const groupHeight = (testID: string): number => {
        const group = screen.getByTestId(testID) as unknown as Node;
        const [label, ...items] = group.children as Node[];
        const heights = items.map((item) =>
          item.props.testID?.startsWith('mode-')
            ? rows[item.props.testID.slice('mode-'.length)]!
            : Math.max(...(item.children as Node[]).map((b) => num(styleOf(b).minHeight))),
        );
        return (
          num(styleOf(label!).minHeight) + heights.reduce((sum, h) => sum + num(styleOf(group).gap) + h, 0)
        );
      };
      const width = PHONE.width - 2 * num(content.paddingHorizontal);
      // The friends group takes the footnote's place [D80a].
      expect(screen.queryByText(i18n.t('home:modes.footnote'))).toBeNull();
      // No inset here; on the phone, the navigation bar's (NAV_BAR_BUTTONS) comes on top of it.
      expect(content.paddingBottom).toBe(tokens.space[8]);

      const groups = GROUPS_TO_FIT.map(groupHeight);
      const needed =
        num(content.paddingTop) +
        groups.reduce((a, b) => a + b, 0) +
        (GROUPS_TO_FIT.length - 1) * num(content.gap) +
        num(content.paddingBottom);
      const available = PHONE.height - STATUS_BAR - header - NAV_BAR_BUTTONS;
      // Ranked rows of two lines (64, the list row's minimum), the practices' 77, the friends' 72.
      expect({ ranked: rows.ranked2, practice: rows.solo, groups, needed }).toEqual({
        ranked: 64,
        practice: 77,
        groups: [236, 72, 275],
        needed: 639,
      });
      expect(needed).toBeLessThanOrEqual(available);

      // The friends buttons' words fit their half of the row on one line (estimated wide).
      const button = styleOf(screen.getByTestId('modes-friends-join'));
      const half =
        (width - num(styleOf(screen.getByTestId('modes-friends-join').parent!).gap)) / 2 -
        2 * num(button.paddingHorizontal) -
        2 * num(button.borderWidth);
      for (const key of ['create', 'join'])
        expect(textWidth(i18n.t(`home:modes.friends.${key}`), tokens.type.button.size)).toBeLessThanOrEqual(
          half,
        );

      // The texts fit their one line beside the picture and the chevron (estimated wide, as layout.ts does).
      const card = styleOf(screen.getByTestId('mode-ranked2'));
      const column =
        width -
        2 * num(card.borderWidth) -
        2 * num(card.paddingHorizontal) -
        size.avatar.card.frame -
        2 * num(card.gap) -
        size.icon.chevron;
      for (const key of KEYS) {
        const title = i18n.t(`home:modes.${key}.title`);
        expect(textWidth(title, tokens.type.sheetTitle.size, { bold: true })).toBeLessThanOrEqual(column);
        for (const tagline of new Set([taglineOf(key, true), taglineOf(key, false)])) {
          // Staged practice's English copy ("Short stages · up to 3 stars", since fill and puzzle stages
          // run up to 60 s, D68) is held to its real width in the app's font.
          const width =
            key === 'levels'
              ? measuredWidth(tagline, tokens.type.caption.fontFamily, tokens.type.caption.size)
              : textWidth(tagline, tokens.type.caption.size);
          expect(width).toBeLessThanOrEqual(column);
        }
      }
    },
  );

  it('the bot practice shows a robot in the opponent’s P2 frame; the solo practice my avatar in P1’s', async () => {
    await renderApp('/modes');
    const p2 = paletteAt(1).ring;
    const lead = within(screen.getByTestId('mode-bot')).getByTestId('mode-bot-lead', hidden);
    expect(lead).toHaveStyle({
      width: size.avatar.card.frame,
      height: size.avatar.card.frame,
      borderRadius: size.avatar.card.frameRadius,
      borderWidth: size.avatar.card.border,
      borderColor: p2,
    });
    // The redrawn robot, larger than the old 22 and in the same colour as its frame.
    const robot = within(lead).getByTestId('icon-bot', hidden);
    expect(robot).toHaveProp('width', 28);
    expect(robot).toHaveProp('stroke', p2);
    // Seen against its fill (WCAG 1.4.11: 3:1 for graphics); the robot's shape tells it apart without colour.
    expect(contrast(p2, color.surface2)).toBeGreaterThanOrEqual(3);
    // The same size as my avatar on the solo card, in my P1 frame.
    const mine = within(screen.getByTestId('mode-solo')).getByTestId('mode-solo-avatar', hidden);
    expect(styleOf(mine)).toMatchObject({ width: size.avatar.card.frame, height: size.avatar.card.frame });
    // Decorative: the card's label says what it is, unchanged.
    expect(screen.getByTestId('mode-bot')).toHaveProp(
      'accessibilityLabel',
      'אימון מול בוט, 5 רמות, ללא דירוג, עובד גם בלי אינטרנט',
    );
  });
});

describe('"סוג משחק" (spec §5.2)', () => {
  it('shows the three game types with their lock time, board and duration; normal by default', async () => {
    await renderApp('/game-type?mode=solo');
    expect(screen.getByRole('header', { name: 'סוג משחק' })).toBeTruthy();
    const group = screen.getByLabelText('סוג משחק', { exact: true });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.props.testID)).toEqual(['type-fast', 'type-normal', 'type-hard']);
    expect(radios.map((r) => r.props.accessibilityState.checked)).toEqual([false, true, false]);
    // The lock time comes from the rules (THINK_TIME_MS), never typed in the screen.
    for (const [type, ms] of Object.entries(THINK_TIME_MS))
      expect(screen.getByTestId(`type-${type}`)).toHaveTextContent(new RegExp(`${ms / 1000} ש׳`));
    expect(screen.getByTestId('type-fast')).toHaveProp(
      'accessibilityLabel',
      'מהיר. נפתר בבודד גלוי בלבד. זמן למשבצת 8 שניות, לוח קל, משך משוער 4 עד 6 דקות',
    );
    expect(screen.getByTestId('type-hard')).toHaveTextContent(/דורש זוגות או צמצומים/);
  });

  it('starts the chosen practice and the game screen takes its place', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-solo'));
    expect(app.pathname()).toBe('/game-type');

    await fireEvent.press(screen.getByRole('radio', { name: /^מהיר\./ }));
    expect(screen.getByTestId('type-fast')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('type-normal')).toHaveProp('accessibilityState', { checked: false });

    await fireEvent.press(screen.getByRole('button', { name: 'התחל אימון' }));
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    const session = useGameStore.getState().session!;
    expect(session).toMatchObject({ mode: 'solo', gameType: 'fast' });
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'solo', gameType: 'fast' });
    await session.flush();
    expect((await repo.getGame(session.id))?.gameType).toBe('fast');

    // The game replaced the game-type screen: back goes to the modes.
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/modes');
  });

  it('says so when the practice cannot start, and stays', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.mockImplementation(() => Promise.reject(new Error('disk full')));
    const app = await renderApp('/game-type?mode=solo&gameType=hard');
    await fireEvent.press(screen.getByTestId('start'));
    await waitFor(() =>
      expect(useToast.getState().current).toMatchObject({
        variant: 'error',
        message: 'לא הצלחנו להתחיל את המשחק. נסו שוב.',
      }),
    );
    expect(app.pathname()).toBe('/game-type');
    expect(screen.getByTestId('start')).toHaveProp('accessibilityState', { disabled: false, busy: false });
  });

  it('without a mode it is solo practice (the "משחק חדש" of the results names only the type)', async () => {
    await renderApp('/game-type?gameType=hard');
    expect(screen.getByText('אימון לבד')).toBeTruthy();
    expect(screen.getByTestId('type-hard')).toHaveProp('accessibilityState', { checked: true });
  });

  it('a mode it cannot start, or a ranked table there is none of, goes back to the modes', async () => {
    const app = await renderApp('/game-type?mode=ranked&gameType=fast&players=5');
    expect(app.pathname()).toBe('/modes');
    const other = await renderApp('/game-type?mode=online&gameType=fast');
    expect(other.pathname()).toBe('/modes');
  });

  it('for a bot practice, the button goes on to the bot selection with the chosen type; nothing starts yet', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-bot'));
    expect(app.searchParams()).toEqual({ mode: 'bot' });
    expect(screen.getByText(/בשלב הבא בוחרים יריב/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /^קשה\./ }));
    const next = screen.getByRole('button', { name: 'בחירת יריב' });
    expect(next).toHaveProp('accessibilityHint', 'בחירת בוט למשחק קשה');
    await fireEvent.press(next);
    expect(app.pathname()).toBe('/bot-select');
    expect(app.searchParams()).toEqual({ gameType: 'hard' });
    expect(useGameStore.getState().session).toBeNull();

    // Back: the game type of the bot practice again.
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'bot' });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/game-type?mode=solo&gameType=fast');
    expect(screen.getByRole('header', { name: 'Game type' })).toBeTruthy();
    expect(screen.getByText('Solo practice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeTruthy();
    expect(screen.getByTestId('type-fast')).toHaveProp(
      'accessibilityLabel',
      'Fast. Solved with naked singles only. 8 seconds per cell, Easy board, about 4 to 6 minutes',
    );
  });
});
