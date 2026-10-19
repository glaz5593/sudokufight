import type { ActionResult } from '../game/engine';
import { LocalGameHost } from '../game/host';
import { defaultRules, INTERFERENCE_KINDS } from '../game/rules';
import type { Action, GameConfig, GameEvent, GameState } from '../game/types';
import { replay } from '../game/view';
import { levelGameConfig } from '../levels/spec';
import { type CellIndex, type Digit, parseCellName } from '../sudoku/board';
import { type BotGame, botGame, eventsOf, HUMAN, runUntilOver, scriptHuman, withLevel } from '../testing/bot';
import { PUZZLE } from '../testing/game';
import { DUEL_LEVEL, ME, PIP } from '../testing/levels';
import { ManualClock } from '../util/clock';
import { createRng, type Rng } from '../util/random';
import { ManualScheduler } from '../util/scheduler';
import { eligibleCells, plausibleWrongDigits } from './brain';
import { BOT_CONFIG, BOT_LEVELS, type BotConfig, type BotLevelId, botPlayer, levelBotConfig } from './levels';
import { attachBot, type BotTrace } from './runner';

/* The bot at the table (spec §9): the rhythm of a move, re-planning, timers [D11], interferences and reactions. */

type Plan = Extract<BotTrace, { type: 'plan' }>;
const plans = (g: BotGame): Plan[] => g.traces.filter((t): t is Plan => t.type === 'plan');
const problems = (g: BotGame) =>
  g.traces.filter((t) => t.type === 'error' || (t.type === 'action' && t.rejected !== undefined));
const botLock = (g: BotGame) => g.host.state.locks.find((l) => l.playerId === g.botId);
const solutionOf = (s: GameState, cell: CellIndex) => Number(s.config.puzzle.solution[cell]) as Digit;

/** Moves time on in small steps until `done` (or `maxMs`). */
function advanceUntil(g: BotGame, done: () => boolean, maxMs = 120_000, step = 10): void {
  const end = g.clock.now() + maxMs;
  while (!done() && g.clock.now() < end) g.scheduler.advance(step);
  if (!done()) throw new Error('advanceUntil: still waiting');
}

/** Events since `seq`. */
const since = (g: BotGame, seq: number): GameEvent[] => g.host.events.filter((e) => e.seq > seq);
const byBot = (g: BotGame, events: readonly GameEvent[]) =>
  events.filter((e) => 'playerId' in e && e.playerId === g.botId);

/** The human solves the first free cell that is not `avoid`, right now. */
function humanSolves(g: BotGame, avoid?: CellIndex): CellIndex {
  const s = g.host.state;
  const cell = eligibleCells(s, HUMAN, g.clock.now()).find((c) => c !== avoid)!;
  g.host.select(cell);
  g.host.place(cell, solutionOf(g.host.state, cell));
  return cell;
}

/** The human tries a plausible wrong digit in the first free cell that is not `avoid`, right now. */
function humanErrs(g: BotGame, avoid?: CellIndex): void {
  const s = g.host.state;
  const cell = eligibleCells(s, HUMAN, g.clock.now()).find((c) => c !== avoid)!;
  g.host.select(cell);
  g.host.place(cell, plausibleWrongDigits(g.host.state, cell)[0]!);
}

/**
 * Practice against a bot has no interferences [D44]. Tests of the bot under hits, and of its own hits, turn
 * them on: the policy where interferences are on (the fake client in ranked, or a rules override).
 */
const INTERFERENCES_ON = { interferences: true } as const;

/** Every reaction always, for this level. */
const reactsAlways = (level: 1 | 2 | 3 | 4 | 5) =>
  withLevel(BOT_LEVELS, level, {
    reactions: Object.fromEntries(
      Object.entries(BOT_LEVELS[level - 1]!.reactions).map(([k, r]) => [k, { ...r, chance: 1 }]),
    ),
  });

