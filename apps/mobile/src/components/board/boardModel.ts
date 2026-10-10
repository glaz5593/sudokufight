import {
  boxOf,
  type CellIndex,
  cellName,
  colOf,
  type Digit,
  DIGITS,
  type GameView,
  type PlayerId,
  type PlayerView,
  rowOf,
  type TimerView,
} from '@sudoku-fight/engine';

import { type AvatarId, EMPTY_AVATAR } from '../../assets/avatars';
import { paletteForSeat, tokens } from '../../theme';

/**
 * The board as this phone draws it (components.md §11, §12), worked out from the engine's GameView. Pure: the
 * board, cells and keypad render this and decide nothing. "Me" is always P1 (colorIndex 0), and the other
 * seats take P2–P4 in seat order (paletteForSeat).
 */

/** What a cell shows (components.md §11.3). Wrong digits (#7) overlay any of them. */
export type CellKind =
  /** #1 */
  | 'empty'
  /** #2 */
  | 'given'
  /** #3 (me) and #4 (an opponent) */
  | 'solved'
  /** #9: my tap, the server has not confirmed the lock yet */
  | 'pending'
  /** #5, and #10 while its timer is stopped */
  | 'myLock'
  /** #6 */
  | 'oppLock';

/** A player as a cell shows them: the solver of a solved cell, or the holder of a lock. */
export interface CellPlayer {
  id: PlayerId;
  seat: number;
  /** Index into color.players as this phone shows it: 0 = me (P1 ●), then P2 ▲, P3 ■, P4 ◆. */
  colorIndex: number;
  name: string | null;
  avatar: AvatarId;
  isMe: boolean;
}

export interface CellLock {
  /** Whole seconds left, rounded up (12000 ms → 12, 2100 ms → 3). */
  seconds: number;
  remainingMs: number;
  /** The timer stands still: the holder is under interference, or the game is frozen [D11, spec §16.2]. */
  paused: boolean;
  /** My lock in its last seconds (motion.md `lock.urgent`); never while paused. */
  urgent: boolean;
}

export interface CellModel {
  index: CellIndex;
  /** "D5": row letter and column number, always LTR. */
  name: string;
  row: number;
  col: number;
  box: number;
  /** Boxes 1, 3, 5, 7 (0-based) use color.board.cellAlt: the checkerboard. */
  alt: boolean;
  kind: CellKind;
  /** Given or solved digit. */
  digit: Digit | null;
  /** Solver ('solved'), lock holder ('myLock', 'oppLock'), or me ('pending'). */
  player: CellPlayer | null;
  /** 'myLock' and 'oppLock' only. */
  lock: CellLock | null;
  /** Wrong digits tried here, oldest first, each digit once. Every player sees them (spec §6.5). */
  wrong: Digit[];
  /** A tap does something: locks the cell, or shows "taken" on an opponent's lock (spec §6.2). */
  interactive: boolean;
  /** I let go of this cell a moment ago and can't take it again yet [D2]: a tap is refused. */
  cooldown: boolean;
}

/** A key's look (components.md §12.1). */
export type KeyState =
  /** I hold a lock: the key works. */
  | 'armed'
  /** No lock: the whole row is idle. */
  | 'idle'
  /** All nine of this digit are on the board. Wins over 'tried'. */
  | 'complete'
  /** Already tried wrongly in my locked cell [D12]. */
  | 'tried';

export interface KeyModel {
  digit: Digit;
  /** 9 minus the digit's givens and solved cells (wrong marks don't count). */
  remaining: number;
  state: KeyState;
  /** Pressing it can't place the digit. */
  disabled: boolean;
}

export interface KeypadModel {
  /** I hold a lock and the game runs. */
  enabled: boolean;
  /** Digits 1–9, in that order. */
  keys: KeyModel[];
}

export interface LockInfo extends CellLock {
  cell: CellIndex;
  name: string;
}

export interface BoardModel {
  /** 81 cells, row by row (index = row × 9 + column). */
  cells: CellModel[];
  keypad: KeypadModel;
  /** My lock: the strip, "ביטול בחירה" and the board's label. */
  myLock: LockInfo | null;
  /** Locks other players hold, in seat order, for the board's label. */
  otherLocks: (LockInfo & { player: CellPlayer })[];
}

export interface BoardModelOptions {
  /** The cell I tapped whose lock the server has not confirmed yet (spec §18, optimistic display). */
  pendingCell?: CellIndex | null;
  /** Each player's avatar; a player without one gets the empty avatar. */
  avatars?: Readonly<Partial<Record<PlayerId, AvatarId>>>;
}

/** Last-seconds threshold of my lock (motion.md `lock.urgent`, tokens motion.limits). */
const URGENT_MS = tokens.motion.limits.lockUrgentSeconds * 1000;

/** Time left on a timer at `now`: the remaining time while stopped, else until it runs out. */
export function timerRemainingMs(timer: TimerView, now: number): number {
  return timer.expiresAt === null ? Math.max(0, timer.remainingMs) : Math.max(0, timer.expiresAt - now);
}

