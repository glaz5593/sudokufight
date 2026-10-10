import {
  adaptationFactor,
  BOT_CONFIG,
  type BotConfig,
  botConfig,
  type BotLevel,
  botLevel,
  type BotLevelId,
  type BotReactionTrigger,
  canInterfere,
  canReact,
  type CellIndex,
  cellDifficulty,
  chooseCell,
  chooseDigit,
  type ClientAction,
  type Clock,
  decideInterference,
  decideReaction,
  drawMs,
  type GameEvent,
  type GameState,
  isEligibleCell,
  leadOver,
  type MsRange,
  type PlayerId,
  type RejectReason,
  type Rng,
  type Scheduler,
  splitThinkTime,
  thinkTime,
} from '@sudoku-fight/engine';

import { withSolution } from './solve';

/**
 * The fake client's player (stage 7: "a Node client that plays like a bot"): the engine bot's decisions
 * (spec §9: BOT_CONFIG and the brain helpers: easy cells first, think times by level, game type and the
 * cell's difficulty, plausible wrong digits, reactions, interferences), played over a network.
 *
 * Unlike the engine's BotRunner, which calls a LocalGameHost and gets the result at once, every action here
 * goes to the server and the answer comes later (an event, a refusal, or nothing at all when the message was
 * lost): a move waits for its answer before the next one, and gives up on it after `answerTimeoutMs`.
 *
 *   hesitate  → select → (cellLocked) → solve → place → (placedCorrect | placedWrong) → hesitate …
 *
 * It knows the solution only because the client worked it out from the givens (./solve), never from the
 * server. It stands still while the game is not running (not started, frozen, over), while it is offline,
 * and while it is hit by an interference [D11]. It never goes over the server's rate limits (`pace`).
 *
 * Pure apart from what is injected (clock, scheduler, RNG, send), so tests drive it with a ManualClock.
 */

export interface FakeBrainOptions {
  playerId: PlayerId;
  level: BotLevelId;
  /** Worked out by the client from the givens. */
  solution: string;
  /** Server time: the client's clock plus the offset from ping/pong. */
  clock: Clock;
  scheduler: Scheduler;
  rng: Rng;
  /** Think time multiplier: 1 plays at a person's pace (spec §9), 0.05 twenty times faster (tests). */
  thinkScale?: number;
  /** Bot settings over BOT_CONFIG (before the scale), e.g. { lingerShare: 0 }. */
  config?: Partial<BotConfig>;
  /** Send interferences per the level's policy (default true). */
  interfere?: boolean;
  /** Send reactions per the level's table (default true). */
  react?: boolean;
  /** Sends an action; returns its clientSeq, or null when it could not go out (offline). */
  send(action: ClientAction): number | null;
  /** 0 when a message of this type may go out now (the token is taken), or the ms to wait. Default: always 0. */
  pace?(type: ClientAction['type']): number;
  /** A select or place without an answer after this long is given up (default 3000 ms). */
  answerTimeoutMs?: number;
  onTrace?(trace: FakeBrainTrace): void;
}

export type FakeBrainTrace =
  | { type: 'plan'; at: number; cell: CellIndex; totalMs: number; hesitateMs: number; solveMs: number }
  | { type: 'action'; at: number; action: ClientAction; clientSeq: number | null; mistake?: boolean }
  | { type: 'rejected'; at: number; clientSeq: number; reason: RejectReason }
  | { type: 'noAnswer'; at: number; clientSeq: number }
  | { type: 'error'; at: number; error: unknown }
  | { type: 'stopped'; at: number; reason: FakeBrainStop };

export type FakeBrainStop = 'gameOver' | 'out' | 'stopped';

