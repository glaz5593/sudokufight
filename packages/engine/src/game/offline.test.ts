import { parseCellName } from '../sudoku/board';
import { answer, GameDriver, PUZZLE, wrongDigit } from '../testing/game';
import {
  type LocalLock,
  type OfflineMove,
  type OfflinePlay,
  offlinePlaceRefusal,
  offlinePlayable,
  offlineSelectRefusal,
  unsettledOfflineMoves,
  withOfflinePlay,
} from './offline';
import type { Rules } from './rules';
import type { GameState } from './types';
import { toView } from './view';

/*
 * The phone's side of the soft phase [D42]: what it may play locally while its connection is lost, from the
 * last state it had, and how it draws that. Pure helpers; the server decides every move when it arrives.
 * 'fast': 8 s of think time. p1 is the offline player ("me").
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A3 = parseCellName('A3'); // a given
const A5 = parseCellName('A5');
const A6 = parseCellName('A6');
const B1 = parseCellName('B1');
const C1 = parseCellName('C1');

const lock = (cell: number, lockedAt: number, thinkMs = 8000): LocalLock => ({
  cell,
  lockedAt,
  expiresAt: lockedAt + thinkMs,
});
const move = (cell: number, digit: number, thinkMs = 1000): OfflineMove =>
  ({ cell, digit, thinkMs }) as OfflineMove;
const play = (o: Partial<OfflinePlay> = {}): OfflinePlay => ({
  softEndsAt: 11000,
  lock: null,
  queued: [],
  ...o,
});

/** PUZZLE solved but for `cells` (by name). */
function nearlySolved(cells: string[]) {
  const blank = new Set(cells.map(parseCellName));
  const givens = [...PUZZLE.solution].map((d, i) => (blank.has(i) ? '0' : d)).join('');
  return { id: 'near', givens, solution: PUZZLE.solution };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('offlinePlayable [D42]', () => {
  it('a running simultaneous game I am in, with a soft phase and offline moves in the rules', () => {
    const g = GameDriver.of();
    expect(offlinePlayable(g.state, 'p1')).toBe(true);
    expect(offlinePlayable(g.state, 'nobody')).toBe(false);
    expect(offlinePlayable(GameDriver.of({ rules: { turnModel: 'turns' } }).state, 'p1')).toBe(false);
    expect(offlinePlayable(GameDriver.of({ rules: { softGraceMs: 0 } }).state, 'p1')).toBe(false);
    expect(offlinePlayable(GameDriver.of({ rules: { offlineMovesMax: 0 } }).state, 'p1')).toBe(false);
    expect(offlinePlayable(GameDriver.of({}, { start: false }).state, 'p1')).toBe(false);

    const paused = GameDriver.of();
    paused.disconnect('p2', { at: 1000 });
    expect(offlinePlayable(paused.state, 'p1')).toBe(false);
    const out = GameDriver.of({ players: 3 });
    out.playerAct('p1', { type: 'surrender' }, 1000);
    expect(offlinePlayable(out.state, 'p1')).toBe(false);
  });

  it('rules from an older server (no softGraceMs, no offlineMovesMax): off, as before', () => {
    const g = GameDriver.of();
    const { softGraceMs: _s, offlineMovesMax: _m, ...older } = g.state.config.rules;
    const state: GameState = { ...g.state, config: { ...g.state.config, rules: older as Rules } };
    expect(offlinePlayable(state, 'p1')).toBe(false);
    expect(offlineSelectRefusal(state, 'p1', play(), A1, 2000)).toBe('disconnected');
  });
});

describe('withOfflinePlay: the state the offline player sees and plays against [D42]', () => {
  it('marks me, puts my local lock in place of mine, drops the others’ locks that ran out, keeps stopped ones', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p3', 'A1', 0); // 8, to pay for a hit
    g.select('p1', 'B1', 500); // my server lock, until 8500
    g.select('p2', 'A2', 1000); // until 9000
    g.playerAct('p3', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1500); // A2 stops, 7500 left
    g.select('p3', 'A5', 2000); // until 10000
    const before = deepFreeze(g.state);
    const json = JSON.stringify(before);

    const shown = withOfflinePlay(before, 'p1', play({ lock: lock(A6, 3000) }), 10000);
    expect(JSON.stringify(before)).toBe(json); // pure
    expect(shown.players[0]!.softEndsAt).toBe(11000);
    expect(shown.players.slice(1).map((p) => p.softEndsAt)).toEqual([undefined, undefined]);
    expect(shown.locks).toEqual([
      { playerId: 'p2', cell: A2, lockedAt: 1000, expiresAt: null, remainingMs: 7500 }, // stopped: kept
      // p3's A5 ran out at 10000: gone. Mine is the local one, B1 is not mine any more.
      { playerId: 'p1', cell: A6, lockedAt: 3000, expiresAt: 11000, remainingMs: 8000 },
    ]);
    // The view draws it: my lock with its countdown, the keypad on, my mark.
    const view = toView(shown, 'p1', 10000);
    expect(view.players[0]).toMatchObject({ softEndsAt: 11000, lock: { cell: A6, remainingMs: 1000 } });
    expect(view.keypad.enabled).toBe(true);
    expect(view.interference!.targets.every((t) => t.blockedBy !== null)).toBe(true);

    expect(withOfflinePlay(before, 'p1', play(), 9999).locks.map((l) => l.playerId)).toEqual(['p2', 'p3']);
  });
});

