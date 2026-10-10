import {
  cellName,
  type EndReason,
  type GameView,
  type InterferenceKind,
  type PlayerId,
} from '@sudoku-fight/engine';

import type { LeadModel } from '../../components/player';
import type { FeedbackCue } from '../../services/feedback';
import { motion } from '../../theme/motion';

/**
 * Pure helpers of the game screen: number formats, what the solo HUD shows, the timeline of a move's feedback
 * (docs/design/motion.md §4.2, §4.3, §5), and the 2-player screen's choices. They only read the engine's
 * GameView, which already holds every rule; nothing here decides anything about the game.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A game's time, in whole seconds rounded down: "0:07", "6:12", "1:02:03". Never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** A think time in seconds with one decimal: 5140 ms → "5.1". */
export const formatSeconds = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(1);

/** What the solo HUD shows besides the score (Game-Solo: time, best move, board progress). */
export interface SoloStats {
  /** Time since the start: the result's duration once the game is over. */
  elapsedMs: number;
  /** Filled cells (givens and solved), out of `total`. */
  filled: number;
  total: number;
  /** My best move so far: its points and cell ("G6"). */
  best: { points: number; cell: string } | null;
}

export function soloStats(view: GameView, now: number): SoloStats {
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const elapsedMs =
    view.status === 'over' && view.result
      ? view.result.durationMs
      : view.startedAt === null
        ? 0
        : Math.max(0, now - view.startedAt);
  const best = me?.bestMove ?? null;
  return {
    elapsedMs,
    filled: view.grid.filter((v) => v !== 0).length,
    total: view.grid.length,
    best: best ? { points: best.points, cell: cellName(best.cell) } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The feedback timeline of a move, counted from R, the moment the result arrives (motion.md §5).

const seq = motion.sequence;

/** When a move's chip shows, starts its flight and lands on the card (ms after R). */
export interface MoveTimeline {
  /** The chip appears (a correct move pops it over the cell at once; a mistake shows it after the shake). */
  appearAt: number;
  flyAt: number;
  /** The chip lands: the delta label takes over and the score starts counting (650 ms). */
  landAt: number;
}

/** tokens.json times the sequences from the key press t0; R is t0 + 140 (motion.md §10). */
export const MOVE_TIMELINE: Readonly<Record<'gain' | 'penalty', MoveTimeline>> = {
  gain: {
    appearAt: 0,
    flyAt: seq.correctMove.flyToCardAt - seq.correctMove.tintAndPopAt,
    landAt: seq.correctMove.countStartAt - seq.correctMove.tintAndPopAt,
  },
  penalty: {
    appearAt: seq.wrongMove.penaltyFlyAt - seq.wrongMove.flashShakeAt,
    flyAt: seq.wrongMove.penaltyFlyAt - seq.wrongMove.flashShakeAt,
    landAt: seq.wrongMove.penaltyPipAt - seq.wrongMove.flashShakeAt,
  },
};

/** A cell's flash is over by then (the longest is the correct flash, 700 ms), so its entry can go. */
export const FLASH_CLEAR_MS = motion.duration.correctFlash + motion.duration.reducedFade;

/**
 * How long the board stays after the game ends, before the results (motion.md `last.cell`): a full board
 * plays the last cell's flash and holds it (700 + 400 ms; 200 ms with reduced motion). "End practice" goes
 * at once: the player asked for it.
 */
export const LAST_CELL_HOLD_MS = 400;

export function endDelayMs(reason: EndReason | undefined, reduce: boolean): number {
  if (reason !== 'boardComplete') return 0;
  return reduce ? motion.duration.reducedFade : motion.duration.correctFlash + LAST_CELL_HOLD_MS;
}

// ---------------------------------------------------------------------------------------------------------
// Two players (practice against a bot, spec §5.1, §9; later ranked)

/**
 * Which HUD the screen draws (spec §6.8): one player, the solo practice's card and the board's progress; two,
 * the pair of cards and the lead bar. Three or four (compact cards) arrive with work plan stage 10; until then
 * they get the pair, with the first opponent.
 */
export type HudLayout = 'solo' | 'duel';

export const hudLayoutOf = (view: Pick<GameView, 'players'>): HudLayout =>
  view.players.length > 1 ? 'duel' : 'solo';

/** The opponent the duel HUD shows: the first other player by seat. */
export function opponentOf(view: Pick<GameView, 'players' | 'me'>): GameView['players'][number] | null {
  return [...view.players].sort((a, b) => a.seat - b.seat).find((p) => p.id !== view.me) ?? null;
}

/** A change of leader (spec §6.8, components.md §9.1): who leads now, by how much, and what it means to me. */
export interface LeadShift {
  /** Null: a tie. */
  leader: PlayerId | null;
  gap: number;
  /** I took the lead. */
  took: boolean;
  /** Someone else took the lead from me (a tie is not a loss of it). */
  lost: boolean;
}

/** The lead after an update, against the leader before it; null when the leader did not change. */
export function leadShift(before: PlayerId | null, lead: LeadModel, myId: PlayerId | null): LeadShift | null {
  const leader = lead.leader?.playerId ?? null;
  if (leader === before) return null;
  return {
    leader,
    gap: lead.leader?.gap ?? 0,
    took: leader !== null && leader === myId,
    lost: before !== null && before === myId && leader !== null,
  };
}

/** The sound and haptic of a reaction that arrives (motion.md §8): each base emoji has its own (spec §8). */
const REACTION_CUES: Readonly<Record<string, FeedbackCue>> = {
  '😂': 'reactLaugh',
  '😱': 'reactScream',
  '😎': 'reactCool',
  '🤦': 'reactFacepalm',
  '🔥': 'reactFire',
  '👀': 'reactEyes',
};

export const reactionCue = (emoji: string): FeedbackCue => REACTION_CUES[emoji] ?? 'reactPop';

/** The cue of an interference that hits me, at its start (motion.md §7). */
const HIT_CUES: Readonly<Record<InterferenceKind, FeedbackCue>> = {
  fireworks: 'hitFireworks',
  cats: 'hitCats',
  warp: 'hitWarp',
};

export const hitCue = (kind: InterferenceKind): FeedbackCue => HIT_CUES[kind];

/**
 * When the view goes stale by the clock alone, with no event to say so: the earliest end of an opponent's
 * second of immunity after an interference [D11]. The engine marks them `busy` until `busyUntil`, and nothing
 * is sent when that second passes, so the screen reads the view again then; otherwise ⚡ (and the arsenal's
 * tokens) would stay "under interference" until some other move happened. Null when no target is busy.
 */
export function staleAt(view: Pick<GameView, 'interference'>): number | null {
  let at: number | null = null;
  for (const target of view.interference?.targets ?? []) {
    if (target.blockedBy !== 'busy' || target.busyUntil === undefined) continue;
    if (at === null || target.busyUntil < at) at = target.busyUntil;
  }
  return at;
}