/** BOT_CONFIG with every delay multiplied by `scale` (think times, reaction and interference delays, retry). */
export function scaledBotConfig(scale: number, base: BotConfig = BOT_CONFIG): BotConfig {
  if (!(scale > 0)) throw new RangeError(`thinkScale must be above 0, got ${scale}`);
  const ms = (r: MsRange): MsRange => ({ min: Math.round(r.min * scale), max: Math.round(r.max * scale) });
  return {
    ...base,
    levels: base.levels.map((l) => ({ ...l, thinkMs: ms(l.thinkMs) })),
    reactionDelayMs: ms(base.reactionDelayMs),
    interferenceDelayMs: ms(base.interferenceDelayMs),
    retryMs: Math.max(10, Math.round(base.retryMs * scale)),
  };
}

type Phase =
  | { kind: 'idle' }
  /** Thinking before locking `cell`. */
  | { kind: 'hesitate'; cell: CellIndex; solveMs: number; linger: boolean }
  /** The select is out; waiting for cellLocked (or a refusal). */
  | { kind: 'selecting'; cell: CellIndex; solveMs: number; linger: boolean; clientSeq: number }
  /** Holding `cell`; the digit goes out when the timer fires. */
  | { kind: 'solving'; cell: CellIndex }
  /** Holding `cell` on purpose until it runs out ("deliberate hesitation", spec §9). */
  | { kind: 'lingering'; cell: CellIndex }
  /** The digit is out; waiting for placedCorrect / placedWrong (or a refusal). */
  | { kind: 'placing'; cell: CellIndex; clientSeq: number }
  /** After a refusal, or for a re-lock wait to end. */
  | { kind: 'wait' };

const IDLE: Phase = { kind: 'idle' };

export class FakeBrain {
  private readonly level: BotLevel;
  private readonly config: BotConfig;
  private readonly answerTimeoutMs: number;
  private state: GameState | null = null;
  private phase: Phase = IDLE;
  private connected = true;
  private moveTimer: unknown = null;
  private answerTimer: unknown = null;
  private reactionTimer: unknown = null;
  private interferenceTimer: unknown = null;
  /** Inside send(): updates are only observed; the plan is reviewed once it returns. */
  private acting = false;
  private done = false;

  constructor(private readonly opts: FakeBrainOptions) {
    const scale = opts.thinkScale ?? 1;
    this.config = scaledBotConfig(scale, botConfig(opts.config));
    this.level = botLevel(opts.level, this.config);
    this.answerTimeoutMs = opts.answerTimeoutMs ?? 3000;
  }

  get stopped(): boolean {
    return this.done;
  }

  /** The level being played (after the scale). */
  get botLevel(): BotLevel {
    return this.level;
  }

  /** The game moved on: the state after `events` (from a snapshot: no events). */
  update(state: GameState, events: readonly GameEvent[] = []): void {
    if (this.done) return;
    this.state = withSolution(state, this.opts.solution);
    this.guard(() => {
      for (const e of events) this.observe(e);
      if (!this.acting) this.review();
    });
  }

  /** The server refused one of this player's actions. */
  rejected(clientSeq: number, reason: RejectReason): void {
    if (this.done) return;
    this.trace({ type: 'rejected', at: this.now(), clientSeq, reason });
    const p = this.phase;
    if ((p.kind === 'selecting' || p.kind === 'placing') && p.clientSeq === clientSeq) {
      this.clearAnswerTimer();
      this.retryLater();
    }
  }

  /** Offline: whatever was on the way may never be answered; stand still until the next snapshot. */
  setConnected(connected: boolean): void {
    if (this.done || connected === this.connected) return;
    this.connected = connected;
    if (!connected) {
      this.cancelMove();
      this.clearAnswerTimer();
      this.phase = IDLE;
      return;
    }
    this.guard(() => this.review());
  }

  stop(reason: FakeBrainStop = 'stopped'): void {
    if (this.done) return;
    this.done = true;
    this.cancelMove();
    this.clearAnswerTimer();
    for (const t of [this.reactionTimer, this.interferenceTimer])
      if (t !== null) this.opts.scheduler.clearTimeout(t);
    this.reactionTimer = this.interferenceTimer = null;
    this.phase = IDLE;
    this.trace({ type: 'stopped', at: this.now(), reason });
  }

