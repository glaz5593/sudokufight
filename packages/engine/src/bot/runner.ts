import type { ActionResult } from '../game/engine';
import { isSoftOffline } from '../game/evolve';
import type { ClientAction } from '../game/host';
import type { InterferenceKind } from '../game/rules';
import type { Action, GameEvent, GameState, PlayerId, RejectReason } from '../game/types';
import type { CellIndex } from '../sudoku/board';
import type { Clock } from '../util/clock';
import type { Rng } from '../util/random';
import type { Scheduler } from '../util/scheduler';
import {
  adaptationFactor,
  canInterfere,
  canReact,
  cellDifficulty,
  type CellDifficulty,
  chooseCell,
  chooseDigit,
  decideInterference,
  decideReaction,
  decideRetaliation,
  drawMs,
  isEligibleCell,
  leadOver,
  type RetaliationChoice,
  splitThinkTime,
  thinkTime,
} from './brain';
import {
  type BotConfig,
  botConfig,
  botLevel,
  type BotLevelId,
  type BotProfile,
  type BotReactionTrigger,
  type BotRetaliationPolicy,
} from './levels';

/**
 * A bot at the table (spec §9): it listens to a game host (BotHost: a LocalGameHost on the phone, the server's
 * game for the stealth bot) and plays through host.dispatch, on the injected clock, scheduler and RNG, so a game
 * against a bot replays exactly.
 *
 * A move has the rhythm of a person (spec §9):
 *   hesitate  think before locking (most of the move's think time)
 *   select    lock the cell
 *   solve     the digit comes within 80% of the lock time, so the lock does not run out —
 *             except on purpose, in about 2% of moves ("deliberate hesitation")
 *   place     the right digit, or a plausible wrong one
 *
 * It looks again at every update and plans anew only when its plan no longer holds: its target was solved
 * or taken, it lost its lock, the game froze or resumed. While it is hit by an interference it stops, as its
 * lock timer does [D11], and goes on from where it was (where the rules let a lock's timer run on under
 * interference, it still enters that lock's digit in time, then stops). While the game is frozen it does
 * nothing, and each of its timers goes on afterwards with the time it had left; the phone's own freeze (the
 * app out of the foreground [D65]) holds the reaction on its way too. It stops for good at gameOver or
 * detach(), and never dispatches after either. A refused action only makes it plan again; nothing it does
 * throws out of a scheduler callback.
 */

export interface BotHandle {
  detach(): void;
}

/** What the bot reads of a host's update: only its events. LocalGameHost's HostUpdate is one. */
export type BotHostUpdate = { kind: 'events'; events: readonly GameEvent[] } | { kind: 'rejected' };

/**
 * What the bot needs of the game it plays in: the full state (solution included), its updates, and a way to act
 * as any player. LocalGameHost is one (practice on the phone). On the server the game room wraps its ServerGame
 * in one for the stealth bot (D90), so the server stays authoritative: the bot's actions go through the engine
 * like anyone's.
 *
 * What the runner counts on: `state` is the state after every update it was told of; updates come in order,
 * once each, and may come synchronously inside `dispatch` (the runner only reviews its plan once dispatch
 * returns); `dispatch` returns the engine's result (`rejected` when refused) and throws only when the game is
 * closed; and an unsubscribed listener hears nothing more.
 */
export interface BotHost {
  readonly state: GameState;
  /** Returns the unsubscribe function. */
  subscribe(listener: (update: BotHostUpdate) => void): () => void;
  dispatch(action: Action): ActionResult;
}