describe('offlineSelectRefusal: may I take this cell on my phone now? [D42]', () => {
  it('a free cell: yes; filled, queued, taken, my own, my re-lock wait, a bad cell: the engine’s reasons', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 0);
    g.select('p2', 'A2', 1000); // until 9000
    g.select('p1', 'B1', 1500);
    g.playerAct('p1', { type: 'release' }, 1600); // my re-lock wait on B1 until 2600
    const s = g.state;
    const p = play({ queued: [move(A5, answer('A5'))], lock: lock(C1, 2000) }); // until 10000
    expect(offlineSelectRefusal(s, 'p1', p, A6, 2000)).toBeNull();
    expect(offlineSelectRefusal(s, 'p1', p, A1, 2000)).toBe('cellFilled');
    expect(offlineSelectRefusal(s, 'p1', p, A3, 2000)).toBe('cellFilled'); // a given
    expect(offlineSelectRefusal(s, 'p1', p, A5, 2000)).toBe('cellFilled'); // my queued move
    expect(offlineSelectRefusal(s, 'p1', p, A2, 8999)).toBe('cellTaken');
    expect(offlineSelectRefusal(s, 'p1', p, A2, 9000)).toBeNull(); // p2's lock ran out (or was filled)
    expect(offlineSelectRefusal(s, 'p1', p, C1, 2000)).toBe('alreadyHeld');
    expect(offlineSelectRefusal(s, 'p1', p, C1, 10000)).toBeNull(); // my local lock ran out
    expect(offlineSelectRefusal(s, 'p1', p, B1, 2599)).toBe('cooldown');
    expect(offlineSelectRefusal(s, 'p1', p, B1, 2600)).toBeNull();
    expect(offlineSelectRefusal(s, 'p1', p, 81, 2000)).toBe('badCell');
  });

  it('nothing once the soft phase is over or the queue is full; nothing frozen, over, in turns, or out', () => {
    const g = GameDriver.of({ rules: { offlineMovesMax: 2 } });
    const s = g.state;
    expect(offlineSelectRefusal(s, 'p1', play(), A1, 10999)).toBeNull();
    expect(offlineSelectRefusal(s, 'p1', play(), A1, 11000)).toBe('disconnected');
    const full = play({ queued: [move(A2, 6), move(A5, 7)] });
    expect(offlineSelectRefusal(s, 'p1', full, A1, 2000)).toBe('disconnected');

    const paused = GameDriver.of();
    paused.disconnect('p2', { at: 1000 });
    expect(offlineSelectRefusal(paused.state, 'p1', play(), A1, 2000)).toBe('paused');
    const over = GameDriver.of();
    over.playerAct('p2', { type: 'surrender' }, 1000);
    expect(offlineSelectRefusal(over.state, 'p1', play(), A1, 2000)).toBe('gameOver');
    const turns = GameDriver.of({ rules: { turnModel: 'turns' } });
    expect(offlineSelectRefusal(turns.state, 'p1', play(), A1, 2000)).toBe('notYourTurn');
    const out = GameDriver.of({ players: 3 });
    out.playerAct('p1', { type: 'surrender' }, 1000);
    expect(offlineSelectRefusal(out.state, 'p1', play(), A1, 2000)).toBe('notActive');
    expect(offlineSelectRefusal(GameDriver.of({}, { start: false }).state, 'p1', play(), A1, 0)).toBe(
      'notStarted',
    );
  });
});

