import { type CellIndex, type Digit, DIGITS, parseCellName } from '../sudoku/board';
import { missedPoints, moveScore } from '../sudoku/scoring';
import { answer, GameDriver, PUZZLE, solveAll } from '../testing/game';
import { defaultRules, type Rules } from './rules';
import type { Action } from './types';

/*
 * Digit entry, correct and wrong moves (spec §6.3, §6.4, §6.5) with the decisions [D2] (the wait before a
 * re-lock after a mistake), [D3], [D12], [D13], [D15]. PUZZLE (bank #1) is the board unless a test builds its
 * own:
 *   A1 = 8 (row 4, col 2, box 3, num 3 → X 4, Y 3 → 8)    A2 = 6 (4, 4, 3, 4 → X 4, Y 4 → 7.5)
 *   A8 = 5                                                  B4 = 8 (3, 3, 3, 3 → X 3, Y 3 → 9)
 *   B7 = 7 (3, 5, 5, 3 → X 5, Y 5 → 6)
 * A wrong digit costs what the right one would score there at that moment (§6.5, Moshe's decision of
 * 2026-10-15): on the opening board A1 8, A2 7.5, A5 8, A6 6.5, A8 6.5, B1 7.
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A8 = parseCellName('A8');
const C7 = parseCellName('C7');

/** A raw place action, so tests can send what a client could send (bad cells, bad digits). */
const placeAt = (playerId: string, cell: CellIndex, digit: number): Action => ({
  type: 'place',
  playerId,
  cell,
  digit: digit as Digit,
});

/** Locks a cell and enters a wrong digit in it; returns the placedWrong event. */
const missed = (g: GameDriver, playerId: string, cell: string) => {
  g.miss(playerId, cell);
  return g.last('placedWrong')!;
};

const cellsOf = (digit: string) =>
  [...PUZZLE.solution].map((c, i) => (c === digit ? i : -1)).filter((i) => i >= 0);
/** PUZZLE's givens with these cells filled in from the solution. */
const givensWith = (cells: number[]) =>
  [...PUZZLE.givens].map((c, i) => (cells.includes(i) ? PUZZLE.solution[i] : c)).join('');

const EIGHTS = cellsOf('8');
/** Every 8 is a given: the digit 8 is complete from the start. */
const ALL_EIGHTS = { id: 'all-eights', givens: givensWith(EIGHTS), solution: PUZZLE.solution };
/** Every 8 but the one in A1 is a given. */
const ONE_EIGHT_LEFT = {
  id: 'one-eight-left',
  givens: givensWith(EIGHTS.filter((i) => i !== A1)),
  solution: PUZZLE.solution,
};
/**
 * The solution with six holes: A1, A2, B1, C1, B4, C7. A1 (8) then scores row 7, col 6, box 5, num 6:
 * the spec's example X = 7, Y = 6 → 3.5 (§6.4).
 */
const SIX_HOLES_CELLS = ['A1', 'A2', 'B1', 'C1', 'B4', 'C7'];
const SIX_HOLES = {
  id: 'six-holes',
  givens: [...PUZZLE.solution]
    .map((c, i) => (SIX_HOLES_CELLS.map(parseCellName).includes(i) ? '0' : c))
    .join(''),
  solution: PUZZLE.solution,
};

/** The keypad's remaining counts of PUZZLE at the start, digit 1 first. */
const START_REMAINING = [5, 6, 4, 5, 5, 5, 6, 6, 4];

// ---------------------------------------------------------------------------------------------------------