/** What the bot is doing, for tests and debugging (attachBot's `onTrace`). */
export type BotTrace =
  | {
      type: 'plan';
      at: number;
      cell: CellIndex;
      difficulty: CellDifficulty;
      adapt: number;
      totalMs: number;
      hesitateMs: number;
      solveMs: number;
      /** This lock is left to run out (deliberate hesitation). */
      linger: boolean;
    }
  | { type: 'action'; at: number; action: ClientAction; rejected?: RejectReason }
  /**
   * [D98] An interference on the bot ended: it will hit back at `dueAt`, trying again until `giveUpAt` (game
   * times as planned; a freeze of the game moves both on).
   */
  | {
      type: 'retaliation';
      at: number;
      targetId: PlayerId;
      kind: InterferenceKind;
      dueAt: number;
      giveUpAt: number;
    }
  /** [D98] It could not hit back by `giveUpAt` (too few points, the target busy or away): it let it go. */
  | { type: 'retaliationDropped'; at: number; targetId: PlayerId; kind: InterferenceKind }
  | { type: 'error'; at: number; error: unknown }
  | { type: 'stopped'; at: number; reason: 'gameOver' | 'out' | 'detached' | 'hostClosed' };

export interface AttachBotOptions {
  botId: PlayerId;
  /** A row of the level table (1–5), or a profile built for this game (stealthBotLevel). */
  level: BotLevelId | BotProfile;
  clock: Clock;
  scheduler: Scheduler;
  rng: Rng;
  /** Settings for this bot only, over BOT_CONFIG (e.g. another level table). */
  config?: Partial<BotConfig>;
  onTrace?: (trace: BotTrace) => void;
}

export function attachBot(host: BotHost, opts: AttachBotOptions): BotHandle {
  const bot = new BotRunner(host, opts);
  return { detach: () => bot.stop('detached') };
}

type MovePlan =
  /** Hesitating before locking `cell`. */
  | { kind: 'select'; cell: CellIndex; solveMs: number; linger: boolean }
  /** Holding `cell`: the digit comes when the timer fires. */
  | { kind: 'place'; cell: CellIndex }
  /** Holding `cell` on purpose until it runs out. */
  | { kind: 'linger'; cell: CellIndex }
  /** Waiting: after a refused action, or for a re-lock wait to end. */
  | { kind: 'wait' };

/** [D98] An interference to hit back with, on its way. */
interface PendingRetaliation {
  choice: RetaliationChoice;
  /** The next attempt, and the time it gives up (game time: a freeze moves both on). */
  dueAt: number;
  giveUpAt: number;
  /** Null while the game is frozen (the count stands still) or while the attempt runs. */
  timer: unknown;
}

class BotRunner {
  private readonly botId: PlayerId;
  private readonly level: BotProfile;
  private readonly config: BotConfig;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly rng: Rng;
  private readonly onTrace: ((trace: BotTrace) => void) | undefined;
  private readonly unsubscribe: () => void;

  private plan: MovePlan | null = null;
  /** The move timer (hesitate, solve or wait). */
  private timer: { handle: unknown; dueAt: number } | null = null;
  /** While the game is frozen or the bot is hit: what was left of the move timer (null: there was none). */
  private frozen: { remaining: number | null } | null = null;
  private reactionTimer: unknown = null;
  /** The reaction on its way: its emoji and when it comes. */
  private reaction: { emoji: string; dueAt: number } | null = null;
  /** The phone's own freeze [D65] holds the reaction on its way too: what it had left. */
  private heldReaction: { emoji: string; remaining: number } | null = null;
  private interferenceTimer: unknown = null;
  /** [D98] The interferences it will hit back with, one per interference it received. */
  private readonly retaliations = new Set<PendingRetaliation>();
  /** [D98] Since when the game is frozen: the count to hitting back stands still meanwhile. */
  private retaliationsHeldAt: number | null = null;
  /** Inside host.dispatch: updates are only observed; the plan is reviewed once it returns. */
  private acting = false;
  private done = false;

