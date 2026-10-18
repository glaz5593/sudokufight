import {
  type Action,
  applyAction,
  type CellIndex,
  createGame,
  type GameEvent,
  type GameState,
} from '@sudoku-fight/engine';

import { answerIn, emptyCellsOf, PUZZLE, wrongIn } from '../../game/testing/practice';
import { OfflinePlayBook } from '../offlinePlay';
import { ME, OPP, rankedConfig } from '../testing/fakeServer';

/**
 * The play offline as RemoteGameHost keeps it [D42]: the local lock, the queue and its messages, on the
 * engine's helpers. Times are the server's clock.
 */

const T0 = 1_000_000;
const SOFT_ENDS = T0 + 10_000;
const [c0, c1, c2] = emptyCellsOf(PUZZLE) as [CellIndex, CellIndex, CellIndex];

/** A running ranked game of two at T0, moved on by `actions` (each at its own time). */
function game(...actions: [Action, number][]): GameState {
  let state = createGame(rankedConfig(), T0 - 1000).state;
  state = applyAction(state, { type: 'start' }, T0 - 1000).state;
  for (const [action, at] of actions) {
    const r = applyAction(state, action, at);
    if (r.rejected) throw new Error(`${action.type}: ${r.rejected}`);
    state = r.state;
  }
  return state;
}

const THINK = rankedConfig().rules.thinkTimeMs;

