import { BOT_MISS_AT } from '../bot/finder';
import { BOT_CONFIG, botConfig, type BotFindConfig } from '../bot/levels';
import { BOXES, cellName, COLS, parseCellName, ROWS } from '../sudoku/board';
import {
  boardTarget,
  FIND_BOARD_LEVEL,
  FIND_DUEL_LEVEL,
  FIND_LEVEL,
  FindDriver,
  pinnedRace,
  RACE_SPOTS,
  SPOT_ERROR_LEVEL,
} from '../testing/findLevels';
import { ME } from '../testing/levels';
import { ManualClock } from '../util/clock';
import { createRng } from '../util/random';
import { createFind, createFindConfig, type FindState, replayFind } from './find';
import { LEVEL_RULES } from './progress';
import type { FindScope, LevelEvent, LevelEventType } from './spec';
import { transformLevel } from './transform';

/* The tap engine (dev-plan §2ג; plan §2.1, §2.2, Idea-1): find, the race against the bot, and spot the error. */

const PENALTY = { ...LEVEL_RULES, tapOnFilled: 'penalty' } as const;
const levelOver = (d: FindDriver) => d.last('levelOver')!;
const pinned = (ms: number, o?: Parameters<typeof pinnedRace>[1]) =>
  pinnedRace(
    RACE_SPOTS.map(() => ms),
    o,
  );
const scopeCells = (scope: FindScope): readonly number[] =>
  scope.kind === 'board'
    ? Array.from({ length: 81 }, (_, i) => i)
    : { box: BOXES, row: ROWS, col: COLS }[scope.kind][scope.index]!.cells;