  constructor(
    private readonly host: BotHost,
    opts: AttachBotOptions,
  ) {
    this.botId = opts.botId;
    this.config = botConfig(opts.config);
    this.level = typeof opts.level === 'number' ? botLevel(opts.level, this.config) : opts.level;
    this.clock = opts.clock;
    this.scheduler = opts.scheduler;
    this.rng = opts.rng;
    this.onTrace = opts.onTrace;
    if (!host.state.players.some((p) => p.id === this.botId))
      throw new RangeError(`${this.botId} is not in the game`);
    this.unsubscribe = host.subscribe((u) => this.onUpdate(u));
    this.review();
  }

  stop(reason: Extract<BotTrace, { type: 'stopped' }>['reason']): void {
    if (this.done) return;
    this.done = true;
    this.cancelMoveTimer();
    if (this.reactionTimer !== null) this.scheduler.clearTimeout(this.reactionTimer);
    if (this.interferenceTimer !== null) this.scheduler.clearTimeout(this.interferenceTimer);
    this.reactionTimer = this.interferenceTimer = null;
    for (const r of this.retaliations) if (r.timer !== null) this.scheduler.clearTimeout(r.timer);
    this.retaliations.clear();
    this.reaction = this.heldReaction = null;
    this.plan = null;
    this.frozen = null;
    this.unsubscribe();
    this.trace({ type: 'stopped', at: this.clock.now(), reason });
  }

  // -- listening ------------------------------------------------------------------------------------------

  private onUpdate(update: BotHostUpdate): void {
    if (this.done) return;
    // The host collects a listener's error and throws it at whoever acted: the bot must never be that.
    this.guard(() => {
      if (update.kind === 'events') this.observe(update.events);
      if (!this.acting) this.review();
    });
  }

  /** Reactions and interference decisions, from what just happened. */
  private observe(events: readonly GameEvent[]): void {
    const me = this.botId;
    for (const e of events) {
      if (e.type === 'placedWrong') {
        if (e.playerId === me) this.considerInterference();
        else this.considerReaction('opponentMistake');
      } else if (e.type === 'placedCorrect' && e.playerId === me) {
        this.considerInterference();
        const lead = leadOver(this.host.state, me);
        // Ahead now, and not before this move (opponents' scores did not move with it).
        if (lead !== null && lead > 0 && lead - e.points <= 0) this.considerReaction('tookLead');
      } else if (e.type === 'interference' && e.targetId === me) {
        this.considerReaction('hit');
      } else if (e.type === 'interferenceEnded' && e.targetId === me) {
        this.considerRetaliation(e);
      }
    }
  }

  // -- the move -------------------------------------------------------------------------------------------

  /** Keeps the plan if it still holds, otherwise makes a new one. Idempotent. */
  private review(): void {
    if (this.done) return;
    const s = this.host.state;
    const now = this.clock.now();
    if (s.status === 'over') return this.stop('gameOver');
    const me = s.players.find((p) => p.id === this.botId);
    if (!me || me.status !== 'active') return this.stop('out');
    // [D98] Only a frozen game stops the count to hitting back; being hit, or the soft phase, does not.
    if (s.status === 'running') this.releaseRetaliations(now);
    else this.holdRetaliations(now);
    const lock = s.locks.find((l) => l.playerId === this.botId);
    // Frozen game, not started yet, or under interference: stand still, as the lock timer does [D11]. With
    // the [D11] alternative its lock's timer runs on under interference: it still finishes that lock in time.
    const hitStops = me.hitBy !== null && !(lock && lock.expiresAt !== null);
    // Away (in the soft phase of a lost connection too [D42]): the engine would refuse every move.
    if (s.status !== 'running' || !me.connected || isSoftOffline(me) || hitStops) return this.freeze(now);
    if (this.frozen) this.thaw(now);

    const plan = this.plan;
    if (plan?.kind === 'wait' && this.timer) return;

    if (lock) {
      if (plan?.kind === 'linger' && plan.cell === lock.cell) return;
      if (plan?.kind === 'place' && plan.cell === lock.cell && this.timer) return;
      if (plan?.kind === 'select' && plan.cell === lock.cell) {
        if (plan.linger) {
          this.plan = { kind: 'linger', cell: lock.cell };
          this.cancelMoveTimer();
        } else {
          this.plan = { kind: 'place', cell: lock.cell };
          this.arm(plan.solveMs, now);
        }
        return;
      }
      // A lock it did not plan, or a refused digit: finish it in a solve time that fits what is left.
      const left = lock.expiresAt === null ? lock.remainingMs : lock.expiresAt - now;
      const d = cellDifficulty(s, lock.cell, this.config);
      const total = thinkTime(
        { level: this.level, gameType: s.config.gameType, factor: d.factor },
        this.rng,
        this.config,
      );
      const { solveMs } = splitThinkTime(total, Math.max(0, left), this.rng, this.config);
      this.plan = { kind: 'place', cell: lock.cell };
      this.arm(solveMs, now);
      return;
    }

    if (plan?.kind === 'select' && this.timer && isEligibleCell(s, this.botId, plan.cell, now)) return;
    this.planMove(s, now);
  }