  // -- listening ------------------------------------------------------------------------------------------

  private observe(e: GameEvent): void {
    const me = this.opts.playerId;
    const p = this.phase;
    if ((e.type === 'placedCorrect' || e.type === 'placedWrong') && e.playerId === me) {
      if (p.kind === 'placing' && p.cell === e.cell) {
        this.clearAnswerTimer();
        this.phase = IDLE;
      }
      this.considerInterference();
      if (e.type === 'placedCorrect') {
        const lead = leadOver(this.state!, me);
        // Ahead now, and not before this move.
        if (lead !== null && lead > 0 && lead - e.points <= 0) this.considerReaction('tookLead');
      }
    } else if (e.type === 'placedWrong') {
      this.considerReaction('opponentMistake');
    } else if (e.type === 'cellReleased' && e.playerId === me) {
      // The lock ran out (or went) while the digit was on the way: its answer will be a refusal.
      if (p.kind === 'placing' && p.cell === e.cell) {
        this.clearAnswerTimer();
        this.phase = IDLE;
      }
    } else if (e.type === 'interference' && e.targetId === me) {
      this.considerReaction('hit');
    }
  }

  // -- the move -------------------------------------------------------------------------------------------

  /** Keeps the plan if it still holds, otherwise makes a new one. Idempotent. */
  private review(): void {
    const s = this.state;
    if (this.done || s === null) return;
    const me = this.opts.playerId;
    const now = this.now();
    if (s.status === 'over') return this.stop('gameOver');
    const player = s.players.find((p) => p.id === me);
    if (!player || player.status !== 'active') return this.stop('out');
    const lock = s.locks.find((l) => l.playerId === me);
    // The answer to its select may come while it stands still: answered all the same.
    if (this.phase.kind === 'selecting' && lock?.cell === this.phase.cell) this.clearAnswerTimer();
    // Under interference it stands still, as its lock's timer does [D11] (unless that timer runs on).
    const hit = player.hitBy !== null && !(lock && lock.expiresAt !== null);
    if (s.status !== 'running' || !this.connected || !player.connected || hit) return this.freeze();

    const p = this.phase;
    if (lock) {
      if ((p.kind === 'solving' || p.kind === 'lingering') && p.cell === lock.cell) return;
      if (p.kind === 'placing' && p.cell === lock.cell) return; // the answer is on its way
      if (p.kind === 'selecting' && p.cell === lock.cell) {
        this.clearAnswerTimer();
        if (p.linger) {
          this.cancelMove();
          this.phase = { kind: 'lingering', cell: lock.cell };
        } else {
          this.phase = { kind: 'solving', cell: lock.cell };
          this.arm(p.solveMs);
        }
        return;
      }
      // A lock it did not plan (back from a drop, or kept after a wrong digit): finish it in time.
      this.clearAnswerTimer();
      const left = lock.expiresAt === null ? lock.remainingMs : lock.expiresAt - now;
      const d = cellDifficulty(s, lock.cell, this.config);
      const total = thinkTime(
        { level: this.level, gameType: s.config.gameType, factor: d.factor },
        this.opts.rng,
        this.config,
      );
      const { solveMs } = splitThinkTime(total, Math.max(0, left), this.opts.rng, this.config);
      this.phase = { kind: 'solving', cell: lock.cell };
      this.arm(solveMs);
      return;
    }

    if (p.kind === 'selecting' || p.kind === 'placing') return; // the answer is on its way
    if (p.kind === 'wait' && this.moveTimer !== null) return;
    if (p.kind === 'hesitate' && this.moveTimer !== null && isEligibleCell(s, me, p.cell, now)) return;
    this.planMove(s, now);
  }

