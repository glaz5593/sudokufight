import { type CellIndex, cellName } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import * as authStore from '../../../auth/authStore';
import { ltr } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { answerIn, emptyCellsOf, PUZZLE } from '../../../game/testing/practice';
import { OnlineSession } from '../../../game/onlineSession';
import i18n from '../../../i18n';
import { FakeTable } from '../../../net/testing/fakeServer';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { hidden, type Setup, setUp } from '../connection/testing/setup';
import { ONLINE_END_HOLD_MS, RESULTS_WATCHDOG_MS } from '../model';
import { OnlineGame } from '../online/OnlineGame';
import {
  CODE,
  liveOnlineSession,
  ME,
  OPP,
  type OnlineGame as Online,
  onlineSession,
  pass,
} from '../testing/online';

/**
 * The game screen online (work plan stage 7, spec §6.6, §16.2, §16.3, §18): the same GameScreen as a practice,
 * on an OnlineSession whose RemoteGameHost talks to a fake server built on the real engine. Before the game the
 * connection layer stands alone (connecting, the lobby, a refusal); in it the screen shows the host's pending
 * select, the server's clock, the connection screens over the game, the ranked surrender, and holds the results
 * while "the opponent left" is up.
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
jest.mock('../../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock; log: jest.Mock } }>(
    '../../../services/crashlytics',
  )
  .crashReporter();
const breadcrumbs = (): string[] => crash.log.mock.calls.map((c: unknown[]) => String(c[0]));

const cells = emptyCellsOf(PUZZLE);
const c0 = cells[0] as CellIndex;

let setup: Setup;
let game: Online | null = null;
let backs: jest.SpyInstance;

beforeEach(async () => {
  setup = await setUp('he');
  backs = jest.spyOn(BackHandler, 'addEventListener');
  crash.recordError.mockClear();
  crash.log.mockClear();
});

afterEach(() => {
  game?.session.close();
  game = null;
  backs.mockRestore();
  setup.restore();
});

/** Android back: the newest handler first, as React Native does, until one takes it. */
async function pressBack(): Promise<void> {
  const handlers = backs.mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler as () => boolean | null | undefined)
    .reverse();
  await act(async () => {
    for (const handler of handlers) if (handler()) return;
  });
}

interface Handlers {
  onEnded: jest.Mock;
  onHome: jest.Mock;
  onRetry: jest.Mock;
  onLeave: jest.Mock;
  onPractice: jest.Mock;
}

async function show(session: OnlineSession, devMetrics = false): Promise<Handlers> {
  const h: Handlers = {
    onEnded: jest.fn(),
    onHome: jest.fn(),
    onRetry: jest.fn(),
    onLeave: jest.fn(),
    onPractice: jest.fn(),
  };
  await render(<OnlineGame session={session} devMetrics={devMetrics} {...h} />);
  return h;
}

async function live(
  o: Parameters<typeof liveOnlineSession>[0] = {},
  profiles: Parameters<typeof liveOnlineSession>[1] = null,
) {
  game = await liveOnlineSession(o, profiles);
  const h = await show(game.session);
  return { ...game, ...h };
}

const cellButton = (cell: CellIndex) => screen.getByTestId(`cell-${cellName(cell)}`);

