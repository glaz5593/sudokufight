import {
  BOT_CONFIG,
  type BotConfig,
  botLevel,
  type BotLevelId,
  type ClientAction,
  createRng,
  defaultRules,
  type GameConfig,
  type GameEvent,
  type GameEventType,
  initialState,
  ManualClock,
  ManualScheduler,
  plausibleWrongDigits,
  type PlayerId,
  publicState,
  type RejectReason,
  type Rules,
  THINK_TIME_MS,
  toPublicEvent,
} from '@sudoku-fight/engine';

import { type DropReason, MessageGate } from '../../game/gate';
import { ServerGame } from '../../game/serverGame';
import { emptyCells, PUZZLE } from '../game';
import { FakeBrain, type FakeBrainTrace, scaledBotConfig } from './brain';
import { GameMirror } from './mirror';
import { solveGivens, withSolution } from './solve';
import { Pacer } from './stats';

/**
 * FakeBrain against the real server game (ServerGame) and the real message gate (shape, rate limits,
 * clientSeq), over a pretend network: every message takes `latencyMs` each way, on a manual clock. A game of
 * two minutes runs in a blink, and replays exactly.
 */

const T0 = Date.UTC(2026, 9, 9, 12);

interface SeatSpec {
  id: PlayerId;
  level: BotLevelId;
  thinkScale?: number;
  config?: Partial<BotConfig>;
  /** Keep within the server's rate limits (default true). */
  pace?: boolean;
}

interface Seat {
  id: PlayerId;
  mirror: GameMirror;
  brain: FakeBrain;
  online: boolean;
  seq: number;
  traces: FakeBrainTrace[];
}

interface Sent {
  playerId: PlayerId;
  clientSeq: number;
  action: ClientAction;
  at: number;
}

class Table {
  readonly clock = new ManualClock(T0);
  readonly scheduler = new ManualScheduler(this.clock);
  readonly game: ServerGame;
  readonly gate = new MessageGate({ now: () => this.clock.now() });
  readonly seats = new Map<PlayerId, Seat>();
  readonly solution = solveGivens(PUZZLE.givens).solution;
  latencyMs = 25;
  /** Messages from these players are lost on the way. */
  readonly losing = new Set<PlayerId>();
  readonly sent: Sent[] = [];
  readonly dropped: { playerId: PlayerId; reason: DropReason }[] = [];
  readonly rejections: { playerId: PlayerId; reason: RejectReason }[] = [];
  /** Digits that were neither right nor a plausible wrong one, when sent. */
  readonly implausible: Sent[] = [];
  readonly errors: unknown[] = [];

  constructor(specs: SeatSpec[], rules: Partial<Rules> = {}) {
    const config: GameConfig = {
      id: 'g',
      mode: 'ranked',
      gameType: 'fast',
      puzzle: PUZZLE,
      players: specs.map((s) => ({ id: s.id, name: s.id })),
      rules: defaultRules('ranked', 'fast', rules),
      seed: 7,
    };
    this.game = new ServerGame({
      config,
      clock: this.clock,
      scheduler: this.scheduler,
      onUpdate: ({ events }) => this.broadcast(events.map(toPublicEvent)),
      onError: (e) => this.errors.push(e),
    });
    for (const [k, spec] of specs.entries()) {
      const pacer = new Pacer(() => this.clock.now());
      const seat: Seat = {
        id: spec.id,
        mirror: new GameMirror(),
        online: true,
        seq: 0,
        traces: [],
      } as unknown as Seat;
      seat.brain = new FakeBrain({
        playerId: spec.id,
        level: spec.level,
        solution: this.solution,
        clock: this.clock,
        scheduler: this.scheduler,
        rng: createRng(100 + k),
        thinkScale: spec.thinkScale ?? 1,
        config: spec.config,
        send: (action) => this.send(seat, action),
        pace: spec.pace === false ? undefined : (type) => pacer.take(type),
        onTrace: (t) => seat.traces.push(t),
      });
      this.seats.set(spec.id, seat);
    }
    // As the room does: the game as created to everyone, then the start.
    for (const seat of this.seats.values()) this.snapshot(seat);
    this.game.start();
  }

  seat(id: PlayerId): Seat {
    return this.seats.get(id)!;
  }

  /** Runs until the game is over (or the clock has gone `maxMs`). */
  run(maxMs = 30 * 60_000): void {
    const end = this.clock.now() + maxMs;
    while (!this.game.isOver && this.clock.now() < end) this.scheduler.advance(500);
    this.scheduler.advance(1000); // the last deliveries
  }

  /** Runs until `done()` (checked every 50 ms). */
  runUntil(done: () => boolean, maxMs = 10 * 60_000): void {
    const end = this.clock.now() + maxMs;
    while (!done() && this.clock.now() < end) this.scheduler.advance(50);
    if (!done()) throw new Error('runUntil: not reached');
  }