  private planMove(s: GameState, now: number): void {
    const rules = s.config.rules;
    this.cancelMoveTimer();
    this.plan = null;
    // 'turns' [D1]: only on its own turn.
    if (rules.turnModel === 'turns' && s.turn?.playerId !== this.botId) return;
    const cell = chooseCell(s, this.botId, now, this.rng, this.config);
    if (cell === null) {
      // Every free cell is taken or in its re-lock wait [D2]. A lock ends with an update; a wait does not.
      const waits = s.cooldowns.filter((c) => c.playerId === this.botId && c.until > now).map((c) => c.until);
      if (waits.length) {
        this.plan = { kind: 'wait' };
        this.arm(Math.min(...waits) - now, now);
      }
      return;
    }
    const difficulty = cellDifficulty(s, cell, this.config);
    const adapt = adaptationFactor(s, this.botId, this.level, this.config);
    const totalMs = thinkTime(
      { level: this.level, gameType: s.config.gameType, factor: difficulty.factor, adapt },
      this.rng,
      this.config,
    );
    const split = splitThinkTime(totalMs, rules.thinkTimeMs, this.rng, this.config);
    let hesitateMs = split.hesitateMs;
    if (rules.turnModel === 'turns' && s.turn?.endsAt != null)
      hesitateMs = Math.min(hesitateMs, Math.floor((s.turn.endsAt - now) * this.config.placeWithin));
    const linger = this.rng.next() < this.config.lingerShare;
    this.plan = { kind: 'select', cell, solveMs: split.solveMs, linger };
    this.arm(hesitateMs, now);
    this.trace({
      type: 'plan',
      at: now,
      cell,
      difficulty,
      adapt,
      totalMs,
      hesitateMs,
      solveMs: split.solveMs,
      linger,
    });
  }

  private onMoveTimer(): void {
    this.timer = null;
    if (this.done) return;
    this.guard(() => {
      const plan = this.plan;
      const s = this.host.state;
      const now = this.clock.now();
      if (plan?.kind === 'select') {
        if (s.status === 'running' && isEligibleCell(s, this.botId, plan.cell, now)) {
          if (!this.act({ type: 'select', cell: plan.cell })) this.retryLater(now);
        } else this.plan = null;
      } else if (plan?.kind === 'place') {
        const lock = s.locks.find((l) => l.playerId === this.botId);
        if (s.status === 'running' && lock?.cell === plan.cell) {
          const { digit } = chooseDigit(s, plan.cell, this.level.mistakeRate, this.rng);
          if (!this.act({ type: 'place', cell: plan.cell, digit })) this.retryLater(now);
        } else this.plan = null;
      } else if (plan?.kind === 'wait') {
        this.plan = null;
      }
      this.review();
    });
  }

  private retryLater(now: number): void {
    if (this.done) return;
    this.plan = { kind: 'wait' };
    this.arm(this.config.retryMs, now);
  }

