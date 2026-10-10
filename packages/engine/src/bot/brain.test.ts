import { applyAction } from '../game/engine';
import type { GameState, PlayerState } from '../game/types';
import { publicState } from '../game/view';
import { GAME_TYPES } from '../gameType';
import { type CellIndex, DIGITS, parseCellName } from '../sudoku/board';
import { type ConfigOptions, GameDriver, PUZZLE } from '../testing/game';
import { createRng, type Rng } from '../util/random';
import {
  adaptationFactor,
  canInterfere,
  canReact,
  cellDifficulties,
  cellDifficulty,
  cellOptions,
  chooseCell,
  chooseDigit,
  decideInterference,
  decideReaction,
  eligibleCells,
  isEligibleCell,
  leadOver,
  plausibleWrongDigits,
  splitThinkTime,
  thinkTime,
} from './brain';
import {
  BOT_CONFIG,
  BOT_LEVELS,
  BOT_PACE,
  type BotLevel,
  botLevel,
  type BotLevelId,
  botPlayer,
} from './levels';

/* The bot's decisions (spec §9), one pure function at a time. */

const ME = 'me';
const bot = (level: BotLevelId = 3) => botPlayer(level).id;
const cell = (name: string): CellIndex => parseCellName(name);

function game(level: BotLevelId = 3, o: ConfigOptions = {}): GameDriver {
  return GameDriver.of({ mode: 'bot', players: [{ id: ME, name: 'Me' }, botPlayer(level)], ...o });
}

/** The same state with some player fields changed (scores, hits, …). */
function withPlayers(s: GameState, change: Record<string, Partial<PlayerState>>): GameState {
  return { ...s, players: s.players.map((p) => (change[p.id] ? { ...p, ...change[p.id] } : p)) };
}

/** An RNG that returns these values, round and round. */
function fixed(...values: number[]): Rng {
  let k = 0;
  return { next: () => values[k++ % values.length]! };
}

/** A level row that always takes its chances. */
const sure = (level: BotLevelId): BotLevel => {
  const l = botLevel(level);
  return {
    ...l,
    interference: { ...l.interference, chance: 1 },
    reactions: Object.fromEntries(Object.entries(l.reactions).map(([k, r]) => [k, { ...r, chance: 1 }])),
  };
};

/** Mean and the 3σ half-width of a binomial share. */
const within3Sigma = (hits: number, n: number, p: number) => {
  const sd = Math.sqrt((p * (1 - p)) / n);
  expect(Math.abs(hits / n - p)).toBeLessThanOrEqual(3 * sd);
};

/** The test puzzle with only A1 and E5 open: each is the last gap of its row, column and box. */
const NEAR = {
  id: 'near',
  givens: [...PUZZLE.solution].map((d, i) => (i === cell('A1') || i === cell('E5') ? '0' : d)).join(''),
  solution: PUZZLE.solution,
};

// On the test puzzle at the start:
//   A1 naked single (8) · B7 hidden single, options 7 8 · B2 hidden single, options 2 3 6 8
//   A2 needs more, options 1 6 8 (6) · A5 needs more, options 5 7 (7) · D1 options 3 4, D2 a naked single (3)