  /** The connection drops: the server hears of it at once; nothing reaches the player meanwhile. */
  drop(id: PlayerId): void {
    const seat = this.seat(id);
    seat.online = false;
    seat.brain.setConnected(false);
    this.game.disconnect(id);
  }

  /** Back: a snapshot first, then the engine's reconnect for everyone (as GameRoom.welcomeBack). */
  reconnect(id: PlayerId): void {
    const seat = this.seat(id);
    seat.online = true;
    this.snapshot(seat);
    this.game.reconnect(id);
  }

  actionsOf(id: PlayerId, from = 0, to = Infinity): Sent[] {
    return this.sent.filter((s) => s.playerId === id && s.at >= from && s.at < to);
  }

  events(type?: GameEventType): GameEvent[] {
    return this.game.events.filter((e) => type === undefined || e.type === type);
  }

  private later(fn: () => void): void {
    this.scheduler.setTimeout(fn, this.latencyMs);
  }

  private snapshot(seat: Seat): void {
    const state = this.game.publicState();
    this.later(() => {
      if (!seat.online) return;
      seat.mirror.snapshot(state, seat.id);
      seat.brain.setConnected(true);
      seat.brain.update(seat.mirror.state!);
    });
  }

  private broadcast(events: GameEvent[]): void {
    for (const seat of this.seats.values())
      this.later(() => {
        if (!seat.online) return;
        const applied = seat.mirror.events(events);
        if (applied.length) seat.brain.update(seat.mirror.state!, applied);
      });
  }

  private send(seat: Seat, action: ClientAction): number | null {
    if (!seat.online) return null;
    const clientSeq = ++seat.seq;
    const sent: Sent = { playerId: seat.id, clientSeq, action, at: this.clock.now() };
    this.sent.push(sent);
    if (action.type === 'place') {
      const right = Number(this.solution[action.cell]);
      const seen = withSolution(seat.mirror.state!, this.solution);
      if (action.digit !== right && !plausibleWrongDigits(seen, action.cell).includes(action.digit))
        this.implausible.push(sent);
    }
    this.later(() => {
      if (this.losing.has(seat.id)) return;
      const admission = this.gate.admit(seat.id, action.type, { ...action, clientSeq });
      if (admission.kind === 'dropped') {
        this.dropped.push({ playerId: seat.id, reason: admission.reason });
        return;
      }
      if (admission.kind !== 'action') return;
      const reason = this.game.act(seat.id, admission.action).rejected;
      if (reason === undefined) return;
      this.rejections.push({ playerId: seat.id, reason });
      this.later(() => seat.online && seat.brain.rejected(clientSeq, reason));
    });
    return clientSeq;
  }
}

const plans = (seat: Seat) => seat.traces.filter((t) => t.type === 'plan');
const tracesOf = (seat: Seat, type: FakeBrainTrace['type']) => seat.traces.filter((t) => t.type === type);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Every level's mistake rate set to `rate`. */
const mistakes = (rate: number): Partial<BotConfig> => ({
  levels: BOT_CONFIG.levels.map((l) => ({ ...l, mistakeRate: rate })),
});

// ---------------------------------------------------------------------------------------------------------