describe('before the game', () => {
  it('connecting, then the private room’s lobby with its code, then the game', async () => {
    game = onlineSession();
    const h = await show(game.session);
    expect(screen.getByTestId('connecting')).toBeOnTheScreen();

    await pass(game.table, 50);
    game.table.lobby();
    await pass(game.table, 50);
    expect(screen.getByTestId('lobby')).toBeOnTheScreen();
    expect(screen.getByTestId('lobby-code')).toHaveTextContent(CODE);
    await fireEvent.press(screen.getByTestId('lobby-leave'));
    expect(h.onLeave).toHaveBeenCalledTimes(1);
    // Android back in the lobby leaves the room too.
    await pressBack();
    expect(h.onLeave).toHaveBeenCalledTimes(2);

    game.table.startGame();
    await pass(game.table, 300);
    expect(screen.queryByTestId('lobby')).toBeNull();
    expect(screen.getByTestId('game')).toBeOnTheScreen();
    // No connection screen over a game that runs.
    expect(screen.queryByTestId('connection-error')).toBeNull();
    expect(screen.getByTestId('game-content', hidden)).toHaveProp('importantForAccessibility', 'auto');
  });

  it('a suspended account (spec §3.5): the room’s refusal explained, and the profile read again', async () => {
    const refresh = jest.spyOn(authStore, 'refreshMe').mockResolvedValue(undefined);
    try {
      const table = new FakeTable();
      table.refuseWith = 'suspended';
      const session = new OnlineSession({ host: table.host, request: { kind: 'join', code: CODE } });
      game = { table, session, tracked: [] };
      await show(session);
      await pass(table, 50);
      expect(screen.getByTestId('connection-error')).toBeOnTheScreen();
      expect(
        screen.getByText('החשבון שלך מושעה, ולכן אין משחקים מדורגים כרגע. אפשר עדיין להתאמן לבד או מול בוט.'),
      ).toBeOnTheScreen();
      expect(screen.getByText(/suspended-525/)).toBeOnTheScreen();
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      refresh.mockRestore();
    }
  });

  it('a code that is no room: the refusal explained, "נסה שוב", and back goes home', async () => {
    const table = new FakeTable();
    const session = new OnlineSession({ host: table.host, request: { kind: 'join', code: 'ZZZ999' } });
    game = { table, session, tracked: [] };
    const h = await show(session);
    await pass(table, 50);
    expect(screen.getByTestId('connection-error')).toBeOnTheScreen();
    expect(screen.getByText('אין חדר עם הקוד הזה. בדוק את הקוד ונסה שוב.')).toBeOnTheScreen();
    expect(screen.getByText(/notFound-522/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: /עבור לאימון/ }));
    expect(h.onPractice).toHaveBeenCalled();
    await pressBack();
    expect(h.onHome).toHaveBeenCalledTimes(1);
  });
});