describe('find (plan §2.1): one target, against the clock', () => {
  it('starts at once: the target shown, 20 s on the clock, no bot', () => {
    const d = new FindDriver(FIND_LEVEL);
    expect(d.types()).toEqual(['levelCreated', 'levelStarted', 'targetShown']);
    expect(d.last('targetShown')).toMatchObject({ index: 0, botTapAt: null });
    expect(d.state.endsAt).toBe(20000);
    const find = d.view().level!.find!;
    expect(find).toMatchObject({ digit: 9, scope: { kind: 'box', index: 4 }, spotIndex: 0, wrongTaps: 0 });
    expect(find.answer).toBeUndefined();
  });

  it('a right tap at 5.000 s is ★★★, at 5.010 s ★★ (inclusive edges)', () => {
    const a = new FindDriver(FIND_LEVEL);
    expect(a.types(a.tap('D5', 5000))).toEqual(['tapped', 'spotWon', 'levelOver']);
    expect(levelOver(a)).toMatchObject({ reason: 'targetReached', elapsedMs: 5000, spots: 1, stars: 3 });
    const b = new FindDriver(FIND_LEVEL);
    b.tap('D5', 5010);
    expect(levelOver(b)).toMatchObject({ reason: 'targetReached', elapsedMs: 5010, stars: 2 });
    // The cell is mine on the board.
    expect(b.view().grid[parseCellName('D5')]).toBe(9);
    expect(b.view().owner[parseCellName('D5')]).toBe(0);
  });

  it('a wrong tap costs 5 s: wrong, then right 1 s later, is 6 s on the clock and ★★', () => {
    const d = new FindDriver(FIND_LEVEL);
    expect(d.tap('D4', 0)).toEqual([
      expect.objectContaining({ type: 'tapped', playerId: ME.id, right: false, penaltyMs: 5000 }),
    ]);
    expect(d.state.endsAt).toBe(15000); // the limit came 5 s closer
    expect(d.view().level).toMatchObject({ penaltyMs: 5000, elapsedMs: 5000, remainingMs: 15000 });
    d.tap('D5', 1000);
    expect(levelOver(d)).toMatchObject({ elapsedMs: 6000, penaltyMs: 5000, stars: 2 });
  });

  it('the second wrong tap ends it: tooManyMisses, 0 stars, and the answer in the view', () => {
    const d = new FindDriver(FIND_LEVEL);
    d.tap('D4', 1000);
    expect(d.types(d.tap('E4', 2000))).toEqual(['tapped', 'levelOver']);
    expect(levelOver(d)).toMatchObject({ reason: 'tooManyMisses', stars: 0, spots: 0 });
    const level = d.view().level!;
    expect(level).toMatchObject({ final: true, stars: 0 });
    expect(level.find!.answer).toEqual([parseCellName('D5')]);
    expect(level.find!.over).toMatchObject({ reason: 'tooManyMisses' });
    expect(d.view().solution).toBe(FIND_LEVEL.board.solution);
    expect(d.tapRefused('D5', 2500)).toBe('gameOver');
  });

  it('right at 19.999 s is ★; at 20 s the time is up first: the tap is refused, 0 stars, the answer shown', () => {
    const a = new FindDriver(FIND_LEVEL);
    a.tap('D5', 19999);
    expect(levelOver(a)).toMatchObject({ reason: 'targetReached', stars: 1 });
    const b = new FindDriver(FIND_LEVEL);
    expect(b.tapRefused('D5', 20000)).toBe('gameOver');
    expect(levelOver(b)).toMatchObject({ reason: 'timeUp', elapsedMs: 20000, stars: 0, t: 20000 });
    expect(b.view().level!.find!.answer).toEqual([parseCellName('D5')]);
  });

  it('a penalty that reaches the limit ends it at once', () => {
    const d = new FindDriver(FIND_LEVEL);
    expect(d.types(d.tap('D4', 16000))).toEqual(['tapped', 'levelOver']);
    expect(levelOver(d)).toMatchObject({ reason: 'timeUp', elapsedMs: 20000, t: 16000 });
  });

  it("scope 'board': every empty cell of the digit is right, any other is wrong", () => {
    for (const cell of ['C1', 'D5', 'F7', 'G3']) {
      const d = new FindDriver(FIND_BOARD_LEVEL);
      d.tap(cell, 2000);
      expect([cell, levelOver(d).reason]).toEqual([cell, 'targetReached']);
      expect(d.last('spotWon')!.cell).toBe(parseCellName(cell));
    }
    const d = new FindDriver(FIND_BOARD_LEVEL);
    d.tap('A1', 1000);
    expect(d.last('tapped')).toMatchObject({ right: false });
    expect(d.view().level!.find!.scope).toEqual({ kind: 'board' });
  });

  it("a tap on a filled cell: nothing with tapOnFilled 'ignore' (the default), a wrong tap with 'penalty'", () => {
    const d = new FindDriver(FIND_LEVEL);
    const before = d.log.length;
    expect(d.tapRefused('A3', 1000)).toBe('cellFilled'); // a given
    expect(d.log).toHaveLength(before);
    expect(d.state).toMatchObject({ endsAt: 20000, penaltyMs: 0 });
    const p = new FindDriver(FIND_LEVEL, { rules: PENALTY });
    p.tap('A3', 1000);
    expect(p.last('tapped')).toMatchObject({ right: false, penaltyMs: 5000 });
    expect(p.state.endsAt).toBe(15000);
    expect(p.state.config.rules.tapOnFilled).toBe('penalty'); // in the config: the replay needs nothing else
  });

  it('refuses a bad cell, and a tap before the start', () => {
    const d = new FindDriver(FIND_LEVEL, { start: false });
    expect(d.tapRefused('D5')).toBe('notStarted');
    d.act({ type: 'start' }, 100);
    expect(d.reject({ type: 'tap', playerId: ME.id, cell: 81 })).toBe('badCell');
    expect(d.reject({ type: 'tap', playerId: 'nobody', cell: 1 })).toBe('unknownPlayer');
    expect(d.reject({ type: 'start' })).toBe('alreadyStarted');
  });
});

