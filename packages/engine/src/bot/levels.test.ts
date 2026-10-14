import { GAME_TYPES } from '../gameType';
import { TECHNIQUES } from '../sudoku/logic';
import {
  BOT_CONFIG,
  BOT_LEVEL_IDS,
  BOT_LEVELS,
  BOT_PACE,
  botConfig,
  botLevel,
  type BotLevelId,
  botPlayer,
  CELL_TECHNIQUES,
  isBotLevelId,
} from './levels';

/* The level table and the bot settings (spec §9) [D40]. */

describe('the level table (spec §9)', () => {
  it('has the five levels of the table: name, avatar, base think time per move, mistake rate', () => {
    expect(
      BOT_LEVELS.map((l) => [l.level, l.name, l.avatar, l.thinkMs.min, l.thinkMs.max, l.mistakeRate]),
    ).toEqual([
      [1, 'Pip', 'hatchling', 15_000, 25_000, 0.15],
      [2, 'Biscuit', 'fox', 12_000, 20_000, 0.09],
      [3, 'Mr. Hoot', 'owl', 9_000, 15_000, 0.05],
      [4, 'Maestro', 'professor', 6_000, 10_000, 0.02],
      [5, 'Overlord', 'furry-monster', 3_000, 5_000, 0.01],
    ]);
    expect(BOT_LEVEL_IDS).toEqual([1, 2, 3, 4, 5]);
  });

  it("thinks per Moshe's ends (Novice 15–25 s, Grandmaster 3–5 s a move), the levels between evenly spaced", () => {
    const first = BOT_LEVELS[0]!.thinkMs;
    const last = BOT_LEVELS.at(-1)!.thinkMs;
    expect(first).toEqual({ min: 15_000, max: 25_000 });
    expect(last).toEqual({ min: 3_000, max: 5_000 });
    const steps = BOT_LEVELS.length - 1;
    BOT_LEVELS.forEach((l, k) => {
      expect(l.thinkMs.min).toBeCloseTo(first.min + ((last.min - first.min) * k) / steps, 6);
      expect(l.thinkMs.max).toBeCloseTo(first.max + ((last.max - first.max) * k) / steps, 6);
    });
  });

  it('dresses every level in a different catalog avatar (protocol checks they are choosable ids)', () => {
    const avatars = BOT_LEVELS.map((l) => l.avatar);
    expect(new Set(avatars).size).toBe(BOT_LEVELS.length);
    for (const id of avatars) expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });

  it('interferes per [D40]: L1 at most once a game, L2 when 15 behind, L3 when 10 behind, L4 when behind, L5 always', () => {
    const p = (l: BotLevelId) => botLevel(l).interference;
    expect(p(1)).toMatchObject({ maxPerGame: 1, minDeficit: null });
    expect(p(2)).toMatchObject({ maxPerGame: null, minDeficit: 15 });
    expect(p(3)).toMatchObject({ maxPerGame: null, minDeficit: 10 });
    expect(p(4)).toMatchObject({ maxPerGame: null, minDeficit: 0 });
    expect(p(5)).toMatchObject({ maxPerGame: null, minDeficit: null });
    // "Rare" < "sometimes" < "when behind" ≤ "aggressive".
    const chances = BOT_LEVEL_IDS.map((l) => p(l).chance);
    expect(chances[0]).toBeLessThan(0.05);
    expect(chances[1]).toBeLessThan(chances[2]!);
    expect(chances[4]).toBeGreaterThanOrEqual(chances[3]!);
    for (const c of chances) expect(c).toBeGreaterThan(0);
  });

  it('reacts per the table: L1 rarely, L2 😂 sometimes, L3 and L5 😂/😱, L4 😎', () => {
    const r = (l: BotLevelId) => botLevel(l).reactions;
    expect(r(1).opponentMistake).toEqual({ emoji: '😂', chance: expect.any(Number) });
    expect(r(1).opponentMistake!.chance).toBeLessThanOrEqual(0.15);
    expect(r(1).hit!.chance).toBeLessThanOrEqual(0.15);
    expect(r(2)).toEqual({ opponentMistake: { emoji: '😂', chance: expect.any(Number) } });
    for (const l of [3, 5] as const) {
      expect(r(l).opponentMistake!.emoji).toBe('😂');
      expect(r(l).hit!.emoji).toBe('😱');
      expect(r(l).opponentMistake!.chance).toBeGreaterThan(r(2).opponentMistake!.chance);
    }
    expect(new Set(Object.values(r(4)).map((x) => x.emoji))).toEqual(new Set(['😎']));
  });

  it('adapts only at levels 1–3', () => {
    expect(BOT_LEVELS.map((l) => l.adaptive)).toEqual([true, true, true, false, false]);
  });

  it('gets faster and more accurate level by level', () => {
    for (let k = 1; k < BOT_LEVELS.length; k++) {
      expect(BOT_LEVELS[k]!.thinkMs.max).toBeLessThan(BOT_LEVELS[k - 1]!.thinkMs.max);
      expect(BOT_LEVELS[k]!.mistakeRate).toBeLessThan(BOT_LEVELS[k - 1]!.mistakeRate);
    }
  });
});