describe('a whole game against a scripted human (spec §9)', () => {
  const g = botGame({ level: 3, seed: 21 });
  scriptHuman(g, { missEvery: 4 });
  runUntilOver(g);
  const events = g.host.events;

  it('plays to the end: both sides solve cells, the board is complete', () => {
    expect(g.host.state.result?.reason).toBe('boardComplete');
    const botCorrect = eventsOf(events, 'placedCorrect', g.botId).length;
    const humanCorrect = eventsOf(events, 'placedCorrect', HUMAN).length;
    expect(botCorrect).toBeGreaterThan(15);
    expect(humanCorrect).toBeGreaterThan(5);
    expect(botCorrect + humanCorrect).toBe(46);
  });

  it('locks, then enters the digit within 80% of the lock time, in the cell it locked', () => {
    const limit = g.config.rules.thinkTimeMs * BOT_CONFIG.placeWithin;
    let lock: Extract<GameEvent, { type: 'cellLocked' }> | null = null;
    let places = 0;
    for (const e of byBot(g, events)) {
      if (e.type === 'cellLocked') lock = e;
      if (e.type === 'placedCorrect' || e.type === 'placedWrong') {
        expect(lock?.cell).toBe(e.cell);
        expect(e.t - lock!.t).toBeLessThanOrEqual(limit);
        places++;
        lock = null;
      }
    }
    expect(places).toBeGreaterThan(15);
  });

  it('is never refused and never fails, and re-plans when the human takes its cell', () => {
    expect(problems(g)).toEqual([]);
    expect(plans(g).length).toBeGreaterThan(eventsOf(events, 'cellLocked', g.botId).length);
  });

  it('thinks the level’s base × the difficulty of the deduction each move needs (spec §9)', () => {
    const { min, max } = BOT_LEVELS[2]!.thinkMs; // Mr. Hoot: 9–15 s
    const seen = new Set<string>();
    for (const p of plans(g)) {
      seen.add(p.difficulty.technique);
      const base = p.totalMs / (p.difficulty.factor * p.adapt * BOT_CONFIG.pace.fast);
      expect(base).toBeGreaterThanOrEqual(min - 1);
      expect(base).toBeLessThanOrEqual(max + 1);
      expect(p.hesitateMs + p.solveMs).toBe(p.totalMs);
      expect(p.solveMs).toBeLessThanOrEqual(g.config.rules.thinkTimeMs * BOT_CONFIG.placeWithin);
    }
    // Easy cells mostly, and a move on an easier one is quicker.
    expect(seen).toContain('lastGap');
    expect(seen).toContain('nakedSingle');
    const meanOf = (t: string) => {
      const ms = plans(g).filter((p) => p.difficulty.technique === t && p.adapt === 1);
      return ms.reduce((a, p) => a + p.totalMs, 0) / ms.length;
    };
    expect(meanOf('lastGap')).toBeLessThan(meanOf('nakedSingle'));
  });

  it('stops at the end: nothing after gameOver, no timer left', () => {
    g.scheduler.advance(60_000);
    expect(g.host.events.at(-1)?.type).toBe('gameOver');
    expect(g.host.events).toHaveLength(events.length);
    expect(g.scheduler.pending).toBe(0);
    expect(g.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'gameOver' });
  });

  it('leaves a log that replays to the same game', () => {
    expect(JSON.stringify(replay(events).at(-1))).toBe(JSON.stringify(g.host.state));
  });

  it('reacts only 0.6–1.6 s after a trigger', () => {
    for (const r of eventsOf(events, 'reaction', g.botId)) {
      const trigger = events.find(
        (e) =>
          r.t - e.t >= BOT_CONFIG.reactionDelayMs.min &&
          r.t - e.t <= BOT_CONFIG.reactionDelayMs.max &&
          ((e.type === 'placedWrong' && e.playerId === HUMAN) ||
            (e.type === 'interference' && e.targetId === g.botId)),
      );
      expect(trigger).toBeDefined();
    }
  });
});

