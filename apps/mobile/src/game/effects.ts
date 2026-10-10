import type {
  CellIndex,
  Digit,
  HostUpdate,
  InterferenceKind,
  MoveScore,
  PlayerId,
  RejectReason,
  ReleaseReason,
} from '@sudoku-fight/engine';

/**
 * What a game screen plays for an update (spec §6.2–§6.5): score flying to the card, a red flash and shake, a
 * "taken" buzz … Pure: it reads the update and nothing else, so the screen keeps no game logic. Event effects
 * carry the event's `seq`, a ready-made id for replaying the same kind of flash twice in a row.
 */
export type UiEffect =
  | {
      kind: 'correct';
      seq: number;
      cell: CellIndex;
      digit: Digit;
      points: number;
      breakdown: MoveScore;
      playerId: PlayerId;
      /** The player's score after it (the card counts up to it). */
      score: number;
      byMe: boolean;
    }
  | {
      kind: 'wrong';
      seq: number;
      cell: CellIndex;
      digit: Digit;
      penalty: number;
      playerId: PlayerId;
      score: number;
      byMe: boolean;
    }
  /** My select on someone else's lock (spec §6.2.3): a short buzz, no penalty. */
  | { kind: 'taken'; cell: CellIndex }
  /** Any other refusal of my action; `cell` when the action named one (e.g. a re-lock wait [D2]). */
  | { kind: 'refused'; reason: RejectReason; cell?: CellIndex }
  | { kind: 'locked'; seq: number; cell: CellIndex; playerId: PlayerId; byMe: boolean }
  | {
      kind: 'released';
      seq: number;
      cell: CellIndex;
      reason: ReleaseReason;
      playerId: PlayerId;
      /** Only with a timeout penalty [D2]. */
      penalty?: number;
      byMe: boolean;
    }
  | { kind: 'ended'; seq: number; gameId: string };

export type UiEffectKind = UiEffect['kind'];

export function effectsOf(update: HostUpdate, myId: PlayerId | null): UiEffect[] {
  if (update.kind === 'rejected') {
    const { action, reason } = update;
    const cell = 'cell' in action ? action.cell : undefined;
    if (reason === 'cellTaken' && action.type === 'select') return [{ kind: 'taken', cell: action.cell }];
    return [cell === undefined ? { kind: 'refused', reason } : { kind: 'refused', reason, cell }];
  }

  const effects: UiEffect[] = [];
  for (const e of update.events) {
    switch (e.type) {
      case 'placedCorrect':
        effects.push({
          kind: 'correct',
          seq: e.seq,
          cell: e.cell,
          digit: e.digit,
          points: e.points,
          breakdown: { ...e.breakdown },
          playerId: e.playerId,
          score: e.score,
          byMe: e.playerId === myId,
        });
        break;
      case 'placedWrong':
        effects.push({
          kind: 'wrong',
          seq: e.seq,
          cell: e.cell,
          digit: e.digit,
          penalty: e.penalty,
          playerId: e.playerId,
          score: e.score,
          byMe: e.playerId === myId,
        });
        break;
      case 'cellLocked':
        effects.push({
          kind: 'locked',
          seq: e.seq,
          cell: e.cell,
          playerId: e.playerId,
          byMe: e.playerId === myId,
        });
        break;
      case 'cellReleased':
        effects.push({
          kind: 'released',
          seq: e.seq,
          cell: e.cell,
          reason: e.reason,
          playerId: e.playerId,
          ...(e.penalty === undefined ? {} : { penalty: e.penalty }),
          byMe: e.playerId === myId,
        });
        break;
      case 'gameOver':
        effects.push({ kind: 'ended', seq: e.seq, gameId: update.view.gameId });
        break;
      default:
        // Interferences and reactions are matchEffectsOf's; connections get theirs with stage 7.
        break;
    }
  }
  return effects;
}

/**
 * What happens between the players rather than on the board (spec §7, §8): reactions, and interferences
 * starting and ending. Kept apart from effectsOf, whose effects are the board's and the keypad's: a screen
 * without opponents never needs these. Pure, like effectsOf.
 */
export type MatchEffect =
  /** A reaction floats up from its sender's card (spec §8); mine too, as every device shows it. */
  | { kind: 'reaction'; seq: number; playerId: PlayerId; emoji: string; byMe: boolean }
  /**
   * An interference starts (spec §7.4): the target's lock timer stops [D11], the sender pays `cost`.
   * `onMe`: I am the target. `byMe`: I sent it.
   */
  | {
      kind: 'interference';
      seq: number;
      fromId: PlayerId;
      targetId: PlayerId;
      interference: InterferenceKind;
      cost: number;
      /** The sender's score after paying. */
      senderScore: number;
      endsAt: number;
      onMe: boolean;
      byMe: boolean;
    }
  | {
      kind: 'interferenceEnded';
      seq: number;
      fromId: PlayerId;
      targetId: PlayerId;
      interference: InterferenceKind;
      onMe: boolean;
      byMe: boolean;
    };

export type MatchEffectKind = MatchEffect['kind'];

export function matchEffectsOf(update: HostUpdate, myId: PlayerId | null): MatchEffect[] {
  if (update.kind !== 'events') return [];
  const effects: MatchEffect[] = [];
  for (const e of update.events) {
    switch (e.type) {
      case 'reaction':
        effects.push({
          kind: 'reaction',
          seq: e.seq,
          playerId: e.playerId,
          emoji: e.emoji,
          byMe: e.playerId === myId,
        });
        break;
      case 'interference':
        effects.push({
          kind: 'interference',
          seq: e.seq,
          fromId: e.fromId,
          targetId: e.targetId,
          interference: e.kind,
          cost: e.cost,
          senderScore: e.score,
          endsAt: e.endsAt,
          onMe: e.targetId === myId,
          byMe: e.fromId === myId,
        });
        break;
      case 'interferenceEnded':
        effects.push({
          kind: 'interferenceEnded',
          seq: e.seq,
          fromId: e.fromId,
          targetId: e.targetId,
          interference: e.kind,
          onMe: e.targetId === myId,
          byMe: e.fromId === myId,
        });
        break;
      default:
        break;
    }
  }
  return effects;
}
