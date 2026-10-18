import { LocalGameHost } from '../game/host';
import { defaultRules, INTERFERENCE_KINDS, REACTIONS, type Rules } from '../game/rules';
import type { GameConfig, GameEvent, GameState } from '../game/types';
import { replay } from '../game/view';
import { GAME_TYPES, type GameType } from '../gameType';
import type { CellIndex, Digit } from '../sudoku/board';
import { bankPuzzles, botGame, eventsOf, HUMAN, withLevel } from '../testing/bot';
import { PUZZLE } from '../testing/game';
import { ManualClock } from '../util/clock';
import { createRng, pick, type Rng } from '../util/random';
import { ManualScheduler, type Scheduler } from '../util/scheduler';
import { eligibleCells, plausibleWrongDigits } from './brain';
import { BOT_LEVELS, type BotConfig, type BotLevelId, botPlayer } from './levels';
import { attachBot, type BotHandle, type BotTrace } from './runner';

/*
 * Trying to break the bot (spec §9; work plan stage 5): a human who does everything at random — grabs cells,
 * errs, cancels, interferes, reacts, drops out and comes back — and tables where the bot has nothing to do.
 * Whatever happens, the bot must never act after the end or after detach(), never move while the game is
 * frozen or while it is hit [D11], never take a cell someone holds, never be refused, never throw out of a
 * scheduler callback, and never spin: its timers stay few and it plans only when something changed.
 */

type Puzzle = GameConfig['puzzle'];

/**
 * Practice against a bot has no interferences [D44]. These tables turn them on (as the fake client plays
 * ranked), so the bot is also tried under hits and with hits of its own; `rules` can turn them off again.
 */
const INTERFERENCES_ON: Partial<Rules> = { interferences: true };

/** The bot's own timers: how many are live now, the most at once, and how many it ever set. */
class TrackingScheduler implements Scheduler {
  readonly live = new Set<unknown>();
  max = 0;
  calls = 0;
  constructor(private readonly inner: ManualScheduler) {}
  setTimeout(fn: () => void, ms: number): unknown {
    this.calls++;
    const handle: unknown = this.inner.setTimeout(() => {
      this.live.delete(handle);
      fn();
    }, ms);
    this.live.add(handle);
    this.max = Math.max(this.max, this.live.size);
    return handle;
  }
  clearTimeout(handle: unknown): void {
    this.live.delete(handle);
    this.inner.clearTimeout(handle);
  }
}

interface Table {
  clock: ManualClock;
  scheduler: ManualScheduler;
  botScheduler: TrackingScheduler;
  host: LocalGameHost;
  botId: string;
  traces: BotTrace[];
  attach(): BotHandle;
}

function table(o: {
  level: BotLevelId;
  gameType?: GameType;
  puzzle?: Puzzle;
  seed?: number;
  config?: Partial<BotConfig>;
  rules?: Partial<Rules>;
}): Table {
  const gameType = o.gameType ?? 'fast';
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const botScheduler = new TrackingScheduler(scheduler);
  const bot = botPlayer(o.level);
  const config: GameConfig = {
    id: 'g',
    mode: 'bot',
    gameType,
    puzzle: o.puzzle ?? PUZZLE,
    players: [{ id: HUMAN }, bot],
    rules: defaultRules('bot', gameType, { ...INTERFERENCES_ON, ...o.rules }),
    seed: o.seed ?? 1,
  };
  const host = new LocalGameHost({ config, playerId: HUMAN, clock, scheduler });
  const traces: BotTrace[] = [];
  const attach = () =>
    attachBot(host, {
      botId: bot.id,
      level: o.level,
      clock,
      scheduler: botScheduler,
      rng: createRng(o.seed ?? 1),
      config: o.config,
      onTrace: (t) => traces.push(t),
    });
  return { clock, scheduler, botScheduler, host, botId: bot.id, traces, attach };
}

const solutionOf = (s: GameState, cell: CellIndex) => Number(s.config.puzzle.solution[cell]) as Digit;
const problems = (traces: readonly BotTrace[]) =>
  traces.filter((t) => t.type === 'error' || (t.type === 'action' && t.rejected !== undefined));