describe('cellDifficulty (spec §9: options and technique)', () => {
  const s = game().state;

  it('a naked single is the easiest: one option, factor 1', () => {
    expect(cellDifficulty(s, cell('A1'))).toEqual({ options: 1, technique: 'nakedSingle', factor: 1 });
  });

  it('a hidden single costs more, and more with more options', () => {
    const b7 = cellDifficulty(s, cell('B7'));
    const b2 = cellDifficulty(s, cell('B2'));
    expect(b7).toMatchObject({ options: 2, technique: 'hiddenSingle' });
    expect(b2).toMatchObject({ options: 4, technique: 'hiddenSingle' });
    expect(b7.factor).toBeCloseTo(1.25 * 1.05);
    expect(b2.factor).toBeCloseTo(1.25 * 1.15);
  });

  it('a cell no single solves yet is the hardest', () => {
    expect(cellDifficulty(s, cell('A5'))).toMatchObject({ options: 2, technique: 'harder' });
    expect(cellDifficulty(s, cell('A2'))).toMatchObject({ options: 3, technique: 'harder' });
    expect(cellDifficulty(s, cell('A2')).factor).toBeCloseTo(1.6 * 1.1);
  });

  it('caps the factor', () => {
    const config = { ...BOT_CONFIG, difficulty: { ...BOT_CONFIG.difficulty, max: 1.5 } };
    expect(cellDifficulty(s, cell('A2'), config).factor).toBe(1.5);
  });

  it('reads the board as it is now: solved cells count', () => {
    const g = game();
    expect(cellDifficulty(g.state, cell('D1')).technique).not.toBe('nakedSingle');
    g.solve(ME, 'D2'); // a 3 next to D1 leaves it a single option
    expect(cellDifficulty(g.state, cell('D1'))).toMatchObject({ options: 1, technique: 'nakedSingle' });
  });

  it('strikes out the digits already tried in the cell [D12]', () => {
    const g = game();
    g.select(ME, 'A5');
    g.place(ME, 'A5', 5); // wrong: the answer is 7
    expect(cellOptions(g.state, cell('A5'))).toEqual([7]);
    expect(cellDifficulty(g.state, cell('A5'))).toMatchObject({ options: 1, technique: 'nakedSingle' });
  });

  it('cellDifficulties covers every cell (null for filled ones) and agrees with cellDifficulty', () => {
    const all = cellDifficulties(s);
    expect(all).toHaveLength(81);
    for (let c = 0; c < 81; c++) {
      if (s.grid[c] !== 0) expect(all[c]).toBeNull();
      else expect(all[c]).toEqual(cellDifficulty(s, c));
    }
    expect(() => cellDifficulty(s, cell('A3'))).toThrow(RangeError); // a given
    expect(cellOptions(s, cell('A3'))).toEqual([]);
  });
});