  private planMove(s: GameState, now: number): void {
    const me = this.opts.playerId;
    const rules = s.config.rules;
    this.cancelMove();
    this.phase = IDLE;
    // 'turns' [D1]: only on its own turn.
    if (rules.turnModel === 'turns' && s.turn?.playerId !== me) return;
    const cell = chooseCell(s, me, now, this.opts.rng, this.config);
    if (cell === null) {
      // Every free cell is locked or in its re-lock wait [D2]. A lock ends with an update; a wait does not.
      const waits = s.cooldowns.filter((c) => c.playerId === me && c.until > now).map((c) => c.until);
      if (waits.length) {
        this.phase = { kind: 'wait' };
        this.arm(Math.min(...waits) - now + 1);
      }
      return;
    }
    const difficulty = cellDifficulty(s, cell, this.config);
    const adapt = adaptationFactor(s, me, this.level, this.config);
    const totalMs = thinkTime(
      { level: this.level, gameType: s.config.gameType, factor: difficulty.factor, adapt },
      this.opts.rng,
      this.config,
    );
    const split = splitThinkTime(totalMs, rules.thinkTimeMs, this.opts.rng, this.config);
    let hesitateMs = split.hesitateMs;
    if (rules.turnModel === 'turns' && s.turn?.endsAt != null)
      hesitateMs = Math.min(hesitateMs, Math.floor((s.turn.endsAt - now) * this.config.placeWithin));
    const linger = this.opts.rng.next() < this.config.lingerShare;
    this.phase = { kind: 'hesitate', cell, solveMs: split.solveMs, linger };
    this.arm(hesitateMs);
    this.trace({ type: 'plan', at: now, cell, totalMs, hesitateMs, solveMs: split.solveMs });
  }

  private onMoveTimer(): void {
    this.moveTimer = null;
    if (this.done) return;
    this.guard(() => {
      const s = this.state!;
      const p = this.phase;
      const me = this.opts.playerId;
      if (p.kind === 'hesitate') {
        if (s.status !== 'running' || !isEligibleCell(s, me, p.cell, this.now())) {
          this.phase = IDLE;
        } else {
          const wait = this.pace('select');
          if (wait > 0) return this.arm(wait); // the server's rate limit: a moment later
          const pending = { ...p, kind: 'selecting' as const, clientSeq: 0 };
          this.phase = pending;
          const clientSeq = this.act({ type: 'select', cell: p.cell });
          if (clientSeq === null) return this.retryLater();
          if (this.phase === pending) {
            pending.clientSeq = clientSeq;
            this.awaitAnswer(clientSeq);
          }
        }
      } else if (p.kind === 'solving') {
        const lock = s.locks.find((l) => l.playerId === me);
        if (s.status !== 'running' || lock?.cell !== p.cell) {
          this.phase = IDLE;
        } else {
          const wait = this.pace('place');
          if (wait > 0) return this.arm(wait);
          const { digit, mistake } = chooseDigit(s, p.cell, this.level.mistakeRate, this.opts.rng);
          const pending = { kind: 'placing' as const, cell: p.cell, clientSeq: 0 };
          this.phase = pending;
          const clientSeq = this.act({ type: 'place', cell: p.cell, digit }, mistake);
          if (clientSeq === null) return this.retryLater();
          if (this.phase === pending) {
            pending.clientSeq = clientSeq;
            this.awaitAnswer(clientSeq);
          }
        }
      } else if (p.kind === 'wait') {
        this.phase = IDLE;
      }
      this.review();
    });
  }

  private retryLater(): void {
    if (this.done) return;
    this.cancelMove();
    this.phase = { kind: 'wait' };
    this.arm(this.config.retryMs);
  }

  /** A select or a place went out: give up on it if nothing comes back. */
  private awaitAnswer(clientSeq: number): void {
    this.clearAnswerTimer();
    this.answerTimer = this.opts.scheduler.setTimeout(() => {
      this.answerTimer = null;
      if (this.done) return;
      const p = this.phase;
      if ((p.kind === 'selecting' || p.kind === 'placing') && p.clientSeq === clientSeq) {
        this.trace({ type: 'noAnswer', at: this.now(), clientSeq });
        this.phase = IDLE;
        this.guard(() => this.review());
      }
    }, this.answerTimeoutMs);
  }