const plansOf = (traces: readonly BotTrace[]) => traces.filter((t) => t.type === 'plan');

/** A puzzle with only `cells` left to fill (the rest given). */
function nearlySolved(cells: readonly CellIndex[]): Puzzle {
  const givens = [...PUZZLE.solution].map((d, i) => (cells.includes(i) ? '0' : d)).join('');
  return { id: `near-${cells.join('-')}`, givens, solution: PUZZLE.solution };
}

/**
 * A human who does anything at any time (seeded): selects any empty cell (the bot's too), enters right and
 * plausible wrong digits, cancels, interferes on the bot, reacts, and drops out for up to 5 s (a two-player
 * game freezes [D4]). Most of what it tries is refused; that is the point.
 */
function chaosHuman(t: Table, rng: Rng): void {
  const { host, scheduler } = t;
  let away = false;
  const step = () => {
    const s = host.state;
    if (s.status === 'over') return;
    const r = rng.next();
    const mine = s.locks.find((l) => l.playerId === HUMAN);
    const empty = s.grid.flatMap((v, c) => (v === 0 ? [c] : []));
    if (away) {
      // Nothing: the phone is away.
    } else if (r < 0.3 && empty.length) host.select(pick(rng, empty));
    else if (r < 0.55 && mine) {
      const wrong = plausibleWrongDigits(s, mine.cell);
      host.place(mine.cell, rng.next() < 0.3 && wrong.length ? pick(rng, wrong) : solutionOf(s, mine.cell));
    } else if (r < 0.62) host.release();
    else if (r < 0.77) host.interfere(t.botId, pick(rng, INTERFERENCE_KINDS));
    else if (r < 0.87) host.react(pick(rng, REACTIONS));
    else if (r < 0.92 && s.status === 'running') {
      host.dispatch({ type: 'disconnect', playerId: HUMAN });
      away = true;
      scheduler.setTimeout(
        () => {
          away = false;
          if (host.state.status !== 'over') host.dispatch({ type: 'reconnect', playerId: HUMAN });
        },
        500 + Math.floor(rng.next() * 4500),
      );
    }
    scheduler.setTimeout(step, 100 + Math.floor(rng.next() * 2900));
  };
  scheduler.setTimeout(step, 50);
}

/** The bot's moves on the board, each with the state just before it. */
function botMoves(events: readonly GameEvent[], botId: string) {
  const states = replay(events);
  return events.flatMap((e, k) =>
    (e.type === 'cellLocked' || e.type === 'placedCorrect' || e.type === 'placedWrong') &&
    e.playerId === botId
      ? [{ e, before: states[k - 1]! }]
      : [],
  );
}

/** Plays a whole game against the chaos human, then checks everything the bot must never do. */
function playChaos(t: Table, seed: number): void {
  t.attach();
  chaosHuman(t, createRng(seed + 7));
  expect(() => {
    while (t.host.state.status !== 'over' && t.clock.now() < 3 * 3600_000) t.scheduler.advance(1000);
  }).not.toThrow();

  const events = t.host.events;
  expect(t.host.state.result?.reason).toBe('boardComplete');
  // Never refused, never failed.
  expect(problems(t.traces)).toEqual([]);
  // Moves only while the game runs and it is not hit (but for a digit in a lock whose timer runs on under
  // interference, the [D11] alternative), and only into a cell nobody holds.
  for (const { e, before } of botMoves(events, t.botId)) {
    expect(before.status).toBe('running');
    const running = before.locks.some((l) => l.playerId === t.botId && l.expiresAt !== null);
    if (e.type === 'cellLocked' || !running)
      expect(before.players.find((p) => p.id === t.botId)!.hitBy).toBeNull();
    if (e.type === 'cellLocked') expect(before.locks.filter((l) => l.cell === e.cell)).toEqual([]);
  }
  // Its sends and reactions only while the game runs.
  const states = replay(events);
  events.forEach((e, k) => {
    const mine =
      (e.type === 'interference' && e.fromId === t.botId) ||
      (e.type === 'reaction' && e.playerId === t.botId);
    if (mine) expect(states[k - 1]!.status).toBe('running');
  });
  // Its locks run out only when it meant them to (deliberate hesitation).
  const timeouts = eventsOf(events, 'cellReleased', t.botId).filter((e) => e.reason === 'timeout');
  const lingers = plansOf(t.traces).filter((p) => p.type === 'plan' && p.linger);
  expect(timeouts.length).toBeLessThanOrEqual(lingers.length);
  // No spinning: a move timer, a reaction and an interference at most, and a handful of timers per move.
  expect(t.botScheduler.max).toBeLessThanOrEqual(3);
  expect(t.botScheduler.calls).toBeLessThan(10 * events.length);
  // And nothing left behind.
  expect(t.botScheduler.live.size).toBe(0);
  expect(t.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'gameOver' });
}