describe('the settings (spec §9)', () => {
  it('thinks as long per move in every game type: a harder board is slower through its cells', () => {
    expect(BOT_PACE).toEqual({ fast: 1, normal: 1, hard: 1 });
    expect(Object.keys(BOT_PACE).sort()).toEqual([...GAME_TYPES].sort());
    expect(BOT_CONFIG.pace).toBe(BOT_PACE);
  });

  it('places the digit within 80% of the lock time, and lets about 2% of locks run out on purpose', () => {
    expect(BOT_CONFIG.placeWithin).toBe(0.8);
    expect(BOT_CONFIG.lingerShare).toBe(0.02);
    expect(BOT_CONFIG.solveShare.min).toBeGreaterThan(0);
    expect(BOT_CONFIG.solveShare.max).toBeLessThan(1);
    expect(BOT_CONFIG.solveShare.min).toBeLessThanOrEqual(BOT_CONFIG.solveShare.max);
  });

  it('slows levels 1–3 down a little when the human trails by more than 25', () => {
    expect(BOT_CONFIG.adaptation.humanTrailingBy).toBe(25);
    expect(BOT_CONFIG.adaptation.slowdown).toBeGreaterThan(1);
    expect(BOT_CONFIG.adaptation.slowdown).toBeLessThanOrEqual(1.5);
  });

  it("knows the logical solver's techniques, between a last gap and 'harder'", () => {
    expect(CELL_TECHNIQUES).toEqual(['lastGap', ...TECHNIQUES, 'harder']);
    expect(Object.keys(BOT_CONFIG.difficulty.technique).sort()).toEqual([...CELL_TECHNIQUES].sort());
  });

  it('makes a harder deduction slower: last gap < naked single (1, the table) < hidden single < … < harder', () => {
    const { technique, max, perExtraOption } = BOT_CONFIG.difficulty;
    expect(technique).toEqual({
      lastGap: 0.8,
      nakedSingle: 1,
      hiddenSingle: 1.3,
      pointing: 1.7,
      claiming: 1.7,
      nakedPair: 2,
      hiddenPair: 2,
      harder: 2.5,
    });
    // Never faster for a harder technique (the order of CELL_TECHNIQUES), and strictly so across the tiers.
    const factors = CELL_TECHNIQUES.map((t) => technique[t]);
    for (let k = 1; k < factors.length; k++) expect(factors[k]).toBeGreaterThanOrEqual(factors[k - 1]!);
    expect(technique.lastGap).toBeLessThan(technique.nakedSingle);
    expect(technique.hiddenSingle).toBeGreaterThan(technique.nakedSingle);
    expect(technique.pointing).toBeGreaterThan(technique.hiddenSingle);
    expect(technique.nakedPair).toBeGreaterThan(technique.claiming);
    expect(technique.harder).toBeGreaterThan(technique.hiddenPair);
    expect(max).toBeGreaterThanOrEqual(technique.harder);
    expect(perExtraOption).toBeGreaterThan(0);
  });

  it('botConfig() lays overrides over the defaults', () => {
    expect(botConfig()).toEqual(BOT_CONFIG);
    const c = botConfig({ lingerShare: 0 });
    expect(c.lingerShare).toBe(0);
    expect(c.levels).toBe(BOT_LEVELS);
  });
});

describe('botLevel / botPlayer', () => {
  it('finds a level, and refuses one that is not in the table', () => {
    expect(botLevel(3).name).toBe('Mr. Hoot');
    expect(() => botLevel(6 as BotLevelId)).toThrow(RangeError);
    expect(isBotLevelId(5)).toBe(true);
    expect(isBotLevelId(0)).toBe(false);
    expect(isBotLevelId('1')).toBe(false);
  });

  it('makes the bot a player: bot-<level>, its name, isBot', () => {
    expect(botPlayer(3)).toEqual({ id: 'bot-3', name: 'Mr. Hoot', isBot: true });
    expect(botPlayer(5, 'rival')).toEqual({ id: 'rival', name: 'Overlord', isBot: true });
  });
});