describe('the bot is repeatable', () => {
  it('the same seed plays the same game; another seed another', () => {
    const run = (seed: number) => {
      const g = botGame({ level: 4, seed });
      scriptHuman(g, { missEvery: 3 });
      runUntilOver(g);
      return JSON.stringify(g.host.events);
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
});

describe('re-planning (spec §9)', () => {
  it('picks another cell when the human takes its target, without a refusal', () => {
    const g = botGame({ level: 1, seed: 3 });
    const [first] = plans(g);
    expect(first).toMatchObject({ at: 0 });
    g.scheduler.advance(500);
    g.host.select(first!.cell);
    const second = plans(g)[1]!;
    expect(second).toMatchObject({ at: 500 });
    expect(second.cell).not.toBe(first!.cell);
    advanceUntil(g, () => !!botLock(g));
    expect(botLock(g)).toMatchObject({ cell: second.cell, lockedAt: 500 + second.hesitateMs });
    expect(problems(g)).toEqual([]);
  });

  it('picks another cell when the human solves its target', () => {
    const g = botGame({ level: 1, seed: 4 });
    const [first] = plans(g);
    g.scheduler.advance(300);
    g.host.select(first!.cell);
    g.host.place(first!.cell, solutionOf(g.host.state, first!.cell));
    expect(plans(g).at(-1)!.cell).not.toBe(first!.cell);
    g.scheduler.advance(30_000);
    expect(eventsOf(g.host.events, 'placedCorrect', g.botId).length).toBeGreaterThan(0);
    expect(problems(g)).toEqual([]);
  });

  it('keeps its target when the board changes elsewhere', () => {
    const g = botGame({ level: 1, seed: 5 });
    const [first] = plans(g);
    g.scheduler.advance(300);
    humanSolves(g, first!.cell);
    expect(plans(g)).toHaveLength(1);
    advanceUntil(g, () => !!botLock(g));
    expect(botLock(g)).toMatchObject({ cell: first!.cell, lockedAt: first!.hesitateMs });
  });

  it('waits for the start of a game that has not started', () => {
    const g = botGame({ level: 5, autoStart: false });
    g.scheduler.advance(30_000);
    expect(plans(g)).toEqual([]);
    expect(g.host.events.map((e) => e.type)).toEqual(['gameCreated']);
    g.host.dispatch({ type: 'start' });
    expect(plans(g)).toHaveLength(1);
    g.scheduler.advance(30_000);
    expect(eventsOf(g.host.events, 'placedCorrect', g.botId).length).toBeGreaterThan(0);
  });
});

describe('timers that stop [D11] (spec §6.2.7, §16.2)', () => {
  it('stands still while hit, and its lock does not run out', () => {
    const g = botGame({ level: 1, seed: 6, rules: INTERFERENCES_ON });
    humanSolves(g, plans(g)[0]!.cell); // points to pay for the interference
    advanceUntil(g, () => !!botLock(g));
    const lock = botLock(g)!;
    const plan = plans(g)
      .filter((p) => p.cell === lock.cell)
      .at(-1)!;
    g.scheduler.advance(200);
    const seq = g.host.state.seq;
    g.host.interfere(g.botId, 'cats');
    expect(g.host.state.players.find((p) => p.id === g.botId)!.hitBy).not.toBeNull();
    advanceUntil(g, () => !botLock(g));
    const [first] = byBot(g, since(g, seq)).filter((e) => e.type !== 'reaction');
    expect(first?.type).toMatch(/^placed(Correct|Wrong)$/);
    // The digit comes the whole interference later than planned.
    expect(first!.t).toBe(lock.lockedAt + plan.solveMs + g.config.rules.interferenceMs);
    expect(eventsOf(g.host.events, 'cellReleased', g.botId).filter((e) => e.reason === 'timeout')).toEqual(
      [],
    );
  });

  it('hesitates the interference longer when hit before locking', () => {
    const g = botGame({ level: 1, seed: 7, rules: INTERFERENCES_ON });
    const target = plans(g)[0]!;
    humanSolves(g, target.cell);
    g.scheduler.advance(100);
    g.host.interfere(g.botId, 'fireworks');
    advanceUntil(g, () => !!botLock(g));
    expect(botLock(g)).toMatchObject({ cell: target.cell, lockedAt: target.hesitateMs + 5000 });
  });

  it('freezes with the game and goes on where it was', () => {
    const g = botGame({ level: 2, seed: 8 });
    advanceUntil(g, () => !!botLock(g));
    const lock = botLock(g)!;
    const plan = plans(g)
      .filter((p) => p.cell === lock.cell)
      .at(-1)!;
    g.scheduler.advance(100);
    g.host.dispatch({ type: 'disconnect', playerId: HUMAN }); // two players: the game freezes [D4]
    expect(g.host.state.status).toBe('paused');
    const seq = g.host.state.seq;
    g.scheduler.advance(10_000);
    expect(since(g, seq)).toEqual([]);
    g.host.dispatch({ type: 'reconnect', playerId: HUMAN });
    advanceUntil(g, () => !botLock(g));
    const placed = byBot(g, since(g, seq)).find(
      (e) => e.type === 'placedCorrect' || e.type === 'placedWrong',
    )!;
    expect(placed.t).toBe(lock.lockedAt + plan.solveMs + 10_000);
  });
});

describe('stopping (spec §9: never after gameOver or detach)', () => {
  it('stops when the human ends the practice', () => {
    const g = botGame({ level: 5, seed: 9 });
    g.scheduler.advance(1000);
    g.host.surrender();
    expect(g.host.state.result?.reason).toBe('practiceEnded');
    const n = g.host.events.length;
    g.scheduler.advance(60_000);
    expect(g.host.events).toHaveLength(n);
    expect(g.scheduler.pending).toBe(0);
    expect(g.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'gameOver' });
  });

  it('detach() stops it for good, and twice is fine', () => {
    const g = botGame({ level: 5, seed: 10 });
    g.scheduler.advance(500);
    expect(botLock(g)).toBeUndefined();
    g.bot.detach();
    g.bot.detach();
    expect(g.scheduler.pending).toBe(0);
    const seq = g.host.state.seq;
    humanErrs(g); // nothing to react to any more
    g.scheduler.advance(60_000);
    expect(byBot(g, since(g, seq))).toEqual([]);
    expect(g.traces.filter((t) => t.type === 'stopped')).toEqual([
      { type: 'stopped', at: 500, reason: 'detached' },
    ]);
  });
});

describe('robustness: a refusal re-plans, nothing escapes a scheduler callback', () => {
  function manualGame(host: (opts: ConstructorParameters<typeof LocalGameHost>[0]) => LocalGameHost) {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const bot = botPlayer(5);
    const config: GameConfig = {
      id: 'g',
      mode: 'bot',
      gameType: 'fast',
      puzzle: PUZZLE,
      players: [{ id: HUMAN }, bot],
      rules: defaultRules('bot', 'fast'),
      seed: 1,
    };
    const h = host({ config, playerId: HUMAN, clock, scheduler });
    const traces: BotTrace[] = [];
    const handle = attachBot(h, {
      botId: bot.id,
      level: 5,
      clock,
      scheduler,
      rng: createRng(1),
      onTrace: (t) => traces.push(t),
    });
    return { clock, scheduler, host: h, bot: handle, botId: bot.id, traces, config } satisfies BotGame;
  }

  it('a refused select: it waits a moment and plans again', () => {
    class FlakyHost extends LocalGameHost {
      refuse = 1;
      override dispatch(action: Action): ActionResult {
        if (this.refuse > 0 && action.type === 'select' && action.playerId !== HUMAN) {
          this.refuse--;
          return { state: this.state, events: [], rejected: 'cellTaken' };
        }
        return super.dispatch(action);
      }
    }
    const g = manualGame((o) => new FlakyHost(o));
    g.scheduler.advance(20_000);
    const refused = g.traces.find((t) => t.type === 'action' && t.rejected);
    expect(refused).toMatchObject({ type: 'action', action: { type: 'select' }, rejected: 'cellTaken' });
    expect(plans(g)[1]!.at).toBe(refused!.at + BOT_CONFIG.retryMs);
    expect(eventsOf(g.host.events, 'placedCorrect', g.botId).length).toBeGreaterThan(2);
  });

  it('a closed host: it stops quietly', () => {
    const g = manualGame((o) => new LocalGameHost(o));
    g.scheduler.advance(1000);
    g.host.close();
    expect(() => g.scheduler.advance(60_000)).not.toThrow();
    expect(g.traces.at(-1)).toMatchObject({ type: 'stopped', reason: 'hostClosed' });
    expect(g.scheduler.pending).toBe(0);
  });

  it('another listener that throws: the bot plays on', () => {
    const g = manualGame((o) => new LocalGameHost(o));
    g.host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === g.botId))
        throw new Error('boom');
    });
    expect(() => g.scheduler.advance(30_000)).not.toThrow();
    expect(g.traces.some((t) => t.type === 'error')).toBe(true);
    expect(eventsOf(g.host.events, 'placedCorrect', g.botId).length).toBeGreaterThan(3);
  });
});