describe('offlinePlaceRefusal: may I enter this digit on my phone now? [D42]', () => {
  it('only in my local lock, while it runs; a digit tried there [D12] or all nine placed (queued ones too) is refused', () => {
    const g = GameDriver.of();
    g.miss('p2', 'A1', 0); // a wrong digit in A1, tried by p2
    const tried = g.state.wrong[A1]![0]!.digit;
    const s = g.state;
    const p = play({ lock: lock(A1, 1000) }); // until 9000
    expect(offlinePlaceRefusal(s, 'p1', p, A1, answer('A1'), 2000)).toBeNull();
    expect(offlinePlaceRefusal(s, 'p1', p, A1, wrongDigit('A1', [tried]), 2000)).toBeNull(); // can't judge it
    expect(offlinePlaceRefusal(s, 'p1', play(), A1, answer('A1'), 2000)).toBe('noLock');
    expect(offlinePlaceRefusal(s, 'p1', p, A1, answer('A1'), 9000)).toBe('noLock'); // it ran out
    expect(offlinePlaceRefusal(s, 'p1', p, A2, answer('A2'), 2000)).toBe('notLockedCell');
    expect(offlinePlaceRefusal(s, 'p1', p, A1, 0, 2000)).toBe('badDigit');
    expect(offlinePlaceRefusal(s, 'p1', p, A1, tried, 2000)).toBe('digitTried');
    expect(offlinePlaceRefusal(s, 'p1', p, A1, answer('A1'), 11000)).toBe('disconnected');

    const mistaker = GameDriver.of({ rules: { wrongDigitDisabledFor: 'mistaker' } });
    mistaker.miss('p2', 'A1', 0);
    expect(offlinePlaceRefusal(mistaker.state, 'p1', p, A1, tried, 2000)).toBeNull(); // p2's try, not mine
    mistaker.miss('p1', 'A1', 100);
    const mine = mistaker.state.wrong[A1]![1]!.digit;
    expect(offlinePlaceRefusal(mistaker.state, 'p1', p, A1, mine, 2000)).toBe('digitTried');
  });

  it('counts my queued digits toward the nine', () => {
    // Every 8 but A1's is on the board.
    const g = GameDriver.of({ puzzle: nearlySolved(['A1', 'A2', 'B1']) });
    const p = play({ lock: lock(A2, 1000) });
    expect(offlinePlaceRefusal(g.state, 'p1', p, A2, 8, 2000)).toBeNull();
    const queued = play({ lock: lock(A2, 1000), queued: [move(A1, 8)] });
    expect(offlinePlaceRefusal(g.state, 'p1', queued, A2, 8, 2000)).toBe('digitComplete');
    expect(offlinePlaceRefusal(g.state, 'p1', p, A2, 9, 2000)).toBe('digitComplete'); // nine 9s on the board
  });
});

describe('unsettledOfflineMoves: what still has to go out after the return [D42]', () => {
  it('drops a move already on the board as mine or already tried by me; keeps a cell someone else filled', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // my queued A1 went through, its answer lost with the connection
    const wrongA2 = wrongDigit('A2');
    g.select('p1', 'A2', 100);
    g.place('p1', 'A2', wrongA2, 200); // so did my wrong A2
    g.solve('p2', 'A5', 300); // p2 filled A5 meanwhile: my move there is lost, the server will say so
    g.miss('p2', 'B1', 400); // p2's wrong try in B1 is not mine
    const p2Wrong = g.state.wrong[B1]![0]!.digit;
    const moves = [
      { ...move(A1, answer('A1')), clientSeq: 1 },
      { ...move(A2, wrongA2), clientSeq: 2 },
      { ...move(A5, answer('A5')), clientSeq: 3 },
      { ...move(B1, p2Wrong), clientSeq: 4 },
      { ...move(A2, answer('A2')), clientSeq: 5 },
    ];
    const left = unsettledOfflineMoves(deepFreeze(g.state), 'p1', moves);
    expect(left.map((m) => m.clientSeq)).toEqual([3, 4, 5]); // the extra field comes along
    expect(unsettledOfflineMoves(g.state, 'p2', [move(A5, answer('A5'))])).toEqual([]);
    expect(unsettledOfflineMoves(g.state, 'nobody', moves)).toHaveLength(5);
  });
});