describe('findDuel (plan §2.2): five spots, against the bot', () => {
  it('the bot takes a spot at its drawn time, and the next one is shown at once', () => {
    const d = new FindDriver(pinned(11000));
    expect(d.last('targetShown')).toMatchObject({ index: 0, botTapAt: 11000 });
    d.tickTo(10999);
    expect(d.all('spotWon')).toEqual([]);
    expect(d.types(d.tickTo(11000))).toEqual(['tapped', 'spotWon', 'targetShown']);
    expect(d.last('spotWon')).toMatchObject({ index: 0, playerId: d.botId, cell: parseCellName('F1') });
    expect(d.last('targetShown')).toMatchObject({ index: 1, botTapAt: 22000, t: 11000 });
    const find = d.view().level!.find!;
    expect(find.spots[0]).toEqual({ state: 'won', playerId: d.botId, cell: parseCellName('F1') });
    expect(find).toMatchObject({ spotIndex: 1, digit: 1, scope: { kind: 'box', index: 5 } });
    expect(d.view().owner[parseCellName('F1')]).toBe(1); // the bot's seat: its colour and ▲
  });

  it('my tap at the same ms as the bot wins the spot', () => {
    const d = new FindDriver(pinned(11000));
    d.tap('F1', 11000);
    expect(d.all('spotWon')).toEqual([expect.objectContaining({ index: 0, playerId: ME.id })]);
    expect(d.all('tapped').map((e) => e.playerId)).toEqual([ME.id]); // the bot never tapped it
    expect(d.last('targetShown')).toMatchObject({ index: 1, botTapAt: 22000 });
  });

  it('the time limit at the same ms as my tap wins: the tap is too late', () => {
    const d = new FindDriver(pinned(40000));
    expect(d.tapRefused('F1', 30000)).toBe('gameOver');
    expect(d.types().slice(-2)).toEqual(['spotVoid', 'levelOver']);
    expect(levelOver(d)).toMatchObject({ reason: 'timeUp', spots: 0, t: 30000 });
    // And a bot tap at that ms too.
    const b = new FindDriver(pinned(30000));
    b.tickTo(30000);
    expect(b.all('spotWon')).toEqual([]);
    expect(levelOver(b).reason).toBe('timeUp');
  });

  it('a wrong tap freezes me 3 s; a tap while frozen is refused', () => {
    const d = new FindDriver(pinned(11000));
    expect(d.tap('D1', 1000)).toEqual([
      expect.objectContaining({ type: 'tapped', right: false, frozenUntil: 4000 }),
    ]);
    expect(d.view().level!.find).toMatchObject({ frozenUntil: 4000, wrongTaps: 1, out: false });
    expect(d.state.endsAt).toBe(30000); // no time penalty in the race
    expect(d.tapRefused('F1', 3999)).toBe('frozen');
    d.tap('F1', 4000);
    expect(d.last('spotWon')).toMatchObject({ playerId: ME.id });
    expect(d.view().level!.find!.frozenUntil).toBeNull();
  });

  it('a second wrong tap on the same spot keeps me out of it until the next one', () => {
    const d = new FindDriver(pinned(11000));
    d.tap('D1', 1000);
    d.tap('D2', 4000);
    expect(d.view().level!.find).toMatchObject({ out: true, wrongTaps: 2 });
    expect(d.tapRefused('F1', 9000)).toBe('frozen');
    d.tickTo(11000); // the bot takes it, and the next one is shown
    expect(d.view().level!.find).toMatchObject({ out: false, spotIndex: 1 });
    d.tap('F8', 11500);
    expect(d.last('spotWon')).toMatchObject({ index: 1, playerId: ME.id });
  });

  it("the bot's own miss freezes it 3 s and leaves the spot open: I can take it", () => {
    const d = new FindDriver(pinned(11000, { missShare: 1 }));
    const miss = d.state.config.botPlan![0]!.miss!;
    expect(miss.atMs).toBeGreaterThanOrEqual(Math.round(11000 * BOT_MISS_AT.min));
    expect(d.last('targetShown')!.botTapAt).toBe(14000); // the miss costs it 3 s
    d.tickTo(miss.atMs);
    expect(d.last('tapped')).toMatchObject({
      playerId: d.botId,
      cell: miss.cell,
      right: false,
      frozenUntil: miss.atMs + 3000,
    });
    expect(d.view().level!.find!.spots[0]).toEqual({ state: 'open' });
    expect(d.view().players[1]).toMatchObject({ mistakes: 1, score: 0 });
    d.tap('F1', miss.atMs + 100);
    expect(d.last('spotWon')).toMatchObject({ index: 0, playerId: ME.id });
    // Without me, it takes it once its freeze and its search are over.
    const b = new FindDriver(pinned(11000, { missShare: 1 }));
    b.tickTo(13999);
    expect(b.all('spotWon')).toEqual([]);
    b.tickTo(14000);
    expect(b.last('spotWon')).toMatchObject({ playerId: b.botId, t: 14000 });
  });

  it('the bot reacts (😂) to my wrong tap when its plan says so, once a spot, a second later', () => {
    const d = new FindDriver(pinned(11000, { reactShare: 1 }));
    expect(d.state.config.botPlan!.every((p) => p.react)).toBe(true);
    d.tap('D1', 1000);
    d.tickTo(1999);
    expect(d.all('reacted')).toEqual([]);
    d.tickTo(2000);
    expect(d.all('reacted')).toEqual([expect.objectContaining({ playerId: d.botId, emoji: '😂', t: 2000 })]);
    d.tap('D2', 4000); // the second on the same spot: no second reaction
    d.tickTo(6000);
    expect(d.all('reacted')).toHaveLength(1);
    const quiet = new FindDriver(pinned(11000, { reactShare: 0 }));
    quiet.tap('D1', 1000);
    quiet.tickTo(5000);
    expect(quiet.all('reacted')).toEqual([]);
  });

  it('five spots taken end it: targetReached, my spots and their stars', () => {
    const d = new FindDriver(pinned(11000));
    ['F1', 'F8', 'G5', 'H9', 'I6'].forEach((cell, k) => d.tap(cell, 1000 * (k + 1)));
    expect(levelOver(d)).toMatchObject({ reason: 'targetReached', spots: 5, stars: 3, elapsedMs: 5000 });
    expect(d.view().level!.find!.spots.every((s) => s.state === 'won')).toBe(true);
    // Four of five, the bot the fifth: still ★★★; three: ★★.
    const four = new FindDriver(pinned(11000));
    ['F1', 'F8', 'G5', 'H9'].forEach((cell, k) => four.tap(cell, 1000 * (k + 1)));
    four.tickTo(4000 + 11000);
    expect(levelOver(four)).toMatchObject({ reason: 'targetReached', spots: 4, stars: 3 });
  });

  it('30 s with a spot open: it goes to nobody (spotVoid), then the time is up', () => {
    const d = new FindDriver(pinnedRace([5000, 40000, 40000, 40000, 40000]));
    d.tickTo(5000);
    expect(d.last('spotWon')).toMatchObject({ playerId: d.botId });
    d.tickTo(30000);
    expect(d.types().slice(-2)).toEqual(['spotVoid', 'levelOver']);
    expect(d.last('spotVoid')).toMatchObject({ index: 1, t: 30000 });
    expect(levelOver(d)).toMatchObject({ reason: 'timeUp', spots: 0, stars: 0, elapsedMs: 30000 });
    const spots = d.view().level!.find!.spots.map((s) => s.state);
    expect(spots).toEqual(['won', 'void', 'waiting', 'waiting', 'waiting']);
  });

  it('has no interference of any kind [D49]', () => {
    const d = new FindDriver(pinned(4000, { missShare: 1, reactShare: 1 }));
    d.tap('D1', 500);
    d.tickTo(30000);
    const known: LevelEventType[] = [
      'levelCreated',
      'levelStarted',
      'targetShown',
      'tapped',
      'spotWon',
      'spotVoid',
      'reacted',
      'levelOver',
    ];
    expect(d.types().filter((t) => !known.includes(t))).toEqual([]);
    expect(d.view().interference).toBeNull();
    expect(d.view().rules).toMatchObject({ interferences: false, interferenceKinds: [] });
  });
});