describe('FakeBrain: a game against the server game', () => {
  it('two of them play a whole game at a person pace, and their mirrors end as the server', () => {
    const t = new Table([
      { id: 'ana', level: 3 },
      { id: 'ben', level: 5 },
    ]);
    t.run();

    expect(t.game.isOver).toBe(true);
    expect(t.game.state.result!.reason).toBe('boardComplete');
    const [ana, ben] = [t.seat('ana'), t.seat('ben')];
    for (const seat of [ana, ben]) {
      seat.mirror.solution(t.game.solution);
      expect(seat.mirror.state).toEqual(publicState(t.game.state));
      expect(seat.brain.stopped).toBe(true);
      expect(seat.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'gameOver' });
      expect(tracesOf(seat, 'error')).toEqual([]);
      expect(tracesOf(seat, 'noAnswer')).toEqual([]);
    }
    const players = t.game.state.players;
    expect(players.reduce((n, p) => n + p.correct, 0)).toBe(emptyCells(PUZZLE).length);
    // Within every server rule: nothing dropped by the gate, refusals only from racing for the same cell.
    expect(t.dropped).toEqual([]);
    expect(new Set(t.rejections.map((r) => r.reason))).toEqual(
      new Set(t.rejections.length ? ['cellTaken'] : []),
    );
    // Its wrong digits are ones a person could believe in (spec §9).
    expect(t.implausible).toEqual([]);
    // It took minutes, like people: level 5 (Overlord) plays faster than level 3 (Mr. Hoot).
    expect(t.clock.now() - T0).toBeGreaterThan(60_000);
    expect(mean(plans(ben).map((p) => p.totalMs))).toBeLessThan(mean(plans(ana).map((p) => p.totalMs)));
    // Nothing of theirs is left ticking.
    t.scheduler.advance(60_000);
    expect(t.scheduler.pending).toBe(0);
  });

  it('think times follow the level, the game type and the cell (spec §9), scaled by thinkScale', () => {
    for (const thinkScale of [1, 0.1]) {
      const t = new Table([
        { id: 'ana', level: 1, thinkScale },
        { id: 'ben', level: 4, thinkScale },
      ]);
      t.run();
      const { pace, difficulty, adaptation } = BOT_CONFIG;
      for (const [id, level] of [
        ['ana', 1],
        ['ben', 4],
      ] as const) {
        const { min, max } = botLevel(level).thinkMs;
        const ps = plans(t.seat(id));
        expect(ps.length).toBeGreaterThan(10);
        for (const p of ps) {
          expect(p.totalMs).toBeGreaterThanOrEqual(Math.floor(min * thinkScale * pace.fast) - 1);
          expect(p.totalMs).toBeLessThanOrEqual(
            Math.ceil(max * thinkScale * pace.fast * difficulty.max * adaptation.slowdown) + 1,
          );
          // The digit comes within 80% of the lock time (the lock does not run out).
          expect(p.solveMs).toBeLessThanOrEqual(THINK_TIME_MS.fast * BOT_CONFIG.placeWithin);
          expect(p.hesitateMs + p.solveMs).toBe(p.totalMs);
        }
      }
    }
    expect(scaledBotConfig(0.5).levels[0]!.thinkMs).toEqual({ min: 4000, max: 5500 });
    expect(() => scaledBotConfig(0)).toThrow(RangeError);
  });

  it('mistakes are plausible wrong digits; after one it goes on, also when the lock is kept [D3]', () => {
    for (const afterMistake of ['release', 'keepLock'] as const) {
      const t = new Table(
        [
          { id: 'ana', level: 2, config: mistakes(0.4) },
          { id: 'ben', level: 3, config: mistakes(0.4) },
        ],
        { afterMistake, mistakePenaltyCap: 8 },
      );
      t.run();
      expect(t.game.state.result!.reason).toBe('boardComplete');
      expect(t.events('placedWrong').length).toBeGreaterThan(5);
      expect(t.implausible).toEqual([]);
      expect(t.dropped).toEqual([]);
      for (const seat of t.seats.values()) expect(tracesOf(seat, 'error')).toEqual([]);
    }
  });

  it('a fast one (thinkScale 0.001) stays within the rate limits only thanks to the pacer', () => {
    const paced = new Table([
      { id: 'ana', level: 5, thinkScale: 0.001 },
      { id: 'ben', level: 5, thinkScale: 0.001 },
    ]);
    paced.run();
    expect(paced.game.state.result!.reason).toBe('boardComplete');
    expect(paced.dropped).toEqual([]);

    const unpaced = new Table([
      { id: 'ana', level: 5, thinkScale: 0.001, pace: false },
      { id: 'ben', level: 5, thinkScale: 0.001, pace: false },
    ]);
    unpaced.run();
    expect(unpaced.dropped.map((d) => d.reason)).toContain('rateLimited');
    // Messages the server dropped are never answered: the brain gives up on them and plays on.
    expect(unpaced.game.state.result!.reason).toBe('boardComplete');
    expect([...unpaced.seats.values()].some((s) => tracesOf(s, 'noAnswer').length > 0)).toBe(true);
  });

  it('turns [D1]: it plays only on its own turn', () => {
    const t = new Table(
      [
        { id: 'ana', level: 4 },
        { id: 'ben', level: 4 },
      ],
      { turnModel: 'turns' },
    );
    t.run();
    expect(t.game.state.result!.reason).toBe('boardComplete');
    expect(t.rejections.map((r) => r.reason)).not.toContain('notYourTurn');
    expect(t.dropped).toEqual([]);
  });
});

