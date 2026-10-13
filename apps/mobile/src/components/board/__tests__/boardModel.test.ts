import { type CellIndex, DIGITS, type Digit, parseCellName } from '@sudoku-fight/engine';

import { color } from '../../../theme';
import {
  boardModel,
  type BoardModel,
  type CellModel,
  emptyCell,
  shownWrongDigits,
  timerRemainingMs,
  WRONG_DIGITS_SHOWN,
} from '../boardModel';
import { DEMO_PUZZLE, demoAnswer, demoBoard, DemoGame, demoWrong } from '../demo';

const at = (m: BoardModel, name: string): CellModel => m.cells[parseCellName(name)]!;
const kinds = (m: BoardModel) => m.cells.map((c) => c.kind);

describe('boardModel: a fresh game', () => {
  const g = new DemoGame();
  const m = boardModel(g.view('moshe'), 0, g.now);

  it('has 81 cells in row order, named like D5, with the checkerboard by box', () => {
    expect(m.cells).toHaveLength(81);
    expect(m.cells.map((c) => c.index)).toEqual([...Array(81).keys()]);
    expect(at(m, 'D5')).toMatchObject({ index: 31, name: 'D5', row: 3, col: 4, box: 4, alt: false });
    expect(at(m, 'A4')).toMatchObject({ box: 1, alt: true });
    expect(at(m, 'E1')).toMatchObject({ box: 3, alt: true });
    expect(at(m, 'I9')).toMatchObject({ box: 8, alt: false });
    expect(m.cells.filter((c) => c.alt).map((c) => c.box)).toEqual(expect.arrayContaining([1, 3, 5, 7]));
    expect(new Set(m.cells.filter((c) => c.alt).map((c) => c.box))).toEqual(new Set([1, 3, 5, 7]));
  });

  it('shows the givens and leaves the rest empty and tappable', () => {
    [...DEMO_PUZZLE.givens].forEach((ch, i) => {
      const cell = m.cells[i]!;
      if (ch === '0') {
        expect(cell).toMatchObject({ kind: 'empty', digit: null, player: null, interactive: true });
      } else {
        expect(cell).toMatchObject({ kind: 'given', digit: Number(ch), player: null, interactive: false });
      }
    });
  });

  it('has no locks, an idle keypad and counts what is left of each digit', () => {
    expect(m.myLock).toBeNull();
    expect(m.otherLocks).toEqual([]);
    expect(m.keypad.enabled).toBe(false);
    const placed = (d: number) => [...DEMO_PUZZLE.givens].filter((c) => c === String(d)).length;
    expect(m.keypad.keys.map((k) => k.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.keypad.keys.map((k) => k.remaining)).toEqual(DIGITS.map((d) => 9 - placed(d)));
    expect(m.keypad.keys.every((k) => k.state === 'idle' && k.disabled)).toBe(true);
  });

  it('is not interactive before the start, for a spectator, or for a player who left', () => {
    const waiting = new DemoGame({ start: false });
    expect(boardModel(waiting.view('moshe'), 0, 0).cells.some((c) => c.interactive)).toBe(false);
    expect(boardModel(g.view(null), null, g.now).cells.some((c) => c.interactive)).toBe(false);
    const left = new DemoGame({ players: 3 }).act({ type: 'surrender', playerId: 'moshe' });
    expect(boardModel(left.view('moshe'), 0, left.now).cells.some((c) => c.interactive)).toBe(false);
  });
});

describe('boardModel: solved cells and colours (me is always P1)', () => {
  const g = new DemoGame().solve('moshe', 'A1', 1000).solve('nina', 'A2', 2000);

  it('marks the solver with my palette (P1) on my phone, and the opponent with P2', () => {
    const m = boardModel(g.view('moshe'), 0, g.now);
    expect(at(m, 'A1')).toMatchObject({
      kind: 'solved',
      digit: demoAnswer('A1'),
      interactive: false,
      player: { id: 'moshe', seat: 0, colorIndex: 0, name: 'MosheG', isMe: true, avatar: 'av00' },
    });
    expect(at(m, 'A2').player).toMatchObject({ id: 'nina', colorIndex: 1, isMe: false, name: 'NinaVolt' });
  });

  it('swaps the colours on the opponent’s phone: each one sees themselves in P1', () => {
    const m = boardModel(g.view('nina'), 1, g.now);
    expect(at(m, 'A2').player).toMatchObject({ id: 'nina', colorIndex: 0, isMe: true });
    expect(at(m, 'A1').player).toMatchObject({ id: 'moshe', colorIndex: 1, isMe: false });
  });

  it('gives P2–P4 to the others in seat order in a four-player game', () => {
    const g4 = new DemoGame({ players: 4 })
      .solve('moshe', 'A1', 1000)
      .solve('nina', 'A2', 2000)
      .solve('aiko', 'B1', 3000)
      .solve('omar', 'B2', 4000);
    const mine = boardModel(g4.view('aiko'), 2, g4.now);
    expect(['A1', 'A2', 'B1', 'B2'].map((c) => at(mine, c).player!.colorIndex)).toEqual([1, 2, 0, 3]);
    const spectator = boardModel(g4.view(null), null, g4.now);
    expect(['A1', 'A2', 'B1', 'B2'].map((c) => at(spectator, c).player!.colorIndex)).toEqual([0, 1, 2, 3]);
    expect(spectator.cells.some((c) => c.player?.isMe)).toBe(false);
  });

  it('uses each player’s avatar when given one', () => {
    const m = boardModel(g.view('moshe'), 0, g.now, { avatars: { nina: 'maya' } });
    expect(at(m, 'A2').player!.avatar).toBe('maya');
    expect(at(m, 'A1').player!.avatar).toBe('av00');
  });
});

describe('boardModel: locks and their seconds', () => {
  it('my lock: seconds from expiresAt, rounded up, urgent in the last 3 s', () => {
    const g = new DemoGame().select('moshe', 'D5', 1000);
    const view = g.view('moshe');
    const at0 = boardModel(view, 0, 1000);
    expect(at(at0, 'D5')).toMatchObject({
      kind: 'myLock',
      interactive: false,
      player: { id: 'moshe', colorIndex: 0 },
      lock: { seconds: 12, remainingMs: 12000, paused: false, urgent: false },
    });
    expect(at0.myLock).toMatchObject({ cell: 31, name: 'D5', seconds: 12 });
    // Same view, later clock: the board counts down on its own.
    expect(at(boardModel(view, 0, 6000), 'D5').lock).toMatchObject({ seconds: 7, urgent: false });
    expect(at(boardModel(view, 0, 9900), 'D5').lock).toMatchObject({ seconds: 4, urgent: false });
    expect(at(boardModel(view, 0, 10000), 'D5').lock).toMatchObject({ seconds: 3, urgent: true });
    expect(at(boardModel(view, 0, 11900), 'D5').lock).toMatchObject({ seconds: 2, urgent: true });
    expect(at(boardModel(view, 0, 12100), 'D5').lock).toMatchObject({ seconds: 1, urgent: true });
    expect(at(boardModel(view, 0, 20000), 'D5').lock).toMatchObject({
      seconds: 0,
      remainingMs: 0,
      urgent: false,
    });
  });

  it('an opponent’s lock: their palette, interactive ("taken"), never urgent, listed for the label', () => {
    const g = new DemoGame().select('nina', 'A8', 1000);
    const m = boardModel(g.view('moshe'), 0, 1000 + 8100, { avatars: { nina: 'lava-lamp' } });
    expect(at(m, 'A8')).toMatchObject({
      kind: 'oppLock',
      interactive: true,
      player: { id: 'nina', colorIndex: 1, avatar: 'lava-lamp', isMe: false },
      lock: { seconds: 4, paused: false, urgent: false },
    });
    expect(m.myLock).toBeNull();
    expect(m.otherLocks).toEqual([
      expect.objectContaining({ name: 'A8', seconds: 4, player: at(m, 'A8').player }),
    ]);
    // Nina sees the same cell as her own lock.
    expect(at(boardModel(g.view('nina'), 1, 1000), 'A8').kind).toBe('myLock');
  });

  it('a lock under interference is paused: remainingMs, no countdown, no urgency [D11]', () => {
    const g = new DemoGame()
      .solve('nina', 'A1', 1000)
      .solve('nina', 'A2', 2000)
      .select('moshe', 'D5', 3000)
      .act({ type: 'interfere', playerId: 'nina', targetId: 'moshe', kind: 'cats' }, 4000);
    const view = g.view('moshe');
    for (const now of [4000, 6000, 8000]) {
      expect(at(boardModel(view, 0, now), 'D5').lock).toEqual({
        seconds: 11,
        remainingMs: 11000,
        paused: true,
        urgent: false,
      });
    }
    // The opponent's phone sees the same stopped timer.
    expect(at(boardModel(g.view('nina'), 1, 8000), 'D5')).toMatchObject({
      kind: 'oppLock',
      lock: { seconds: 11, paused: true },
    });
  });

  it('stops every lock while a two-player game is frozen by a disconnect (spec §16.2)', () => {
    const g = new DemoGame()
      .select('moshe', 'D5', 1000)
      .select('nina', 'A8', 1000)
      .act({ type: 'disconnect', playerId: 'nina' }, 3000);
    const m = boardModel(g.view('moshe'), 0, 9000);
    expect(at(m, 'D5').lock).toMatchObject({ paused: true, seconds: 10 });
    expect(at(m, 'A8').lock).toMatchObject({ paused: true, seconds: 10 });
    // Frozen: nothing to tap.
    expect(m.cells.some((c) => c.interactive)).toBe(false);
  });

  it('moves the lock with a switch, and marks the cell I let go of as cooling down [D2]', () => {
    const g = new DemoGame().select('moshe', 'D5', 1000).select('moshe', 'E5', 1500);
    const m = boardModel(g.view('moshe'), 0, 1500);
    expect(at(m, 'D5')).toMatchObject({ kind: 'empty', cooldown: true, interactive: true });
    expect(at(m, 'E5').kind).toBe('myLock');
    g.act({ type: 'release', playerId: 'moshe' }, 1600);
    const released = boardModel(g.view('moshe'), 0, 1600);
    expect(released.myLock).toBeNull();
    expect(at(released, 'E5')).toMatchObject({ kind: 'empty', cooldown: true });
    g.advance(1000);
    expect(at(boardModel(g.view('moshe'), 0, g.now), 'E5').cooldown).toBe(false);
  });
});

describe('boardModel: a pending tap (optimistic display, spec §18)', () => {
  it('shows my unconfirmed tap as pending, in my colour, and not tappable again', () => {
    const g = new DemoGame();
    const m = boardModel(g.view('moshe'), 0, 0, { pendingCell: parseCellName('D5') });
    expect(at(m, 'D5')).toMatchObject({ kind: 'pending', interactive: false, player: { colorIndex: 0 } });
    expect(m.myLock).toBeNull();
    expect(kinds(m).filter((k) => k === 'pending')).toHaveLength(1);
  });

  it('gives way to what the server says: my lock, an opponent’s lock, or a filled cell', () => {
    const g = new DemoGame().solve('nina', 'A1', 900).select('moshe', 'D5', 1000).select('nina', 'A8', 1000);
    const opts = (cell: string) => ({ pendingCell: parseCellName(cell) as CellIndex });
    expect(at(boardModel(g.view('moshe'), 0, 1100, opts('D5')), 'D5').kind).toBe('myLock');
    expect(at(boardModel(g.view('moshe'), 0, 1100, opts('A8')), 'A8').kind).toBe('oppLock');
    expect(at(boardModel(g.view('moshe'), 0, 1100, opts('A1')), 'A1').kind).toBe('solved');
    expect(at(boardModel(g.view('moshe'), 0, 1100, opts('A3')), 'A3').kind).toBe('given');
    // A spectator has no taps.
    expect(boardModel(g.view(null), null, 1100, opts('E5')).cells.some((c) => c.kind === 'pending')).toBe(
      false,
    );
  });
});

describe('boardModel: wrong digits (spec §6.5) and the keypad (spec §6.3, D12)', () => {
  it('keeps every player’s wrong digits, oldest first, each once, after the cell is solved too', () => {
    const g = new DemoGame({ players: 3 })
      .miss('nina', 'E5', 1, 1000)
      .miss('aiko', 'E5', 2, 2000)
      .miss('moshe', 'E5', 3, 3000)
      .miss('nina', 'E5', 4, 4000);
    const m = boardModel(g.view('moshe'), 0, g.now);
    expect(at(m, 'E5')).toMatchObject({ kind: 'empty', wrong: [1, 2, 3, 4] });
    expect(shownWrongDigits(at(m, 'E5'))).toEqual([2, 3, 4]);
    expect(WRONG_DIGITS_SHOWN).toBe(3);
    g.advance(1000).solve('moshe', 'E5');
    expect(at(boardModel(g.view('moshe'), 0, g.now), 'E5')).toMatchObject({
      kind: 'solved',
      wrong: [1, 2, 3, 4],
    });
  });

  it('lists a digit once when two players tried it ("mistaker" rule) ', () => {
    const g = new DemoGame({ rules: { wrongDigitDisabledFor: 'mistaker' } })
      .miss('nina', 'E5', 1, 1000)
      .miss('moshe', 'E5', 1, 2000);
    expect(at(boardModel(g.view('moshe'), 0, g.now), 'E5').wrong).toEqual([1]);
  });

  it('arms the keypad while I hold a lock, and disables a digit tried wrongly in my cell [D12]', () => {
    const tried = demoWrong('F8');
    const g = new DemoGame().miss('nina', 'F8', tried, 1000).select('moshe', 'F8', 2000);
    const m = boardModel(g.view('moshe'), 0, g.now);
    expect(m.keypad.enabled).toBe(true);
    for (const key of m.keypad.keys) {
      if (key.digit === tried) expect(key).toMatchObject({ state: 'tried', disabled: true });
      else expect(key).toMatchObject({ state: 'armed', disabled: false });
    }
    // Elsewhere the digit is fine again.
    g.act({ type: 'release', playerId: 'moshe' }, 3000).select('moshe', 'D5', 3000);
    expect(boardModel(g.view('moshe'), 0, g.now).keypad.keys[tried - 1]!.state).toBe('armed');
  });

  it('greys out a complete digit; "complete" wins over "tried" [D12]', () => {
    // The digit with the fewest empty cells, all solved.
    const empties = (d: number) =>
      [...DEMO_PUZZLE.solution]
        .map((s, i) => (s === String(d) && DEMO_PUZZLE.givens[i] === '0' ? i : -1))
        .filter((i) => i >= 0);
    const d = DIGITS.slice().sort((a, b) => empties(a).length - empties(b).length)[0]!;
    // A cell whose answer is not d, where d was tried wrongly.
    const other = [...DEMO_PUZZLE.givens].findIndex(
      (c, i) => c === '0' && DEMO_PUZZLE.solution[i] !== String(d),
    );
    const otherName = emptyCell(other).name;
    const g = new DemoGame().miss('nina', otherName, d, 500);
    let t = 1000;
    for (const i of empties(d)) g.solve('moshe', emptyCell(i).name, (t += 100));
    const idle = boardModel(g.view('moshe'), 0, g.now);
    expect(idle.keypad.keys[d - 1]).toMatchObject({ remaining: 0, state: 'complete', disabled: true });
    g.select('moshe', otherName, (t += 100));
    const locked = boardModel(g.view('moshe'), 0, g.now);
    expect(locked.keypad.keys[d - 1]).toMatchObject({ remaining: 0, state: 'complete', disabled: true });
    expect(locked.keypad.keys.filter((k) => k.state === 'complete')).toHaveLength(1);
  });

  it('counts only placed digits, never wrong marks, in "remaining"', () => {
    const g = new DemoGame();
    const before = boardModel(g.view('moshe'), 0, 0).keypad.keys.map((k) => k.remaining);
    g.miss('moshe', 'E5', 1, 1000);
    expect(boardModel(g.view('moshe'), 0, g.now).keypad.keys.map((k) => k.remaining)).toEqual(before);
    g.advance(1000).solve('moshe', 'E5');
    const after = boardModel(g.view('moshe'), 0, g.now).keypad.keys.map((k) => k.remaining);
    const d: Digit = demoAnswer('E5');
    expect(after[d - 1]).toBe(before[d - 1]! - 1);
  });
});

describe('boardModel: the demo board has every cell state at once', () => {
  const { view, mySeat, now } = demoBoard();
  const m = boardModel(view, mySeat, now, { pendingCell: parseCellName('I1') });

  it('draws givens, four solvers, my lock, two opponents’ locks (one paused) and a pending tap', () => {
    expect(new Set(kinds(m))).toEqual(new Set(['given', 'solved', 'empty', 'myLock', 'oppLock', 'pending']));
    expect(new Set(m.cells.filter((c) => c.kind === 'solved').map((c) => c.player!.colorIndex))).toEqual(
      new Set([0, 1, 2, 3]),
    );
    expect(m.myLock).toMatchObject({ name: 'F8', seconds: 7, paused: false });
    expect(m.otherLocks.map((l) => [l.name, l.player.name, l.paused])).toEqual([
      ['D4', 'NinaVolt', true],
      ['A8', 'Aiko_M', false],
    ]);
    expect(at(m, 'F8').wrong).toHaveLength(1);
    expect(at(m, 'E5').wrong).toHaveLength(2);
    expect(at(m, 'A5')).toMatchObject({ kind: 'solved', wrong: [expect.any(Number)] });
    expect(m.keypad.keys.filter((k) => k.state === 'tried')).toHaveLength(1);
    expect(color.players[at(m, 'A5').player!.colorIndex]!.name).toBe('P2');
  });
});

describe('timerRemainingMs and emptyCell', () => {
  it('reads a running timer from expiresAt and a stopped one from remainingMs', () => {
    expect(timerRemainingMs({ expiresAt: 5000, remainingMs: 999 }, 2000)).toBe(3000);
    expect(timerRemainingMs({ expiresAt: 5000, remainingMs: 999 }, 9000)).toBe(0);
    expect(timerRemainingMs({ expiresAt: null, remainingMs: 4200 }, 9000)).toBe(4200);
  });

  it('builds a blank cell with its name and checkerboard', () => {
    expect(emptyCell(80)).toEqual({
      index: 80,
      name: 'I9',
      row: 8,
      col: 8,
      box: 8,
      alt: false,
      kind: 'empty',
      digit: null,
      player: null,
      lock: null,
      wrong: [],
      interactive: false,
      cooldown: false,
    });
  });
});