describe('spotError (plan Idea-1)', () => {
  const D5 = parseCellName('D5');
  const B2 = parseCellName('B2');

  it('shows my digits around the givens, mine in my colour', () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    expect(d.types()).toEqual(['levelCreated', 'levelStarted']); // no target to show
    const v = d.view();
    expect(v.grid[D5]).toBe(6); // the planted error
    expect(v.grid[parseCellName('A1')]).toBe(8);
    expect(v.owner[parseCellName('A1')]).toBe(0);
    expect(v.givens[parseCellName('A1')]).toBe(false);
    expect(v.owner[parseCellName('A3')]).toBeNull();
    expect(v.level!.find).toMatchObject({ digit: null, scope: null, spots: [], found: [] });
  });

  it('a tap on a planted error finds it: the right digit shows', () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    expect(d.tap('D5', 2000)).toEqual([expect.objectContaining({ type: 'tapped', right: true })]);
    expect(d.view().grid[D5]).toBe(9);
    expect(d.view().level!.find!.found).toEqual([D5]);
    expect(d.tapRefused('D5', 2500)).toBe('cellFilled'); // found already
  });

  it('a tap on a right digit of mine costs 5 s; on an empty cell nothing', () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    d.tap('A1', 1000);
    expect(d.last('tapped')).toMatchObject({ right: false, penaltyMs: 5000 });
    expect(d.state).toMatchObject({ endsAt: 25000, penaltyMs: 5000 });
    expect(d.tapRefused('A5', 1500)).toBe('badCell');
  });

  it("a tap on a given: nothing with tapOnFilled 'ignore', 5 s with 'penalty'", () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    expect(d.tapRefused('A3', 1000)).toBe('cellFilled');
    expect(d.state.penaltyMs).toBe(0);
    const p = new FindDriver(SPOT_ERROR_LEVEL, { rules: PENALTY });
    p.tap('A3', 1000);
    expect(p.state).toMatchObject({ endsAt: 25000, penaltyMs: 5000 });
  });

  it('all found ends it (targetReached), its stars by the clock', () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    d.tap('D5', 2000);
    d.tap('A1', 3000); // +5 s
    d.tap('B2', 6000);
    expect(levelOver(d)).toMatchObject({ reason: 'targetReached', found: 2, elapsedMs: 11000, stars: 3 });
    expect(d.view().level!.find!.answer).toEqual([]);
  });

  it('time up with an error not found: 0 stars, and the errors not found are shown', () => {
    const d = new FindDriver(SPOT_ERROR_LEVEL);
    d.tap('D5', 2000);
    d.tickTo(30000);
    expect(levelOver(d)).toMatchObject({ reason: 'timeUp', found: 1, stars: 0 });
    expect(d.view().level!.find!.answer).toEqual([B2]);
  });
});