describe('practice against a bot: no interferences, either way [D44]', () => {
  it('Overlord at its most eager sends none over a whole game, and mine are refused', () => {
    const levels = withLevel(BOT_LEVELS, 5, {
      interference: { maxPerGame: null, minDeficit: null, chance: 1 },
    });
    const g = botGame({ level: 5, seed: 11, config: { levels } });
    expect(g.config.rules.interferences).toBe(false);
    scriptHuman(g, { missEvery: 5 });
    g.scheduler.advance(3000);
    expect(g.host.getView().interference).toBeNull(); // no panel, so no button on its card
    expect(
      g.host.dispatch({ type: 'interfere', playerId: HUMAN, targetId: g.botId, kind: 'cats' }).rejected,
    ).toBe('interferencesOff');
    runUntilOver(g);
    expect(g.host.state.result?.reason).toBe('boardComplete');
    expect(eventsOf(g.host.events, 'interference')).toEqual([]);
    expect(g.traces.some((t) => t.type === 'action' && t.action.type === 'interfere')).toBe(false);
    expect(problems(g)).toEqual([]);
  });
});

describe('interferences at engine level (spec §7.2, §9) [D40]: the policy where they are on', () => {
  it('Overlord is aggressive: it pays 2, 4, 8 … and never hits a busy target [D10, D11]', () => {
    const g = botGame({ level: 5, seed: 11, rules: INTERFERENCES_ON });
    runUntilOver(g);
    const sent = eventsOf(g.host.events, 'interference').filter((e) => e.fromId === g.botId);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    sent.forEach((e, k) => {
      expect(e).toMatchObject({ targetId: HUMAN, cost: 2 ** (k + 1) });
      expect(INTERFERENCE_KINDS).toContain(e.kind);
      expect(e.score).toBeGreaterThanOrEqual(0); // it could pay
      if (k) expect(e.t - sent[k - 1]!.t).toBeGreaterThanOrEqual(5000 + 1000);
    });
    expect(problems(g)).toEqual([]);
  });

  it('Biscuit never interferes while it is not 15 behind', () => {
    const g = botGame({ level: 2, seed: 12, rules: INTERFERENCES_ON });
    runUntilOver(g);
    expect(eventsOf(g.host.events, 'interference')).toEqual([]);
  });

  it('Biscuit interferes once it trails by 15 or more', () => {
    // A seed where Biscuit also errs twice and still has the points to pay (a mistake costs the cell's value, §6.5).
    const g = botGame({ level: 2, seed: 15, rules: INTERFERENCES_ON });
    scriptHuman(g, { everyMs: 2500, placeMs: 500, startAt: 100 }); // much faster than Biscuit
    runUntilOver(g);
    const states = replay(g.host.events);
    const sent = g.host.events.flatMap((e, k) =>
      e.type === 'interference' ? [{ e, before: states[k - 1]! }] : [],
    );
    expect(sent.length).toBeGreaterThan(0);
    for (const { e, before } of sent) {
      const score = (id: string) => before.players.find((p) => p.id === id)!.score;
      expect(e.fromId).toBe(g.botId);
      expect(score(HUMAN) - score(g.botId)).toBeGreaterThanOrEqual(15);
    }
  });

  it('Pip interferes at most once a game, however eager', () => {
    const levels = withLevel(BOT_LEVELS, 1, { interference: { maxPerGame: 1, minDeficit: null, chance: 1 } });
    const g = botGame({ level: 1, seed: 14, config: { levels }, rules: INTERFERENCES_ON });
    runUntilOver(g);
    expect(eventsOf(g.host.events, 'interference').filter((e) => e.fromId === g.botId)).toHaveLength(1);
  });
});

