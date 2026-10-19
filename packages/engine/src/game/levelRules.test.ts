import { GAME_TYPES } from '../gameType';
import { LEVEL_RULES } from '../levels/progress';
import { type AppLevel, levelGameConfig } from '../levels/spec';
import { parseCellName } from '../sudoku/board';
import { missedPoints, moveScore } from '../sudoku/scoring';
import { answer, GameDriver, wrongDigit } from '../testing/game';
import {
  CHAIN_LEVEL,
  DUEL_LEVEL,
  FILL_BOX_LEVEL,
  levelDriver,
  ME,
  PIP,
  POINT_HUNTER_LEVEL,
} from '../testing/levels';
import { ManualClock } from '../util/clock';
import { seedFromString } from '../util/random';
import { ManualScheduler } from '../util/scheduler';
import { type HostUpdate, LocalGameHost } from './host';
import { defaultRules, GAME_MODES } from './rules';
import type { GameEvent } from './types';
import { replay } from './view';

/*
 * The rules of a level of staged practice in the game engine (1.0.2, dev-plan §2א, §3.1): a time limit, a
 * target, time penalties, locks with no timer, a chain [D64], the level's view and result, and the phone's own
 * freeze [D65]. And first of all: every other game plays exactly as it did in 1.0.1.
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const B2 = parseCellName('B2');
const C1 = parseCellName('C1');
const D4 = parseCellName('D4');
const D5 = parseCellName('D5');
const F8 = parseCellName('F8');

const types = (events: readonly GameEvent[]) => events.map((e) => e.type);
const hash = (x: unknown) => seedFromString(JSON.stringify(x)).toString(16);

describe('every other game is exactly as in 1.0.1', () => {
  // The keys of defaultRules before 1.0.2: no level key may join them (they come only with a level's rules).
  const KEYS_1_0_1 = [
    'turnModel',
    'turnPickMs',
    'thinkTimeMs',
    'timeoutPenalty',
    'relockCooldownMs',
    'relockCooldownAfter',
    'afterMistake',
    'wrongDigitDisabledFor',
    'scoreY',
    'negativeScore',
    'tieBreak',
    'surrenderRanking',
    'interferences',
    'interferenceKinds',
    'interferenceMs',
    'interferenceCostBase',
    'interferenceNeedsScore',
    'interferenceImmunityMs',
    'pauseLockWhileInterfered',
    'reactionCooldownMs',
    'reactions',
    'graceMs',
    'freezeUpToPlayers',
    'softGraceMs',
    'offlineMovesMax',
    'offlineMovesWindowMs',
    'interfereSoftOffline',
    'rating',
  ];
  const RANKED_FAST_1_0_1 =
    '{"turnModel":"simultaneous","turnPickMs":8000,"thinkTimeMs":8000,"timeoutPenalty":0,"relockCooldownMs":1000,' +
    '"relockCooldownAfter":["cancel","timeout","switch","mistake","disconnect"],"afterMistake":"release",' +
    '"wrongDigitDisabledFor":"everyone","scoreY":"sorted","negativeScore":true,"tieBreak":"fewerMistakes",' +
    '"surrenderRanking":"exitOrder","interferences":true,' +
    '"interferenceKinds":["fireworks","cats","warp","scramble","ink","keypad"],"interferenceMs":5000,' +
    '"interferenceCostBase":2,"interferenceNeedsScore":true,"interferenceImmunityMs":1000,' +
    '"pauseLockWhileInterfered":true,"reactionCooldownMs":2000,"reactions":["😂","😱","😎","🤦","🔥","👀"],' +
    '"graceMs":15000,"freezeUpToPlayers":2,"softGraceMs":10000,"offlineMovesMax":8,"offlineMovesWindowMs":5000,' +
    '"interfereSoftOffline":false,"rating":{"k":32,"provisionalGames":10,"provisionalFactor":2,' +
    '"abandonWinScore":1,"option":"B","initialRating":1200,"abandonPenalty":0,"leaverGuard":true,' +
    '"stayerGuard":true,"abandonJudgedAt":"disconnect"}}';

  it.each(GAME_MODES.flatMap((m) => GAME_TYPES.map((t) => [m, t] as const)))(
    'defaultRules(%s, %s) has the keys of 1.0.1, no more',
    (mode, gameType) => {
      expect(Object.keys(defaultRules(mode, gameType))).toEqual(KEYS_1_0_1);
    },
  );

  it('defaultRules(ranked, fast) is the same JSON, byte for byte', () => {
    expect(JSON.stringify(defaultRules('ranked', 'fast'))).toBe(RANKED_FAST_1_0_1);
  });

  /*
   * Scripted games through every path of their kind (moves, mistakes, a timeout, an interference, reactions, a
   * soft and a hard disconnect, a move made offline, a freeze, a surrender). The hashes of their logs, final
   * states and every view on the way were taken from the engine of 1.0.1 (commit 3529c8b): the same bytes.
   */
  function ranked() {
    const g = GameDriver.of({ players: 2 });
    const views: unknown[] = [];
    const step = (f: () => unknown) => {
      f();
      views.push(g.view('p1'), g.view('p2'));
    };
    step(() => g.solve('p1', 'A1', 0));
    step(() => g.miss('p2', 'B1', 500));
    step(() => g.select('p1', 'A2', 1000));
    step(() => g.advance(8000));
    step(() => g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 9500));
    step(() => g.playerAct('p2', { type: 'react', emoji: '😂' }, 9600));
    step(() => g.tickTo(15000));
    step(() => g.disconnect('p2', { soft: true, at: 16000 }));
    step(() => g.reconnect('p2', 18000));
    step(() => g.offlineMove('p2', 'A2', { at: 18100 }));
    step(() => g.disconnect('p1', { at: 20000 }));
    step(() => g.reconnect('p1', 25000));
    step(() => g.solve('p2', 'A5', 26000));
    step(() => g.playerAct('p1', { type: 'surrender' }, 30000));
    return { g, views };
  }
  function solo() {
    const g = GameDriver.of({ players: 1 });
    const views: unknown[] = [];
    const step = (f: () => unknown) => {
      f();
      views.push(g.view('p1'));
    };
    step(() => g.solve('p1', 'A1', 0));
    step(() => g.miss('p1', 'B1', 1500));
    step(() => g.select('p1', 'A2', 3000));
    step(() => g.advance(9000));
    step(() => g.solve('p1', 'B1', 13000));
    step(() => g.playerAct('p1', { type: 'surrender' }, 20000));
    return { g, views };
  }
  function bot() {
    const g = GameDriver.of({
      mode: 'bot',
      players: [
        { id: 'me', name: 'Me' },
        { id: 'bot-1', name: 'Pip', isBot: true },
      ],
    });
    const views: unknown[] = [];
    const step = (f: () => unknown) => {
      f();
      views.push(g.view('me'));
    };
    step(() => g.solve('me', 'A1', 0));
    step(() => g.select('bot-1', 'A2', 400));
    step(() => g.miss('me', 'B1', 900));
    step(() => g.playerAct('bot-1', { type: 'react', emoji: '😂' }, 1500));
    step(() => g.advance(9000));
    step(() => g.solve('bot-1', 'A5', 11000));
    step(() => g.playerAct('me', { type: 'surrender' }, 14000));
    return { g, views };
  }

  it.each([
    ['ranked, 2 players', ranked, 24, 'bb597201', '9f5534c9', 'a503a215'],
    ['solo practice', solo, 13, '95c508ce', '4de98aae', '6233394d'],
    ['practice against a bot', bot, 14, 'a98b8442', '102cae50', '258c5abe'],
  ] as const)('%s: the log, the state and every view hash as in 1.0.1', (_, play, n, log, state, views) => {
    const { g, views: seen } = play();
    expect([g.log.length, hash(g.log), hash(g.state), hash(seen)]).toEqual([n, log, state, views]);
    expect(g.replayMatches()).toBe(true);
  });

  it('a ranked game has no time penalty, no time limit, and no level in its result or view', () => {
    const { g, views } = ranked();
    expect(types(g.log)).not.toContain('timePenalty');
    expect(g.state).not.toHaveProperty('timeUpAt');
    expect(g.state).not.toHaveProperty('pausedBy');
    expect(g.state.players[0]).not.toHaveProperty('timePenaltyMs');
    expect(g.state.config).not.toHaveProperty('level');
    expect(g.state.result).not.toHaveProperty('level');
    for (const view of views) expect(view).not.toHaveProperty('level');
  });
});