describe("the bot's plan is drawn once, from the level and the attempt (spec §9) [D61, D63]", () => {
  const plan = (o: Parameters<typeof createFindConfig>[1], spec = FIND_DUEL_LEVEL) =>
    createFindConfig({ id: 'x', spec, player: ME }, o).botPlan;

  it('the same seed and attempt: the same plan; attempt 2: another', () => {
    expect(plan({ attempt: 1 })).toEqual(plan({ attempt: 1 }));
    expect(plan({ attempt: 2 })).toEqual(plan({ attempt: 2 }));
    expect(plan({ attempt: 2 })).not.toEqual(plan({ attempt: 1 }));
    // "שוב" plays the equivalent board, with the bot drawn again (dev-plan §1.3 ה).
    expect(plan({ attempt: 2 }, transformLevel(FIND_DUEL_LEVEL, 2))).not.toEqual(plan({ attempt: 1 }));
  });

  it("stays within the level's frozen ranges; a miss is a plausible cell, 30–80% into the search", () => {
    for (let attempt = 1; attempt <= 40; attempt++) {
      const p = plan({ attempt })!;
      expect(p).toHaveLength(5);
      p.forEach((spot, k) => {
        const [min, max] = FIND_DUEL_LEVEL.bot!.findMs![k]!;
        expect(spot.tapAtMs).toBeGreaterThanOrEqual(min);
        expect(spot.tapAtMs).toBeLessThanOrEqual(max);
        if (!spot.miss) return;
        expect(spot.miss.atMs).toBeGreaterThanOrEqual(Math.floor(spot.tapAtMs * BOT_MISS_AT.min));
        expect(spot.miss.atMs).toBeLessThanOrEqual(Math.ceil(spot.tapAtMs * BOT_MISS_AT.max));
        const target = RACE_SPOTS[k]!;
        expect(scopeCells(target.scope)).toContain(spot.miss.cell);
        expect(spot.miss.cell).not.toBe(target.cell);
        expect(FIND_DUEL_LEVEL.board.grid[spot.miss.cell]).toBe('0');
      });
    }
  });

  it('depends only on the level: a change of BOT_CONFIG.find leaves it as it was', () => {
    const before = plan({ attempt: 3 });
    const saved = BOT_CONFIG.find;
    const changed: BotFindConfig = {
      ...saved,
      ms: {
        1: { min: 1, max: 2 },
        2: { min: 1, max: 2 },
        3: { min: 1, max: 2 },
        4: { min: 1, max: 2 },
        5: { min: 1, max: 2 },
      },
      missShare: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
      reactShare: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
      tierFactor: { ...saved.tierFactor, single: 9 },
    };
    BOT_CONFIG.find = changed;
    try {
      expect(plan({ attempt: 3 })).toEqual(before);
    } finally {
      BOT_CONFIG.find = saved;
    }
    expect(plan({ attempt: 3, botConfig: botConfig({ find: changed }) })).toEqual(before);
    // A level without its frozen values takes them from BOT_CONFIG.find (the builder always freezes them).
    const bare = { ...FIND_DUEL_LEVEL, bot: { level: 1 as const, pace: 1 } };
    expect(plan({ attempt: 3, botConfig: botConfig({ find: changed }) }, bare)).not.toEqual(
      plan({ attempt: 3 }, bare),
    );
  });

  it('a given RNG draws its own plan (the builder simulates many bots)', () => {
    expect(plan({ attempt: 1, rng: createRng(5) })).toEqual(plan({ attempt: 1, rng: createRng(5) }));
    expect(plan({ attempt: 1, rng: createRng(5) })).not.toEqual(plan({ attempt: 1 }));
  });

  it('replayFind(log) lands exactly on the final state, with no RNG', () => {
    const d = new FindDriver(FIND_DUEL_LEVEL, { attempt: 4 });
    d.tap('D1', 1500);
    d.act({ type: 'pause' }, 2000);
    d.act({ type: 'resume' }, 9000);
    d.tap('F1', 12000);
    d.tickTo(40000);
    expect(d.state.status).toBe('over');
    const replayed: FindState = replayFind(d.log);
    expect(replayed).toEqual(d.state);
    expect(d.replayMatches()).toBe(true);
    // The log carries the whole config, the plan with it.
    expect((d.log[0] as Extract<LevelEvent, { type: 'levelCreated' }>).config.botPlan).toEqual(
      d.state.config.botPlan,
    );
  });
});