describe('a bot against a human who does anything (spec §9)', () => {
  const cases = ([1, 2, 3, 4, 5] as const).flatMap((level) =>
    GAME_TYPES.map((gameType, ti) => ({ level, gameType, seed: 1000 * level + ti })),
  );

  it.each(cases)('L$level on $gameType (seed $seed)', ({ level, gameType, seed }) => {
    const t = table({ level, gameType, seed, puzzle: bankPuzzles(gameType, 1)[0]! });
    playChaos(t, seed);
    // The human did get in the way: froze the game, hit the bot, and solved cells too.
    const events = t.host.events;
    expect(eventsOf(events, 'gamePaused').length).toBeGreaterThan(0);
    expect(eventsOf(events, 'interference').filter((e) => e.targetId === t.botId).length).toBeGreaterThan(0);
    expect(eventsOf(events, 'placedCorrect', HUMAN).length).toBeGreaterThan(0);
  });

  it.each<[string, Partial<Rules>]>([
    ["'turns' [D1]", { turnModel: 'turns' }],
    ['the lock stays after a mistake [D3]', { afterMistake: 'keepLock' }],
    ['a wrong digit is closed only to whoever tried it [D12]', { wrongDigitDisabledFor: 'mistaker' }],
    ['a timeout costs points [D2]', { timeoutPenalty: 2 }],
    ['the lock timer runs on under interference [D11]', { pauseLockWhileInterfered: false }],
  ])('under other rules: %s', (_, rules) => {
    for (const level of [1, 3, 5] as const) {
      const t = table({ level, seed: 40 + level, rules, puzzle: bankPuzzles('fast', 2)[1]! });
      playChaos(t, 40 + level);
    }
  });

  it('in a default game against a bot nothing is ever sent, either way, and the bot plays clean [D44]', () => {
    for (const level of [1, 5] as const) {
      const t = table({ level, seed: 60 + level, rules: { interferences: false } });
      expect(defaultRules('bot', 'fast').interferences).toBe(false); // what practice plays
      playChaos(t, 60 + level);
      expect(eventsOf(t.host.events, 'interference')).toEqual([]);
      expect(t.traces.some((x) => x.type === 'action' && x.action.type === 'interfere')).toBe(false);
    }
  });

  it('detach() in the middle of it all: not one more action, not one timer left', () => {
    const t = table({ level: 5, seed: 77 });
    const bot = t.attach();
    chaosHuman(t, createRng(78));
    t.scheduler.advance(45_000);
    expect(eventsOf(t.host.events, 'placedCorrect', t.botId).length).toBeGreaterThan(0);
    bot.detach();
    const seq = t.host.state.seq;
    expect(t.botScheduler.live.size).toBe(0);
    t.scheduler.advance(30 * 60_000);
    // Whatever it held runs out by itself (the engine's timer); the bot itself sends nothing.
    const sent = t.host.events.filter(
      (e) =>
        e.seq > seq &&
        ((e.type === 'interference' && e.fromId === t.botId) ||
          ('playerId' in e &&
            e.playerId === t.botId &&
            !(e.type === 'cellReleased' && e.reason === 'timeout'))),
    );
    expect(sent).toEqual([]);
    const calls = t.botScheduler.calls;
    t.scheduler.advance(60_000);
    expect(t.botScheduler.calls).toBe(calls);
  });
});