describe('entering a digit (§6.3)', () => {
  it('needs an active lock: without one the digit is refused (noLock), at no cost', () => {
    const g = GameDriver.of();
    expect(g.reject(placeAt('p1', A1, 8))).toBe('noLock');
    expect(g.reject(placeAt('p1', A1, 5))).toBe('noLock');
    expect(g.player('p1')).toMatchObject({ score: 0, mistakes: 0, correct: 0 });
    expect(g.state.grid[A1]).toBe(0);
    expect(g.state.wrong[A1]).toEqual([]);
  });

  it('a cell locked by someone else is not my lock: noLock', () => {
    const g = GameDriver.of();
    g.select('p2', 'A1');
    expect(g.reject(placeAt('p1', A1, 8))).toBe('noLock');
    expect(g.lock('p2')!.cell).toBe(A1);
    expect(g.score('p1')).toBe(0);
  });

  it('once the lock is gone (cancel, timeout) the digit is refused', () => {
    const cancelled = GameDriver.of();
    cancelled.select('p1', 'A1', 0);
    cancelled.playerAct('p1', { type: 'release' }, 100);
    expect(cancelled.reject(placeAt('p1', A1, 8), 200)).toBe('noLock');

    // The lock runs out at 8000 exactly (fast game [D2]): a digit sent at that moment comes too late.
    const late = GameDriver.of();
    late.select('p1', 'A1', 0);
    expect(late.reject(placeAt('p1', A1, 8), 8000)).toBe('noLock');
    expect(late.last('cellReleased')).toMatchObject({ reason: 'timeout', t: 8000 });
    expect(late.score('p1')).toBe(0);

    // One millisecond earlier it still counts.
    const inTime = GameDriver.of();
    inTime.select('p1', 'A1', 0);
    inTime.place('p1', 'A1', 8, 7999);
    expect(inTime.last('placedCorrect')).toMatchObject({ cell: A1, thinkMs: 7999 });
  });

  it('only on the locked cell (notLockedCell), at no cost and keeping the lock', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    g.select('p2', 'A5');
    expect(g.reject(placeAt('p1', A2, answer('A2')))).toBe('notLockedCell'); // an empty cell
    expect(g.reject(placeAt('p1', parseCellName('A3'), 4))).toBe('notLockedCell'); // a given
    expect(g.reject(placeAt('p1', parseCellName('A5'), answer('A5')))).toBe('notLockedCell'); // p2's cell
    expect(g.reject(placeAt('p1', 81, 8))).toBe('notLockedCell'); // not on the board
    expect(g.reject(placeAt('p1', -1, 8))).toBe('notLockedCell');
    expect(g.lock('p1')!.cell).toBe(A1);
    expect(g.player('p1')).toMatchObject({ score: 0, mistakes: 0 });
    expect(g.state.grid[A2]).toBe(0);
  });

  it('switching cells moves the lock: the first cell is no longer mine', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    g.select('p1', 'A2');
    expect(g.reject(placeAt('p1', A1, 8))).toBe('notLockedCell');
    g.place('p1', 'A2', 6);
    expect(g.state.grid[A2]).toBe(6);
  });

  it.each([0, 10, -1, 2.5, Number.NaN])('only the digits 1–9: %p is refused (badDigit)', (digit) => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    expect(g.reject(placeAt('p1', A1, digit))).toBe('badDigit');
    expect(g.lock('p1')!.cell).toBe(A1);
    expect(g.player('p1')).toMatchObject({ score: 0, mistakes: 0 });
    expect(g.state.wrong[A1]).toEqual([]);
  });

  it('a digit sent as text is not a digit (badDigit)', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    expect(g.reject({ type: 'place', playerId: 'p1', cell: A1, digit: '8' as unknown as Digit })).toBe(
      'badDigit',
    );
  });

  it('the checks come in order: the lock, then the cell, then the digit', () => {
    const g = GameDriver.of();
    expect(g.reject(placeAt('p1', A1, 0))).toBe('noLock');
    g.select('p1', 'A1');
    expect(g.reject(placeAt('p1', A2, 0))).toBe('notLockedCell');
    expect(g.reject(placeAt('p1', A1, 0))).toBe('badDigit');
  });

  it('every digit 1–9 can be entered: the server checks it against the solution, not the board', () => {
    // 4 is already a given in row A (A3), so it is plainly wrong in A1, but it is still an ordinary mistake.
    const g = GameDriver.of();
    g.select('p1', 'A1');
    const events = g.place('p1', 'A1', 4);
    expect(events[0]).toMatchObject({ type: 'placedWrong', digit: 4, penalty: 8 });
    // And the right digit is accepted whoever enters it.
    g.select('p2', 'A1');
    expect(g.place('p2', 'A1', 8)[0]).toMatchObject({ type: 'placedCorrect', playerId: 'p2', digit: 8 });
  });

  it('is refused before the game starts, while it is frozen, and after it ends', () => {
    const waiting = GameDriver.of({}, { start: false });
    expect(waiting.reject(placeAt('p1', A1, 8))).toBe('notStarted');

    // 2 players: a disconnection freezes the game; the lock is kept but no digit goes in (§16.2) [D4].
    const frozen = GameDriver.of();
    frozen.select('p1', 'A1');
    frozen.act({ type: 'disconnect', playerId: 'p2' });
    expect(frozen.reject(placeAt('p1', A1, 8))).toBe('paused');
    expect(frozen.lock('p1')!.cell).toBe(A1);
    expect(frozen.state.grid[A1]).toBe(0);

    // 3 seats, but one has surrendered: two players are still in the game, so it freezes the same way.
    const twoLeft = GameDriver.of({ players: 3 });
    twoLeft.playerAct('p3', { type: 'surrender' });
    twoLeft.select('p1', 'A1');
    twoLeft.act({ type: 'disconnect', playerId: 'p2' });
    expect(twoLeft.state.status).toBe('paused');
    expect(twoLeft.reject(placeAt('p1', A1, 8))).toBe('paused');
    expect(twoLeft.lock('p1')!.cell).toBe(A1);

    const over = GameDriver.of({ puzzle: SIX_HOLES });
    for (const cell of SIX_HOLES_CELLS) over.solve('p1', cell);
    expect(over.state.status).toBe('over');
    expect(over.reject(placeAt('p2', A1, 8))).toBe('gameOver');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('a digit already tried wrongly in this cell (§6.3) [D12]', () => {
  it("[D12 'everyone'] is refused for every player in that cell, with no penalty", () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5); // wrong: A1 is 8, worth 8 there
    expect(g.player('p1')).toMatchObject({ mistakes: 1, score: -8 });

    g.select('p2', 'A1', 0);
    expect(g.reject(placeAt('p2', A1, 5))).toBe('digitTried');
    expect(g.player('p2')).toMatchObject({ mistakes: 0, score: 0 });
    expect(g.lock('p2')!.cell).toBe(A1); // the refusal costs nothing, not even the lock
    g.playerAct('p2', { type: 'release' }, 100);

    g.select('p3', 'A1', 100);
    expect(g.reject(placeAt('p3', A1, 5))).toBe('digitTried');
    expect(g.player('p3')).toMatchObject({ mistakes: 0, score: 0 });
    g.playerAct('p3', { type: 'release' }, 200);

    // Whoever tried it is refused too (relocking after the one-second wait of §6.2.6).
    g.select('p1', 'A1', 1000);
    expect(g.reject(placeAt('p1', A1, 5))).toBe('digitTried');
    expect(g.player('p1')).toMatchObject({ mistakes: 1, score: -8 });
    expect(g.state.wrong[A1]).toEqual([{ digit: 5, playerId: 'p1' }]);
  });

  it('only in this cell: the same digit can still be entered elsewhere', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    g.place('p1', 'A1', 5);
    g.select('p2', 'A8');
    expect(g.place('p2', 'A8', 5)[0]).toMatchObject({ type: 'placedCorrect', cell: A8, digit: 5 });
  });

  it("every tried digit is refused, and a new wrong digit costs the cell's value again", () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5);
    g.select('p2', 'A1', 0);
    g.place('p2', 'A1', 6);
    g.select('p1', 'A1', 1000);
    expect(g.reject(placeAt('p1', A1, 5))).toBe('digitTried');
    expect(g.reject(placeAt('p1', A1, 6))).toBe('digitTried');
    expect(g.place('p1', 'A1', 7)[0]).toMatchObject({
      type: 'placedWrong',
      digit: 7,
      penalty: 8,
      mistakes: 2,
    });
    expect(g.state.wrong[A1]).toEqual([
      { digit: 5, playerId: 'p1' },
      { digit: 6, playerId: 'p2' },
      { digit: 7, playerId: 'p1' },
    ]);
    expect(g.player('p1')).toMatchObject({ mistakes: 2, score: -16 });
    expect(g.player('p2')).toMatchObject({ mistakes: 1, score: -8 });
  });

  it("[D12 'mistaker'] is refused only for whoever tried it; anyone else pays for it", () => {
    const g = GameDriver.of({ rules: { wrongDigitDisabledFor: 'mistaker' } });
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5);

    g.select('p2', 'A1', 0);
    expect(g.place('p2', 'A1', 5)[0]).toMatchObject({
      type: 'placedWrong',
      playerId: 'p2',
      digit: 5,
      penalty: 8,
      mistakes: 1,
      score: -8,
    });

    g.select('p1', 'A1', 1000);
    expect(g.reject(placeAt('p1', A1, 5))).toBe('digitTried');
    expect(g.player('p1')).toMatchObject({ mistakes: 1, score: -8 });
    expect(g.state.wrong[A1]).toEqual([
      { digit: 5, playerId: 'p1' },
      { digit: 5, playerId: 'p2' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('a digit with all nine on the board (§6.3)', () => {
  it('is refused (digitComplete), with no penalty and keeping the lock', () => {
    const g = GameDriver.of({ puzzle: ALL_EIGHTS });
    g.select('p1', 'A2');
    expect(g.reject(placeAt('p1', A2, 8))).toBe('digitComplete');
    expect(g.player('p1')).toMatchObject({ mistakes: 0, score: 0 });
    expect(g.state.wrong[A2]).toEqual([]);
    expect(g.lock('p1')!.cell).toBe(A2);
    // Every other digit still goes through.
    expect(g.place('p1', 'A2', 6)[0]).toMatchObject({ type: 'placedCorrect', digit: 6 });
  });

  it('is refused from the moment the ninth one is placed', () => {
    const g = GameDriver.of({ puzzle: ONE_EIGHT_LEFT });
    g.select('p1', 'A2');
    // While A1 is open, 8 is just a wrong digit in A2, which costs what its 6 is worth there.
    expect(g.place('p1', 'A2', 8)[0]).toMatchObject({ type: 'placedWrong', penalty: 6.5 });
    // The ninth 8: num = 8, so X = 8 → 9 − 8 + (9 − 4)/2 = 3.5.
    g.select('p2', 'A1');
    expect(g.place('p2', 'A1', 8)[0]).toMatchObject({
      type: 'placedCorrect',
      points: 3.5,
      breakdown: { row: 4, col: 2, box: 3, num: 8, X: 8, Y: 4, points: 3.5 },
    });
    g.select('p2', 'B1');
    expect(g.reject(placeAt('p2', parseCellName('B1'), 8))).toBe('digitComplete');
    expect(g.player('p2')).toMatchObject({ mistakes: 0, score: 3.5 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('a correct digit (§6.4)', () => {
  it('scores 9 − X + (9 − Y)/2 on the board before the move, and the event carries the breakdown', () => {
    const g = GameDriver.of();
    const before = g.state.grid.slice();
    g.select('p1', 'A1', 1000);
    const events = g.place('p1', 'A1', 8, 3500);
    expect(g.types(events)).toEqual(['placedCorrect']);
    const breakdown = { row: 4, col: 2, box: 3, num: 3, X: 4, Y: 3, points: 8 };
    expect(moveScore(before, A1, 8)).toEqual(breakdown);
    expect(events[0]).toEqual({
      type: 'placedCorrect',
      playerId: 'p1',
      cell: A1,
      digit: 8,
      points: 8,
      breakdown,
      score: 8,
      thinkMs: 2500,
      seq: expect.any(Number),
      t: 3500,
    });
  });

  it('every move is scored on the board just before it, whoever made the earlier moves', () => {
    const g = GameDriver.of();
    const expected = [
      { player: 'p1', cell: 'A2', points: 7.5, breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 4 } },
      // A2 is now filled: one more in row A and in box 1.
      { player: 'p2', cell: 'A1', points: 6.5, breakdown: { row: 5, col: 2, box: 4, num: 3, X: 5, Y: 4 } },
      // A1 put an 8 on the board: num of 8 went from 3 to 4.
      { player: 'p1', cell: 'B4', points: 8, breakdown: { row: 3, col: 3, box: 3, num: 4, X: 4, Y: 3 } },
    ];
    for (const m of expected) {
      const before = g.state.grid.slice();
      const cell = parseCellName(m.cell);
      g.select(m.player, m.cell);
      const [e] = g.place(m.player, m.cell, answer(m.cell));
      expect(e).toMatchObject({
        type: 'placedCorrect',
        points: m.points,
        breakdown: { ...m.breakdown, points: m.points },
      });
      expect(g.last('placedCorrect')!.breakdown).toEqual(moveScore(before, cell, answer(m.cell)));
    }
    expect(g.score('p1')).toBe(15.5);
    expect(g.score('p2')).toBe(6.5);
  });

  it('the spec example: X = 7, Y = 6 → 2 + 1.5 = 3.5', () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES });
    g.select('p1', 'A1');
    expect(g.place('p1', 'A1', 8)[0]).toMatchObject({
      points: 3.5,
      breakdown: { row: 7, col: 6, box: 5, num: 6, X: 7, Y: 6, points: 3.5 },
      score: 3.5,
    });
  });

  it('[D13] a tie at the top makes Y equal to X', () => {
    const g = GameDriver.of();
    expect(g.state.config.rules.scoreY).toBe('sorted'); // the default
    g.select('p1', 'B4');
    // All four parameters are 3: X = Y = 3 → 6 + 3 = 9.
    expect(g.place('p1', 'B4', 8)[0]).toMatchObject({
      points: 9,
      breakdown: { row: 3, col: 3, box: 3, num: 3, X: 3, Y: 3, points: 9 },
    });
    g.select('p2', 'A2');
    // 4, 4, 3, 4: Y = 4 (not the next distinct value, 3) → 5 + 2.5 = 7.5.
    expect(g.place('p2', 'A2', 6)[0]).toMatchObject({ points: 7.5, breakdown: { X: 4, Y: 4 } });
  });

  it("[D13 'distinct'] Y is the highest value below X; with all four equal Y is still X", () => {
    const g = GameDriver.of({ rules: { scoreY: 'distinct' } });
    const before = g.state.grid.slice();
    g.select('p1', 'A2');
    // 4, 4, 3, 4: Y = 3, the next value down (not the second 4) → 5 + 3 = 8 instead of 7.5.
    const [a2] = g.place('p1', 'A2', 6);
    expect(a2).toMatchObject({
      type: 'placedCorrect',
      points: 8,
      breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 3, points: 8 },
      score: 8,
    });
    expect(g.last('placedCorrect')!.breakdown).toEqual(moveScore(before, A2, 6, 'distinct'));
    // B4 is untouched by A2: 3, 3, 3, 3 → no lower value, Y = X = 3 → 9, as with 'sorted'.
    g.select('p2', 'B4');
    expect(g.place('p2', 'B4', 8)[0]).toMatchObject({
      points: 9,
      breakdown: { X: 3, Y: 3, points: 9 },
      score: 9,
    });
    expect(g.player('p1')).toMatchObject({ score: 8, pointsGained: 8, bestMove: { cell: A2, points: 8 } });
  });

  it("[D13 'distinct'] changes nothing when the second value already differs: the spec example and the last cell", () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES, rules: { scoreY: 'distinct' } });
    // 7, 6, 5, 6 → X = 7, Y = 6 either way → 3.5.
    expect(g.solve('p1', 'A1')[1]).toMatchObject({ points: 3.5, breakdown: { X: 7, Y: 6 } });
    for (const cell of SIX_HOLES_CELLS.slice(1, 5)) g.solve('p2', cell);
    // The last cell: 8, 8, 8, 8 → Y = X = 8 → 1.5.
    expect(g.solve('p1', 'C7')[1]).toMatchObject({ cell: C7, points: 1.5, breakdown: { X: 8, Y: 8 } });
    expect(g.last('gameOver')).toMatchObject({ reason: 'boardComplete' });
  });

  it('wrong marks are not "filled": they count neither in the row, column and box nor in num', () => {
    const g = GameDriver.of();
    // A wrong 6 in A1 (row A, column 1, box 1) next to A2, whose answer is 6.
    g.select('p1', 'A1');
    g.place('p1', 'A1', 6);
    expect(g.state.wrong[A1]).toEqual([{ digit: 6, playerId: 'p1' }]);
    g.select('p2', 'A2');
    // Exactly as on the fresh board: row 4, col 4, box 3, num 4 → 7.5.
    expect(g.place('p2', 'A2', 6)[0]).toMatchObject({
      points: 7.5,
      breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 4, points: 7.5 },
    });
  });

  it("fills the cell in the solver's seat, adds to the score and the counters, and ends the lock", () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p1', 'B7');
    g.select('p2', 'A1', 1000);
    const events = g.place('p2', 'A1', 8, 1500);
    expect(g.types(events)).toEqual(['placedCorrect']); // no separate release
    expect(g.state.grid[A1]).toBe(8);
    expect(g.state.owner[A1]).toBe(1); // p2 sits in seat 1
    expect(g.state.givens[A1]).toBe(false);
    expect(g.lock('p2')).toBeUndefined();
    expect(g.lock('p1')!.cell).toBe(parseCellName('B7')); // other locks are untouched
    expect(g.player('p2')).toMatchObject({
      score: 8,
      correct: 1,
      pointsGained: 8,
      mistakes: 0,
      lastCorrectAt: 1500,
      thinkMsTotal: 500,
    });
    expect(g.player('p1')).toMatchObject({ score: 0, correct: 0 });
    // A solved cell cannot be locked again, not by its solver and not by anyone else.
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 })).toBe('cellFilled');
    expect(g.reject({ type: 'select', playerId: 'p3', cell: A1 })).toBe('cellFilled');

    g.place('p1', 'B7', 7);
    expect(g.state.owner[parseCellName('B7')]).toBe(0);
    expect(g.state.status).toBe('running');
  });

  it('adds the points to whatever the score is, also a negative one', () => {
    const g = GameDriver.of();
    g.miss('p1', 'A2'); // −7.5
    g.select('p1', 'A1');
    expect(g.place('p1', 'A1', 8)[0]).toMatchObject({ points: 8, score: 0.5 });
    expect(g.player('p1')).toMatchObject({ score: 0.5, pointsGained: 8 });
  });

  it('keeps the best move as the highest-scoring correct move', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A2'); // 7.5
    expect(g.player('p1').bestMove).toEqual({
      cell: A2,
      digit: 6,
      points: 7.5,
      breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 4, points: 7.5 },
    });
    g.solve('p1', 'A1'); // 6.5: lower, the best move stays
    expect(g.player('p1').bestMove).toMatchObject({ cell: A2, points: 7.5 });
    g.solve('p1', 'B4'); // 8: higher, it takes over
    expect(g.player('p1').bestMove).toMatchObject({
      cell: parseCellName('B4'),
      digit: 8,
      points: 8,
      breakdown: { X: 4, Y: 3 },
    });
    expect(g.player('p1').pointsGained).toBe(22);
    expect(g.player('p2').bestMove).toBeNull();
  });

  it('think time runs from the lock to the digit', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 1000);
    expect(g.place('p1', 'A1', 8, 3500)[0]).toMatchObject({ thinkMs: 2500 });
    g.select('p1', 'A2', 4000);
    expect(g.place('p1', 'A2', 6, 4000)[0]).toMatchObject({ thinkMs: 0 });
    expect(g.player('p1').thinkMsTotal).toBe(2500);
  });

  it('a digit stamped before the lock (a clock that went back) counts at the time of the lock: think time 0', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 3000);
    expect(g.place('p1', 'A1', 8, 2000)[0]).toMatchObject({ type: 'placedCorrect', t: 3000, thinkMs: 0 });
    expect(g.player('p1')).toMatchObject({ lastCorrectAt: 3000, thinkMsTotal: 0 });
  });

  it('think time leaves out a freeze (§6.2.7, §16.2) [D4]', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 1000); // runs out at 9000
    g.act({ type: 'disconnect', playerId: 'p2' }, 3000); // frozen with 6000 left
    g.act({ type: 'reconnect', playerId: 'p2' }, 7000); // 4000 later: the lock now runs out at 13000
    expect(g.lock('p1')!.expiresAt).toBe(13000);
    // 2000 before the freeze, nothing during it, 1000 after it.
    expect(g.place('p1', 'A1', 8, 8000)[0]).toMatchObject({ type: 'placedCorrect', thinkMs: 3000 });
  });

  it('think time leaves out the time the lock timer was stopped by an interference (§6.2.7) [D11]', () => {
    const setup = () => {
      const g = GameDriver.of();
      g.solve('p2', 'B7', 0); // p2 earns 6 points to pay for an interference (cost 2)
      g.select('p1', 'A1', 1000); // runs out at 9000
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000); // until 8000; 6000 left
      return g;
    };
    // The interference stops the lock with 6000 left, and the event says so (spec §18 locks[]).
    const stopped = { playerId: 'p1', cell: A1, expiresAt: null, remainingMs: 6000 };
    expect(setup().last('interference')!.locks).toEqual([stopped]);
    // The game goes on under interference: a digit during it counts the 2000 before it stopped.
    const during = setup();
    expect(during.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 6000 });
    expect(during.place('p1', 'A1', 8, 5000)[0]).toMatchObject({ type: 'placedCorrect', thinkMs: 2000 });
    // After it: 2000 before, nothing during, 2000 after it resumed at 8000.
    const after = setup();
    const [ended] = after.tickTo(8000);
    expect(ended).toMatchObject({ type: 'interferenceEnded', locks: [{ ...stopped, expiresAt: 14000 }] });
    expect(after.lock('p1')!.expiresAt).toBe(14000);
    expect(after.place('p1', 'A1', 8, 10000)[0]).toMatchObject({ thinkMs: 4000 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('a wrong digit (§6.5)', () => {
  it('costs what the right digit would have scored in that cell at that moment', () => {
    const g = GameDriver.of();
    const before = g.state.grid.slice();
    expect(missed(g, 'p1', 'A1')).toMatchObject({ type: 'placedWrong', penalty: 8, mistakes: 1, score: -8 });
    // The same formula as a correct move (§6.4), on the board before the entry, with the solution's digit.
    expect(missedPoints(before, A1, 8).points).toBe(8);
    expect(moveScore(before, A1, 8).points).toBe(8);
  });

  it("does not depend on the mistake number: six misses cost each cell's value", () => {
    const g = GameDriver.of();
    const cells = ['A1', 'A2', 'A5', 'A6', 'A8', 'B1'];
    const before = g.state.grid.slice();
    const penalties: number[] = [];
    const scores: number[] = [];
    cells.forEach((cell, k) => {
      const e = missed(g, 'p1', cell);
      // Wrong marks are not on the board, so every cell is still scored on the opening board.
      expect(e).toMatchObject({
        mistakes: k + 1,
        penalty: missedPoints(before, parseCellName(cell), answer(cell)).points,
      });
      penalties.push(e.penalty);
      scores.push(g.score('p1'));
    });
    expect(penalties).toEqual([8, 7.5, 8, 6.5, 6.5, 7]);
    expect(scores).toEqual([-8, -15.5, -23.5, -30, -36.5, -43.5]);
    expect(g.player('p1').mistakes).toBe(6);
  });

  it('follows the board: the same cell costs less as its row, column, box and digit fill', () => {
    const fresh = GameDriver.of();
    expect(missed(fresh, 'p1', 'A2')).toMatchObject({ penalty: 7.5 });
    const later = GameDriver.of();
    later.solve('p2', 'A1');
    expect(missed(later, 'p1', 'A2')).toMatchObject({ penalty: 6.5, score: -6.5 });

    // Correct moves in between: each mistake is charged on the board as it is then.
    const g = GameDriver.of();
    let gained = 0;
    const solve = (cell: string) => {
      g.solve('p1', cell);
      gained += g.last('placedCorrect')!.points;
    };
    const penalties: number[] = [];
    const miss = (cell: string) => {
      const before = g.state.grid.slice();
      const e = missed(g, 'p1', cell);
      expect(e.penalty).toBe(missedPoints(before, parseCellName(cell), answer(cell)).points);
      penalties.push(e.penalty);
    };
    miss('A2');
    solve('A1');
    solve('B4');
    miss('A5');
    solve('B7');
    miss('A6');
    miss('A8');
    expect(penalties).toEqual([7.5, 6.5, 6, 5]);
    expect(gained).toBe(22);
    expect(g.score('p1')).toBe(gained - 25);
    expect(g.player('p1')).toMatchObject({ correct: 3, mistakes: 4 });
  });

  it('is the same rule for every player, and each player counts their own mistakes', () => {
    const g = GameDriver.of({ players: 3 });
    g.miss('p1', 'A1'); // 8
    g.miss('p1', 'A2'); // 7.5
    expect(missed(g, 'p2', 'A5')).toMatchObject({ playerId: 'p2', penalty: 8, mistakes: 1, score: -8 });
    g.miss('p1', 'A6'); // 6.5
    expect(missed(g, 'p2', 'A8')).toMatchObject({ playerId: 'p2', penalty: 6.5, mistakes: 2, score: -14.5 });
    expect(missed(g, 'p3', 'B1')).toMatchObject({ playerId: 'p3', penalty: 7, mistakes: 1, score: -7 });
    expect(g.player('p1')).toMatchObject({ mistakes: 3, score: -22 });
  });

  it('the event tells the digit, the penalty, the mistake count and the score, and nothing of the right digit', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    const events = g.place('p1', 'A1', 5, 2000);
    // No breakdown and no answer: they would tell everyone how many of the right digit are on the board.
    expect(events[0]).toEqual({
      type: 'placedWrong',
      playerId: 'p1',
      cell: A1,
      digit: 5,
      penalty: 8,
      mistakes: 1,
      score: -8,
      seq: expect.any(Number),
      t: 2000,
    });
  });

  it("[D13] follows the game's Y rule: with 'distinct' a wrong digit in A2 costs 8", () => {
    const g = GameDriver.of({ rules: { scoreY: 'distinct' } });
    expect(missed(g, 'p1', 'A2')).toMatchObject({ penalty: 8, score: -8 });
  });

  it("lists each penalty in the player's state and in every view, oldest first, and replays exactly", () => {
    const g = GameDriver.of();
    expect(g.player('p1').mistakePenalties).toEqual([]);
    g.miss('p1', 'A2'); // 7.5
    g.solve('p2', 'A1');
    g.miss('p1', 'A5'); // 7 after A1
    expect(g.player('p1').mistakePenalties).toEqual([7.5, 7]);
    expect(g.player('p1').mistakePenalties).toHaveLength(g.player('p1').mistakes);
    expect(g.player('p2').mistakePenalties).toEqual([]);
    for (const viewer of ['p1', 'p2', null]) {
      expect(g.view(viewer).players[0]!.mistakePenalties).toEqual([7.5, 7]);
    }
    // The view's list is a copy.
    const v = g.view('p1');
    v.players[0]!.mistakePenalties.push(99);
    expect(g.player('p1').mistakePenalties).toEqual([7.5, 7]);
    expect(g.replayMatches()).toBe(true);
  });

  it('has no switch (Moshe, 2026-10-15): no mode has a penalty rule, and an old config cannot bring the ladder back', () => {
    for (const mode of ['solo', 'bot', 'ranked'] as const) {
      const rules = defaultRules(mode, 'normal');
      expect(rules).not.toHaveProperty('mistakePenalty');
      expect(rules).not.toHaveProperty('mistakePenaltyCap');
    }
    // A config written by an older build (the in-between 'doubling' switch, or the [D14] cap) is ignored.
    const stale = { mistakePenalty: 'doubling', mistakePenaltyCap: 1 } as Partial<Rules>;
    const g = GameDriver.of({ rules: stale });
    const penalties = ['A1', 'A2', 'A5', 'A6', 'A8', 'B1'].map((cell) => missed(g, 'p1', cell).penalty);
    expect(penalties).toEqual([8, 7.5, 8, 6.5, 6.5, 7]);
    expect(g.score('p1')).toBe(-43.5);
    expect(g.player('p1').mistakePenalties).toEqual(penalties);
  });

  it('is not a correct move: the board, the counters and the best move stay as they were', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    g.place('p1', 'A1', 5);
    expect(g.state.grid[A1]).toBe(0);
    expect(g.state.owner[A1]).toBeNull();
    expect(g.player('p1')).toMatchObject({
      correct: 0,
      pointsGained: 0,
      bestMove: null,
      lastCorrectAt: null,
    });
    expect(g.state.status).toBe('running');
  });

  it('stays in the cell, small and red, for every player to see (state.wrong and every view)', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p1', 'A1');
    g.place('p1', 'A1', 5);
    const mark = [{ digit: 5, playerId: 'p1' }];
    expect(g.state.wrong[A1]).toEqual(mark);
    for (const viewer of ['p1', 'p2', 'p3', null]) {
      const view = g.view(viewer);
      expect(view.wrong[A1]).toEqual(mark);
      expect(view.grid[A1]).toBe(0);
      expect(view.solution).toBeNull(); // the right digit is not revealed (§6.3, §21)
    }
  });

  it('stays after the cell is solved', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5);
    g.select('p2', 'A1', 0);
    g.place('p2', 'A1', 6);
    g.select('p2', 'A1', 1000);
    g.place('p2', 'A1', 8);
    expect(g.state.grid[A1]).toBe(8);
    expect(g.state.owner[A1]).toBe(1);
    const marks = [
      { digit: 5, playerId: 'p1' },
      { digit: 6, playerId: 'p2' },
    ];
    expect(g.state.wrong[A1]).toEqual(marks);
    expect(g.view('p1').wrong[A1]).toEqual(marks);
    expect(g.view('p2').wrong[A1]).toEqual(marks);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the cell after a mistake (§6.5) [D3]', () => {
  it('[D3 release] is released (reason mistake), and anyone may lock it at once', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    const events = g.place('p1', 'A1', 5, 2000);
    expect(g.types(events)).toEqual(['placedWrong', 'cellReleased']);
    expect(events[1]).toMatchObject({
      type: 'cellReleased',
      playerId: 'p1',
      cell: A1,
      reason: 'mistake',
      t: 2000,
    });
    expect(events[1]).not.toHaveProperty('penalty'); // the mistake was charged once, in placedWrong
    expect(g.lock('p1')).toBeUndefined();
    expect(g.reject(placeAt('p1', A1, 8), 2000)).toBe('noLock');
    g.select('p2', 'A1', 2000);
    expect(g.lock('p2')!.cell).toBe(A1);
  });

  it('[D2] the one who erred may lock it again only after one second (§6.2.6: "after a release for any reason … or a mistake")', () => {
    const g = GameDriver.of();
    expect(g.state.config.rules.relockCooldownAfter).toContain('mistake'); // the default
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5, 2000);
    expect(g.state.cooldowns).toEqual([{ playerId: 'p1', cell: A1, until: 3000 }]);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 2999)).toBe('cooldown');
    // My screen shows the wait on that cell; nobody else has one.
    expect(g.view('p1').cooldowns).toEqual([{ cell: A1, until: 3000 }]);
    expect(g.view('p2').cooldowns).toEqual([]);
    g.select('p1', 'A1', 3000);
    expect(g.lock('p1')!.cell).toBe(A1);
    expect(g.view('p1').cooldowns).toEqual([]);
  });

  it('[D2] the wait holds only the one who erred, and only in that cell', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5, 2000);
    g.select('p1', 'A2', 2000); // another cell: at once
    expect(g.lock('p1')!.cell).toBe(A2);
    g.select('p2', 'A1', 2000); // another player: at once
    expect(g.lock('p2')!.cell).toBe(A1);
    expect(g.view('p2').cooldowns).toEqual([]);
  });

  it("[D2] the wait is a rule: without 'mistake' in relockCooldownAfter (or with no wait) the one who erred may relock at once", () => {
    const withoutMistake = GameDriver.of({
      rules: { relockCooldownAfter: ['cancel', 'timeout', 'switch', 'disconnect'] },
    });
    withoutMistake.select('p1', 'A1', 0);
    withoutMistake.place('p1', 'A1', 5, 2000);
    expect(withoutMistake.state.cooldowns).toEqual([]);
    withoutMistake.select('p1', 'A1', 2000);
    expect(withoutMistake.lock('p1')!.cell).toBe(A1);

    const noWait = GameDriver.of({ rules: { relockCooldownMs: 0 } });
    noWait.select('p1', 'A1', 0);
    noWait.place('p1', 'A1', 5, 2000);
    noWait.select('p1', 'A1', 2000);
    expect(noWait.lock('p1')!.cell).toBe(A1);
    expect(defaultRules('ranked', 'fast').relockCooldownMs).toBe(1000);
  });

  it('[D3 keepLock] stays locked to whoever erred, who may go on trying', () => {
    const g = GameDriver.of({ rules: { afterMistake: 'keepLock' } });
    g.select('p1', 'A1', 0);
    const events = g.place('p1', 'A1', 5, 2000);
    expect(g.types(events)).toEqual(['placedWrong']);
    expect(g.lock('p1')).toMatchObject({ cell: A1, lockedAt: 0, expiresAt: 8000 });
    expect(g.state.cooldowns).toEqual([]); // nothing was released, so there is no wait [D2]
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 }, 2000)).toBe('cellTaken');
    // The same digit is still refused, a new wrong one costs the cell's value again, the right one ends the lock.
    expect(g.reject(placeAt('p1', A1, 5), 2500)).toBe('digitTried');
    expect(g.place('p1', 'A1', 6, 3000)[0]).toMatchObject({
      type: 'placedWrong',
      penalty: 8,
      mistakes: 2,
      score: -16,
    });
    expect(g.place('p1', 'A1', 8, 5000)[0]).toMatchObject({
      type: 'placedCorrect',
      thinkMs: 5000,
      score: -8,
    });
    expect(g.lock('p1')).toBeUndefined();
    expect(g.state.wrong[A1]).toEqual([
      { digit: 5, playerId: 'p1' },
      { digit: 6, playerId: 'p1' },
    ]);
  });

  it('[D3 keepLock] the kept lock still runs out at its original time', () => {
    const g = GameDriver.of({ rules: { afterMistake: 'keepLock' } });
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5, 3000);
    expect(g.deadline).toBe(8000);
    const [e] = g.tickTo(8000);
    expect(e).toMatchObject({ type: 'cellReleased', playerId: 'p1', cell: A1, reason: 'timeout' });
    expect(g.score('p1')).toBe(-8);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('[D15] score below zero (§6.5)', () => {
  it('by default the score may go below zero', () => {
    const g = GameDriver.of();
    expect(missed(g, 'p1', 'A1')).toMatchObject({ score: -8 });
    expect(missed(g, 'p1', 'A2')).toMatchObject({ score: -15.5 });
    expect(g.score('p1')).toBe(-15.5);
    expect(g.view('p2').players[0]!.score).toBe(-15.5);
  });

  it('with negativeScore: false the score stops at zero, and the event still carries the full penalty', () => {
    const g = GameDriver.of({ rules: { negativeScore: false } });
    expect(missed(g, 'p1', 'A2')).toMatchObject({ penalty: 7.5, mistakes: 1, score: 0 });
    g.solve('p1', 'A1'); // 8 (A2 holds only a wrong mark)
    expect(g.score('p1')).toBe(8);
    expect(missed(g, 'p1', 'A5')).toMatchObject({ penalty: 7, mistakes: 2, score: 1 });
    expect(missed(g, 'p1', 'A6')).toMatchObject({ penalty: 6, mistakes: 3, score: 0 });
    expect(missed(g, 'p1', 'A8')).toMatchObject({ penalty: 6, mistakes: 4, score: 0 });
    expect(g.player('p1').mistakePenalties).toEqual([7.5, 7, 6, 6]);
    g.solve('p1', 'B4');
    expect(g.score('p1')).toBe(g.last('placedCorrect')!.points); // counts up from zero, not from −18.5
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the keypad in the view (§6.3)', () => {
  it('shows how many of each digit are still to be placed', () => {
    const g = GameDriver.of();
    expect(g.view('p1').keypad.remaining).toEqual(START_REMAINING);
    g.solve('p1', 'A1'); // an 8
    const after = START_REMAINING.slice();
    after[7] = 5;
    expect(g.view('p1').keypad.remaining).toEqual(after);
    expect(g.view('p2').keypad.remaining).toEqual(after);
    // A wrong digit is not on the board: the counts stay.
    g.miss('p2', 'A2');
    expect(g.view('p2').keypad.remaining).toEqual(after);
  });

  it('works only while I hold a lock and the game runs', () => {
    const g = GameDriver.of();
    expect(g.view('p1').keypad.enabled).toBe(false);
    g.select('p1', 'A1', 0);
    expect(g.view('p1').keypad.enabled).toBe(true);
    expect(g.view('p2').keypad.enabled).toBe(false);
    expect(g.view(null).keypad.enabled).toBe(false); // a spectator has no keypad
    g.tickTo(8000); // the lock runs out
    expect(g.view('p1').keypad.enabled).toBe(false);

    g.select('p1', 'A1', 9500);
    g.place('p1', 'A1', 8); // a correct digit ends the lock
    expect(g.view('p1').keypad.enabled).toBe(false);

    g.select('p1', 'A2', 9500);
    g.place('p1', 'A2', 1); // so does a mistake [D3]
    expect(g.view('p1').keypad.enabled).toBe(false);

    g.select('p1', 'A5', 9500);
    g.act({ type: 'disconnect', playerId: 'p2' }); // 2 players: frozen, the lock is kept
    expect(g.lock('p1')).toBeDefined();
    expect(g.view('p1').keypad.enabled).toBe(false);
    g.act({ type: 'reconnect', playerId: 'p2' }, 10500);
    expect(g.view('p1').keypad.enabled).toBe(true);
  });

  it('goes with my lock on the card: its cell and timer, standing still while the game is frozen (§6.2.7, §6.8)', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 1000); // runs out at 9000
    for (const viewer of ['p1', 'p2', null])
      expect(g.view(viewer).players[0]!.lock).toEqual({ cell: A1, expiresAt: 9000, remainingMs: 8000 });
    expect(g.view('p1').players[1]!.lock).toBeNull();

    g.act({ type: 'disconnect', playerId: 'p2' }, 3000); // 2 players: frozen with 6000 left
    g.tickTo(5000);
    expect(g.view('p1').players[0]!.lock).toEqual({ cell: A1, expiresAt: null, remainingMs: 6000 });
    expect(g.view('p1').keypad.enabled).toBe(false);

    g.act({ type: 'reconnect', playerId: 'p2' }, 7000); // 4000 later
    expect(g.view('p1').players[0]!.lock).toMatchObject({ cell: A1, expiresAt: 13000 });
    expect(g.view('p1').keypad.enabled).toBe(true);
  });

  it('goes with my lock under interference: the timer stands still, the keypad still works (§6.2.7) [D11]', () => {
    const g = GameDriver.of();
    g.solve('p2', 'B7', 0); // 6 points, enough for an interference (cost 2)
    g.select('p1', 'A1', 1000); // runs out at 9000
    g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'fireworks' }, 3000);
    expect(g.view('p2').players[0]!.lock).toEqual({ cell: A1, expiresAt: null, remainingMs: 6000 });
    expect(g.view('p1').keypad.enabled).toBe(true);
    g.tickTo(8000); // the interference ends: 6000 left from now
    expect(g.view('p1').players[0]!.lock).toEqual({ cell: A1, expiresAt: 14000, remainingMs: 6000 });
  });

  it('is off once the game is over', () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES });
    for (const cell of SIX_HOLES_CELLS) g.solve('p1', cell);
    expect(g.view('p1').keypad.enabled).toBe(false);
    expect(g.view('p1').keypad.remaining).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(g.view('p1').keypad.disabled).toEqual([...DIGITS]);
  });

  it('dims a digit with all nine on the board, with or without a lock', () => {
    const g = GameDriver.of({ puzzle: ALL_EIGHTS });
    expect(g.view('p1').keypad.remaining[7]).toBe(0);
    expect(g.view('p1').keypad.disabled).toEqual([8]);
    g.select('p1', 'A2');
    expect(g.view('p1').keypad.disabled).toEqual([8]);
    expect(g.view('p2').keypad.disabled).toEqual([8]);
  });

  it('dims the ninth one as soon as it is placed', () => {
    const g = GameDriver.of({ puzzle: ONE_EIGHT_LEFT });
    expect(g.view('p1').keypad.remaining[7]).toBe(1);
    expect(g.view('p1').keypad.disabled).toEqual([]);
    g.solve('p2', 'A1');
    expect(g.view('p1').keypad.remaining[7]).toBe(0);
    expect(g.view('p1').keypad.disabled).toEqual([8]);
  });

  it("[D12 'everyone'] dims a digit tried wrongly in my locked cell, for every player, only in that cell", () => {
    // Every 8 is a given here, so 8 is dimmed throughout; A2 (answer 6) takes the wrong 5.
    const g = GameDriver.of({ players: 3, puzzle: ALL_EIGHTS });
    g.select('p1', 'A2', 0);
    g.place('p1', 'A2', 5);
    expect(g.view('p1').keypad.disabled).toEqual([8]); // no lock now: only the complete digit
    g.select('p2', 'A2', 0);
    expect(g.view('p2').keypad.disabled).toEqual([5, 8]);
    expect(g.view('p3').keypad.disabled).toEqual([8]); // p3 holds no lock on A2
    g.select('p2', 'A5', 0); // another cell: 5 is free again
    expect(g.view('p2').keypad.disabled).toEqual([8]);
    g.select('p1', 'A2', 1000);
    expect(g.view('p1').keypad.disabled).toEqual([5, 8]);
  });

  it("[D12 'mistaker'] dims it only for whoever tried it", () => {
    const g = GameDriver.of({ rules: { wrongDigitDisabledFor: 'mistaker' } });
    g.select('p1', 'A1', 0);
    g.place('p1', 'A1', 5);
    g.select('p2', 'A1', 0);
    expect(g.view('p2').keypad.disabled).toEqual([]);
    g.playerAct('p2', { type: 'release' }, 500);
    g.select('p1', 'A1', 1000);
    expect(g.view('p1').keypad.disabled).toEqual([5]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the last cell (§6.4, §6.7)', () => {
  it('filling the last cell ends the game (boardComplete); the last cell is always worth 1.5', () => {
    const g = GameDriver.of();
    solveAll(g, 'p1');
    const lastPlaced = g.last('placedCorrect')!;
    expect(lastPlaced).toMatchObject({
      points: 1.5,
      breakdown: { row: 8, col: 8, box: 8, num: 8, X: 8, Y: 8 },
    });
    expect(g.types().slice(-2)).toEqual(['placedCorrect', 'gameOver']);
    expect(g.last('gameOver')).toMatchObject({ reason: 'boardComplete', t: lastPlaced.t });
    expect(g.state.status).toBe('over');
    expect(g.state.grid.join('')).toBe(PUZZLE.solution);
  });

  it('whoever fills it, in a game shared between players', () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES });
    g.solve('p1', 'A1'); // 3.5
    g.solve('p2', 'A2');
    g.solve('p1', 'B1');
    g.solve('p2', 'C1');
    g.solve('p1', 'B4');
    expect(g.state.status).toBe('running');
    g.select('p2', 'C7');
    const events = g.place('p2', 'C7', 8);
    expect(g.types(events)).toEqual(['placedCorrect', 'gameOver']);
    expect(events[0]).toMatchObject({ cell: C7, points: 1.5 });
    expect(events[1]).toMatchObject({ type: 'gameOver', reason: 'boardComplete' });
  });

  it('in solo practice too', () => {
    const g = GameDriver.of({ players: 1, puzzle: SIX_HOLES });
    for (const cell of SIX_HOLES_CELLS) g.solve('p1', cell);
    expect(g.last('gameOver')).toMatchObject({ reason: 'boardComplete' });
  });

  it('a wrong digit does not end the game, even with one other empty cell left', () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES });
    for (const cell of ['A1', 'A2', 'B4', 'C7']) g.solve('p1', cell);
    // Left: B1 (3) and C1 (9). A 9 in B1 is wrong but not complete yet; a near-full board makes it cheap.
    g.select('p2', 'B1');
    expect(g.place('p2', 'B1', 9)[0]).toMatchObject({ type: 'placedWrong', penalty: 1.5 });
    expect(g.state.status).toBe('running');
    expect(g.types()).not.toContain('gameOver');
  });

  it('in the last empty cell every wrong digit is already complete: only the right one can go in', () => {
    const g = GameDriver.of({ puzzle: SIX_HOLES });
    for (const cell of SIX_HOLES_CELLS.slice(0, 5)) g.solve('p1', cell);
    g.select('p2', 'C7'); // the last hole; its answer is 8
    expect(g.view('p2').keypad.disabled).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    for (const d of [1, 2, 3, 4, 5, 6, 7, 9]) expect(g.reject(placeAt('p2', C7, d))).toBe('digitComplete');
    expect(g.player('p2')).toMatchObject({ mistakes: 0, score: 0 });
    expect(g.state.status).toBe('running');
    g.place('p2', 'C7', 8);
    expect(g.state.status).toBe('over');
  });
});

describe('replay', () => {
  it('every digit, right or wrong, is in the replay', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1');
    g.miss('p2', 'A2');
    g.miss('p3', 'A2');
    g.solve('p2', 'B4');
    g.select('p3', 'A5');
    g.place('p3', 'A5', answer('A5'), 500);
    expect(g.replayMatches()).toBe(true);
  });
});