  // -- timers ---------------------------------------------------------------------------------------------

  private arm(ms: number, now: number): void {
    this.cancelMoveTimer();
    if (this.done) return;
    const delay = Math.max(0, Math.round(ms));
    const handle = this.scheduler.setTimeout(() => this.onMoveTimer(), delay);
    this.timer = { handle, dueAt: now + delay };
  }

  private cancelMoveTimer(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private freeze(now: number): void {
    if (this.frozen) return;
    this.frozen = { remaining: this.timer ? Math.max(0, this.timer.dueAt - now) : null };
    this.cancelMoveTimer();
    // The app left the foreground [D65]: nothing of the bot runs, its reaction on the way included; it comes
    // after the resume with the time it had left. (A disconnect's freeze lets it run, as it always did.)
    if (this.host.state.pausedBy === 'background' && this.reaction && this.reactionTimer !== null) {
      this.scheduler.clearTimeout(this.reactionTimer);
      this.reactionTimer = null;
      this.heldReaction = { emoji: this.reaction.emoji, remaining: Math.max(0, this.reaction.dueAt - now) };
      this.reaction = null;
    }
  }

  private thaw(now: number): void {
    const remaining = this.frozen?.remaining ?? null;
    this.frozen = null;
    if (remaining !== null && this.plan) this.arm(remaining, now);
    const held = this.heldReaction;
    this.heldReaction = null;
    if (held) this.scheduleReaction(held.emoji, held.remaining, now);
  }

  // -- reactions and interferences ------------------------------------------------------------------------

  private considerReaction(trigger: BotReactionTrigger): void {
    // One at a time: the rate limit would drop the next anyway [D19].
    if (this.reactionTimer !== null || this.heldReaction !== null) return;
    const emoji = decideReaction(trigger, this.host.state, this.level, this.rng);
    if (!emoji) return;
    this.scheduleReaction(emoji, drawMs(this.rng, this.config.reactionDelayMs), this.clock.now());
  }

  private scheduleReaction(emoji: string, delay: number, now: number): void {
    this.reaction = { emoji, dueAt: now + delay };
    this.reactionTimer = this.scheduler.setTimeout(() => {
      this.reactionTimer = null;
      this.reaction = null;
      if (this.done) return;
      this.guard(() => {
        if (canReact(this.host.state, this.botId, this.clock.now())) this.act({ type: 'react', emoji });
        this.review();
      });
    }, delay);
  }

  private considerInterference(): void {
    if (this.interferenceTimer !== null) return;
    const choice = decideInterference(this.host.state, this.botId, this.level, this.clock.now(), this.rng);
    if (!choice) return;
    this.interferenceTimer = this.scheduler.setTimeout(
      () => {
        this.interferenceTimer = null;
        if (this.done) return;
        this.guard(() => {
          const s = this.host.state;
          // Still allowed (the target may be under another one, or the points spent by now).
          if (canInterfere(s, this.botId, choice.targetId, this.clock.now()))
            this.act({ type: 'interfere', targetId: choice.targetId, kind: choice.kind });
          this.review();
        });
      },
      drawMs(this.rng, this.config.interferenceDelayMs),
    );
  }

  // -- hitting back [D98] ---------------------------------------------------------------------------------

  /** An interference on it ended: plan the answer, when its level has one. */
  private considerRetaliation(ended: Extract<GameEvent, { type: 'interferenceEnded' }>): void {
    const choice = decideRetaliation(this.host.state, this.botId, this.level, ended, this.rng);
    if (!choice) return;
    const r: PendingRetaliation = {
      choice,
      dueAt: ended.t + choice.afterMs,
      giveUpAt: ended.t + choice.giveUpAfterMs,
      timer: null,
    };
    this.retaliations.add(r);
    const { targetId, kind } = choice;
    const now = this.clock.now();
    this.trace({ type: 'retaliation', at: now, targetId, kind, dueAt: r.dueAt, giveUpAt: r.giveUpAt });
    // While the game is frozen it waits for the resume, which moves both times on.
    if (this.retaliationsHeldAt === null) this.armRetaliation(r, now);
  }

  private armRetaliation(r: PendingRetaliation, now: number): void {
    if (r.timer !== null) this.scheduler.clearTimeout(r.timer);
    r.timer = this.scheduler.setTimeout(() => this.onRetaliationTimer(r), Math.max(0, r.dueAt - now));
  }

  /** Its moment came: hit back if it can, else try again in a moment, but never after giveUpAt. */
  private onRetaliationTimer(r: PendingRetaliation): void {
    r.timer = null;
    if (this.done || !this.retaliations.has(r)) return;
    this.guard(() => {
      const now = this.clock.now();
      const s = this.host.state;
      // The game froze meanwhile and the bot was not told yet: the resume re-arms it.
      if (s.status !== 'running') return this.review();
      const { targetId, kind } = r.choice;
      if (canInterfere(s, this.botId, targetId, now) && this.act({ type: 'interfere', targetId, kind })) {
        this.retaliations.delete(r);
      } else if (now >= r.giveUpAt) {
        this.retaliations.delete(r);
        if (!this.done) this.trace({ type: 'retaliationDropped', at: now, targetId, kind });
      } else if (!this.done) {
        r.dueAt = Math.min(now + this.retaliationPolicy().retryMs, r.giveUpAt);
        this.armRetaliation(r, now);
      }
      this.review();
    });
  }

  /** The game froze: every answer on its way keeps the time it had left. */
  private holdRetaliations(now: number): void {
    if (this.retaliationsHeldAt !== null) return;
    this.retaliationsHeldAt = now;
    for (const r of this.retaliations) {
      if (r.timer !== null) this.scheduler.clearTimeout(r.timer);
      r.timer = null;
    }
  }

  /** The game goes on: every answer on its way goes on, moved on by the freeze. */
  private releaseRetaliations(now: number): void {
    const heldAt = this.retaliationsHeldAt;
    if (heldAt === null) return;
    this.retaliationsHeldAt = null;
    const frozenMs = Math.max(0, now - heldAt);
    for (const r of this.retaliations) {
      r.dueAt += frozenMs;
      r.giveUpAt += frozenMs;
      this.armRetaliation(r, now);
    }
  }

  private retaliationPolicy(): BotRetaliationPolicy {
    const policy = this.level.interference.retaliate;
    // Only a level with a policy plans an answer (decideRetaliation).
    if (!policy) throw new Error('No retaliation policy');
    return policy;
  }

  // -- acting ---------------------------------------------------------------------------------------------

  /** Sends an action as the bot. False when it was refused or could not be sent. */
  private act(action: ClientAction): boolean {
    const before = this.host.state;
    const at = this.clock.now();
    let result: ActionResult | undefined;
    this.acting = true;
    try {
      result = this.host.dispatch({ ...action, playerId: this.botId });
    } catch (error) {
      this.trace({ type: 'error', at, error });
      // Nothing happened: the host is closed (or the engine gave up). Otherwise another listener threw.
      if (this.host.state === before) this.stop('hostClosed');
      return this.host.state !== before;
    } finally {
      this.acting = false;
    }
    this.trace(
      result.rejected
        ? { type: 'action', at, action, rejected: result.rejected }
        : { type: 'action', at, action },
    );
    return !result.rejected;
  }

  /** Runs a step of the bot; an error is reported, never thrown at the scheduler or the host. */
  private guard(step: () => void): void {
    try {
      step();
    } catch (error) {
      this.trace({ type: 'error', at: this.clock.now(), error });
      if (!this.done && !this.timer) this.retryLater(this.clock.now());
    }
  }

  private trace(t: BotTrace): void {
    if (!this.onTrace) return;
    try {
      this.onTrace(t);
    } catch {
      // A broken observer must not stop the bot.
    }
  }
}