describe('nothing to do: the bot waits without spinning', () => {
  it('every free cell is held by the human: no plan, no timer, until the lock is let go', () => {
    const cell = PUZZLE.givens.indexOf('0');
    const t = table({ level: 5, puzzle: nearlySolved([cell]) });
    t.host.select(cell);
    t.attach();
    t.scheduler.advance(7000); // the human's lock lasts 8 s (fast)
    expect(plansOf(t.traces)).toEqual([]);
    expect(t.botScheduler.calls).toBe(0);
    t.scheduler.advance(1000); // it runs out: the cell is free for the bot (the human waits a second [D2])
    expect(plansOf(t.traces)).toHaveLength(1);
    t.scheduler.advance(30_000);
    expect(t.host.state.result?.reason).toBe('boardComplete');
    expect(eventsOf(t.host.events, 'placedCorrect', t.botId)).toHaveLength(1);
    expect(problems(t.traces)).toEqual([]);
  });

  it('every free cell in its own re-lock wait: one wait to its end, then it plans again [D2]', () => {
    const cell = PUZZLE.givens.indexOf('0');
    // Lets every lock run out: after each, the only cell is in its one-second wait.
    const t = table({ level: 5, puzzle: nearlySolved([cell]), config: { lingerShare: 1 } });
    t.attach();
    t.scheduler.advance(60_000);
    while (t.host.state.locks.length) t.scheduler.advance(100); // the round under way runs out too
    const locks = eventsOf(t.host.events, 'cellLocked', t.botId);
    const timeouts = eventsOf(t.host.events, 'cellReleased', t.botId);
    expect(locks.length).toBeGreaterThan(3);
    expect(timeouts).toHaveLength(locks.length);
    // Each round: a plan, its lock, and a wait that ends exactly when the re-lock wait does.
    for (const [k, release] of timeouts.entries()) {
      const next = locks[k + 1];
      if (next) expect(next.t).toBeGreaterThanOrEqual(release.t + 1000);
    }
    expect(plansOf(t.traces).length).toBeGreaterThanOrEqual(locks.length);
    expect(plansOf(t.traces).length).toBeLessThanOrEqual(locks.length + 1);
    expect(t.botScheduler.calls).toBeLessThanOrEqual(3 * locks.length + 3);
    expect(problems(t.traces)).toEqual([]);
  });

  it('the human grabs its target 1 ms before it would: no refusal, no loop', () => {
    const cells = [...PUZZLE.givens].flatMap((d, i) => (d === '0' ? [i] : [])).slice(0, 2);
    const t = table({ level: 5, puzzle: nearlySolved(cells) });
    t.attach();
    // Whenever the bot plans a cell, the human grabs it 1 ms before the bot's select.
    let grabs = 0;
    const seen = new Set<number>();
    t.scheduler.advance(0);
    const watch = () => {
      for (const p of plansOf(t.traces)) {
        if (p.type !== 'plan' || seen.has(p.at * 100 + p.cell)) continue;
        seen.add(p.at * 100 + p.cell);
        t.scheduler.setTimeout(
          () => {
            if (t.host.state.locks.some((l) => l.playerId === HUMAN)) t.host.release();
            const before = t.host.state.seq;
            t.host.select(p.cell);
            if (t.host.state.seq > before) grabs++;
          },
          Math.max(0, p.at + p.hesitateMs - 1 - t.clock.now()),
        );
      }
      if (t.host.state.status !== 'over') t.scheduler.setTimeout(watch, 1);
    };
    watch();
    t.scheduler.advance(20_000);
    expect(grabs).toBeGreaterThan(2);
    expect(problems(t.traces)).toEqual([]);
    // Each grab made it choose again, at once and without a refusal.
    expect(plansOf(t.traces).length).toBeGreaterThan(grabs);
    expect(t.botScheduler.max).toBeLessThanOrEqual(3);
  });
});

