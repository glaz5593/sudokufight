import {
  cellName,
  type EndReason,
  type GameView,
  type InterferenceKind,
  type PlayerId,
  playedMs,
  type PlayerView,
} from '@sudoku-fight/engine';

import { compactCardGap, compactCardWidth, type LeadModel } from '../../components/player';
import { gameEndConfig } from '../../config/gameEnd';
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
  /**
   * The time played (the engine's playedMs: a background freeze [D65] left out); the result's duration once the
   * game is over.
   */
  elapsedMs: number;
  /** Filled cells (givens and solved), out of `total`. */
  filled: number;
  total: number;
  /** My best move so far: its points and cell ("G6"). */
  best: { points: number; cell: string } | null;
}

export function soloStats(view: GameView, now: number): SoloStats {
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const elapsedMs = view.status === 'over' && view.result ? view.result.durationMs : playedMs(view, now);
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
 * How long the board stays after the game ends, before the results:
 * - a full board plays the last cell's flash and holds it (motion.md `last.cell`: 700 + 400 ms; 200 ms with
 *   reduced motion);
 * - an online game that ends otherwise (a surrender, mine or the opponent's; an abandonment) holds its final
 *   board ONLINE_END_HOLD_MS (motion.md `game.end`; 200 ms with reduced motion). Moshe's black screens of
 *   1.0.0 (15.10.2026) came on exactly these ends, which opened the results at once, inside the server's
 *   message, while the fades the end had started were still running; the full board, which waited, never did;
 * - "End practice" goes at once: the player asked for it, and its dialog's exit is the wait.
 * Whatever the hold, the results never open inside the host's update (GameScreen: always from a timer of the
 * screen), never while a dialog or sheet is still on the screen (they also wait for its onExited, at most
 * DIALOG_GONE_CEILING_MS more), and a watchdog notices when they did not open (RESULTS_WATCHDOG_MS).
 */
export const LAST_CELL_HOLD_MS = 400;

/** The final board of an online game that did not fill up stays this long (config/gameEnd.ts). */
export const ONLINE_END_HOLD_MS = gameEndConfig.onlineHoldMs;

export function endDelayMs(reason: EndReason | undefined, reduce: boolean, online = false): number {
  if (reason === 'boardComplete')
    return reduce ? motion.duration.reducedFade : motion.duration.correctFlash + LAST_CELL_HOLD_MS;
  if (!online) return 0;
  return reduce ? motion.duration.reducedFade : ONLINE_END_HOLD_MS;
}

/**
 * The results were asked for this long ago and the game screen is still here (a navigation that was lost):
 * it shows a way on ("לתוצאות", "לבית") and reports it (config/gameEnd.ts).
 */
export const RESULTS_WATCHDOG_MS = gameEndConfig.resultsWatchdogMs;

/**
 * The longest the results wait for the end dialog to report it has left the screen (bug 9): its exit is
 * `sheet.out` (240 ms, or a 200 ms fade) once the game-over render is committed, which can take a few hundred
 * ms more on the phone. Only a ceiling: should the exit never be reported, the results still open.
 */
export const DIALOG_GONE_CEILING_MS = 1_500;

// ---------------------------------------------------------------------------------------------------------
// Two players (practice against a bot, spec §5.1, §9; ranked), and three or four (ranked, work plan stage 10)

/**
 * Which HUD the screen draws (spec §6.8): one player, the solo practice's card and the board's progress; two,
 * the pair of cards and the lead bar; three or four, a row of compact cards (each with its current place) and
 * the lead bar by place.
 */
export type HudLayout = 'solo' | 'duel' | 'group';

export const hudLayoutOf = (view: Pick<GameView, 'players'>): HudLayout =>
  view.players.length > 2 ? 'group' : view.players.length > 1 ? 'duel' : 'solo';

/**
 * The cards' order (spec §6.8, components.md §7.1): me first, at the start edge, then everyone else by seat.
 * It never changes during a game (places do not re-sort it), so an interference target never moves under the
 * finger. A spectator (no `me`) sees the seats as they are.
 */
export function seatOrder(view: Pick<GameView, 'players' | 'me'>): PlayerView[] {
  const bySeat = [...view.players].sort((a, b) => a.seat - b.seat);
  const me = bySeat.find((p) => p.id === view.me);
  return me ? [me, ...bySeat.filter((p) => p !== me)] : bySeat;
}

/** Everyone but me, by seat: the cards with ⚡ (spec §6.8). */
export const opponentsOf = (view: Pick<GameView, 'players' | 'me'>): PlayerView[] =>
  seatOrder(view).filter((p) => p.id !== view.me);

/** The opponent the duel HUD shows: the first other player by seat. */
export function opponentOf(view: Pick<GameView, 'players' | 'me'>): PlayerView | null {
  return opponentsOf(view)[0] ?? null;
}

/**
 * The widths of the compact cards in seat order (components.md §7.1): 114 · 114 · 114 for three players,
 * 106 (mine) and 78 for the others with four, filling the design's 358-wide row with its gaps (8 and 6). A
 * narrower row shrinks every card in proportion (the gaps stay), so the row never wraps and never pushes into
 * the board; a wider one keeps the design's widths (the row spreads them out).
 */
export function groupCardWidths(count: number, rowWidth: number): number[] {
  const widths = Array.from({ length: count }, (_, i) => compactCardWidth(count, i === 0));
  const gaps = compactCardGap(count) * Math.max(0, count - 1);
  const design = widths.reduce((a, w) => a + w, 0);
  const scale = Math.min(1, Math.max(0, rowWidth - gaps) / design);
  return widths.map((w) => Math.floor(w * scale));
}

/**
 * Out of a game of 3–4 that goes on without me (spec §6.6, §6.7, D36): I surrendered (or the server gave me
 * up after the grace), my place is fixed by the order of leaving, and the others play on. Null while I am in
 * the game, once it is over, and in games of two (there a surrender ends the game).
 */
export interface OutOfGame {
  how: 'surrendered' | 'abandoned';
  place: number;
}

export function outOfGame(view: Pick<GameView, 'players' | 'me' | 'status'>): OutOfGame | null {
  if (view.players.length < 3 || view.status === 'over') return null;
  const me = view.players.find((p) => p.id === view.me);
  if (!me || me.status === 'active') return null;
  return { how: me.status, place: me.place };
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
export const HIT_CUES: Readonly<Record<InterferenceKind, FeedbackCue>> = {
  fireworks: 'hitFireworks',
  cats: 'hitCats',
  warp: 'hitWarp',
  scramble: 'hitScramble',
  ink: 'hitInk',
  keypad: 'hitKeypad',
};

/**
 * The start cue of a kind. A kind this app doesn't know (a newer player's [D47]) gets the warp's: a sound and
 * the Warning haptic, so the hit is still felt, and nothing throws.
 */
export const hitCue = (kind: InterferenceKind): FeedbackCue =>
  Object.prototype.hasOwnProperty.call(HIT_CUES, kind) ? HIT_CUES[kind] : 'hitWarp';

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