describe('in the game', () => {
  it('a tap shows pending at once (the host’s), until the server’s lock arrives (spec §18)', async () => {
    const g = await live({ oneWayMs: 60 });
    await fireEvent.press(cellButton(c0));
    expect(g.table.room.actions.at(-1)).toMatchObject({ type: 'select', cell: c0 });
    expect(cellButton(c0)).toHaveAccessibleName(/ממתינה לאישור הנעילה/);
    await pass(g.table, 200);
    expect(cellButton(c0)).not.toHaveAccessibleName(/ממתינה לאישור הנעילה/);
    expect(screen.getByTestId('lock-strip-seconds', hidden)).toBeOnTheScreen();

    // A digit's result only comes from the server: until it answers the cell stays empty.
    await fireEvent.press(screen.getByTestId(`key-${answerIn(PUZZLE, c0)}`));
    expect(g.session.getView().grid[c0]).toBe(0);
    await pass(g.table, 200);
    expect(g.session.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
  });

  it('the timers run on the server’s clock (ping/pong), whatever the phone’s says', async () => {
    // The server's clock is an hour ahead of the phone's.
    const g = await live({ skewMs: 3_600_000 });
    expect(Math.abs(g.session.host.sync.offsetMs - 3_600_000)).toBeLessThan(5);
    await fireEvent.press(cellButton(c0));
    await pass(g.table, 100);
    // A fresh lock: 8 s (spec §6.2), not 8 s an hour away.
    expect(screen.getByTestId('lock-strip-seconds', hidden)).toHaveTextContent(/^8/);
    // 3.2 s later (the screen ticks every 250 ms): 4.7 s left, shown as 5.
    await pass(g.table, 3200);
    expect(screen.getByTestId('lock-strip-seconds', hidden)).toHaveTextContent(/^5/);
  });

  it('the opponent drops: the game freezes with "Reconnecting... 15"; back, play goes on', async () => {
    const g = await live();
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 100);
    expect(g.session.getView().status).toBe('paused');
    expect(screen.getByTestId('opponent-reconnecting-frozen', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 15',
    );
    expect(screen.getByTestId('game-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    // Frozen: Android back opens no surrender (the layer takes no input under it either).
    await pressBack();
    expect(screen.queryByTestId('ranked-surrender')).toBeNull();
    await pass(g.table, 3000);
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 12',
    );

    await act(async () => {
      g.table.game!.apply({ type: 'reconnect', playerId: OPP });
    });
    await pass(g.table, 600);
    expect(g.session.getView().status).toBe('running');
    expect(screen.queryByTestId('opponent-reconnecting')).toBeNull();
    expect(screen.getByTestId('game-content', hidden)).toHaveProp('importantForAccessibility', 'auto');
  });

  it('a match’s room (its players from "found"): the loading card with them, the tag, the percent and a tip', async () => {
    game = onlineSession(
      {},
      {
        [ME]: { avatarId: 'lava-lamp', country: 'IL', name: 'Moshe', rating: 1287, provisional: false },
        [OPP]: { avatarId: 'maya', country: 'DE', name: 'NinaVolt', rating: 1305, provisional: true },
      },
    );
    await show(game.session);
    expect(screen.getByTestId('connecting')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-tag')).toHaveTextContent('מדורג · מהיר');
    expect(screen.getByTestId(`connecting-player-${OPP}`)).toHaveTextContent('NinaVolt', { exact: false });
    expect(screen.getByTestId(`connecting-player-${OPP}-state`)).toHaveTextContent('מוכן!');
    expect(screen.getByTestId('connecting-tip')).toBeOnTheScreen();
    expect(screen.queryByTestId('connecting-tip')).not.toHaveTextContent('13.5', { exact: false });

    // Into the room and the game: the card goes, the board comes.
    await pass(game.table, 50);
    game.table.startGame();
    await pass(game.table, 300);
    expect(screen.queryByTestId('connecting')).toBeNull();
    expect(screen.getByTestId('game')).toBeOnTheScreen();
  });

  it('a room by code has no players to show while connecting: the steps alone', async () => {
    game = onlineSession();
    await show(game.session);
    expect(screen.getByTestId('connecting')).toBeOnTheScreen();
    expect(screen.queryByTestId('connecting-tag')).toBeNull();
    expect(screen.queryByTestId('connecting-tip')).toBeNull();
  });

  it('my connection drops: the board locks with the attempt; back, it is synced and play goes on', async () => {
    // The hard phase at once (no soft phase [D42]; the soft phase is below).
    const g = await live({ rules: { softGraceMs: 0 } });
    g.table.offline = true;
    await act(async () => {
      g.table.cutMe();
    });
    await pass(g.table, 100);
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent('החיבור שלך אבד');
    expect(screen.getByTestId('self-reconnecting-banner-attempt')).toHaveTextContent(/ניסיון\s*1/);
    // The first try failed (no network); the next one is "attempt 2" (spec §16.2).
    await pass(g.table, 300);
    expect(screen.getByTestId('self-reconnecting-banner-attempt')).toHaveTextContent(/ניסיון\s*2/);
    expect(screen.getByTestId('game-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    // A tap goes nowhere meanwhile (the host refuses it, and the layer takes the touches).
    await pass(g.table, 1000);

    g.table.offline = false;
    await pass(g.table, 1500);
    expect(g.session.online.status).toBe('live');
    expect(g.session.getView().status).toBe('running');
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent('חזרת למשחק');
    expect(screen.getByTestId('game-content', hidden)).toHaveProp('importantForAccessibility', 'auto');
    await pass(g.table, 3000);
    expect(screen.queryByTestId('self-reconnecting-banner')).toBeNull();
  });

  it('the opponent does not come back: "ניצחת בנטישה", and the results only on "לתוצאות"', async () => {
    const g = await live({ rules: { graceMs: 2000 } });
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 2500);
    expect(g.session.getView().result?.reason).toBe('lastPlayerStanding');
    expect(screen.getByTestId('opponent-left')).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-left-win')).toHaveTextContent('ניצחת בנטישה');
    await pass(g.table, 2000);
    expect(g.onEnded).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
    // From a timer of the screen, not inside the press (the end was seen long ago: no hold).
    await pass(g.table, 50);
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    // A private room has no profiles: no flag.
    expect(screen.queryByTestId('opponent-left-flag', hidden)).toBeNull();
  });

  it('the leaver’s flag on their avatar, from the match’s profiles (Opponent-Left)', async () => {
    const g = await live({ rules: { graceMs: 2000 } }, { [OPP]: { avatarId: 'maya', country: 'DE' } });
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 2500);
    const flag = screen.getByTestId('opponent-left-flag', hidden);
    expect(within(flag).getByText('🇩🇪', hidden)).toBeTruthy();
    // Decorative: the title says who left.
    expect(flag).toHaveProp('accessibilityElementsHidden', true);
  });

  it('surrender (spec §6.6): "ביטול" is the safe choice; "כן, להיכנע" loses at once', async () => {
    const g = await live();
    // Android back asks first, as the button does.
    await pressBack();
    expect(screen.getByTestId('ranked-surrender')).toBeOnTheScreen();
    await fireEvent.press(
      within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'ביטול' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    const dialog = screen.getByTestId('ranked-surrender');
    expect(within(dialog).getByText('אתה בטוח שאתה רוצה להיכנע?')).toBeOnTheScreen();
    expect(within(dialog).getByText('המשחק ייחשב כהפסד')).toBeOnTheScreen();
    await fireEvent.press(within(dialog).getByRole('button', { name: 'ביטול' }));
    expect(g.table.room.actions.some((a) => a.type === 'surrender')).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    await fireEvent.press(
      within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'כן, להיכנע' }),
    );
    expect(g.table.room.actions.at(-1)).toMatchObject({ type: 'surrender' });
    await pass(g.table, 200);
    expect(g.session.getView().result?.ranking.find((r) => r.playerId === ME)).toMatchObject({ place: 2 });
    // The final board holds (motion.md game.end), and the dialog has long left by then.
    expect(g.onEnded).not.toHaveBeenCalled();
    await pass(g.table, ONLINE_END_HOLD_MS);
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('opponent-left')).toBeNull();
    // Practice's "סיום אימון" dialog is not there.
    expect(screen.queryByTestId('end-practice')).toBeNull();
  });

  it('the surrender dialog closes when the game freezes, and does not come back by itself', async () => {
    const g = await live();
    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    expect(screen.getByTestId('ranked-surrender')).toBeOnTheScreen();
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 400);
    expect(screen.queryByTestId('ranked-surrender')).toBeNull();
    await act(async () => {
      g.table.game!.apply({ type: 'reconnect', playerId: OPP });
    });
    await pass(g.table, 600);
    expect(g.session.getView().status).toBe('running');
    expect(screen.queryByTestId('ranked-surrender')).toBeNull();
    expect(g.table.room.actions.some((a) => a.type === 'surrender')).toBe(false);
  });

  it('the connection can’t come back in time: the error screen, "נסה שוב", and back goes home', async () => {
    const g = await live({
      rules: { graceMs: 1000, softGraceMs: 0 },
      options: { serverNoticeMs: 0, reconnectSlackMs: 0 },
    });
    g.table.offline = true;
    await act(async () => {
      g.table.cutMe();
    });
    await pass(g.table, 2500);
    expect(g.session.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(screen.getByTestId('connection-error')).toBeOnTheScreen();
    expect(screen.getByText('החיבור לשרת המשחק אבד ולא הצלחנו לחזור אליו.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(g.onRetry).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(g.onHome).toHaveBeenCalledTimes(1);
    await pressBack();
    expect(g.onHome).toHaveBeenCalledTimes(2);
  });

  it('development builds: the network measures over the game, from the "ms" chip', async () => {
    game = await liveOnlineSession();
    await show(game.session, true);
    expect(screen.queryByTestId('net-metrics')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'מדדי רשת' }));
    expect(screen.getByTestId('net-metrics')).toBeOnTheScreen();
    expect(screen.getByTestId('net-metrics-rtt-values')).toHaveTextContent(/p95 \d+/);
    await fireEvent.press(screen.getByRole('button', { name: 'סגירת מדדי הרשת' }));
    expect(screen.queryByTestId('net-metrics')).toBeNull();
  });

  it('English: the same screens in the other direction', async () => {
    await i18n.changeLanguage('en');
    const g = await live();
    await fireEvent.press(screen.getByRole('button', { name: 'Surrender' }));
    expect(
      within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'Cancel' }),
    ).toBeOnTheScreen();
    await fireEvent.press(
      within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'Cancel' }),
    );
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 100);
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 15',
    );
    expect(screen.getByTestId('opponent-reconnecting-frozen', hidden)).toHaveTextContent(/frozen/i);
  });
});