function lockOf(timer: TimerView, now: number, mine: boolean): CellLock {
  const remainingMs = timerRemainingMs(timer, now);
  const paused = timer.expiresAt === null;
  return {
    seconds: Math.ceil(remainingMs / 1000),
    remainingMs,
    paused,
    urgent: mine && !paused && remainingMs > 0 && remainingMs <= URGENT_MS,
  };
}

/**
 * The board, the keypad and the locks as `mySeat` sees them at `now` (in the clock the view's timers use).
 * `mySeat` null draws a spectator's board: nothing is interactive and seats keep their own colors.
 */
export function boardModel(
  view: GameView,
  mySeat: number | null,
  now: number,
  options: BoardModelOptions = {},
): BoardModel {
  const seats = view.players.length;
  const bySeat = new Map(view.players.map((p) => [p.seat, p]));
  const me = mySeat === null ? null : (bySeat.get(mySeat) ?? null);
  const players = tokens.color.players;

  const playerOf = (p: PlayerView): CellPlayer => ({
    id: p.id,
    seat: p.seat,
    colorIndex: players.indexOf(paletteForSeat(p.seat, me ? me.seat : null, seats)),
    name: p.name,
    avatar: options.avatars?.[p.id] ?? EMPTY_AVATAR,
    isMe: p === me,
  });

  // Who holds which cell.
  const lockAt = new Map<CellIndex, { holder: PlayerView; lock: CellLock }>();
  for (const p of view.players) {
    if (p.lock) lockAt.set(p.lock.cell, { holder: p, lock: lockOf(p.lock, now, p === me) });
  }

  const canPlay = view.status === 'running' && me !== null && me.status === 'active';
  const cooling = new Set(view.cooldowns.map((c) => c.cell));
  const pending = options.pendingCell ?? null;

  const cells = view.grid.map((value, index): CellModel => {
    const box = boxOf(index);
    const base = {
      index,
      name: cellName(index),
      row: rowOf(index),
      col: colOf(index),
      box,
      alt: box % 2 === 1,
      wrong: uniqueDigits(view.wrong[index]?.map((w) => w.digit) ?? []),
      cooldown: cooling.has(index),
    };
    if (value !== 0) {
      const given = view.givens[index] === true;
      const ownerSeat = view.owner[index];
      const solver = given || ownerSeat == null ? undefined : bySeat.get(ownerSeat);
      return {
        ...base,
        kind: given ? 'given' : 'solved',
        digit: value as Digit,
        player: solver ? playerOf(solver) : null,
        lock: null,
        interactive: false,
      };
    }
    const held = lockAt.get(index);
    if (held) {
      const mine = held.holder === me;
      return {
        ...base,
        kind: mine ? 'myLock' : 'oppLock',
        digit: null,
        player: playerOf(held.holder),
        lock: held.lock,
        // My own lock: a tap does nothing. Someone else's: a tap gets "taken" feedback (spec §6.2.3).
        interactive: canPlay && !mine,
      };
    }
    if (index === pending && me) {
      return { ...base, kind: 'pending', digit: null, player: playerOf(me), lock: null, interactive: false };
    }
    return { ...base, kind: 'empty', digit: null, player: null, lock: null, interactive: canPlay };
  });

  const keypad: KeypadModel = {
    enabled: view.keypad.enabled,
    keys: DIGITS.map((digit): KeyModel => {
      const remaining = view.keypad.remaining[digit - 1] ?? 0;
      const state: KeyState =
        remaining <= 0
          ? 'complete'
          : view.keypad.disabled.includes(digit)
            ? 'tried'
            : view.keypad.enabled
              ? 'armed'
              : 'idle';
      return { digit, remaining: Math.max(0, remaining), state, disabled: state !== 'armed' };
    }),
  };

  const lockInfo = (cell: CellModel): LockInfo => ({ cell: cell.index, name: cell.name, ...cell.lock! });
  const myLockCell = cells.find((c) => c.kind === 'myLock');
  const otherLocks = cells
    .filter((c) => c.kind === 'oppLock')
    .map((c) => ({ ...lockInfo(c), player: c.player! }))
    .sort((a, b) => a.player.seat - b.player.seat);

  return { cells, keypad, myLock: myLockCell ? lockInfo(myLockCell) : null, otherLocks };
}

function uniqueDigits(digits: readonly Digit[]): Digit[] {
  return digits.filter((d, k) => digits.indexOf(d) === k);
}

/** How many wrong digits a cell draws: the last three (components.md §11.3 #7). The label reads them all. */
export const WRONG_DIGITS_SHOWN = 3;

/** The wrong digits a cell draws in its corner, oldest first. */
export const shownWrongDigits = (cell: Pick<CellModel, 'wrong'>): Digit[] =>
  cell.wrong.slice(-WRONG_DIGITS_SHOWN);

/** A blank cell model, for building boards by hand (the design-system screen, tests). */
export function emptyCell(index: CellIndex): CellModel {
  const box = boxOf(index);
  return {
    index,
    name: cellName(index),
    row: rowOf(index),
    col: colOf(index),
    box,
    alt: box % 2 === 1,
    kind: 'empty',
    digit: null,
    player: null,
    lock: null,
    wrong: [],
    interactive: false,
    cooldown: false,
  };
}
