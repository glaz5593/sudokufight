import type { GameEvent, PlayerId } from '../game/types';
import { replay } from '../game/view';
import type { GameType } from '../gameType';
import { cellDifficulty } from './brain';
import { BOT_CONFIG, type BotConfig } from './levels';
import { STEALTH_BOT_CONFIG, type StealthBotConfig } from './stealth';

/**
 * A player's pace (stealth-bot plan §5.1, §5.2) [D96, D97a]: how long an ordinary move takes him, and how often
 * he enters a wrong digit, so the stealth bot can play at his own pace (stealthBotLevel). Pure functions of an
 * event log and of numbers the server keeps: the same code on the server and on the phone.
 *
 * - movePace: one game's log → his base (the mean of his moves, each ÷ its cell's difficulty factor), the moves
 *   it counted, and his digits and mistakes. The server keeps the base and the count of each ranked game.
 * - paceFromHistory: his last ranked games → the base and the mistake rate to build the bot from, with the
 *   defaults for a new player, the bounds, and the guard of a player who beats the stealth bot too often.
 */

/** One game's pace of one player (movePace). */
export interface MovePace {
  /**
   * The base: an ordinary move (a naked single, factor 1), in ms. The mean, over the counted moves, of each
   * move's time ÷ the difficulty factor of its cell (BOT_CONFIG.difficulty: the bot's own yardstick).
   */
  baseMs: number;
  /** The moves counted: the weight of baseMs among games (game_players.pace_moves). */
  moves: number;
  /** The mean time of the counted moves as they were, before ÷ the factor. */
  rawMs: number;
  /** The mean difficulty factor of their cells. */
  meanFactor: number;
  /** Every digit he entered, right or wrong (moves not counted for the pace included), and the wrong ones. */
  digits: number;
  mistakes: number;
}

type Digit = Extract<GameEvent, { type: 'placedCorrect' | 'placedWrong' }>;

/**
 * [D96] One player's pace in one game, from its full event log (from gameCreated on: the server's ServerGame
 * .events, the phone's LocalGameHost.events). Null when no move counted (he entered no digit, say).
 *
 * - A move is a digit he entered, right or wrong (spec §11.2). Its time runs from his previous digit (or from
 *   gameStarted) to this one, without the time the game was frozen (gamePaused … gameResumed), the time he was
 *   under an interference (interference … interferenceEnded on him), and the time he was away (his
 *   playerConnectionLost or playerDisconnected … playerReconnected).
 * - A digit entered offline and sent on his return [D42] is a digit (for the mistakes) but not a move: it came
 *   in a burst, its time says nothing. The next move's time runs from it.
 * - A move longer than `outlierFactor` (3) × the median of his moves is not counted (the phone rang).
 * - Each counted move's time is ÷ the difficulty factor of its cell on the board as it was just before the
 *   digit (cellDifficulty with the bot's config: the same yardstick as the bot's think times).
 */
export function movePace(
  events: readonly GameEvent[],
  playerId: PlayerId,
  config: BotConfig = BOT_CONFIG,
  stealth: StealthBotConfig = STEALTH_BOT_CONFIG,
): MovePace | null {
  if (!events.length || events[0]!.type !== 'gameCreated') return null;
  if (!events[0]!.config.players.some((p) => p.id === playerId)) return null;
  const states = replay(events);

  const moves: { ms: number; factor: number }[] = [];
  let digits = 0;
  let mistakes = 0;
  /** Since his previous digit (or the start); null before gameStarted. */
  let lastAt: number | null = null;
  /** Time stood still since lastAt, and since when it stands still now (null: it runs). */
  let stoppedMs = 0;
  let stoppedAt: number | null = null;
  let frozen = false;
  let hit = false;
  let away = false;
  const update = (t: number) => {
    const stopped = frozen || hit || away;
    if (stopped && stoppedAt === null) stoppedAt = t;
    else if (!stopped && stoppedAt !== null) {
      stoppedMs += t - stoppedAt;
      stoppedAt = null;
    }
  };

  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    switch (e.type) {
      case 'gameStarted':
        lastAt = e.t;
        stoppedMs = 0;
        break;
      case 'gamePaused':
        frozen = true;
        break;
      case 'gameResumed':
        frozen = false;
        break;
      case 'interference':
        if (e.targetId === playerId) hit = true;
        break;
      case 'interferenceEnded':
        if (e.targetId === playerId) hit = false;
        break;
      case 'playerConnectionLost':
      case 'playerDisconnected':
        if (e.playerId === playerId) away = true;
        break;
      case 'playerReconnected':
        if (e.playerId === playerId) away = false;
        break;
      case 'placedCorrect':
      case 'placedWrong':
        if (e.playerId === playerId) {
          digits++;
          if (e.type === 'placedWrong') mistakes++;
          countMove(e, k);
        }
        break;
      default:
        break;
    }
    update(e.t);
  }

  function countMove(e: Digit, k: number): void {
    if (lastAt !== null && !e.offline) {
      const still = stoppedMs + (stoppedAt === null ? 0 : e.t - stoppedAt);
      const ms = Math.max(0, e.t - lastAt - still);
      moves.push({ ms, factor: cellDifficulty(states[k - 1]!, e.cell, config).factor });
    }
    lastAt = e.t;
    stoppedMs = 0;
    if (stoppedAt !== null) stoppedAt = e.t;
  }

  if (!moves.length) return null;
  const median = medianOf(moves.map((m) => m.ms));
  const counted = moves.filter((m) => m.ms <= stealth.outlierFactor * median);
  if (!counted.length) return null;
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    baseMs: mean(counted.map((m) => m.ms / m.factor)),
    moves: counted.length,
    rawMs: mean(counted.map((m) => m.ms)),
    meanFactor: mean(counted.map((m) => m.factor)),
    digits,
    mistakes,
  };
}