describe('chooseCell (spec §9: prefers easy cells, with noise) and eligibility (spec §6.2)', () => {
  it('never picks a cell someone else holds', () => {
    const g = game();
    g.select(ME, 'A1');
    expect(eligibleCells(g.state, bot(), 0)).not.toContain(cell('A1'));
    const rng = createRng(1);
    for (let k = 0; k < 300; k++) expect(chooseCell(g.state, bot(), 0, rng)).not.toBe(cell('A1'));
  });

  it('waits a second before taking back a cell it let go of [D2]', () => {
    const g = game();
    g.act({ type: 'select', playerId: bot(), cell: cell('A1') }, 0);
    g.act({ type: 'release', playerId: bot() }, 100);
    expect(isEligibleCell(g.state, bot(), cell('A1'), 1099)).toBe(false);
    expect(isEligibleCell(g.state, bot(), cell('A1'), 1100)).toBe(true);
    // The wait is the bot's own: it does not hold anyone else back.
    expect(isEligibleCell(g.state, ME, cell('A1'), 500)).toBe(true);
  });

  it('skips a cell with no digit left to try, and filled cells', () => {
    const s = game().state;
    const tried = {
      ...s,
      wrong: s.wrong.map((w, c) => (c === cell('A1') ? DIGITS.map((digit) => ({ digit, playerId: ME })) : w)),
    };
    expect(isEligibleCell(tried, bot(), cell('A1'), 0)).toBe(false);
    expect(isEligibleCell(s, bot(), cell('A3'), 0)).toBe(false);
    expect(eligibleCells(s, bot(), 0)).toHaveLength(46);
  });

  it('returns null when every free cell is taken or waiting', () => {
    const g = game(3, { puzzle: NEAR });
    g.select(ME, 'A1');
    g.act({ type: 'select', playerId: bot(), cell: cell('E5') }, 0);
    g.act({ type: 'release', playerId: bot() }, 0);
    expect(chooseCell(g.state, bot(), 500, createRng(1))).toBeNull();
    expect(chooseCell(g.state, bot(), 1000, createRng(1))).toBe(cell('E5'));
  });

  it('mostly picks the easiest cells, still sometimes others, and spreads over the easy ones', () => {
    const s = game().state;
    const diffs = cellDifficulties(s);
    const singles = diffs.filter((d) => d?.technique === 'nakedSingle').length;
    expect(singles).toBe(14); // of 46 open cells
    const rng = createRng(2);
    const picks = Array.from({ length: 3000 }, () => chooseCell(s, bot(), 0, rng)!);
    const naked = picks.filter((c) => diffs[c]!.technique === 'nakedSingle').length;
    expect(naked / picks.length).toBeGreaterThan(0.85);
    expect(naked).toBeLessThan(picks.length); // noise
    expect(new Set(picks.filter((c) => diffs[c]!.technique === 'nakedSingle')).size).toBe(14);
  });

  it('with no noise always picks one of the easiest', () => {
    const s = game().state;
    const config = { ...BOT_CONFIG, cellChoiceTemperature: 0 };
    const rng = createRng(3);
    for (let k = 0; k < 100; k++)
      expect(cellDifficulty(s, chooseCell(s, bot(), 0, rng, config)!).technique).toBe('nakedSingle');
  });

  it('is repeatable with the same seed', () => {
    const s = game().state;
    const run = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => chooseCell(s, bot(), 0, rng));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe('thinkTime (spec §9: base × pace × difficulty, with spread)', () => {
  it.each(BOT_LEVELS.flatMap((level) => GAME_TYPES.map((gameType) => ({ level, gameType }))))(
    'L$level.level on $gameType: within the range, centred on its middle',
    ({ level, gameType }) => {
      const rng = createRng(level.level * 31 + gameType.length);
      const factor = 1.4;
      const adapt = 1.2;
      const scale = BOT_PACE[gameType] * factor * adapt;
      const n = 600;
      const times = Array.from({ length: n }, () => thinkTime({ level, gameType, factor, adapt }, rng));
      for (const t of times) {
        expect(t).toBeGreaterThanOrEqual(Math.floor(level.thinkMs.min * scale));
        expect(t).toBeLessThanOrEqual(Math.ceil(level.thinkMs.max * scale));
        expect(Number.isInteger(t)).toBe(true);
      }
      const mean = times.reduce((a, b) => a + b, 0) / n;
      const mid = ((level.thinkMs.min + level.thinkMs.max) / 2) * scale;
      const sd = ((level.thinkMs.max - level.thinkMs.min) * scale) / Math.sqrt(12 * n);
      expect(Math.abs(mean - mid)).toBeLessThanOrEqual(3 * sd + 1);
    },
  );

  it('scales the same draw by the pace of the game type and by the difficulty', () => {
    const level = botLevel(2);
    const at = (gameType: (typeof GAME_TYPES)[number], factor: number) =>
      thinkTime({ level, gameType, factor }, createRng(9));
    expect(at('fast', 1) / at('normal', 1)).toBeCloseTo(0.67, 3);
    expect(at('hard', 1) / at('normal', 1)).toBeCloseTo(1.5, 3);
    expect(at('normal', 1.6) / at('normal', 1)).toBeCloseTo(1.6, 3);
    expect(thinkTime({ level, gameType: 'normal', factor: 1 }, fixed(0))).toBe(6000);
    expect(thinkTime({ level, gameType: 'normal', factor: 1 }, fixed(0.5))).toBe(7500);
  });
});

describe('splitThinkTime (spec §9: hesitate, then the digit within 80% of the lock)', () => {
  it('splits the whole think time; the part after locking is a share of it', () => {
    const rng = createRng(4);
    for (let k = 0; k < 500; k++) {
      const total = 2000 + k * 7;
      const { hesitateMs, solveMs } = splitThinkTime(total, 12000, rng);
      expect(hesitateMs + solveMs).toBe(total);
      expect(solveMs).toBeGreaterThanOrEqual(Math.floor(total * 0.25));
      expect(solveMs).toBeLessThanOrEqual(Math.ceil(total * 0.5));
    }
  });

  it('never leaves less than 20% of the lock: a long move hesitates longer instead', () => {
    const rng = createRng(5);
    for (const lockMs of [8000, 12000, 18000]) {
      for (let k = 0; k < 200; k++) {
        const total = 30000 + k * 50;
        const { hesitateMs, solveMs } = splitThinkTime(total, lockMs, rng);
        expect(solveMs).toBeLessThanOrEqual(lockMs * 0.8);
        expect(hesitateMs + solveMs).toBe(total);
      }
    }
  });
});

describe('adaptationFactor (spec §9: levels 1–3 slow down when the human trails by more than 25)', () => {
  const s = game().state;
  it.each([1, 2, 3, 4, 5] as BotLevelId[])('level %i', (level) => {
    const at = (lead: number) =>
      adaptationFactor(
        withPlayers(s, { [ME]: { score: 10 }, [bot()]: { score: 10 + lead } }),
        bot(),
        botLevel(level),
      );
    expect(at(25)).toBe(1);
    expect(at(-30)).toBe(1);
    expect(at(25.5)).toBe(level <= 3 ? BOT_CONFIG.adaptation.slowdown : 1);
  });

  it('only counts opponents still in the game', () => {
    const out = withPlayers(s, { [ME]: { score: 0, status: 'surrendered' }, [bot()]: { score: 40 } });
    expect(leadOver(out, bot())).toBeNull();
    expect(adaptationFactor(out, bot(), botLevel(1))).toBe(1);
  });
});

describe('chooseDigit and plausibleWrongDigits (spec §9: a plausible mistake, never a random one)', () => {
  it('plays the right digit when it does not err', () => {
    const s = game().state;
    const rng = createRng(6);
    for (let k = 0; k < 200; k++)
      expect(chooseDigit(s, cell('A2'), 0, rng)).toEqual({ digit: 6, mistake: false });
  });

  it("errs with one of the cell's other candidates", () => {
    const s = game().state;
    expect(plausibleWrongDigits(s, cell('A2'))).toEqual([1, 8]);
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const c = chooseDigit(s, cell('A2'), 1, rng);
      expect(c.mistake).toBe(true);
      seen.add(c.digit);
    }
    expect([...seen].sort()).toEqual([1, 8]);
  });

  it('on a single option, errs with a digit that fits two of its three units (one peer overlooked)', () => {
    // A1 (8): row A misses 1 5 6 7 8, column 1 misses 2 3 4 5 7 8 9, box 1 misses 1 2 3 6 8 9.
    const s = game().state;
    expect(plausibleWrongDigits(s, cell('A1'))).toEqual([1, 2, 3, 5, 6, 7, 9]);
  });

  it('never repeats a digit already tried in the cell [D12]', () => {
    const g = game();
    g.select(ME, 'A2');
    g.place(ME, 'A2', 1);
    expect(plausibleWrongDigits(g.state, cell('A2'))).toEqual([8]);
    g.select(ME, 'A2', 2000);
    g.place(ME, 'A2', 8);
    // No candidate left but the answer: digits that fit two units (column 2 and box 1).
    expect(plausibleWrongDigits(g.state, cell('A2'))).toEqual([2, 3]);
  });

  it('plays the right digit when no wrong one is plausible (the last gap of its row, column and box)', () => {
    const s = game(3, { puzzle: NEAR }).state;
    expect(plausibleWrongDigits(s, cell('A1'))).toEqual([]);
    expect(chooseDigit(s, cell('A1'), 1, createRng(8))).toEqual({ digit: 8, mistake: false });
  });

  it('errs at the given rate', () => {
    const s = game().state;
    const rng = createRng(9);
    const n = 5000;
    let wrong = 0;
    for (let k = 0; k < n; k++) if (chooseDigit(s, cell('B2'), 0.2, rng).mistake) wrong++;
    within3Sigma(wrong, n, 0.2);
  });

  it('needs the solution', () => {
    const s = publicState(game().state);
    expect(() => chooseDigit(s, cell('A2'), 0, createRng(1))).toThrow(RangeError);
  });
});

describe('canInterfere (spec §7.2) [D10, D11]', () => {
  const at = 1000;
  const base = () => {
    const g = game(5);
    g.tickTo(at);
    return g.state;
  };
  const B = bot(5);
  const engineTakes = (s: GameState) =>
    applyAction(s, { type: 'interfere', playerId: B, targetId: ME, kind: 'cats' }, at).rejected === undefined;

  it.each([
    ['too few points for the first (2)', { [B]: { score: 1.5 } }, false],
    ['enough for the first', { [B]: { score: 2 } }, true],
    ['too few for the second (4)', { [B]: { score: 3.5, interferencesSent: 1 } }, false],
    ['enough for the second', { [B]: { score: 4, interferencesSent: 1 } }, true],
    [
      'target already hit',
      { [B]: { score: 9 }, [ME]: { hitBy: { fromId: B, kind: 'cats', endsAt: 3000 } } },
      false,
    ],
    ['target in its second of immunity', { [B]: { score: 9 }, [ME]: { immuneUntil: at + 1 } }, false],
    ['immunity just over', { [B]: { score: 9 }, [ME]: { immuneUntil: at } }, true],
    ['target surrendered', { [B]: { score: 9 }, [ME]: { status: 'surrendered' } }, false],
    ['target disconnected', { [B]: { score: 9 }, [ME]: { connected: false } }, false],
  ] as [string, Record<string, Partial<PlayerState>>, boolean][])('%s', (_name, change, ok) => {
    const s = withPlayers(base(), change);
    expect(canInterfere(s, B, ME, at)).toBe(ok);
    expect(engineTakes(s)).toBe(ok); // the same answer as the engine
  });

  it('not while the game is not running, with interferences off, or on itself', () => {
    const s = withPlayers(base(), { [B]: { score: 9 } });
    expect(canInterfere({ ...s, status: 'paused' }, B, ME, at)).toBe(false);
    expect(canInterfere({ ...s, status: 'over' }, B, ME, at)).toBe(false);
    const off = { ...s, config: { ...s.config, rules: { ...s.config.rules, interferences: false } } };
    expect(canInterfere(off, B, ME, at)).toBe(false);
    expect(canInterfere(s, B, B, at)).toBe(false);
    expect(canInterfere(s, B, 'nobody', at)).toBe(false);
  });
});

describe('decideInterference (spec §9 table) [D40]', () => {
  const at = 1000;
  const state = (
    level: BotLevelId,
    me: Partial<PlayerState>,
    botP: Partial<PlayerState>,
    o: ConfigOptions = {},
  ) => {
    const g = game(level, o);
    g.tickTo(at);
    return withPlayers(g.state, { [ME]: me, [bot(level)]: botP });
  };
  const decide = (level: BotLevelId, s: GameState, l: BotLevel = sure(level)) =>
    decideInterference(s, bot(level), l, at, createRng(1));

  it('level 1: at most once a game', () => {
    expect(decide(1, state(1, { score: 0 }, { score: 10 }))).toEqual({
      targetId: ME,
      kind: expect.any(String),
    });
    expect(decide(1, state(1, { score: 0 }, { score: 10, interferencesSent: 1 }))).toBeNull();
  });

  it('level 2: only when trailing by 15 or more', () => {
    expect(decide(2, state(2, { score: 16.5 }, { score: 2 }))).toBeNull();
    expect(decide(2, state(2, { score: 17 }, { score: 2 }))).not.toBeNull();
  });

  it('level 3: only when trailing by 10 or more', () => {
    expect(decide(3, state(3, { score: 11.5 }, { score: 2 }))).toBeNull();
    expect(decide(3, state(3, { score: 12 }, { score: 2 }))).not.toBeNull();
  });

  it('level 4: only when trailing', () => {
    expect(decide(4, state(4, { score: 5 }, { score: 5 }))).toBeNull();
    expect(decide(4, state(4, { score: 5.5 }, { score: 5 }))).not.toBeNull();
  });

  it('level 5: whatever the score', () => {
    expect(decide(5, state(5, { score: 0 }, { score: 30 }))).not.toBeNull();
  });

  it('never when the rules would refuse it (not enough points)', () => {
    expect(decide(5, state(5, { score: 0 }, { score: 1 }))).toBeNull();
    expect(decide(2, state(2, { score: 40 }, { score: 1 }))).toBeNull();
  });

  it("takes the level's chance", () => {
    const s = state(2, { score: 30 }, { score: 10 });
    const rng = createRng(11);
    const n = 4000;
    let yes = 0;
    for (let k = 0; k < n; k++) if (decideInterference(s, bot(2), botLevel(2), at, rng)) yes++;
    within3Sigma(yes, n, botLevel(2).interference.chance);
  });

  it('picks a kind the rules allow [D17]', () => {
    const s = state(5, {}, { score: 9 }, { rules: { interferenceKinds: ['warp'] } });
    for (let seed = 0; seed < 20; seed++)
      expect(decideInterference(s, bot(5), sure(5), at, createRng(seed))?.kind).toBe('warp');
  });

  it('aims at the leading opponent that can take one', () => {
    const g = GameDriver.of({
      mode: 'bot',
      players: [{ id: ME }, { id: 'p2' }, botPlayer(5)],
    });
    g.tickTo(at);
    const s = withPlayers(g.state, { [ME]: { score: 5 }, p2: { score: 8 }, [bot(5)]: { score: 9 } });
    expect(decideInterference(s, bot(5), sure(5), at, createRng(1))?.targetId).toBe('p2');
    const busy = withPlayers(s, { p2: { immuneUntil: at + 500 } });
    expect(decideInterference(busy, bot(5), sure(5), at, createRng(1))?.targetId).toBe(ME);
  });
});

describe('reactions (spec §8, §9) [D19]', () => {
  const s = game().state;

  it('follow the table: 😂 on a mistake, 😱 when hit, 😎 for Maestro, nothing where the table has none', () => {
    const rng = createRng(1);
    expect(decideReaction('opponentMistake', s, sure(3), rng)).toBe('😂');
    expect(decideReaction('hit', s, sure(3), rng)).toBe('😱');
    expect(decideReaction('hit', s, sure(4), rng)).toBe('😎');
    expect(decideReaction('tookLead', s, sure(4), rng)).toBe('😎');
    expect(decideReaction('hit', s, sure(2), rng)).toBeNull();
    expect(decideReaction('tookLead', s, sure(5), rng)).toBeNull();
  });

  it("take the level's chance", () => {
    const rng = createRng(13);
    const n = 4000;
    let yes = 0;
    for (let k = 0; k < n; k++) if (decideReaction('opponentMistake', s, botLevel(3), rng)) yes++;
    within3Sigma(yes, n, botLevel(3).reactions.opponentMistake!.chance);
  });

  it('never an emoji the rules do not have, nor after the game', () => {
    const rules = { ...s.config.rules, reactions: ['🔥'] };
    expect(
      decideReaction('opponentMistake', { ...s, config: { ...s.config, rules } }, sure(3), fixed(0)),
    ).toBeNull();
    expect(decideReaction('opponentMistake', { ...s, status: 'over' }, sure(3), fixed(0))).toBeNull();
  });

  it('canReact keeps one reaction per 2 seconds, while the game runs', () => {
    const t = 10_000;
    const after = (last: number | null) => withPlayers(s, { [bot()]: { lastReactionAt: last } });
    expect(canReact(after(null), bot(), t)).toBe(true);
    expect(canReact(after(t - 1999), bot(), t)).toBe(false);
    expect(canReact(after(t - 2000), bot(), t)).toBe(true);
    expect(canReact({ ...after(null), status: 'paused' }, bot(), t)).toBe(false);
    expect(canReact(withPlayers(s, { [bot()]: { status: 'surrendered' } }), bot(), t)).toBe(false);
  });
});