describe('inside a host update', () => {
  it('detached by another listener while it is acting: it stops on the spot', () => {
    const t = table({ level: 5, seed: 3 });
    let bot: BotHandle | null = null;
    t.host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === t.botId))
        bot?.detach();
    });
    bot = t.attach();
    t.scheduler.advance(60_000);
    const mine = t.host.events.filter((e) => 'playerId' in e && e.playerId === t.botId);
    // Its one lock, then nothing: the lock runs out by itself.
    expect(mine.map((e) => e.type)).toEqual(['cellLocked', 'cellReleased']);
    expect(t.botScheduler.live.size).toBe(0);
    expect(t.traces.filter((x) => x.type === 'stopped')).toMatchObject([{ reason: 'detached' }]);
    expect(problems(t.traces)).toEqual([]);
  });

  it('the host closed by another listener while it is acting: it stops quietly at its next step', () => {
    const t = table({ level: 5, seed: 4 });
    t.host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === t.botId))
        t.host.close();
    });
    t.attach();
    expect(() => t.scheduler.advance(60_000)).not.toThrow();
    expect(t.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'hostClosed' });
    expect(t.scheduler.pending).toBe(0);
  });
});

describe('frozen means frozen: what it decided before a freeze does not happen during it', () => {
  /** The first empty cell nobody holds and the bot is not about to take. */
  const freeCell = (t: Table): CellIndex => {
    const s = t.host.state;
    const target = plansOf(t.traces).at(-1);
    return s.grid.findIndex(
      (v, c) =>
        v === 0 && !s.locks.some((l) => l.cell === c) && !(target?.type === 'plan' && target.cell === c),
    );
  };

  it('a reaction on its way when the game freezes is dropped [D4]', () => {
    const levels = withLevel(BOT_LEVELS, 3, { reactions: { opponentMistake: { emoji: '😂', chance: 1 } } });
    const t = table({ level: 3, seed: 5, config: { levels } });
    t.attach();
    t.scheduler.advance(100);
    const cell = freeCell(t);
    t.host.select(cell);
    t.host.place(cell, plausibleWrongDigits(t.host.state, cell)[0]!);
    expect(t.botScheduler.live.size).toBe(2); // its move, and the 😂 on its way
    t.host.dispatch({ type: 'disconnect', playerId: HUMAN });
    const seq = t.host.state.seq;
    t.scheduler.advance(10_000);
    expect(t.host.events.filter((e) => e.seq > seq)).toEqual([]);
    t.host.dispatch({ type: 'reconnect', playerId: HUMAN });
    t.scheduler.advance(3000);
    expect(eventsOf(t.host.events, 'reaction', t.botId)).toEqual([]);
    expect(problems(t.traces)).toEqual([]);
  });

  it('an interference on its way when the game freezes is dropped [D4, D11]', () => {
    const levels = withLevel(BOT_LEVELS, 5, {
      interference: { maxPerGame: null, minDeficit: null, chance: 1 },
    });
    const t = table({ level: 5, seed: 6, config: { levels } });
    t.attach();
    // Its first correct digit: it can pay 2 and decides to send one, 0.4–1.2 s later.
    const solved = () => eventsOf(t.host.events, 'placedCorrect', t.botId).length;
    while (!solved()) t.scheduler.advance(10);
    expect(t.botScheduler.live.size).toBe(2); // its next move, and the interference on its way
    t.host.dispatch({ type: 'disconnect', playerId: HUMAN });
    const seq = t.host.state.seq;
    t.scheduler.advance(10_000);
    expect(t.host.events.filter((e) => e.seq > seq)).toEqual([]);
    t.host.dispatch({ type: 'reconnect', playerId: HUMAN });
    t.scheduler.advance(1);
    expect(eventsOf(t.host.events, 'interference')).toEqual([]);
    expect(problems(t.traces)).toEqual([]);
  });
});