describe('timeLimitMs: the level ends when its time is up', () => {
  it('runs until 29,999, ends at 30,000 (timeUp), and its deadline is the next timer', () => {
    const g = GameDriver.of({ players: 1, rules: { timeLimitMs: 30000 } });
    expect(g.state.timeUpAt).toBe(30000);
    expect(g.deadline).toBe(30000);
    expect(g.tickTo(29999)).toEqual([]);
    expect(g.state.status).toBe('running');
    const [e] = g.tickTo(30000);
    expect(e).toMatchObject({ type: 'gameOver', reason: 'timeUp', durationMs: 30000, t: 30000 });
    expect(g.deadline).toBeNull();
    expect(g.replayMatches()).toBe(true);
  });

  it('a digit at the deadline itself is too late: gameOver first, the digit refused', () => {
    const g = GameDriver.of({ players: 1, rules: { timeLimitMs: 30000 } });
    g.select('p1', 'A1', 25000);
    expect(g.reject({ type: 'place', playerId: 'p1', cell: A1, digit: answer('A1') }, 30000)).toBe(
      'gameOver',
    );
    expect(types(g.log).slice(-1)).toEqual(['gameOver']);
    expect(g.state.grid[A1]).toBe(0);
  });

  it('a lock that runs out at the same instant: only gameOver (the time limit comes first)', () => {
    const g = GameDriver.of({ players: 1, rules: { timeLimitMs: 30000 } });
    g.select('p1', 'A1', 22000); // fast: runs out at 30,000 too
    expect(g.deadline).toBe(30000);
    expect(types(g.tickTo(30000))).toEqual(['gameOver']);
  });
});

