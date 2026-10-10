import { type CellIndex, cellName } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { answerIn, emptyCellsOf, PUZZLE } from '../../../game/testing/practice';
import { OnlineSession } from '../../../game/onlineSession';
import i18n from '../../../i18n';
import { FakeTable } from '../../../net/testing/fakeServer';
import { hidden, type Setup, setUp } from '../connection/testing/setup';
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

const cells = emptyCellsOf(PUZZLE);
const c0 = cells[0] as CellIndex;

let setup: Setup;
let game: Online | null = null;
let backs: jest.SpyInstance;

beforeEach(async () => {
  setup = await setUp('he');
  backs = jest.spyOn(BackHandler, 'addEventListener');
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

async function live(o: Parameters<typeof liveOnlineSession>[0] = {}) {
  game = await liveOnlineSession(o);
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

  it('my connection drops: the board locks with the attempt; back, it is synced and play goes on', async () => {
    const g = await live();
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
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
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
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
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
    const g = await live({ rules: { graceMs: 1000 }, options: { serverNoticeMs: 0, reconnectSlackMs: 0 } });
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
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה לבית' }));
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