describe('the [D11] alternative: its lock timer runs on while it is hit', () => {
  it('it still enters the digit of the lock it holds in time, then stands still until the hit ends', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = botGame({ level: 1, seed, rules: { ...INTERFERENCES_ON, pauseLockWhileInterfered: false } });
      // Points to pay for the interference, in a cell the bot is not after.
      const target = plansOf(g.traces).at(-1);
      const cell = eligibleCells(g.host.state, HUMAN, 0).find(
        (c) => !(target?.type === 'plan' && target.cell === c),
      )!;
      g.host.select(cell);
      g.host.place(cell, solutionOf(g.host.state, cell));
      const botLock = () => g.host.state.locks.find((l) => l.playerId === g.botId);
      while (!botLock()) g.scheduler.advance(10);
      const lock = botLock()!;
      const plan = plansOf(g.traces)
        .filter((p) => p.type === 'plan' && p.cell === lock.cell)
        .at(-1)!;
      g.scheduler.advance(200);
      g.host.interfere(g.botId, 'cats');
      expect(botLock()!.expiresAt).toBe(lock.expiresAt); // the rules let it run on
      const hit = eventsOf(g.host.events, 'interference').at(-1)!;
      g.scheduler.advance(20_000);
      const released = eventsOf(g.host.events, 'cellReleased', g.botId).filter((e) => e.reason === 'timeout');
      if (plan.type === 'plan' && plan.linger) continue; // a lock it meant to let run out
      expect(released).toEqual([]);
      const placed = g.host.events.find(
        (e) => (e.type === 'placedCorrect' || e.type === 'placedWrong') && e.playerId === g.botId,
      )!;
      expect(placed.t).toBe(lock.lockedAt + (plan.type === 'plan' ? plan.solveMs : NaN));
      // Then nothing new while the interference lasts.
      const next = eventsOf(g.host.events, 'cellLocked', g.botId).find((e) => e.t > lock.lockedAt);
      expect(next?.t ?? Infinity).toBeGreaterThanOrEqual(hit.endsAt);
      expect(problems(g.traces)).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('three at the table: two bots and a human who does anything', () => {
  it('a disconnect does not freeze a game of three [D4]; neither bot is ever refused or moves while hit', () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const levels = [2, 5] as const;
    const config: GameConfig = {
      id: 'g3',
      mode: 'bot',
      gameType: 'fast',
      puzzle: bankPuzzles('fast', 3)[2]!,
      players: [{ id: HUMAN }, ...levels.map((l) => botPlayer(l))],
      rules: defaultRules('bot', 'fast', INTERFERENCES_ON),
      seed: 9,
    };
    const host = new LocalGameHost({ config, playerId: HUMAN, clock, scheduler });
    const bots = levels.map((level) => {
      const traces: BotTrace[] = [];
      const tracked = new TrackingScheduler(scheduler);
      attachBot(host, {
        botId: `bot-${level}`,
        level,
        clock,
        scheduler: tracked,
        rng: createRng(level * 31),
        onTrace: (x) => traces.push(x),
      });
      return { id: `bot-${level}`, traces, tracked };
    });
    // The chaos human hits the first bot; the bots may hit each other and the human.
    const t: Table = {
      clock,
      scheduler,
      botScheduler: bots[0]!.tracked,
      host,
      botId: bots[0]!.id,
      traces: bots[0]!.traces,
      attach: () => ({ detach: () => undefined }),
    };
    chaosHuman(t, createRng(99));
    expect(() => {
      while (host.state.status !== 'over' && clock.now() < 3 * 3600_000) scheduler.advance(1000);
    }).not.toThrow();

    const events = host.events;
    expect(host.state.result?.reason).toBe('boardComplete');
    expect(eventsOf(events, 'playerDisconnected').length).toBeGreaterThan(0);
    expect(eventsOf(events, 'gamePaused')).toEqual([]);
    for (const bot of bots) {
      expect(problems(bot.traces)).toEqual([]);
      for (const { e, before } of botMoves(events, bot.id)) {
        expect(before.status).toBe('running');
        expect(before.players.find((p) => p.id === bot.id)!.hitBy).toBeNull();
        if (e.type === 'cellLocked') expect(before.locks.filter((l) => l.cell === e.cell)).toEqual([]);
      }
      expect(eventsOf(events, 'placedCorrect', bot.id).length).toBeGreaterThan(3);
      expect(bot.tracked.max).toBeLessThanOrEqual(3);
      expect(bot.tracked.live.size).toBe(0);
    }
  });
});
