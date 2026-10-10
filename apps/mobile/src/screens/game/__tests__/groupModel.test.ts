import { type PlayerView } from '@sudoku-fight/engine';

import { cardModels, colorIndexFor } from '../../../components/player';
import { testHost } from '../../../game/testing/practice';
import { tokens } from '../../../theme';
import { compactAvatarCenterOf, compactScoreSlotOf } from '../geometry';
import { groupCardWidths, hudLayoutOf, opponentOf, opponentsOf, outOfGame, seatOrder } from '../model';
import { group, ME } from '../testing/group';

/** The pure parts of the 3–4 player screen (work plan stage 10; spec §6.6–§6.8, components.md §7). */

const ids = (players: PlayerView[]) => players.map((p) => p.id);

describe('which HUD, and in which order (spec §6.8)', () => {
  it('3 or 4 players get the group of compact cards', () => {
    const g3 = group();
    const g4 = group({ count: 4 });
    expect(hudLayoutOf(g3.host.getView())).toBe('group');
    expect(hudLayoutOf(g4.host.getView())).toBe('group');
    expect(hudLayoutOf(testHost().host.getView())).toBe('solo');
    g3.session.close();
    g4.session.close();
  });

  it('me first, then the others by seat, whatever seat I have; a spectator sees the seats as they are', () => {
    const g = group({ count: 4 });
    const view = g.host.getView();
    expect(ids(seatOrder(view))).toEqual([ME, 'bot-1', 'bot-2', 'bot-4']);
    expect(ids(opponentsOf(view))).toEqual(['bot-1', 'bot-2', 'bot-4']);
    expect(opponentOf(view)?.id).toBe('bot-1');
    // Me in seat 2: still first; the others keep their seat order (and P2–P4 in that order).
    const players = view.players.map((p, i) => ({ ...p, seat: [2, 0, 1, 3][i]! }));
    const mine = { ...view, players };
    expect(ids(seatOrder(mine))).toEqual([ME, 'bot-1', 'bot-2', 'bot-4']);
    const seats = players.map((p) => p.seat);
    expect(seatOrder(mine).map((p) => colorIndexFor(p.seat, 2, seats))).toEqual([0, 1, 2, 3]);
    expect(ids(seatOrder({ ...mine, me: null }))).toEqual(['bot-1', 'bot-2', ME, 'bot-4']);
    g.session.close();
  });

  it('the order never follows the places (targets never move)', () => {
    const g = group();
    const [a, b] = g.cells;
    g.as('bot-2').solve(a!);
    g.as('bot-2').solve(b!);
    const view = g.host.getView();
    expect(view.players.find((p) => p.id === 'bot-2')!.place).toBe(1);
    expect(ids(seatOrder(view))).toEqual([ME, 'bot-1', 'bot-2']);
    // The cards' own models agree: places on them, the seat order kept.
    expect(cardModels(view, 0, g.clock.now()).map((c) => [c.playerId, c.place])).toEqual([
      [ME, 2],
      ['bot-1', 2],
      ['bot-2', 1],
    ]);
    g.session.close();
  });
});

describe('the compact cards’ widths (components.md §7.1)', () => {
  it('fill the design’s 358-wide row: 3 × 114 (gap 8), and 106 + 3 × 78 (gap 6)', () => {
    expect(groupCardWidths(3, 358)).toEqual([114, 114, 114]);
    expect(groupCardWidths(4, 358)).toEqual([106, 78, 78, 78]);
  });

  it('a wider row keeps them; a narrower one shrinks them in proportion, never past the row', () => {
    expect(groupCardWidths(3, 398)).toEqual([114, 114, 114]);
    const narrow = groupCardWidths(4, 288);
    expect(narrow.reduce((a, w) => a + w, 0) + 3 * 6).toBeLessThanOrEqual(288);
    expect(narrow[0]! / narrow[1]!).toBeCloseTo(106 / 78, 1);
  });
});

describe('out of a game of 3–4 (spec §6.6, §6.7, D36)', () => {
  it('while I am in: nothing; once I surrender: out, with my fixed place; over: nothing', () => {
    const g = group({ count: 4 });
    expect(outOfGame(g.host.getView())).toBeNull();
    g.host.surrender();
    expect(outOfGame(g.host.getView())).toEqual({ how: 'surrendered', place: 4 });
    g.as('bot-1').surrender();
    // Still fourth: the first one out ranks last.
    expect(outOfGame(g.host.getView())).toEqual({ how: 'surrendered', place: 4 });
    g.as('bot-2').surrender();
    expect(g.host.getView().status).toBe('over');
    expect(outOfGame(g.host.getView())).toBeNull();
    g.session.close();
  });

  it('two players: a surrender ends the game, so there is never an "out" to show', () => {
    const { host } = testHost({ mode: 'ranked', players: [{ id: ME }, { id: 'opp' }] });
    host.surrender();
    expect(outOfGame(host.getView())).toBeNull();
    host.close();
  });
});

describe('where things land on a compact card (motion.md §6)', () => {
  it('the avatar at the top of the column; the score row under the name and the rating', () => {
    const rect = { x: 16, y: 58, width: 114, height: 160 };
    const avatar = compactAvatarCenterOf(rect);
    expect(avatar).toEqual({ x: 73, y: 58 + 7 + tokens.size.avatar.compact.frame / 2 });
    const slot = compactScoreSlotOf(rect);
    expect(slot.x).toBe(73);
    expect(slot.y).toBeGreaterThan(avatar.y);
    expect(slot.y).toBeLessThan(rect.y + rect.height / 2 + 20);
  });
});