describe('FakeBrain: trouble', () => {
  it('stands still while the game is frozen by a drop, finishes a lock it held, and plays on after', () => {
    const t = new Table([
      { id: 'ana', level: 3 },
      { id: 'ben', level: 3 },
    ]);
    // Drop Ben while he holds a lock (kept through the freeze in two players).
    t.runUntil(
      () => t.game.state.locks.some((l) => l.playerId === 'ben') && t.events('placedCorrect').length > 3,
    );
    const held = t.game.state.locks.find((l) => l.playerId === 'ben')!.cell;
    t.drop('ben');
    const frozenAt = t.clock.now();
    t.scheduler.advance(8000);
    expect(t.game.state.status).toBe('paused');
    // Nothing from Ana once she knew (one latency later), nothing from Ben at all.
    expect(t.actionsOf('ana', frozenAt + t.latencyMs, t.clock.now())).toEqual([]);
    expect(t.actionsOf('ben', frozenAt)).toEqual([]);

    const backAt = t.clock.now();
    t.reconnect('ben');
    t.runUntil(() => t.actionsOf('ben', backAt).some((s) => s.action.type === 'place'));
    // Back with a snapshot that shows his lock: he finishes it.
    expect(t.actionsOf('ben', backAt)[0]!.action).toMatchObject({ type: 'place', cell: held });
    t.run();
    expect(t.game.state.result!.reason).toBe('boardComplete');
    for (const seat of t.seats.values()) {
      seat.mirror.solution(t.game.solution);
      expect(seat.mirror.state).toEqual(publicState(t.game.state));
      expect(tracesOf(seat, 'error')).toEqual([]);
    }
  });

  it('an action without an answer is given up after answerTimeoutMs, and the game goes on', () => {
    const t = new Table([
      { id: 'ana', level: 4 },
      { id: 'ben', level: 4 },
    ]);
    t.runUntil(() => t.events('placedCorrect').length > 2);
    t.losing.add('ana');
    t.runUntil(() => tracesOf(t.seat('ana'), 'noAnswer').length > 0);
    t.losing.delete('ana');
    t.run();
    expect(t.game.state.result!.reason).toBe('boardComplete');
    expect(t.game.state.players.find((p) => p.id === 'ana')!.correct).toBeGreaterThan(3);
    expect(tracesOf(t.seat('ana'), 'error')).toEqual([]);
  });

  it('stands still while hit by an interference [D11]; reacts and interferes per its level', () => {
    // Overlord interferes whatever the score, and reacts to mistakes; everyone errs often here.
    const t = new Table(
      [
        { id: 'ana', level: 5, config: mistakes(0.3) },
        { id: 'ben', level: 5, config: mistakes(0.3) },
      ],
      { mistakePenaltyCap: 4 },
    );
    t.run();
    expect(t.game.state.result!.reason).toBe('boardComplete');
    const hits = t.events('interference') as Extract<GameEvent, { type: 'interference' }>[];
    expect(hits.length).toBeGreaterThan(0);
    expect(t.events('reaction').length).toBeGreaterThan(0);
    for (const hit of hits) {
      // Once it knows (one latency later) until the end: no select, no place from the target.
      const moves = t
        .actionsOf(hit.targetId, hit.t + t.latencyMs + 1, hit.endsAt)
        .filter((s) => s.action.type === 'select' || s.action.type === 'place');
      expect(moves).toEqual([]);
    }
    expect(t.dropped).toEqual([]);
    expect(t.rejections.map((r) => r.reason)).not.toContain('tooSoon');
  });

  it('stops for good once its player is out (surrendered), while the others play on', () => {
    const t = new Table([
      { id: 'ana', level: 4 },
      { id: 'ben', level: 4 },
      { id: 'cyd', level: 4 },
    ]);
    t.runUntil(() => t.events('placedCorrect').length > 3);
    t.game.act('cyd', { type: 'surrender' });
    t.scheduler.advance(100);
    const cyd = t.seat('cyd');
    expect(cyd.brain.stopped).toBe(true);
    expect(cyd.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'out' });
    const outAt = t.clock.now();
    t.run();
    expect(t.game.state.result!.reason).toBe('boardComplete');
    expect(t.actionsOf('cyd', outAt)).toEqual([]);
  });

  it('does nothing before the start, plays once it runs, and nothing once stopped', () => {
    const clock = new ManualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const sent: ClientAction[] = [];
    const brain = new FakeBrain({
      playerId: 'ana',
      level: 3,
      solution: PUZZLE.solution,
      clock,
      scheduler,
      rng: createRng(1),
      send: (a) => (sent.push(a), sent.length),
    });
    const config: GameConfig = {
      id: 'g',
      mode: 'ranked',
      gameType: 'fast',
      puzzle: { ...PUZZLE, solution: '' }, // as a client holds it
      players: [{ id: 'ana' }, { id: 'ben' }],
      rules: defaultRules('ranked', 'fast'),
    };
    const waiting = initialState(config, T0);
    brain.update(waiting);
    scheduler.advance(60_000);
    expect(sent).toEqual([]);

    brain.update({ ...waiting, status: 'running', startedAt: clock.now() });
    scheduler.advance(10_000);
    expect(sent[0]).toMatchObject({ type: 'select' });

    brain.stop();
    sent.length = 0;
    brain.update({ ...waiting, status: 'running' });
    scheduler.advance(60_000);
    expect(sent).toEqual([]);
    expect(scheduler.pending).toBe(0);
  });
});