  // -- timers ---------------------------------------------------------------------------------------------

  private arm(ms: number): void {
    this.cancelMove();
    if (this.done) return;
    this.moveTimer = this.opts.scheduler.setTimeout(() => this.onMoveTimer(), Math.max(0, Math.round(ms)));
  }

  private cancelMove(): void {
    if (this.moveTimer !== null) this.opts.scheduler.clearTimeout(this.moveTimer);
    this.moveTimer = null;
  }

  private clearAnswerTimer(): void {
    if (this.answerTimer !== null) this.opts.scheduler.clearTimeout(this.answerTimer);
    this.answerTimer = null;
  }

  /** Stands still: the move starts over when the game runs again (a held lock is finished in time). */
  private freeze(): void {
    this.cancelMove();
    const k = this.phase.kind;
    if (k === 'hesitate' || k === 'solving' || k === 'wait') this.phase = IDLE;
  }

  // -- reactions and interferences (spec §8, §7.2, the level's table) ---------------------------------------

  private considerReaction(trigger: BotReactionTrigger): void {
    if (this.opts.react === false || this.reactionTimer !== null) return;
    const emoji = decideReaction(trigger, this.state!, this.level, this.opts.rng);
    if (!emoji) return;
    this.reactionTimer = this.opts.scheduler.setTimeout(
      () => {
        this.reactionTimer = null;
        if (this.done) return;
        this.guard(() => {
          if (
            this.connected &&
            canReact(this.state!, this.opts.playerId, this.now()) &&
            this.pace('react') === 0
          )
            this.act({ type: 'react', emoji });
        });
      },
      drawMs(this.opts.rng, this.config.reactionDelayMs),
    );
  }

  private considerInterference(): void {
    if (this.opts.interfere === false || this.interferenceTimer !== null) return;
    const choice = decideInterference(this.state!, this.opts.playerId, this.level, this.now(), this.opts.rng);
    if (!choice) return;
    this.interferenceTimer = this.opts.scheduler.setTimeout(
      () => {
        this.interferenceTimer = null;
        if (this.done) return;
        this.guard(() => {
          const s = this.state!;
          // Still allowed: the target may be under another one, or the points spent by now.
          if (
            this.connected &&
            canInterfere(s, this.opts.playerId, choice.targetId, this.now()) &&
            this.pace('interfere') === 0
          )
            this.act({ type: 'interfere', targetId: choice.targetId, kind: choice.kind });
        });
      },
      drawMs(this.opts.rng, this.config.interferenceDelayMs),
    );
  }

  // -- sending --------------------------------------------------------------------------------------------

  private act(action: ClientAction, mistake?: boolean): number | null {
    const at = this.now();
    let clientSeq: number | null;
    this.acting = true;
    try {
      clientSeq = this.opts.send(action);
    } finally {
      this.acting = false;
    }
    this.trace(
      mistake === undefined
        ? { type: 'action', at, action, clientSeq }
        : { type: 'action', at, action, clientSeq, mistake },
    );
    return clientSeq;
  }

  private pace(type: ClientAction['type']): number {
    return this.opts.pace?.(type) ?? 0;
  }

  private now(): number {
    return this.opts.clock.now();
  }

  /** A step of the brain: an error is reported, never thrown at the scheduler or the network. */
  private guard(step: () => void): void {
    try {
      step();
    } catch (error) {
      this.trace({ type: 'error', at: this.now(), error });
      if (!this.done && this.moveTimer === null) this.retryLater();
    }
  }

  private trace(t: FakeBrainTrace): void {
    try {
      this.opts.onTrace?.(t);
    } catch {
      // A broken observer must not stop the player.
    }
  }
}