describe('reactions (spec §8, §9) [D19]', () => {
  it('😂 after my mistake, 0.6–1.6 s later', () => {
    const g = botGame({ level: 3, seed: 15, config: { levels: reactsAlways(3) } });
    g.scheduler.advance(500);
    humanErrs(g, plans(g)[0]!.cell);
    g.scheduler.advance(2000);
    const [r] = eventsOf(g.host.events, 'reaction', g.botId);
    expect(r).toMatchObject({ emoji: '😂' });
    expect(r!.t - 500).toBeGreaterThanOrEqual(600);
    expect(r!.t - 500).toBeLessThanOrEqual(1600);
  });

  it('😱 when I hit it', () => {
    const g = botGame({ level: 5, seed: 16, config: { levels: reactsAlways(5) }, rules: INTERFERENCES_ON });
    humanSolves(g, plans(g)[0]!.cell);
    g.scheduler.advance(100);
    g.host.interfere(g.botId, 'warp');
    g.scheduler.advance(2000);
    expect(eventsOf(g.host.events, 'reaction', g.botId).map((r) => r.emoji)).toEqual(['😱']);
  });

  it('Maestro stays cool: 😎 when hit', () => {
    const g = botGame({ level: 4, seed: 17, config: { levels: reactsAlways(4) }, rules: INTERFERENCES_ON });
    humanSolves(g, plans(g)[0]!.cell);
    g.host.interfere(g.botId, 'cats');
    g.scheduler.advance(2000);
    expect(eventsOf(g.host.events, 'reaction', g.botId).map((r) => r.emoji)).toEqual(['😎']);
  });

  it('Maestro: 😎 when it takes the lead', () => {
    const g = botGame({ level: 4, seed: 18, config: { levels: reactsAlways(4) } });
    humanSolves(g, plans(g)[0]!.cell);
    runUntilOver(g);
    const states = replay(g.host.events);
    const lead = g.host.events.findIndex((e, k) => {
      if (e.type !== 'placedCorrect' || e.playerId !== g.botId) return false;
      const s = states[k]!;
      const score = (id: string) => s.players.find((p) => p.id === id)!.score;
      return score(g.botId) > score(HUMAN);
    });
    const r = eventsOf(g.host.events, 'reaction', g.botId)[0];
    expect(r).toMatchObject({ emoji: '😎' });
    expect(r!.t - g.host.events[lead]!.t).toBeGreaterThanOrEqual(600);
    expect(r!.t - g.host.events[lead]!.t).toBeLessThanOrEqual(1600);
  });

  it('Biscuit has no 😱 in its table', () => {
    const g = botGame({ level: 2, seed: 19, config: { levels: reactsAlways(2) }, rules: INTERFERENCES_ON });
    humanSolves(g, plans(g)[0]!.cell);
    g.host.interfere(g.botId, 'cats');
    g.scheduler.advance(3000);
    expect(eventsOf(g.host.events, 'reaction', g.botId)).toEqual([]);
  });

  it('keeps to one reaction per 2 seconds, without a refusal', () => {
    const g = botGame({ level: 3, seed: 20, config: { levels: reactsAlways(3) } });
    const avoid = () => plans(g).at(-1)?.cell;
    g.scheduler.advance(100);
    humanErrs(g, avoid());
    g.scheduler.advance(500);
    humanErrs(g, avoid()); // while the first reaction is on its way
    g.scheduler.advance(3000);
    humanErrs(g, avoid());
    g.scheduler.advance(3000);
    const reactions = eventsOf(g.host.events, 'reaction', g.botId);
    expect(reactions).toHaveLength(2);
    expect(reactions[1]!.t - reactions[0]!.t).toBeGreaterThanOrEqual(2000);
    expect(problems(g)).toEqual([]);
  });
});

