import { cellName, parseCellName } from '@sudoku-fight/engine';

import { boardGeometry } from '../../../components/board';
import { answerIn, emptyCellsOf, PUZZLE, testHost, wrongIn } from '../../../game/testing/practice';
import { motion } from '../../../theme/motion';
import { boardSide, cellCenter, centerOf, within } from '../geometry';
import {
  DIALOG_GONE_CEILING_MS,
  endDelayMs,
  formatClock,
  formatSeconds,
  MOVE_TIMELINE,
  soloStats,
} from '../model';

describe('formats', () => {
  it('shows a game time as m:ss, and h:mm:ss past an hour', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7_000)).toBe('0:07');
    expect(formatClock(59_999)).toBe('0:59');
    expect(formatClock(372_000)).toBe('6:12');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(-5_000)).toBe('0:00');
  });

  it('shows think times in seconds with one decimal', () => {
    expect(formatSeconds(5_140)).toBe('5.1');
    expect(formatSeconds(12_000)).toBe('12.0');
    expect(formatSeconds(0)).toBe('0.0');
  });
});

describe('soloStats', () => {
  it('counts the time from the start, the filled cells and my best move', () => {
    const { host, clock } = testHost();
    const givens = 81 - emptyCellsOf(PUZZLE).length;
    const start = host.getView();
    expect(soloStats(start, clock.now())).toEqual({ elapsedMs: 0, filled: givens, total: 81, best: null });

    const [a, b] = emptyCellsOf(PUZZLE);
    clock.advance(2_000);
    host.select(a!);
    host.place(a!, answerIn(PUZZLE, a!));
    host.select(b!);
    host.place(b!, wrongIn(PUZZLE, b!));
    clock.advance(1_500);
    const view = host.getView();
    const me = view.players[0]!;
    const stats = soloStats(view, clock.now());
    expect(stats.elapsedMs).toBe(3_500);
    expect(stats.filled).toBe(givens + 1); // the wrong digit is only a mark
    expect(stats.best).toEqual({ points: me.bestMove!.points, cell: cellName(a!) });
  });

  it('stops at the result’s duration once the game is over', () => {
    const { host, clock } = testHost();
    clock.advance(10_000);
    host.surrender();
    const view = host.getView();
    clock.advance(60_000);
    expect(view.status).toBe('over');
    expect(soloStats(view, clock.now()).elapsedMs).toBe(view.result!.durationMs);
  });
});

describe('the move timeline (motion.md §5)', () => {
  it('pops the points at once, flies them at R+300 and lands at R+660', () => {
    expect(MOVE_TIMELINE.gain).toEqual({ appearAt: 0, flyAt: 300, landAt: 660 });
    expect(MOVE_TIMELINE.gain.landAt - MOVE_TIMELINE.gain.flyAt).toBe(motion.duration.pointsFlight);
  });

  it('shows a penalty after the shake and lands it with the same timing', () => {
    expect(MOVE_TIMELINE.penalty).toEqual({ appearAt: 300, flyAt: 300, landAt: 660 });
  });

  it('holds a full board before the results (700 + 400 ms; 200 with reduced motion), and never an ended one', () => {
    expect(endDelayMs('boardComplete', false)).toBe(1_100);
    expect(endDelayMs('boardComplete', true)).toBe(motion.duration.reducedFade);
    expect(endDelayMs('practiceEnded', false)).toBe(0);
    expect(endDelayMs(undefined, false)).toBe(0);
  });

  it('the ceiling on waiting for the end dialog to leave is well past its exit', () => {
    expect(DIALOG_GONE_CEILING_MS).toBeGreaterThan(motion.duration.sheetOut + 500);
  });
});

describe('geometry of the flights', () => {
  const board = { x: 16, y: 300, width: 358, height: 358 };
  const g = boardGeometry(358);

  it('finds a cell’s centre on the LTR board: A1 top left, I9 bottom right, E5 in the middle', () => {
    expect(cellCenter(board, parseCellName('A1'))).toEqual({ x: 16 + g.cell / 2, y: 300 + g.cell / 2 });
    const i9 = cellCenter(board, parseCellName('I9'));
    expect(i9.x).toBeCloseTo(16 + 358 - g.cell / 2, 6);
    expect(i9.y).toBeCloseTo(300 + 358 - g.cell / 2, 6);
    const e5 = cellCenter(board, parseCellName('E5'));
    expect(e5.x).toBeCloseTo(16 + 179, 6);
    expect(e5.y).toBeCloseTo(300 + 179, 6);
    // A4 starts the second box: past three cells, two lines and one box gap.
    expect(cellCenter(board, parseCellName('A4')).x).toBeCloseTo(16 + 3 * g.cell + 2 + 3 + g.cell / 2, 6);
  });

  it('chains layout rects up to the root and takes their centres', () => {
    const room = { x: 0, y: 280, width: 390, height: 400 };
    const slot = { x: 16, y: 21, width: 358, height: 358 };
    expect(within(room, slot)).toEqual({ x: 16, y: 301, width: 358, height: 358 });
    expect(centerOf({ x: 10, y: 20, width: 44, height: 30 })).toEqual({ x: 32, y: 35 });
  });

  it('sizes the board by the width less the gutters and by the room it has', () => {
    expect(boardSide(390, null)).toBe(358);
    expect(boardSide(360, null)).toBe(328);
    expect(boardSide(430, null)).toBe(358);
    expect(boardSide(390, 300.6)).toBe(300);
    expect(boardSide(430, 500)).toBe(398);
  });
});