describe('endAtScore 30: the first to the target wins (duel)', () => {
  // A1 8, A2 6.5, B4 8, G8 7 → 29.5; then A5 takes it past 30.
  const upTo29_5 = (g: GameDriver, id: string) => {
    g.solve(id, 'A1', 1000);
    g.solve(id, 'A2', 2000);
    g.solve(id, 'B4', 3000);
    g.solve(id, 'G8', 4000);
  };

  it('29.5 does not end it; the move that reaches 30 ends it targetReached, the mover first', () => {
    const g = levelDriver(DUEL_LEVEL);
    upTo29_5(g, 'me');
    expect(g.score('me')).toBe(29.5);
    expect(g.state.status).toBe('running');
    const events = g.solve('me', 'A5', 5000);
    expect(types(events)).toEqual(['cellLocked', 'placedCorrect', 'gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'targetReached' });
    expect(g.state.result!.ranking[0]).toMatchObject({ playerId: 'me', place: 1 });
    expect(g.score('me')).toBeGreaterThanOrEqual(30);
    expect(g.replayMatches()).toBe(true);
  });

  it('the same when the bot gets there first: the bot ranks first', () => {
    const g = levelDriver(DUEL_LEVEL);
    upTo29_5(g, PIP.id);
    g.solve(PIP.id, 'A5', 5000);
    expect(g.state.result).toMatchObject({ reason: 'targetReached' });
    expect(g.state.result!.ranking[0]).toMatchObject({ playerId: PIP.id, place: 1 });
    // My lead is negative: the bot won, no stars (levelOutcome reads it as botWon).
    expect(g.state.result!.level).toMatchObject({ stars: 0, metric: -g.score(PIP.id) });
  });
});

describe('editableCells: only the box can be chosen (fillBox)', () => {
  it('refuses any other cell, given or empty, with no event', () => {
    const g = levelDriver(FILL_BOX_LEVEL);
    const n = g.log.length;
    expect(g.reject({ type: 'select', playerId: 'me', cell: A1 })).toBe('notEditable');
    expect(g.reject({ type: 'select', playerId: 'me', cell: parseCellName('D6') })).toBe('notEditable'); // a given
    expect(g.log).toHaveLength(n);
  });

  it('the last cell of the box ends it targetReached', () => {
    const g = levelDriver(FILL_BOX_LEVEL);
    for (const [k, cell] of ['D4', 'D5', 'E4', 'E5'].entries()) g.solve('me', cell, 1000 * (k + 1));
    expect(g.state.status).toBe('running');
    expect(types(g.solve('me', 'F4', 6000)).slice(-1)).toEqual(['gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'targetReached', durationMs: 6000 });
  });

  it.each([
    ['a given', [parseCellName('D6')]],
    ['a cell off the board', [81]],
    ['a cell twice', [D4, D4]],
    ['no cell', []],
  ])('refuses a level with %s (RangeError)', (_, cells) => {
    expect(() => GameDriver.of({ players: 1, rules: { editableCells: cells } })).toThrow(RangeError);
  });
});

describe('mistakeTimeMs 5000: a wrong digit costs time', () => {
  const box30 = (): GameDriver => levelDriver({ ...FILL_BOX_LEVEL, timeLimitMs: 30000 });

  it('placedWrong, then timePenalty; the end comes 5 s closer; the lock stays, the cell free to retry', () => {
    const g = box30();
    g.select('me', 'D4', 1000);
    const events = g.place('me', 'D4', wrongDigit('D4'));
    expect(types(events)).toEqual(['placedWrong', 'timePenalty']);
    expect(events[1]).toMatchObject({ playerId: 'me', cell: D4, reason: 'mistake', ms: 5000, totalMs: 5000 });
    expect(g.deadline).toBe(25000);
    expect(g.player('me').timePenaltyMs).toBe(5000);
    // keepLock, no wait to lock again: the right digit goes in at once.
    expect(g.lock('me')?.cell).toBe(D4);
    expect(types(g.place('me', 'D4', answer('D4')))).toEqual(['placedCorrect']);
    g.select('me', 'D5', 2000);
    expect(g.place('me', 'D5', wrongDigit('D5'))[1]).toMatchObject({ totalMs: 10000 });
    expect(g.deadline).toBe(20000);
    expect(g.replayMatches()).toBe(true);
  });

  it('a penalty that reaches the end ends the level timeUp in the same move', () => {
    const g = box30();
    g.select('me', 'D4', 1000);
    g.place('me', 'D4', wrongDigit('D4')); // the end: 25,000
    g.select('me', 'D5', 21000);
    const events = g.place('me', 'D5', wrongDigit('D5')); // 20,000 < 21,000
    expect(types(events)).toEqual(['placedWrong', 'timePenalty', 'gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'timeUp', durationMs: 21000 });
    expect(g.state.result!.level).toMatchObject({ stars: 0, elapsedMs: 30000, penaltyMs: 10000 });
    expect(g.replayMatches()).toBe(true);
  });

  it('is for one player, and must be positive', () => {
    expect(() => GameDriver.of({ players: 2, rules: { mistakeTimeMs: 5000 } })).toThrow(RangeError);
    expect(() => GameDriver.of({ players: 1, rules: { mistakeTimeMs: 0 } })).toThrow(RangeError);
  });
});

describe('chainCells: only the next cell of the chain [D64]', () => {
  // CHAIN_LEVEL: A1 → B2 → C1, 5 s for a mistake, 24 s.
  const penalty = (): GameDriver =>
    new GameDriver(
      levelGameConfig(CHAIN_LEVEL, {
        id: 'g',
        player: ME,
        attempt: 1,
        rules: { ...LEVEL_RULES, chainNotYet: 'penalty' },
      }),
    );

  it('a wrong digit, in the chain or off it: a mistake and its time; the same cell again at once', () => {
    const g = levelDriver(CHAIN_LEVEL);
    expect(g.state.config.rules.chainNotYet).toBe('accept');
    g.select('me', 'A1', 1000);
    expect(types(g.place('me', 'A1', wrongDigit('A1')))).toEqual(['placedWrong', 'timePenalty']);
    expect(g.lock('me')?.cell).toBe(A1);
    expect(types(g.place('me', 'A1', answer('A1')))).toEqual(['placedCorrect']);
    g.select('me', 'A2', 2000);
    const off = g.place('me', 'A2', wrongDigit('A2'));
    expect(types(off)).toEqual(['placedWrong', 'timePenalty']);
    expect(off[1]).toMatchObject({ reason: 'mistake', totalMs: 10000 });
  });

  it("'penalty' (the proposal, a switch): a right digit in any cell but the next costs 5 s and goes nowhere", () => {
    const g = penalty();
    expect(g.state.config.rules.chainNotYet).toBe('penalty');
    g.select('me', 'B2', 1000); // the chain's second cell, A1 is next
    const events = g.place('me', 'B2', answer('B2'));
    expect(types(events)).toEqual(['timePenalty']);
    expect(events[0]).toMatchObject({ playerId: 'me', cell: B2, reason: 'notYet', ms: 5000, totalMs: 5000 });
    expect(g.state.grid[B2]).toBe(0);
    expect(g.state.wrong[B2]).toEqual([]);
    expect(g.player('me').mistakes).toBe(0);
    expect(g.lock('me')?.cell).toBe(B2);
    expect(g.view('me').keypad.disabled).not.toContain(answer('B2'));
    // Off the chain too.
    g.select('me', 'A2', 2000);
    expect(types(g.place('me', 'A2', answer('A2')))).toEqual(['timePenalty']);
    // The next cell, then the rest in order: the last one ends it.
    expect(types(g.solve('me', 'A1', 3000))).toEqual(['cellReleased', 'cellLocked', 'placedCorrect']);
    g.solve('me', 'B2', 4000);
    expect(types(g.solve('me', 'C1', 5000)).slice(-2)).toEqual(['placedCorrect', 'gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'targetReached' });
    // 5 s played + 10 s of penalties: ★★ (up to 16 s).
    expect(g.state.result!.level).toEqual({ stars: 2, metric: 15000, elapsedMs: 15000, penaltyMs: 10000 });
    expect(g.replayMatches()).toBe(true);
  });

  it("'accept' (the default, the original §14): a right digit anywhere scores; only chain cells advance the chain", () => {
    const g = levelDriver(CHAIN_LEVEL);
    const points = moveScore(g.state.grid, A2, answer('A2')).points;
    const [, placed] = g.solve('me', 'A2', 1000); // off the chain
    expect(placed).toMatchObject({ type: 'placedCorrect', cell: A2, points });
    expect(g.view('me').level!.progress).toEqual({ kind: 'chain', done: 0, total: 3 });
    g.solve('me', 'C1', 2000); // a later chain cell: it counts
    expect(g.view('me').level!.progress).toEqual({ kind: 'chain', done: 1, total: 3 });
    g.solve('me', 'A1', 3000);
    expect(types(g.solve('me', 'B2', 4000)).slice(-1)).toEqual(['gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'targetReached' });
  });

  it('is for one player', () => {
    expect(() => GameDriver.of({ players: 2, rules: { chainCells: [A1, B2], mistakeTimeMs: 5000 } })).toThrow(
      RangeError,
    );
    expect(() =>
      GameDriver.of({ players: 1, rules: { chainCells: [A1, C1], chainNotYet: 'penalty' } }),
    ).toThrow(/mistakeTimeMs/);
    // 'accept' (also when the rules leave it out) charges nothing for a digit it cannot know yet.
    expect(() => GameDriver.of({ players: 1, rules: { chainCells: [A1, C1] } })).not.toThrow();
  });
});

describe('maxMoves 3 (pointHunter)', () => {
  it('two right and one wrong: the third move ends it; the score is the points less the mistake', () => {
    const g = levelDriver(POINT_HUNTER_LEVEL);
    g.solve('me', 'A1', 1000); // 8
    g.solve('me', 'B2', 2000); // 7.5
    g.select('me', 'F8', 3000);
    const penalty = missedPoints(g.state.grid, F8, answer('F8')).points;
    const events = g.place('me', 'F8', wrongDigit('F8'));
    expect(types(events)).toEqual(['placedWrong', 'gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'targetReached' });
    expect(g.score('me')).toBe(15.5 - penalty);
    expect(g.state.result!.level).toMatchObject({ metric: 15.5 - penalty, stars: 0 });
  });

  it('time up after one move: timeUp, with the points so far', () => {
    const g = levelDriver(POINT_HUNTER_LEVEL);
    g.solve('me', 'A1', 1000);
    expect(types(g.tickTo(30000))).toEqual(['gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'timeUp' });
    expect(g.state.result!.ranking[0]).toMatchObject({ playerId: 'me', score: 8 });
    expect(g.state.result!.level).toMatchObject({ metric: 8 });
  });

  it('must be a positive whole number', () => {
    expect(() => GameDriver.of({ players: 1, rules: { maxMoves: 1.5 } })).toThrow(RangeError);
    expect(() => GameDriver.of({ players: 1, rules: { maxMoves: 0 } })).toThrow(RangeError);
  });
});

describe('lockTimeout false: a lock with no timer', () => {
  it('has no expiry, no timer, and is still mine a minute later; its think time is the time held', () => {
    const g = GameDriver.of({ players: 1, rules: { lockTimeout: false } });
    const [e] = g.select('p1', 'A1', 1000);
    expect(e).toMatchObject({ type: 'cellLocked', expiresAt: null });
    expect(g.deadline).toBeNull();
    expect(g.advance(60000)).toEqual([]);
    expect(g.lock('p1')?.cell).toBe(A1);
    expect(g.place('p1', 'A1', answer('A1'))[0]).toMatchObject({ type: 'placedCorrect', thinkMs: 60000 });
  });
});

describe('createGame checks a level’s rules (RangeError)', () => {
  it.each([
    ['lockTimeout false with interferences on', { players: 2, rules: { lockTimeout: false as const } }],
    ['mistakeTimeMs with 2 players', { players: 2, rules: { mistakeTimeMs: 5000 } }],
    ['chainCells with 2 players', { players: 2, rules: { chainCells: [A1], mistakeTimeMs: 5000 } }],
    ['timeLimitMs 0', { players: 1, rules: { timeLimitMs: 0 } }],
    ['timeLimitMs below 0', { players: 1, rules: { timeLimitMs: -1 } }],
    ['endAtScore 0', { players: 1, rules: { endAtScore: 0 } }],
    ['maxMistakes (reserved)', { players: 1, rules: { maxMistakes: 1 } }],
  ] as const)('%s', (_, options) => {
    expect(() => GameDriver.of(options)).toThrow(RangeError);
  });
});

describe('the level in the view (GameView.level)', () => {
  it('fillBox: the clock, the stars so far, the progress, and the end as it ended', () => {
    const g = levelDriver(FILL_BOX_LEVEL);
    expect(g.view('me').level).toEqual({
      id: 'L002',
      rev: 1,
      kind: 'fillBox',
      boss: false,
      attempt: 1,
      elapsedMs: 0,
      limitMs: 20000,
      endsAt: 20000,
      remainingMs: 20000,
      penaltyMs: 0,
      marks: FILL_BOX_LEVEL.stars,
      stars: 3,
      final: false,
      editableCells: FILL_BOX_LEVEL.targets.cells,
      progress: { kind: 'cells', done: 0, total: 5 },
      lockTimer: false,
    });
    g.select('me', 'D4', 4000);
    g.place('me', 'D4', wrongDigit('D4')); // +5 s
    expect(g.view('me').level).toMatchObject({
      elapsedMs: 9000,
      endsAt: 15000,
      remainingMs: 11000,
      stars: 3,
    });
    g.now = 6000;
    expect(g.view('me').level).toMatchObject({ elapsedMs: 11000, penaltyMs: 5000, stars: 2 });
    g.place('me', 'D4', answer('D4'));
    expect(g.view('me').level!.progress).toEqual({ kind: 'cells', done: 1, total: 5 });
    for (const cell of ['D5', 'E4', 'E5', 'F4']) g.solve('me', cell, 8000);
    expect(g.state.result!.level).toEqual({ stars: 2, metric: 13000, elapsedMs: 13000, penaltyMs: 5000 });
    g.now = 20000; // the clock stopped at the end
    expect(g.view('me').level).toMatchObject({
      elapsedMs: 13000,
      endsAt: null,
      remainingMs: 7000,
      stars: 2,
      final: true,
      progress: { kind: 'cells', done: 5, total: 5 },
    });
  });

  it('duel: the scores and my lead, and the lock timer on', () => {
    const g = levelDriver(DUEL_LEVEL);
    g.solve('me', 'A1', 1000); // 8
    g.solve(PIP.id, 'A2', 2000); // 6.5
    expect(g.view('me').level).toMatchObject({
      progress: { kind: 'score', mine: 8, opponent: 6.5, target: 30 },
      stars: 1,
      lockTimer: true,
      editableCells: null,
    });
  });

  it('selectedWorth: what the right digit in my cell is worth, only with the hint and a lock', () => {
    const g = levelDriver(POINT_HUNTER_LEVEL);
    expect(g.view('me').level).not.toHaveProperty('selectedWorth');
    g.select('me', 'A1', 1000);
    expect(g.view('me').level!.selectedWorth).toBe(moveScore(g.state.grid, A1, answer('A1')).points);
    expect(g.view('me').level!.progress).toEqual({ kind: 'moves', used: 0, max: 3, score: 0 });
    const noHint: AppLevel = { ...POINT_HUNTER_LEVEL, worthHint: false };
    const h = levelDriver(noHint);
    h.select('me', 'A1', 1000);
    expect(h.view('me').level).not.toHaveProperty('selectedWorth');
  });

  it('a chain says how far, never which cell is next', () => {
    const g = levelDriver(CHAIN_LEVEL);
    const view = g.view('me');
    expect(view.level!.progress).toEqual({ kind: 'chain', done: 0, total: 3 });
    expect(view.level!.editableCells).toBeNull();
    expect(view.level).not.toHaveProperty('chainCells');
    expect(view.rules).not.toHaveProperty('chainCells');
  });
});

describe('the phone’s own freeze [D65]', () => {
  function play(spec: AppLevel) {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({
      config: levelGameConfig(spec, { id: 'g', player: ME, attempt: 1 }),
      playerId: 'me',
      clock,
      scheduler,
    });
    const updates: HostUpdate[] = [];
    host.subscribe((u) => updates.push(u));
    const said = () =>
      updates.splice(0).map((u) => (u.kind === 'events' ? types(u.events) : `rejected: ${u.reason}`));
    return { clock, scheduler, host, said };
  }

  it('a 30 s fillBox frozen at 12.3 s for a minute: no timeUp meanwhile, 17.7 s left after it', () => {
    const { scheduler, host, said } = play({ ...FILL_BOX_LEVEL, timeLimitMs: 30000 });
    scheduler.advance(1000);
    host.select(D4);
    scheduler.advance(11300);
    host.pause();
    expect(said()).toEqual([['cellLocked'], ['gamePaused']]);
    expect(host.getView().level).toMatchObject({ elapsedMs: 12300, remainingMs: 17700, endsAt: null });
    scheduler.advance(60000);
    expect(said()).toEqual([]);
    expect(host.getView()).toMatchObject({ status: 'paused', level: { remainingMs: 17700 } });
    // Every move is refused meanwhile.
    host.select(D5);
    host.place(D4, answer('D4'));
    host.release();
    host.react('😂');
    expect(said()).toEqual(['rejected: paused', 'rejected: paused', 'rejected: paused', 'rejected: paused']);
    // Again: nothing.
    host.pause();
    expect(said()).toEqual([]);
    host.resume();
    expect(said()).toEqual([['gameResumed']]);
    expect(host.events.at(-1)).toMatchObject({ type: 'gameResumed', reason: 'foreground', pausedMs: 60000 });
    host.resume();
    expect(said()).toEqual([]);
    expect(host.getView().level).toMatchObject({ elapsedMs: 12300, remainingMs: 17700, endsAt: 90000 });
    // The lock is still mine, and its think time leaves the freeze out.
    scheduler.advance(700);
    host.place(D4, answer('D4'));
    expect(host.events.at(-1)).toMatchObject({ type: 'placedCorrect', thinkMs: 12000 });
    scheduler.advance(16999);
    expect(host.state.status).toBe('running');
    scheduler.advance(1);
    expect(host.state.result).toMatchObject({ reason: 'timeUp', level: { elapsedMs: 30000 } });
    expect(host.events.at(-1)!.t).toBe(90000);
    expect(replay(host.events).at(-1)).toEqual(host.state);
  });

  it('a lock timer stands still in the freeze and goes on with the same time left', () => {
    const { scheduler, host } = play(DUEL_LEVEL);
    scheduler.advance(2000);
    host.select(A1); // fast: 8 s, runs out at 10,000
    scheduler.advance(3000);
    host.pause();
    expect(host.getView().players[0]!.lock).toMatchObject({ expiresAt: null, remainingMs: 5000 });
    scheduler.advance(60000);
    expect(host.getView().players[0]!.lock).toMatchObject({ cell: A1, remainingMs: 5000 });
    host.resume();
    expect(host.getView().players[0]!.lock).toMatchObject({ expiresAt: 70000, remainingMs: 5000 });
    expect(host.getView().level).toMatchObject({ elapsedMs: 5000, endsAt: 90000 });
    scheduler.advance(5000);
    expect(host.events.at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout', t: 70000 });
  });

  it('leaving is still possible while frozen: the level clock stops at the freeze', () => {
    const { scheduler, host } = play(FILL_BOX_LEVEL);
    scheduler.advance(4000);
    host.pause();
    scheduler.advance(30000);
    host.surrender();
    expect(host.state.result).toMatchObject({
      reason: 'practiceEnded',
      level: { stars: 0, elapsedMs: 4000 },
    });
    expect(host.getView().level).toMatchObject({ elapsedMs: 4000, final: true });
  });

  it('with no time limit (rules without timeLimitMs) the clock leaves the freeze out too (played.ts)', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const config = levelGameConfig(FILL_BOX_LEVEL, { id: 'g', player: ME, attempt: 1 });
    const { timeLimitMs: _limit, ...rules } = config.rules;
    const host = new LocalGameHost({ config: { ...config, rules }, playerId: 'me', clock, scheduler });
    scheduler.advance(4000);
    host.pause();
    scheduler.advance(60000);
    host.resume();
    scheduler.advance(1000);
    expect(host.getView().level).toMatchObject({ elapsedMs: 5000, limitMs: null });
    host.surrender();
    expect(host.state.result).toMatchObject({ durationMs: 5000, level: { elapsedMs: 5000 } });
  });

  it('nothing to resume when not frozen, nothing to freeze after the end', () => {
    const { scheduler, host, said } = play(FILL_BOX_LEVEL);
    host.resume(); // not frozen
    scheduler.advance(20000); // time up
    said();
    host.pause();
    host.resume();
    expect(said()).toEqual([]);
    expect(host.state.status).toBe('over');
  });
});
