import { cellDifficulties } from '../bot/brain';
import { GAME_TYPES } from '../gameType';
import { bankPuzzles } from '../testing/bot';
import { GameDriver } from '../testing/game';
import { BOXES, type CellIndex, type Digit, DIGITS, parseCellName, parseGrid } from './board';
import { type Technique, TECHNIQUES } from './logic';
import { closedBoard, type ExcludedDigits, knowableCells, knowablePlacements } from './reading';

const SINGLES: Technique[] = ['nakedSingle', 'hiddenSingle'];

/** The cells the bot can solve on the board as it is: every empty cell it does not class as 'harder'. */
function botKnowable(driver: GameDriver): CellIndex[] {
  return cellDifficulties(driver.state).flatMap((d, cell) => (d && d.technique !== 'harder' ? [cell] : []));
}

/** The wrong tries of a game, as the reading takes them. */
function wrongTries(driver: GameDriver): ExcludedDigits {
  const out = new Map<CellIndex, Digit[]>();
  driver.state.wrong.forEach((tries, cell) => {
    if (tries.length)
      out.set(
        cell,
        tries.map((w) => w.digit),
      );
  });
  return out;
}

describe('knowableCells reads a board as the bot does (bot/brain)', () => {
  it.each(GAME_TYPES)('agrees with the bot on 30 %s boards of the offline bank', (gameType) => {
    for (const puzzle of bankPuzzles(gameType, 30)) {
      const driver = GameDriver.of({ puzzle, players: 1, gameType });
      expect(knowableCells(driver.state.grid, TECHNIQUES)).toEqual(botKnowable(driver));
    }
  });

  it('and with the wrong tries everyone sees [D12]', () => {
    let changed = 0;
    for (const puzzle of bankPuzzles('normal', 10)) {
      const driver = GameDriver.of({ puzzle, players: 1, gameType: 'normal' });
      const sol = parseGrid(puzzle.solution);
      // Two wrong digits in each of the first six empty cells (the bot reads only the grid and the tries).
      const wrong = driver.state.wrong.map((tries) => tries.slice());
      const empty = driver.state.grid.flatMap((v, i) => (v === 0 ? [i] : [])).slice(0, 6);
      for (const cell of empty)
        for (const digit of DIGITS.filter((d) => d !== sol[cell]).slice(0, 2))
          wrong[cell]!.push({ digit, playerId: 'p1' });
      driver.state = { ...driver.state, wrong };
      const excluded = wrongTries(driver);
      expect(excluded.size).toBe(6);
      const known = knowableCells(driver.state.grid, TECHNIQUES, excluded);
      expect(known).toEqual(botKnowable(driver));
      if (known.join() !== knowableCells(driver.state.grid).join()) changed++;
    }
    expect(changed).toBeGreaterThan(0); // the tries do make cells knowable
  });

  it('gives the solution digit of every knowable cell', () => {
    for (const gameType of GAME_TYPES)
      for (const p of bankPuzzles(gameType, 10)) {
        const sol = parseGrid(p.solution);
        for (const { cell, digit } of knowablePlacements(parseGrid(p.givens))) expect(digit).toBe(sol[cell]);
      }
  });

  it('knows less with fewer techniques, and nothing without a single', () => {
    for (const p of bankPuzzles('normal', 10)) {
      const grid = parseGrid(p.givens);
      const all = knowableCells(grid);
      const singles = knowableCells(grid, SINGLES);
      expect(singles.every((c) => all.includes(c))).toBe(true);
      expect(knowableCells(grid, ['nakedSingle']).every((c) => singles.includes(c))).toBe(true);
      expect(knowableCells(grid, ['pointing', 'claiming'])).toEqual([]);
    }
  });
});

describe('adding a correct digit', () => {
  it.each(GAME_TYPES)(
    'never removes another knowable cell with the singles (30 %s boards, every empty cell)',
    (gameType) => {
      for (const p of bankPuzzles(gameType, 30)) {
        const grid = parseGrid(p.givens);
        const sol = parseGrid(p.solution);
        const before = knowableCells(grid, SINGLES);
        for (let cell = 0; cell < 81; cell++) {
          if (grid[cell] !== 0) continue;
          const next = grid.slice();
          next[cell] = sol[cell]!;
          const after = new Set(knowableCells(next, SINGLES));
          expect(before.filter((c) => c !== cell && !after.has(c))).toEqual([]);
        }
      }
    },
  );

  it('can end an elimination: the new single is then filled first (no cell is placed while reading)', () => {
    // Offline fast board e61d22ce…: box 6 keeps its 9 in column 8 (two places), a pointing that takes the 9
    // out of C8, so C8 is a 4. With E1's 9 on the board, box 6 has one place left for its 9: a single, which
    // the reading does not fill, so there is no pointing any more and C8 waits for that 9 (as the bot does).
    const p = bankPuzzles('fast', 30).find((q) => q.id === 'e61d22ce87bb5f88')!;
    const grid = parseGrid(p.givens);
    const sol = parseGrid(p.solution);
    const c8 = parseCellName('C8');
    const e1 = parseCellName('E1');
    expect(knowableCells(grid)).toContain(c8);
    expect(knowableCells(grid, SINGLES)).not.toContain(c8); // it takes an elimination
    const next = grid.slice();
    next[e1] = sol[e1]!;
    expect(knowableCells(next)).not.toContain(c8);
  });
});

describe('closedBoard', () => {
  it('fills a fast board to its solution with every technique', () => {
    for (const p of bankPuzzles('fast', 5))
      expect(closedBoard(parseGrid(p.givens))).toEqual(parseGrid(p.solution));
  });

  it('stops where the techniques do, every filled cell right and nothing knowable left', () => {
    for (const p of bankPuzzles('hard', 5)) {
      const grid = parseGrid(p.givens);
      const sol = parseGrid(p.solution);
      const closed = closedBoard(grid, SINGLES);
      closed.forEach((v, i) => {
        if (v !== 0) expect(v).toBe(sol[i]);
        if (grid[i] !== 0) expect(v).toBe(grid[i]);
      });
      expect(knowableCells(closed, SINGLES)).toEqual([]);
    }
  });

  it('fills only the cells it may (a fill-the-box level)', () => {
    const p = bankPuzzles('fast', 1)[0]!;
    const grid = parseGrid(p.givens);
    const sol = parseGrid(p.solution);
    const box = BOXES.find((b) => b.cells.filter((c) => grid[c] === 0).length >= 3)!;
    const closed = closedBoard(grid, TECHNIQUES, new Set(box.cells));
    closed.forEach((v, i) => {
      if (box.cells.includes(i)) expect(v).toBe(sol[i]);
      else expect(v).toBe(grid[i]);
    });
  });
});