describe('checks (RangeError)', () => {
  const clock = new ManualClock();
  const make =
    (spec: Parameters<typeof createFind>[0]['spec'], attempt = 1) =>
    () =>
      createFind({ id: 'x', spec, player: ME }, { clock, attempt });

  it('refuses a digit kind, a bad attempt, a target on a filled cell, a race without its bot', () => {
    expect(make({ ...FIND_LEVEL, kind: 'duel', targets: { endAtScore: 30 } })).toThrow(RangeError);
    expect(make(FIND_LEVEL, 0)).toThrow(RangeError);
    expect(make({ ...FIND_LEVEL, targets: { target: boardTarget(9, ['A3']) } })).toThrow(RangeError);
    expect(make({ ...FIND_LEVEL, targets: { target: boardTarget(8, ['D5']) } })).toThrow(RangeError);
    const { bot: _bot, ...noBot } = FIND_DUEL_LEVEL;
    expect(make(noBot)).toThrow(RangeError);
    expect(make({ ...SPOT_ERROR_LEVEL, board: { ...SPOT_ERROR_LEVEL.board, mine: undefined } })).toThrow(
      RangeError,
    );
    expect(make(FIND_LEVEL)).not.toThrow();
    expect(cellName(FIND_LEVEL.targets.target.cell!)).toBe('D5');
  });
});