describe('OfflinePlayBook (D42)', () => {
  it('is off until the connection is lost: nothing is played, the state is drawn as it is', () => {
    const book = new OfflinePlayBook();
    const state = game();
    expect(book.active).toBe(false);
    expect(book.select(state, ME, c0, T0)).toBe('disconnected');
    expect(book.place(state, ME, c0, 1, T0)).toBe('disconnected');
    expect(book.release(T0)).toBe('disconnected');
    expect(book.overlay(state, ME, T0)).toBe(state);
    expect(book.nextWake(state, ME, T0)).toBeNull();
  });

  it('the local lock: taken, drawn with its countdown and the mark, let go of, and run out', () => {
    const book = new OfflinePlayBook();
    const state = game();
    book.start(T0, SOFT_ENDS, null);
    expect(book).toMatchObject({ active: true, since: T0, softEndsAt: SOFT_ENDS });
    expect(book.release(T0)).toBe('noLock');
    expect(book.select(state, ME, c0, T0 + 100)).toBeNull();
    expect(book.lockCell).toBe(c0);
    const shown = book.overlay(state, ME, T0 + 200);
    expect(shown.locks).toEqual([
      { playerId: ME, cell: c0, lockedAt: T0 + 100, expiresAt: T0 + 100 + THINK, remainingMs: THINK },
    ]);
    expect(shown.players.find((p) => p.id === ME)?.softEndsAt).toBe(SOFT_ENDS);
    expect(state.locks).toEqual([]); // pure: the state itself is untouched
    expect(book.nextWake(state, ME, T0 + 200)).toBe(T0 + 100 + THINK);
    // Its time runs out: gone here too.
    expect(book.expire(T0 + 100 + THINK - 1)).toBe(false);
    expect(book.expire(T0 + 100 + THINK)).toBe(true);
    expect(book.overlay(state, ME, T0 + 100 + THINK).locks).toEqual([]);
    // Taken again, and let go of.
    expect(book.select(state, ME, c1, T0 + 9000)).toBeNull();
    expect(book.release(T0 + 9100)).toBeNull();
    expect(book.lockCell).toBeNull();
    expect(book.nextWake(state, ME, T0 + 9100)).toBe(SOFT_ENDS);
  });

  it("the engine's refusals: another player's lock, a filled cell, my re-lock wait", () => {
    const state = game(
      [{ type: 'select', playerId: OPP, cell: c1 }, T0 - 500],
      [{ type: 'select', playerId: ME, cell: c2 }, T0 - 400],
      [{ type: 'release', playerId: ME }, T0 - 300],
    );
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    expect(book.select(state, ME, c1, T0)).toBe('cellTaken');
    expect(book.select(state, ME, c2, T0)).toBe('cooldown');
    const given = [...PUZZLE.givens].findIndex((d) => d !== '0') as CellIndex;
    expect(book.select(state, ME, given, T0)).toBe('cellFilled');
    // The opponent's lock ran out by now (offline nobody knows how): the cell is free here.
    const freeAt = state.locks.find((l) => l.playerId === OPP)!.expiresAt!;
    expect(book.nextWake(state, ME, T0)).toBe(freeAt);
    expect(book.select(state, ME, c1, freeAt)).toBeNull();
  });

  it('digits join the queue in order, with their think time; each releases the lock', () => {
    const state = game();
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    expect(book.place(state, ME, c0, answerIn(PUZZLE, c0), T0)).toBe('noLock');
    book.select(state, ME, c0, T0 + 1000);
    expect(book.place(state, ME, c1, 1, T0 + 1500)).toBe('notLockedCell');
    expect(book.place(state, ME, c0, answerIn(PUZZLE, c0), T0 + 3400)).toBeNull();
    expect(book.lockCell).toBeNull();
    book.select(state, ME, c1, T0 + 4000);
    expect(book.place(state, ME, c1, wrongIn(PUZZLE, c1), T0 + 4000)).toBeNull();
    expect(book.queued).toEqual([
      { cell: c0, digit: answerIn(PUZZLE, c0) },
      { cell: c1, digit: wrongIn(PUZZLE, c1) },
    ]);
    // A queued cell is no longer free here.
    expect(book.select(state, ME, c0, T0 + 5000)).toBe('cellFilled');
    // To send: in order, think times from their locks.
    expect(book.entriesToSend(state, ME)).toEqual([
      { cell: c0, digit: answerIn(PUZZLE, c0), thinkMs: 2400, clientSeq: null, sentAt: null },
      { cell: c1, digit: wrongIn(PUZZLE, c1), thinkMs: 0, clientSeq: null, sentAt: null },
    ]);
  });

  it('the soft phase over: nothing more is played here, the lock goes, the queue stays', () => {
    const state = game();
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    book.select(state, ME, c0, T0);
    book.place(state, ME, c0, answerIn(PUZZLE, c0), T0 + 500);
    book.select(state, ME, c1, SOFT_ENDS - 100);
    expect(book.overlay(state, ME, SOFT_ENDS).locks).toEqual([]);
    expect(book.expire(SOFT_ENDS)).toBe(true);
    expect(book.select(state, ME, c2, SOFT_ENDS)).toBe('disconnected');
    expect(book.size).toBe(1);
    expect(book.nextWake(state, ME, SOFT_ENDS)).toBeNull();
  });

  it('the server lock of the moment is carried in; at the return a lock without a digit is handed back', () => {
    const state = game([{ type: 'select', playerId: ME, cell: c0 }, T0 - 2000]);
    const mine = state.locks[0]!;
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, { cell: c0, lockedAt: mine.lockedAt, expiresAt: mine.expiresAt! });
    expect(book.overlay(state, ME, T0).locks).toMatchObject([{ playerId: ME, cell: c0 }]);
    expect(book.end(T0 + 1000)).toEqual({ held: c0, letGo: [] });
    expect(book.active).toBe(false);
    // Run out by then: nothing to take again, and nothing to let go of (its time ran out, nobody cancelled it).
    book.start(T0, SOFT_ENDS, { cell: c0, lockedAt: mine.lockedAt, expiresAt: mine.expiresAt! });
    expect(book.end(mine.expiresAt!)).toEqual({ held: null, letGo: [] });
  });

  it('a carried lock let go of here (cancelled, or another cell selected) is handed back to be released', () => {
    const state = game([{ type: 'select', playerId: ME, cell: c0 }, T0 - 2000]);
    const mine = state.locks[0]!;
    const carried = { cell: c0, lockedAt: mine.lockedAt, expiresAt: mine.expiresAt! };
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, carried);
    expect(book.release(T0 + 100)).toBeNull();
    expect(book.end(T0 + 200)).toEqual({ held: null, letGo: [c0] });

    // Moved to another cell: that one is held, the carried one let go.
    book.start(T0, SOFT_ENDS, carried);
    expect(book.select(state, ME, c1, T0 + 100)).toBeNull();
    expect(book.end(T0 + 200)).toEqual({ held: c1, letGo: [c0] });

    // Back to it in the end: held, nothing to let go.
    book.start(T0, SOFT_ENDS, carried);
    book.select(state, ME, c1, T0 + 100);
    expect(book.select(state, ME, c0, T0 + 1500)).toBeNull(); // no re-lock wait here: never let go at the server
    expect(book.end(T0 + 1600)).toEqual({ held: c0, letGo: [c1] });

    // A new loss starts afresh; so does the end of the game.
    book.start(T0, SOFT_ENDS, carried);
    book.release(T0 + 100);
    book.start(T0 + 5000, SOFT_ENDS + 5000, null);
    expect(book.end(T0 + 5100)).toEqual({ held: null, letGo: [] });
  });

  it('messages: sent, answered, refused; a new loss puts the unanswered back to be sent', () => {
    const state = game();
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    for (const [cell, at] of [
      [c0, T0],
      [c1, T0 + 100],
      [c2, T0 + 200],
    ] as const) {
      book.select(state, ME, cell, at);
      book.place(state, ME, cell, answerIn(PUZZLE, cell), at + 50);
    }
    book.end(T0 + 1000);
    expect(book.oldestSentAt).toBeNull();
    const [e0, e1, e2] = book.entriesToSend(state, ME);
    book.markSent(e0!, 11, 500);
    book.markSent(e1!, 12, 500);
    book.markSent(e2!, 13, 600);
    expect(book.entriesToSend(state, ME)).toEqual([]);
    expect(book.oldestSentAt).toBe(500);
    // c0's answer: placedCorrect with `offline`, by me.
    const correct = (cell: CellIndex, playerId = ME, offline = true): GameEvent =>
      ({
        type: 'placedCorrect',
        playerId,
        cell,
        ...(offline ? { offline: true } : {}),
        seq: 1,
        t: T0,
      }) as unknown as GameEvent;
    expect(book.answered(correct(c0, OPP), ME)).toBe(false);
    expect(book.answered(correct(c0, ME, false), ME)).toBe(false);
    expect(book.answered(correct(c0), ME)).toBe(true);
    // c1 refused: lost.
    expect(book.rejected(99)).toBeNull();
    expect(book.rejected(12)).toMatchObject({ cell: c1 });
    expect(book.queued).toEqual([{ cell: c2, digit: answerIn(PUZZLE, c2) }]);
    expect(book.oldestSentAt).toBe(600);
    // The connection goes before c2's answer: it goes out again after the next return.
    book.resetUnanswered();
    expect(book.entriesToSend(state, ME)).toEqual([
      { cell: c2, digit: answerIn(PUZZLE, c2), thinkMs: 50, clientSeq: null, sentAt: null },
    ]);
    expect(book.oldestSentAt).toBeNull();
  });

  it('a sent move with no answer for a while goes out again (the server dropped it): none stays waiting for good', () => {
    const state = game();
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    for (const cell of [c0, c1]) {
      book.select(state, ME, cell, T0);
      book.place(state, ME, cell, answerIn(PUZZLE, cell), T0 + 10);
    }
    book.end(T0 + 100);
    const [e0, e1] = book.entriesToSend(state, ME);
    book.markSent(e0!, 21, 1000);
    book.markSent(e1!, 22, 2000);
    expect(book.resetSentBy(999)).toBe(0);
    expect(book.resetSentBy(1500)).toBe(1);
    expect(book.entriesToSend(state, ME).map((e) => e.cell)).toEqual([c0]);
    expect(book.oldestSentAt).toBe(2000);
    // Its old message is no longer its own: a late refusal of it loses nothing.
    expect(book.rejected(21)).toBeNull();
    expect(book.size).toBe(2);
  });

  it('the snapshot settles a move whose answer was lost: dropped, never sent twice; a cell filled by another stays (the server refuses it)', () => {
    const book = new OfflinePlayBook();
    book.start(T0, SOFT_ENDS, null);
    const before = game();
    for (const cell of [c0, c1, c2]) {
      book.select(before, ME, cell, T0);
      book.place(before, ME, cell, cell === c1 ? wrongIn(PUZZLE, c1) : answerIn(PUZZLE, cell), T0);
    }
    book.end(T0 + 500);
    // At the server meanwhile: my c0 and my wrong c1 counted; the opponent solved c2.
    const after = game(
      [{ type: 'select', playerId: ME, cell: c0 }, T0 + 100],
      [{ type: 'place', playerId: ME, cell: c0, digit: answerIn(PUZZLE, c0) }, T0 + 200],
      [{ type: 'select', playerId: ME, cell: c1 }, T0 + 2000],
      [{ type: 'place', playerId: ME, cell: c1, digit: wrongIn(PUZZLE, c1) }, T0 + 2100],
      [{ type: 'select', playerId: OPP, cell: c2 }, T0 + 2200],
      [{ type: 'place', playerId: OPP, cell: c2, digit: answerIn(PUZZLE, c2) }, T0 + 2300],
    );
    expect(book.entriesToSend(after, ME).map((e) => e.cell)).toEqual([c2]);
    expect(book.size).toBe(1);
    book.clear();
    expect(book).toMatchObject({ active: false, size: 0, lockCell: null });
  });
});