/**
 * Moshe, after testing 1.0.0 (15.10.2026) [D42]: "לסמן על המשתמש שהוא בלי תקשורת ולהמשיך את המשחק כרגיל. רק
 * אחרי 10 שניות נניח, להציג את ההודעות של בעיית תקשורת. אם אחרי 8 שניות חוזרת התקשורת ומתברר ששניים סימנו את
 * אותה המשבצת, זה שהיה בלי תקשורת יפסיד אותה."
 */
describe('a lost connection: the soft phase first (D42)', () => {
  const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../services/feedback');
  const digit = answerIn(PUZZLE, c0);

  beforeEach(() => {
    useToast.getState().clear();
    feedback.cue.mockClear();
  });

  async function dropMine(g: Online) {
    g.table.offline = true;
    await act(async () => {
      g.table.cutMe();
    });
    await pass(g.table, 100);
  }

  it('my connection drops: nothing covers the game, a tap locks, a digit waits; back, it counts', async () => {
    const g = await live();
    await dropMine(g);
    expect(g.session.online.status).toBe('reconnecting');
    // No overlay, no banner, nothing blocked; screen readers hear it once.
    expect(screen.queryByTestId('self-reconnecting-banner')).toBeNull();
    expect(screen.getByTestId('game-content', hidden)).toHaveProp('importantForAccessibility', 'auto');
    expect(screen.getByTestId('self-offline-announcer', hidden)).toHaveTextContent(
      'אין חיבור. אפשר להמשיך לשחק, והמהלכים יישלחו כשהחיבור יחזור',
    );
    // My card is marked, and what needs the server waits for it: the surrender (back too).
    expect(screen.getByTestId('presence-unstable', hidden)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'כניעה' })).toBeDisabled();
    await pressBack();
    expect(screen.queryByTestId('ranked-surrender')).toBeNull();

    await fireEvent.press(cellButton(c0));
    await pass(g.table, 50);
    expect(screen.getByTestId('lock-strip-seconds', hidden)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId(`key-${digit}`));
    await pass(g.table, 50);
    expect(cellButton(c0)).toHaveAccessibleName(`${cellName(c0)}, ${digit}, ממתין לחיבור`);
    expect(screen.getByTestId('cell-queued-mark')).toBeOnTheScreen();
    expect(screen.getByTestId('game-live')).toHaveTextContent(`${ltr(cellName(c0))}: ${digit} ממתין לחיבור`, {
      exact: false,
    });
    expect(g.session.getView().grid[c0]).toBe(0);

    g.table.offline = false;
    await pass(g.table, 1500);
    expect(g.session.online.status).toBe('live');
    expect(g.session.getView().grid[c0]).toBe(digit);
    expect(cellButton(c0)).toHaveAccessibleName(/נפתרה על ידיך/);
    // A return inside the soft phase: no "back" banner either.
    expect(screen.queryByTestId('self-reconnecting-banner')).toBeNull();
    expect(screen.queryByTestId('presence-unstable', hidden)).toBeNull();
  });

  it('the opponent took my cell meanwhile: it shakes, a short warning, and no penalty', async () => {
    const g = await live();
    await dropMine(g);
    await fireEvent.press(cellButton(c0));
    await fireEvent.press(screen.getByTestId(`key-${digit}`));
    await act(async () => {
      g.table.opponent({ type: 'select', cell: c0 });
    });
    g.table.offline = false;
    await pass(g.table, 1500);
    expect(useToast.getState().current).toMatchObject({
      variant: 'warning',
      message: `${ltr(cellName(c0))} נתפסה בזמן שלא היה לך חיבור · בלי קנס`,
    });
    expect(feedback.cue).toHaveBeenCalledWith('cellDenied');
    expect(g.session.getView().players.find((p) => p.id === ME)).toMatchObject({ score: 0, mistakes: 0 });
    expect(cellButton(c0)).toHaveAccessibleName(/נעולה על ידי Rival/);
  });

  it('not back by the end of the soft phase: Self-Reconnecting, the board locked', async () => {
    const g = await live();
    await dropMine(g);
    await fireEvent.press(cellButton(c0));
    await pass(g.table, 9500);
    expect(screen.queryByTestId('self-reconnecting-banner')).toBeNull();
    await pass(g.table, 600);
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent('החיבור שלך אבד');
    expect(screen.getByTestId('game-content', hidden)).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    // The lock held here ran out with the soft phase.
    expect(g.session.getView().players.find((p) => p.id === ME)?.lock).toBeNull();
  }, 30_000);

  it('the opponent’s connection drops: only the mark on their card, the game goes on; after it, the freeze', async () => {
    const g = await live();
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP, soft: true });
    });
    await pass(g.table, 100);
    expect(g.session.getView().status).toBe('running');
    expect(screen.queryByTestId('opponent-reconnecting')).toBeNull();
    expect(screen.getByTestId('unstable-pill', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('interfere')).toBeNull();
    expect(screen.getByTestId('game-content', hidden)).toHaveProp('importantForAccessibility', 'auto');
    // I play on meanwhile.
    await fireEvent.press(cellButton(c0));
    await pass(g.table, 100);
    expect(screen.getByTestId('lock-strip-seconds', hidden)).toBeOnTheScreen();

    await pass(g.table, 10_000);
    expect(g.session.getView().status).toBe('paused');
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 15',
    );
  }, 30_000);
});