describe("the 'turns' model [D1]", () => {
  it('plays only on its own turn', () => {
    const g = botGame({ level: 4, seed: 22, rules: { turnModel: 'turns' } });
    expect(plans(g)).toEqual([]); // the human (seat 0) has the first turn
    g.scheduler.advance(120_000);
    const states = replay(g.host.events);
    const locks = g.host.events.flatMap((e, k) =>
      e.type === 'cellLocked' && e.playerId === g.botId ? [states[k - 1]!] : [],
    );
    expect(locks.length).toBeGreaterThan(3);
    for (const before of locks) expect(before.turn?.playerId).toBe(g.botId);
    expect(problems(g)).toEqual([]);
  });

  it('the slowest level still locks before its turn passes, and its digit comes within the lock', () => {
    const g = botGame({ level: 1, gameType: 'normal', seed: 23, rules: { turnModel: 'turns' } });
    scriptHuman(g, { everyMs: 500, placeMs: 2000, startAt: 100 }); // quick on its own turns
    runUntilOver(g, 2 * 3600_000, 1000);
    expect(g.host.state.result?.reason).toBe('boardComplete');
    const events = g.host.events;
    const turns = eventsOf(events, 'turnStarted').filter((e) => e.playerId === g.botId);
    expect(turns.length).toBeGreaterThan(10);
    for (const turn of turns) {
      const next = events.find(
        (e) => e.seq > turn.seq && (e.type === 'turnStarted' || e.type === 'gameOver'),
      );
      const lock = events.find((e) => e.seq > turn.seq && e.type === 'cellLocked' && e.playerId === g.botId);
      // A Novice move takes 15 s and more, a 'normal' turn 12 s: it hesitates within the turn instead.
      expect(lock).toBeDefined();
      expect(lock!.seq).toBeLessThan(next!.seq);
      if (turn.endsAt !== null) expect(lock!.t).toBeLessThan(turn.endsAt);
    }
    // Only the deliberate hesitation lets a lock run out (spec §9: about 2%).
    const timeouts = eventsOf(events, 'cellReleased', g.botId).filter((e) => e.reason === 'timeout');
    expect(timeouts.length).toBeLessThanOrEqual(Math.ceil(0.1 * turns.length));
    expect(problems(g)).toEqual([]);
  });
});

describe('four at the table', () => {
  it('a human and three bots (levels 1, 2 and 4) fill the board; every bot digit comes within its lock', () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const levels = [1, 2, 4] as const;
    const config: GameConfig = {
      id: 'four',
      mode: 'bot',
      gameType: 'fast',
      puzzle: PUZZLE,
      players: [{ id: HUMAN }, ...levels.map((l) => botPlayer(l))],
      rules: defaultRules('bot', 'fast', INTERFERENCES_ON), // the bots hit each other too
      seed: 1,
    };
    const host = new LocalGameHost({ config, playerId: HUMAN, clock, scheduler });
    const traces: BotTrace[] = [];
    for (const level of levels)
      attachBot(host, {
        botId: `bot-${level}`,
        level,
        clock,
        scheduler,
        rng: createRng(30 + level),
        onTrace: (t) => traces.push(t),
      });
    scriptHuman({ host, scheduler, clock }, { everyMs: 10_000, missEvery: 5 });
    while (host.state.status !== 'over' && clock.now() < 3600_000) scheduler.advance(1000);
    expect(host.state.result?.reason).toBe('boardComplete');
    expect(traces.filter((t) => t.type === 'error' || (t.type === 'action' && t.rejected))).toEqual([]);
    const limit = config.rules.thinkTimeMs * BOT_CONFIG.placeWithin;
    for (const level of levels) {
      const id = `bot-${level}`;
      let lockedAt: number | null = null;
      let digits = 0;
      for (const e of host.events) {
        if (!('playerId' in e) || e.playerId !== id) continue;
        if (e.type === 'cellLocked') lockedAt = e.t;
        if (e.type === 'placedCorrect' || e.type === 'placedWrong') {
          expect(e.t - lockedAt!).toBeLessThanOrEqual(limit);
          digits++;
        }
      }
      expect([id, digits > 0]).toEqual([id, true]);
    }
  });
});

