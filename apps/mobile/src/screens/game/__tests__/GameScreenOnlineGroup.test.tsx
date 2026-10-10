import { type CellIndex, cellName, type PlayerId } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { emptyCellsOf, PUZZLE } from '../../../game/testing/practice';
import type { OnlineSession } from '../../../game/onlineSession';
import { hidden, type Setup, setUp, wait } from '../connection/testing/setup';
import { OnlineGame } from '../online/OnlineGame';
import { liveOnlineSession, ME, OPP, type OnlineGame as Online, pass } from '../testing/online';

/**
 * A game of 4 online (work plan stage 10, "סיום": four players, full ranking): the same GameScreen on an
 * OnlineSession whose RemoteGameHost talks to the fake server (the real engine at the server's time). The
 * others' moves are the server's; mine go through the host. A 3–4 player game never freezes for a drop (D4):
 * the card shows the reconnect pill, and a player who does not come back is out by the end of the grace.
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

const NINA = 'p3';
const AIKO = 'p4';
const PLAYERS = [
  { id: ME, name: 'Moshe' },
  { id: OPP, name: 'Rival' },
  { id: NINA, name: 'NinaVolt' },
  { id: AIKO, name: 'Aiko_M' },
];
const GRACE_MS = 2000;
const cells = emptyCellsOf(PUZZLE);

let setup: Setup;
let game: Online | null = null;

beforeEach(async () => {
  setup = await setUp('he');
});

afterEach(() => {
  game?.session.close();
  game = null;
  setup.restore();
});

async function live() {
  game = await liveOnlineSession({ players: PLAYERS, rules: { graceMs: GRACE_MS } });
  const h = { onEnded: jest.fn(), onHome: jest.fn(), onRetry: jest.fn(), onLeave: jest.fn() };
  await render(<OnlineGame session={game.session as OnlineSession} {...h} />);
  return { ...game, ...h };
}

/** Someone else acts at the server; the events reach the phone after the network's delay. */
async function serverAct(
  g: Online,
  id: PlayerId,
  action: Parameters<NonNullable<Online['table']['game']>['act']>[1],
) {
  await act(async () => {
    const { rejected } = g.table.game!.act(id, action);
    if (rejected) throw new Error(`${id}'s ${action.type} was refused: ${rejected}`);
  });
  await pass(g.table, 100);
}

const card = (id: PlayerId) => screen.getByTestId(id === ME ? 'card-me' : `card-${id}`, hidden);
const rankOf = (id: PlayerId) => within(card(id)).getByText(/^#\d$/, hidden).props.children as string;
const summaryOf = (id: PlayerId) =>
  screen.getByTestId(id === ME ? 'card-me-summary' : `card-${id}-summary`, hidden).props
    .accessibilityLabel as string;

describe('a game of 4 on the server', () => {
  it('compact cards in seat order; others’ locks; out by surrender and by the grace; my surrender; the end', async () => {
    const g = await live();
    const row = screen.getByTestId('group-hud');
    expect(row.children.map((c) => (c as unknown as { props: { testID?: string } }).props.testID)).toEqual([
      'group-hud-mine',
      `group-hud-${OPP}`,
      `group-hud-${NINA}`,
      `group-hud-${AIKO}`,
    ]);
    expect(summaryOf(NINA)).toMatch(/^NinaVolt · מקום 1 · 0 נקודות · חושב/);

    // NinaVolt takes a cell: her lock on my board, in her colour's shape and her name.
    const c0 = cells[0] as CellIndex;
    await serverAct(g, NINA, { type: 'select', cell: c0 });
    expect(screen.getByTestId(`cell-${cellName(c0)}`)).toHaveProp(
      'accessibilityLabel',
      `${cellName(c0)}, ריקה, נעולה על ידי NinaVolt, 8 שניות`,
    );
    expect(summaryOf(NINA)).toContain(`בוחר ${cellName(c0)}`);

    // Aiko surrenders (D36): out, last, no ⚡; the game goes on.
    await serverAct(g, AIKO, { type: 'surrender' });
    expect(g.session.getView().status).toBe('running');
    expect(rankOf(AIKO)).toBe('#4');
    expect(summaryOf(AIKO)).toMatch(/^Aiko_M · מקום 4 · .* · נכנע/);
    expect(screen.queryByRole('button', { name: /^הפרעה ל־Aiko_M/ })).toBeNull();
    // NinaVolt drops, three still in: a game of 3–4 does not freeze (D4); her card waits for her with the pill
    // and her lock is let go (spec §16.2).
    await act(async () => {
      g.table.game!.apply({ type: 'disconnect', playerId: NINA });
    });
    await pass(g.table, 100);
    expect(g.session.getView().status).toBe('running');
    expect(screen.queryByTestId('opponent-reconnecting')).toBeNull();
    expect(within(card(NINA)).getByTestId('reconnect-pill', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId(`cell-${cellName(c0)}`)).toHaveProp(
      'accessibilityLabel',
      expect.not.stringContaining('NinaVolt'),
    );

    // I surrender meanwhile: "תצא מהמשחק"; out third (Aiko went first), and I stay to watch, or go home.
    await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
    await fireEvent.press(
      within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'כן, להיכנע' }),
    );
    expect(g.table.room.actions.at(-1)).toMatchObject({ type: 'surrender' });
    await pass(g.table, 200);
    expect(screen.getByTestId('out-strip')).toHaveTextContent(/נכנעת · מקום 3/);
    expect(rankOf(ME)).toBe('#3');
    expect(rankOf(AIKO)).toBe('#4');
    expect(g.onEnded).not.toHaveBeenCalled();
    // Two are still in, one away: the game froze for them (D4), but nobody wins by me: no freeze screen.
    expect(g.session.getView().status).toBe('paused');
    expect(screen.queryByTestId('opponent-reconnecting')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(g.onHome).toHaveBeenCalledTimes(1);

    // She is not back by the end of the grace: out, and Rival, the last one in, wins.
    await pass(g.table, GRACE_MS + 200);
    await wait(100);
    const view = g.session.getView();
    expect(view.status).toBe('over');
    expect(view.result!.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      [OPP, 1, 'active'],
      [NINA, 2, 'abandoned'],
      [ME, 3, 'surrendered'],
      [AIKO, 4, 'surrendered'],
    ]);
    expect(g.onEnded).toHaveBeenCalledWith('online-1');
  });
});