/**
 * Moshe's device test of 1.0.0 (15.10.2026): "הוא סיים את המשחק באמצע, קיבלתי מסך שחור. לפעמים גם קיבלתי מסך
 * שחור כשאני פרשתי". An online end that is not a full board holds its final board (motion.md `game.end`), opens
 * the results from a timer (never inside the server's message), only once every native window has gone, and is
 * watched should they not come.
 */
describe('the end of an online game (no black screen)', () => {
  /** Moves on until `ok`, a little at a time. */
  async function passUntil(table: FakeTable, ok: () => boolean, max = 5000) {
    for (let done = 0; done < max && !ok(); done += 50) await pass(table, 50);
    expect(ok()).toBe(true);
  }

  it('the opponent gives up while I hold a lock: the board holds, its ring fades, then the results once', async () => {
    const g = await live();
    await fireEvent.press(cellButton(c0));
    await pass(g.table, 100);
    expect(g.session.getView().players.find((p) => p.id === ME)?.lock?.cell).toBe(c0);
    expect(screen.getByTestId(`cell-${cellName(c0)}-face`)).toContainElement(screen.getByTestId('cell-ring'));

    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, 100);
    // Over (the events and the solution are in), and the final board still on the screen.
    expect(g.session.getView().status).toBe('over');
    expect(g.session.host.solution).not.toBeNull();
    expect(g.onEnded).not.toHaveBeenCalled();
    expect(screen.getByTestId('game')).toBeOnTheScreen();
    // My lock went with the end: its ring fades from the cell (no layout animation), then it is gone.
    expect(screen.queryByTestId('cell-ring')).toBeNull();
    expect(screen.getByTestId('cell-ring-leaving')).toBeOnTheScreen();
    await pass(g.table, motion.duration.lockAutoRelease + 150);
    expect(screen.queryByTestId('cell-ring-leaving')).toBeNull();
    expect(g.onEnded).not.toHaveBeenCalled();

    await pass(g.table, ONLINE_END_HOLD_MS - motion.duration.lockAutoRelease - 150);
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    await pass(g.table, 1000);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(crash.recordError).not.toHaveBeenCalled();
    expect(breadcrumbs()).toEqual(
      expect.arrayContaining([
        'game: game over (lastPlayerStanding) locks=1 modal=false hit=false',
        `game: results in ${ONLINE_END_HOLD_MS} ms`,
        'game: opening the results',
      ]),
    );
  });

  it('with reduced motion the hold is the 200 ms fade', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await live();
    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, 100);
    expect(g.session.getView().status).toBe('over');
    expect(g.onEnded).not.toHaveBeenCalled();
    await pass(g.table, motion.duration.reducedFade);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
  });

  it('an end that comes in a return’s snapshot (I was away when the opponent gave up) holds the same', async () => {
    const g = await live();
    g.table.offline = true;
    await act(async () => {
      g.table.cutMe();
    });
    await pass(g.table, 200);
    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    expect(g.table.game!.state.status).toBe('over');
    expect(g.session.getView().status).not.toBe('over');
    g.table.offline = false;
    await passUntil(g.table, () => g.session.getView().status === 'over');
    expect(g.onEnded).not.toHaveBeenCalled();
    await pass(g.table, ONLINE_END_HOLD_MS + 100);
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('connection-error')).toBeNull();
    expect(breadcrumbs()).toContain('game: game over on arrival (lastPlayerStanding)');
  });

  it('the report sheet is open when the opponent gives up: it closes, and the results come once it has gone', async () => {
    const g = await live();
    const sheetAtResults: boolean[] = [];
    g.onEnded.mockImplementation(() => sheetAtResults.push(screen.queryByTestId('report-sheet') !== null));
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByTestId('card-menu-report'));
    await pass(g.table, motion.duration.sheetIn + 50);
    expect(screen.getByTestId('report-sheet')).toBeOnTheScreen();

    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, 100);
    expect(g.session.getView().status).toBe('over');
    await pass(g.table, motion.duration.sheetOut + 100);
    expect(screen.queryByTestId('report-sheet')).toBeNull();
    await pass(g.table, ONLINE_END_HOLD_MS);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(sheetAtResults).toEqual([false]);
    expect(breadcrumbs()).toContain('game: game over (lastPlayerStanding) locks=0 modal=true hit=false');
  });

  it('the block dialog is open when the opponent gives up: the same', async () => {
    const g = await live();
    const dialogAtResults: boolean[] = [];
    g.onEnded.mockImplementation(() => dialogAtResults.push(screen.queryByTestId('block-confirm') !== null));
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByTestId('card-menu-block'));
    await pass(g.table, motion.duration.sheetIn + 50);
    expect(screen.getByTestId('block-confirm')).toBeOnTheScreen();

    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, ONLINE_END_HOLD_MS + 200);
    expect(screen.queryByTestId('block-confirm')).toBeNull();
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(dialogAtResults).toEqual([false]);
  });

  it('the card menu is open when the opponent gives up: it closes, and no report or block opens during the hold', async () => {
    const g = await live();
    const windowAtResults: boolean[] = [];
    g.onEnded.mockImplementation(() =>
      windowAtResults.push(
        screen.queryByTestId('report-sheet') !== null || screen.queryByTestId('block-confirm') !== null,
      ),
    );
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    expect(screen.getByTestId('card-menu-report')).toBeOnTheScreen();

    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, 300);
    expect(g.session.getView().status).toBe('over');
    expect(g.onEnded).not.toHaveBeenCalled(); // the hold
    // The menu went with the end; opened again, it has nothing that opens a native window.
    expect(screen.queryByTestId('card-menu-report')).toBeNull();
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    expect(screen.queryByTestId('card-menu-report')).toBeNull();
    expect(screen.queryByTestId('card-menu-block')).toBeNull();
    await pass(g.table, ONLINE_END_HOLD_MS);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(windowAtResults).toEqual([false]);
  });

  it('my connection drops in a game frozen for the opponent: the freeze stays, and my surrender is off', async () => {
    const g = await live();
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 100);
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'כניעה', ...hidden })).toBeEnabled();

    g.table.offline = true;
    await act(async () => {
      g.table.cutMe();
    });
    await pass(g.table, 100);
    expect(g.session.online.status).toBe('reconnecting');
    // Nothing is played here in a frozen game: no soft-phase mark that would lift the freeze.
    expect(g.session.online.offlinePlay).toMatchObject({ playable: false });
    expect(screen.queryByTestId('self-offline-announcer', hidden)).toBeNull();
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toBeOnTheScreen();
    // My card sits above the freeze: its surrender would be refused without a word, so it is off.
    expect(screen.getByRole('button', { name: 'כניעה', ...hidden })).toBeDisabled();
  });

  it('the game freezes while the report sheet is open: the sheet closes (nothing covers the freeze)', async () => {
    const g = await live();
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByTestId('card-menu-report'));
    await pass(g.table, motion.duration.sheetIn + 50);
    expect(screen.getByTestId('report-sheet')).toBeOnTheScreen();
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: OPP });
    });
    await pass(g.table, 400);
    expect(screen.queryByTestId('report-sheet')).toBeNull();
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toBeOnTheScreen();
  });

  it('results that never replace the game: "לתוצאות" and "לבית" after the watchdog, and a report', async () => {
    const g = await live();
    await act(async () => {
      g.table.opponent({ type: 'surrender' });
    });
    await pass(g.table, ONLINE_END_HOLD_MS + 100);
    expect(g.onEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('results-fallback')).toBeNull();
    await pass(g.table, RESULTS_WATCHDOG_MS);
    expect(screen.getByTestId('results-fallback')).toBeOnTheScreen();
    expect(crash.recordError).toHaveBeenCalledWith(
      new Error('the results did not replace the game'),
      'game: results watchdog',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(g.onHome).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
    expect(g.onEnded).toHaveBeenCalledTimes(2);
  });
});

describe('[D65] the background freeze is for local games only', () => {
  it('an online game never freezes for the app’s background, and never shows the 3, 2, 1', async () => {
    const listeners = new Set<(state: string) => void>();
    const appState = {
      addEventListener: (_type: 'change', listener: (state: string) => void) => {
        listeners.add(listener);
        return { remove: () => listeners.delete(listener) };
      },
    };
    const g = await live({ appState });
    await act(async () => listeners.forEach((l) => l('background')));
    await pass(g.table, 500);
    expect(screen.queryByTestId('resume-countdown', hidden)).toBeNull();
    expect(g.session.getView()).not.toHaveProperty('pausedBy');
    await act(async () => listeners.forEach((l) => l('active')));
    for (let k = 0; k < 4; k++) {
      await pass(g.table, 1000);
      expect(screen.queryByTestId('resume-countdown', hidden)).toBeNull();
    }
    expect(g.session.getView()).not.toHaveProperty('pausedBy');
  });
});