describe('two bots at one table', () => {
  it('share the board without a single refusal', () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const config: GameConfig = {
      id: 'g',
      mode: 'bot',
      gameType: 'fast',
      puzzle: PUZZLE,
      players: [{ id: HUMAN }, botPlayer(5), botPlayer(3)],
      rules: defaultRules('bot', 'fast', INTERFERENCES_ON), // the bots hit each other too
      seed: 1,
    };
    const host = new LocalGameHost({ config, playerId: HUMAN, clock, scheduler });
    const traces: BotTrace[] = [];
    for (const [level, seed] of [
      [5, 1],
      [3, 2],
    ] as const)
      attachBot(host, {
        botId: `bot-${level}`,
        level,
        clock,
        scheduler,
        rng: createRng(seed),
        onTrace: (t) => traces.push(t),
      });
    while (host.state.status !== 'over' && clock.now() < 3600_000) scheduler.advance(5000);
    expect(host.state.result?.reason).toBe('boardComplete');
    expect(traces.filter((t) => t.type === 'error' || (t.type === 'action' && t.rejected))).toEqual([]);
    for (const id of ['bot-5', 'bot-3'])
      expect(eventsOf(host.events, 'placedCorrect', id).length).toBeGreaterThan(5);
  });
});

describe('staged practice: the bot of a level against it (dev-plan §2ג) [D61, D49, D65]', () => {
  /** A level duel (DUEL_LEVEL: first to 30 in 30 s) on LocalGameHost, the bot attached; its draws recorded. */
  function levelDuel(
    o: { config?: Partial<BotConfig>; level?: BotLevelId; rng?: Rng; human?: boolean } = {},
  ): BotGame & { draws: number[] } {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const config = levelGameConfig(DUEL_LEVEL, { id: 'duel', player: ME, attempt: 1 });
    const host = new LocalGameHost({ config, playerId: ME.id, clock, scheduler });
    const draws: number[] = [];
    const base = o.rng ?? createRng(config.seed!);
    const rng: Rng = {
      next: () => {
        const v = base.next();
        draws.push(v);
        return v;
      },
    };
    const traces: BotTrace[] = [];
    const bot = attachBot(host, {
      botId: PIP.id,
      level: o.level ?? 1,
      clock,
      scheduler,
      rng,
      config: o.config,
      onTrace: (t) => traces.push(t),
    });
    const g = { clock, scheduler, host, bot, botId: PIP.id, traces, config, draws };
    if (o.human ?? true) scriptHuman(g, { everyMs: 4000, placeMs: 1500, missEvery: 3, id: ME.id });
    return g;
  }

  it("a level duel in mode 'bot' has no interference, and the bot draws the same random stream as today", () => {
    const eager = withLevel(BOT_LEVELS, 1, {
      interference: { maxPerGame: null, minDeficit: null, chance: 1 },
    });
    const today = levelDuel({ config: { levels: eager } });
    runUntilOver(today, 60_000, 500);
    const level = levelDuel({ config: { ...levelBotConfig(1), levels: eager } });
    runUntilOver(level, 60_000, 500);
    expect(level.config).toMatchObject({ mode: 'bot', rules: { interferences: false } });
    for (const g of [today, level]) {
      expect(g.host.state.status).toBe('over');
      expect(eventsOf(g.host.events, 'interference')).toEqual([]);
      expect(g.traces.some((t) => t.type === 'action' && t.action.type === 'interfere')).toBe(false);
      expect(problems(g)).toEqual([]);
    }
    // No lock was left to run out in the game of today: the level's bot plays it draw for draw.
    expect(plans(today).length).toBeGreaterThan(0);
    expect(plans(today).every((p) => !p.linger)).toBe(true);
    expect(level.draws).toEqual(today.draws);
    expect(JSON.stringify(level.host.events)).toBe(JSON.stringify(today.host.events));
  });

  it('with levelBotConfig(0.9) every move takes 0.9 of its unpaced think time', () => {
    const g = levelDuel({ config: levelBotConfig(0.9), level: 5, rng: { next: () => 0.5 }, human: false });
    runUntilOver(g, 60_000, 500);
    const { min, max } = BOT_LEVELS[4]!.thinkMs;
    const base = min + 0.5 * (max - min); // what the RNG draws
    expect(plans(g).length).toBeGreaterThan(3);
    for (const p of plans(g)) {
      expect(p.adapt).toBe(1);
      expect(p.linger).toBe(false);
      expect(p.totalMs).toBe(Math.round(base * 0.9 * p.difficulty.factor * p.adapt));
    }
  });

  it('the app out of the foreground [D65]: nothing while frozen, then on with the time it had left', () => {
    const g = levelDuel({ config: levelBotConfig(1), human: false });
    const [first] = plans(g);
    expect(first!.hesitateMs).toBeLessThan(26_000); // it locks within the level's 30 s
    g.scheduler.advance(3000);
    g.host.pause();
    expect(g.host.state).toMatchObject({ status: 'paused', pausedBy: 'background' });
    let seq = g.host.state.seq;
    g.scheduler.advance(120_000);
    expect(since(g, seq)).toEqual([]);
    g.host.resume();
    advanceUntil(g, () => !!botLock(g));
    expect(botLock(g)).toMatchObject({ cell: first!.cell, lockedAt: first!.hesitateMs + 120_000 });
    // Frozen again while it holds its cell: the digit comes the whole freeze later.
    const lock = botLock(g)!;
    g.scheduler.advance(100);
    g.host.pause();
    seq = g.host.state.seq;
    g.scheduler.advance(45_000);
    expect(since(g, seq)).toEqual([]);
    g.host.resume();
    advanceUntil(g, () => !botLock(g));
    const placed = byBot(g, since(g, seq)).find(
      (e) => e.type === 'placedCorrect' || e.type === 'placedWrong',
    )!;
    expect(placed.t).toBe(lock.lockedAt + first!.solveMs + 45_000);
    expect(problems(g)).toEqual([]);
  });

  it('[D65] in a practice against a bot too: frozen mid-think, it places nothing and keeps the think time left', () => {
    const g = botGame({ level: 3, seed: 5 });
    advanceUntil(g, () => !!botLock(g));
    const lock = botLock(g)!;
    const plan = plans(g).find((p) => p.cell === lock.cell)!;
    g.scheduler.advance(200);
    g.host.pause();
    const seq = g.host.state.seq;
    g.scheduler.advance(300_000);
    expect(since(g, seq)).toEqual([]);
    expect(botLock(g)).toMatchObject({ cell: lock.cell });
    g.host.resume();
    advanceUntil(g, () => !botLock(g) || botLock(g)!.cell !== lock.cell);
    const placed = byBot(g, since(g, seq)).find(
      (e) => e.type === 'placedCorrect' || e.type === 'placedWrong',
    )!;
    // Its digit comes the whole freeze later: the think time it had left, no more and no less.
    expect(placed).toMatchObject({ cell: lock.cell, t: lock.lockedAt + plan.solveMs + 300_000 });
    expect(problems(g)).toEqual([]);
  });

  it('[D65] holds its reaction on the way too: it comes after the resume, with the time it had left', () => {
    const reacts = { ...levelBotConfig(1), levels: reactsAlways(1) };
    const run = (pauseMs: number) => {
      const g = levelDuel({ config: reacts, human: false });
      g.scheduler.advance(500);
      humanErrs(g, plans(g)[0]!.cell);
      g.scheduler.advance(100);
      if (pauseMs) {
        g.host.pause();
        g.scheduler.advance(pauseMs);
        expect(eventsOf(g.host.events, 'reaction', g.botId)).toEqual([]);
        g.host.resume();
      }
      g.scheduler.advance(2000);
      return eventsOf(g.host.events, 'reaction', g.botId);
    };
    const [plain] = run(0);
    expect(plain).toMatchObject({ emoji: '😂' });
    expect(run(60_000)).toEqual([expect.objectContaining({ emoji: '😂', t: plain!.t + 60_000 })]);
  });

  it("keeps to a level's box (rules.editableCells): every cell it locks is in it", () => {
    const box = ['D4', 'D5', 'E4', 'E5', 'F4'].map(parseCellName);
    const g = botGame({ level: 5, seed: 31, rules: { editableCells: box } });
    runUntilOver(g, 600_000);
    expect(g.host.state.result?.reason).toBe('targetReached');
    const locked = eventsOf(g.host.events, 'cellLocked', g.botId).map((e) => e.cell);
    expect(locked.length).toBeGreaterThan(0);
    for (const c of locked) expect(box).toContain(c);
    expect(problems(g)).toEqual([]);
  });
});
