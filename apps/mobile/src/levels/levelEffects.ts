import type {
  CellIndex,
  FindLevelOver,
  HostUpdate,
  LevelEvent,
  PlayerId,
  PuzzleEvent,
  PuzzleLevelOver,
  RejectReason,
} from '@sudoku-fight/engine';

/**
 * What a tap stage's screen plays for an update (components.md §19.7; plan §2.1, §2.2): a found cell, a wrong
 * tap's red X and its "‎+5 ש׳" or 3 s freeze, the bot taking a spot, its 😂, a spot nobody took, the next spot,
 * and the end. Pure: it reads the tap engine's events (`levelEvents`) and nothing else, so the screen keeps no
 * game logic. Each effect carries its event's `seq`, a ready-made id for replaying the same flash twice.
 *
 * The puzzle (1.0.3, levels-ui.md §4.3): its engine's events (`puzzleEvents`) the same way: two boxes swapped
 * (with a wrong swap's "‎+5 ש׳"), a box locked home (only with lockOnCorrect), the freeze, and the end; a swap
 * the engine refused says why ('boxFixed' sends the dragged box home). The screen decides none of it.
 */
export type LevelEffect =
  /** A right tap: a find's target or a race's spot (then `spotWon` follows), or a planted error found. */
  | { kind: 'found'; seq: number; cell: CellIndex; playerId: PlayerId; byMe: boolean }
  /** A spot of a race taken (by me or the bot): its pip, and the bot's hop on its card. */
  | { kind: 'spotWon'; seq: number; index: number; cell: CellIndex; playerId: PlayerId; byMe: boolean }
  /**
   * A wrong tap: the red X. `penaltyMs`: a find's or spot the error's time penalty (the "‎+5 ש׳" chip);
   * `frozenUntil`: the race's freeze of its tapper.
   */
  | {
      kind: 'miss';
      seq: number;
      cell: CellIndex;
      playerId: PlayerId;
      byMe: boolean;
      penaltyMs: number | null;
      frozenUntil: number | null;
    }
  /** Nobody took a spot (time ran out on it, or everyone was out of it). */
  | { kind: 'spotVoid'; seq: number; index: number }
  /** The next target shows (a race's spot `index`). */
  | { kind: 'shown'; seq: number; index: number }
  /** A reaction (the bot's 😂 on my wrong tap, D62: none from me in a stage by default). */
  | { kind: 'reaction'; seq: number; playerId: PlayerId; emoji: string; byMe: boolean }
  /** [D65] The stage froze, or went on after the countdown. */
  | { kind: 'paused'; seq: number }
  | { kind: 'resumed'; seq: number; pausedMs: number }
  /** My tap was refused: frozen (the race), a filled cell, the stage paused or over. */
  | { kind: 'refused'; reason: RejectReason; cell?: CellIndex }
  /** The stage is over (the levelOver event): the screen holds its last picture, then shows the result. */
  | { kind: 'ended'; seq: number; over: FindLevelOver }
  /** A puzzle: two boxes changed places; `penaltyMs` > 0 for a wrong swap (its "‎+5 ש׳") [D70c]. */
  | { kind: 'swapped'; seq: number; from: number; to: number; penaltyMs: number }
  /** A puzzle's box reached its home and locked there (only with lockOnCorrect) [D71]. */
  | { kind: 'boxPlaced'; seq: number; place: number }
  /** A puzzle's swap was refused: a fixed box ('boxFixed'), a bad place, the puzzle paused or over. */
  | { kind: 'swapRefused'; reason: RejectReason; from: number; to: number }
  /** The puzzle is over (its levelOver event): the screen holds its last picture, then shows the result. */
  | { kind: 'puzzleEnded'; seq: number; over: PuzzleLevelOver };

export type LevelEffectKind = LevelEffect['kind'];

function effectOf(e: LevelEvent, myId: PlayerId | null): LevelEffect | null {
  switch (e.type) {
    case 'tapped':
      return e.right
        ? { kind: 'found', seq: e.seq, cell: e.cell, playerId: e.playerId, byMe: e.playerId === myId }
        : {
            kind: 'miss',
            seq: e.seq,
            cell: e.cell,
            playerId: e.playerId,
            byMe: e.playerId === myId,
            penaltyMs: e.penaltyMs ?? null,
            frozenUntil: e.frozenUntil ?? null,
          };
    case 'spotWon':
      return {
        kind: 'spotWon',
        seq: e.seq,
        index: e.index,
        cell: e.cell,
        playerId: e.playerId,
        byMe: e.playerId === myId,
      };
    case 'spotVoid':
      return { kind: 'spotVoid', seq: e.seq, index: e.index };
    case 'targetShown':
      return { kind: 'shown', seq: e.seq, index: e.index };
    case 'reacted':
      return {
        kind: 'reaction',
        seq: e.seq,
        playerId: e.playerId,
        emoji: e.emoji,
        byMe: e.playerId === myId,
      };
    case 'levelPaused':
      return { kind: 'paused', seq: e.seq };
    case 'levelResumed':
      return { kind: 'resumed', seq: e.seq, pausedMs: e.pausedMs };
    case 'levelOver': {
      const { reason, elapsedMs, penaltyMs, spots, found, stars } = e;
      return { kind: 'ended', seq: e.seq, over: { reason, elapsedMs, penaltyMs, spots, found, stars } };
    }
    case 'levelCreated':
    case 'levelStarted':
      return null;
  }
}

function puzzleEffectOf(e: PuzzleEvent): LevelEffect | null {
  switch (e.type) {
    case 'boxesSwapped':
      return { kind: 'swapped', seq: e.seq, from: e.from, to: e.to, penaltyMs: e.penaltyMs };
    case 'boxPlaced':
      return { kind: 'boxPlaced', seq: e.seq, place: e.place };
    case 'levelPaused':
      return { kind: 'paused', seq: e.seq };
    case 'levelResumed':
      return { kind: 'resumed', seq: e.seq, pausedMs: e.pausedMs };
    case 'levelOver': {
      const { reason, elapsedMs, penaltyMs, swaps, mistakes, stars } = e;
      return {
        kind: 'puzzleEnded',
        seq: e.seq,
        over: { reason, elapsedMs, penaltyMs, swaps, mistakes, stars },
      };
    }
    case 'puzzleCreated':
    case 'levelStarted':
      return null;
  }
}

/** The effects of one update of a tap stage's (or a puzzle's) host, in order. */
export function levelEffectsOf(update: HostUpdate, myId: PlayerId | null): LevelEffect[] {
  if (update.kind === 'rejected') {
    const { action, reason } = update;
    if (action.type === 'swapBoxes')
      return [{ kind: 'swapRefused', reason, from: action.from, to: action.to }];
    const cell = 'cell' in action ? action.cell : undefined;
    return action.type === 'tap' ? [{ kind: 'refused', reason, cell }] : [];
  }
  const out: LevelEffect[] = [];
  for (const e of update.levelEvents ?? []) {
    const effect = effectOf(e, myId);
    if (effect) out.push(effect);
  }
  for (const e of update.puzzleEvents ?? []) {
    const effect = puzzleEffectOf(e);
    if (effect) out.push(effect);
  }
  return out;
}