function medianOf(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------------------------------------
// History

/** One of the player's ranked games, as the server keeps it (game_players). */
export interface PaceGame {
  gameType: GameType;
  /** movePace().baseMs of that game (game_players.pace_ms). */
  paceMs: number;
  /** movePace().moves: its weight (game_players.pace_moves). */
  paceMoves: number;
  /**
   * His digits in that game, right and wrong, and the wrong ones (movePace().digits and .mistakes). Absent: the
   * game counts for the base but not for the mistake rate.
   */
  digits?: number;
  mistakes?: number;
}

export interface PaceHistory {
  /** The game type about to be played. */
  gameType: GameType;
  /**
   * His last RANKED games that have a pace, newest first (D96: never practice, which the server cannot check).
   * More than `games` (10) is fine: only the newest count.
   */
  games: readonly PaceGame[];
  /**
   * His last games against the stealth bot, newest first: whether he won each (the guard). Absent or empty: no
   * guard. More than `guard.history` is fine: only the newest count.
   */
  stealthWins?: readonly boolean[];
}

/** What to build the stealth bot from (stealthBotLevel's input). */
export interface PlayerPace {
  /** The base (an ordinary move, ms), within `baseBounds`. */
  baseMs: number;
  /** Wrong digits ÷ digits, within `mistakes.min`–`mistakes.max`. */
  mistakeRate: number;
  /** The guard's personal scale: 1, or less (a quicker bot) for a player who beats the stealth bot too often. */
  scale: number;
  /** The games that counted (0: the defaults alone). */
  games: number;
  /** Only games of the type about to be played counted (at least `sameTypeMin` of them). */
  sameTypeOnly: boolean;
}

/**
 * [D96, D97a] The player's pace from his last ranked games (stealth-bot plan §5.1, §5.2):
 * - The newest `games` (10) games that have a pace. If at least `sameTypeMin` (5) of them are of the game type
 *   about to be played, only those.
 * - The base: their bases, weighted by each game's counted moves. The mistake rate: their wrong digits ÷ their
 *   digits.
 * - Fewer than `minGames` (3): with none, the defaults (14 s, 8%); with one or two, a blend: n/3 his, the rest
 *   the default.
 * - Then within the bounds (3–40 s; 2%–20%).
 * - The guard (stealthGuardScale): a player who won more than 65% of 10 stealth games in a row gets a quicker bot.
 */
export function paceFromHistory(
  history: PaceHistory,
  config: StealthBotConfig = STEALTH_BOT_CONFIG,
): PlayerPace {
  const usable = history.games
    .filter(
      (g) => Number.isFinite(g.paceMs) && g.paceMs > 0 && Number.isFinite(g.paceMoves) && g.paceMoves > 0,
    )
    .slice(0, config.games);
  const sameType = usable.filter((g) => g.gameType === history.gameType);
  const sameTypeOnly = sameType.length >= config.sameTypeMin;
  const used = sameTypeOnly ? sameType : usable;

  const moves = used.reduce((a, g) => a + g.paceMoves, 0);
  const measuredBase = used.length ? used.reduce((a, g) => a + g.paceMs * g.paceMoves, 0) / moves : 0;
  const baseMs = clamp(
    blend(measuredBase, used.length, config.defaultBaseMs, config.minGames),
    config.baseBounds.min,
    config.baseBounds.max,
  );

  const counted = used.filter(
    (g) =>
      g.digits !== undefined &&
      g.mistakes !== undefined &&
      Number.isFinite(g.digits) &&
      Number.isFinite(g.mistakes) &&
      g.digits > 0 &&
      g.mistakes >= 0,
  );
  const digits = counted.reduce((a, g) => a + g.digits!, 0);
  const wrong = counted.reduce((a, g) => a + Math.min(g.mistakes!, g.digits!), 0);
  const mistakeRate = clamp(
    blend(digits ? wrong / digits : 0, counted.length, config.mistakes.default, config.minGames),
    config.mistakes.min,
    config.mistakes.max,
  );

  return {
    baseMs,
    mistakeRate,
    scale: stealthGuardScale(history.stealthWins ?? [], config),
    games: used.length,
    sameTypeOnly,
  };
}

/** n of `full` games measured: n/full of them, the rest the default; from `full` games on, them alone. */
function blend(measured: number, n: number, fallback: number, full: number): number {
  if (n <= 0) return fallback;
  if (n >= full) return measured;
  return (n * measured + (full - n) * fallback) / full;
}

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/**
 * The guard against farming (stealth-bot plan §5.1): the player's stealth games in the order he played them
 * (`wins` newest first, the newest `guard.history` of them). Each time `guard.games` (10) games in a row since
 * the last step were won more than `guard.winShare` (65%), the scale steps down by `guard.step` (5%), never
 * below `guard.min` (0.8); the next step needs 10 new games. 1 for a player who does not beat it that often.
 *
 * Nothing is stored: it is worked out from his results every time. A streak older than the history no longer
 * counts, so the scale comes back once he stops winning that often (a first guess, tuned by the win rate the
 * admin site shows).
 */
export function stealthGuardScale(
  wins: readonly boolean[],
  config: StealthBotConfig = STEALTH_BOT_CONFIG,
): number {
  const { games, winShare, step, min, history } = config.guard;
  let scale = 1;
  let run: boolean[] = [];
  for (const won of wins.slice(0, history).reverse()) {
    run.push(won);
    if (run.length > games) run.shift();
    if (run.length === games && run.filter(Boolean).length / games > winShare) {
      scale = Math.max(min, Math.round((scale - step) * 1e6) / 1e6);
      run = [];
    }
  }
  return scale;
}
