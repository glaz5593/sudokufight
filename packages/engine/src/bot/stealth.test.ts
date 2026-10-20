import { INTERFERENCE_KINDS, type InterferenceKind, type Rules } from '../game/rules';
import { GameDriver } from '../testing/game';
import { createRng, type Rng } from '../util/random';
import { decideInterference, decideReaction, decideRetaliation, retaliationKinds, thinkTime } from './brain';
import { BOT_CONFIG, BOT_LEVELS, botConfig, type BotProfile } from './levels';
import { STEALTH_BOT_CONFIG, type StealthBotConfig, stealthBotConfig, stealthBotLevel } from './stealth';

/* The stealth bot's level (stealth-bot plan §5) [D96, D97a, D97b, D98]: built from the player's own pace. */

const N = STEALTH_BOT_CONFIG.normalization;
/** The bot's base for a player's base, before the bounds. */
const botBase = (playerBaseMs: number) => playerBaseMs * N * STEALTH_BOT_CONFIG.paceScale;

/** A ranked two-player game (p1, p2): p2 is the bot, p1 sends the interferences. */
const ranked = (rules?: Partial<Rules>) => GameDriver.of({ mode: 'ranked', rules });
const ENDED = { fromId: 'p1', targetId: 'p2', kind: 'cats' as InterferenceKind };

/** An RNG that records how many numbers were drawn. */
function counting(seed = 1): Rng & { draws: number } {
  const base = createRng(seed);
  const rng = {
    draws: 0,
    next: () => {
      rng.draws++;
      return base.next();
    },
  };
  return rng;
}

describe('STEALTH_BOT_CONFIG: the defaults of the plan (§5, §8)', () => {
  it('±30%, 14 s without data, 3–40 s, 10 games (3 at least, 5 of a type), a move over 3× the median left out', () => {
    expect(STEALTH_BOT_CONFIG).toMatchObject({
      spread: 0.3,
      defaultBaseMs: 14_000,
      baseBounds: { min: 3000, max: 40_000 },
      games: 10,
      minGames: 3,
      sameTypeMin: 5,
      outlierFactor: 3,
      paceScale: 1,
    });
  });

  it('mistakes 2%–20%, 8% without data [D97a]; no reactions [D97b]', () => {
    expect(STEALTH_BOT_CONFIG.mistakes).toEqual({ min: 0.02, max: 0.2, default: 0.08 });
    expect(STEALTH_BOT_CONFIG.reactions).toEqual({});
  });

  it('hits back 2–20 s after the end, always, half the same kind, trying again every second [D98]', () => {
    expect(STEALTH_BOT_CONFIG.retaliate).toEqual({
      afterEndMs: { min: 2000, max: 20_000 },
      chance: 1,
      sameKindShare: 0.5,
      retryMs: 1000,
    });
  });

  it('the guard: more than 65% of 10 won → 5% quicker, down to 0.8', () => {
    expect(STEALTH_BOT_CONFIG.guard).toMatchObject({ games: 10, winShare: 0.65, step: 0.05, min: 0.8 });
  });

  it('the normalization is a calibration close to 1 (simulation.test.ts checks it)', () => {
    expect(N).toBeGreaterThanOrEqual(0.8);
    expect(N).toBeLessThanOrEqual(1.5);
  });
});

describe('stealthBotLevel (plan §5.1–§5.5)', () => {
  it("thinks 0.7–1.3 of the player's base (× the normalization), and errs at his rate", () => {
    const level = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.06 });
    expect(level.thinkMs).toEqual({
      min: Math.round(botBase(10_000) * 0.7),
      max: Math.round(botBase(10_000) * 1.3),
    });
    expect(level.mistakeRate).toBe(0.06);
  });

  it('keeps the base within 3–40 s', () => {
    expect(stealthBotLevel({ baseMs: 500, mistakeRate: 0.05 }).thinkMs).toEqual({ min: 2100, max: 3900 });
    expect(stealthBotLevel({ baseMs: 120_000, mistakeRate: 0.05 }).thinkMs).toEqual({
      min: 28_000,
      max: 52_000,
    });
  });

  it('keeps mistakes within 2%–20%', () => {
    expect(stealthBotLevel({ baseMs: 10_000, mistakeRate: 0 }).mistakeRate).toBe(0.02);
    expect(stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.5 }).mistakeRate).toBe(0.2);
  });

  it("× the guard's personal scale and the config's paceScale (lower: quicker)", () => {
    const plain = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 }).thinkMs;
    const guarded = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05, scale: 0.9 }).thinkMs;
    expect(guarded.min).toBe(Math.round(plain.min * 0.9));
    expect(guarded.max).toBe(Math.round(plain.max * 0.9));
    const tuned: StealthBotConfig = { ...STEALTH_BOT_CONFIG, paceScale: 0.95 };
    expect(stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 }, tuned).thinkMs).toEqual({
      min: Math.round(botBase(10_000) * 0.95 * 0.7),
      max: Math.round(botBase(10_000) * 0.95 * 1.3),
    });
    const normalized: StealthBotConfig = { ...STEALTH_BOT_CONFIG, normalization: 1.2 };
    expect(stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 }, normalized).thinkMs).toEqual({
      min: Math.round(10_000 * 1.2 * 0.7),
      max: Math.round(10_000 * 1.2 * 1.3),
    });
  });

  it('never starts an interference (chance 0), hits back per D98, no reactions, no slowing down', () => {
    const level = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 });
    expect(level.interference).toEqual({
      maxPerGame: null,
      minDeficit: null,
      chance: 0,
      retaliate: STEALTH_BOT_CONFIG.retaliate,
    });
    expect(level.reactions).toEqual({});
    expect(level.adaptive).toBe(false);
  });

  it("takes the persona's kinds [D17], and does not share the config's objects", () => {
    const kinds: InterferenceKind[] = ['fireworks', 'cats'];
    const level = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05, kinds });
    expect(level.interference.retaliate?.kinds).toEqual(['fireworks', 'cats']);
    kinds.push('warp');
    expect(level.interference.retaliate?.kinds).toEqual(['fireworks', 'cats']);
    expect(level.interference.retaliate).not.toBe(STEALTH_BOT_CONFIG.retaliate);
    expect(level.reactions).not.toBe(STEALTH_BOT_CONFIG.reactions);
    expect(STEALTH_BOT_CONFIG.retaliate.kinds).toBeUndefined();
  });

  it('a value that is not a number falls back to the default, so a bad figure never stops a game', () => {
    const level = stealthBotLevel({ baseMs: Number.NaN, mistakeRate: Number.NaN, scale: Number.NaN });
    expect(level.thinkMs).toEqual({
      min: Math.round(botBase(14_000) * 0.7),
      max: Math.round(botBase(14_000) * 1.3),
    });
    expect(level.mistakeRate).toBe(0.08);
    expect(stealthBotLevel({ baseMs: -5, mistakeRate: 0.05 }).thinkMs).toEqual(level.thinkMs);
  });

  it('stealthBotConfig: the pace per game type is 1 (its pace is already the player’s), the rest as every bot', () => {
    expect(stealthBotConfig()).toEqual({ pace: { fast: 1, normal: 1, hard: 1 } });
    const config = botConfig(stealthBotConfig());
    expect(config.lingerShare).toBe(BOT_CONFIG.lingerShare); // ~2% "deliberate hesitation" (plan §5.3)
    expect(config.difficulty).toBe(BOT_CONFIG.difficulty);
  });
});

describe('thinkTime with a level built for the player (plan §5.1)', () => {
  it('1,000 seeded draws: each within 0.7–1.3 × base × the cell factor, the mean within 2% of base × factor', () => {
    const level = stealthBotLevel({ baseMs: 9000, mistakeRate: 0.05 });
    const base = (level.thinkMs.min + level.thinkMs.max) / 2;
    const config = botConfig(stealthBotConfig());
    const rng = createRng(2026);
    for (const factor of [0.8, 1, 1.3, 2]) {
      const ms = Array.from({ length: 1000 }, () =>
        thinkTime({ level, gameType: 'hard', factor }, rng, config),
      );
      for (const m of ms) {
        expect(m).toBeGreaterThanOrEqual(Math.floor(level.thinkMs.min * factor) - 1);
        expect(m).toBeLessThanOrEqual(Math.ceil(level.thinkMs.max * factor) + 1);
      }
      const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
      expect(Math.abs(mean / (base * factor) - 1)).toBeLessThanOrEqual(0.02);
    }
  });
});

describe('it never starts an interference, and never reacts [D98, D97b]', () => {
  const level = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 });

  it('decideInterference: never, even far behind with points to pay, and without drawing', () => {
    const d = ranked();
    d.solve('p2', 'A1');
    d.solve('p1', 'A2');
    d.solve('p1', 'A6');
    d.solve('p1', 'A8');
    const rng = counting();
    for (let k = 0; k < 200; k++) expect(decideInterference(d.state, 'p2', level, d.now, rng)).toBeNull();
    expect(rng.draws).toBe(0);
  });

  it('decideReaction: nothing for any trigger', () => {
    const d = ranked();
    const rng = counting();
    for (const trigger of ['opponentMistake', 'hit', 'tookLead'] as const)
      expect(decideReaction(trigger, d.state, level, rng)).toBeNull();
    expect(rng.draws).toBe(0);
  });
});

describe('decideRetaliation [D98]', () => {
  const level = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05 });

  it('hits back at whoever sent it, 2–20 s after the end, giving up 20 s after the end', () => {
    const d = ranked();
    const rng = createRng(7);
    const after: number[] = [];
    for (let k = 0; k < 500; k++) {
      const c = decideRetaliation(d.state, 'p2', level, ENDED, rng)!;
      expect(c).toMatchObject({ targetId: 'p1', giveUpAfterMs: 20_000 });
      expect(c.afterMs).toBeGreaterThanOrEqual(2000);
      expect(c.afterMs).toBeLessThanOrEqual(20_000);
      after.push(c.afterMs);
    }
    // Uniform over the window: both ends are reached.
    expect(Math.min(...after)).toBeLessThan(3000);
    expect(Math.max(...after)).toBeGreaterThan(19_000);
  });

  it('the same kind about half the time, else a kind drawn among those it may use', () => {
    const d = ranked();
    const rng = createRng(8);
    const kinds = Array.from(
      { length: 2000 },
      () => decideRetaliation(d.state, 'p2', level, ENDED, rng)!.kind,
    );
    const same = kinds.filter((k) => k === 'cats').length / kinds.length;
    // Half the same kind, and a sixth of the other half drawn: ≈ 0.5 + 0.5 / 6.
    expect(same).toBeGreaterThan(0.5 + 0.5 / 6 - 0.05);
    expect(same).toBeLessThan(0.5 + 0.5 / 6 + 0.05);
    for (const k of INTERFERENCE_KINDS) expect(kinds).toContain(k);
  });

  it("only kinds of the game [D47] that the persona's level opened [D17]", () => {
    const d = ranked({ interferenceKinds: ['fireworks', 'cats', 'warp', 'scramble'] });
    const persona = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05, kinds: ['cats', 'warp', 'keypad'] });
    expect(retaliationKinds(d.state, persona)).toEqual(['cats', 'warp']);
    const rng = createRng(9);
    // It got a kind it may not send: always one of its own.
    const kinds = new Set(
      Array.from(
        { length: 300 },
        () => decideRetaliation(d.state, 'p2', persona, { ...ENDED, kind: 'scramble' }, rng)!.kind,
      ),
    );
    expect([...kinds].sort()).toEqual(['cats', 'warp']);
  });

  it('none when it may send no kind at all', () => {
    const d = ranked({ interferenceKinds: ['scramble'] });
    const persona = stealthBotLevel({ baseMs: 10_000, mistakeRate: 0.05, kinds: ['cats'] });
    expect(decideRetaliation(d.state, 'p2', persona, ENDED, createRng(1))).toBeNull();
  });

  it('none, without drawing: no policy (the five levels), interferences off [D44], not its own, unknown sender', () => {
    const rng = counting();
    const on = ranked();
    for (const l of BOT_LEVELS) {
      expect(l.interference.retaliate).toBeUndefined();
      expect(decideRetaliation(on.state, 'p2', l, ENDED, rng)).toBeNull();
    }
    const off = ranked({ interferences: false });
    expect(decideRetaliation(off.state, 'p2', level, ENDED, rng)).toBeNull();
    expect(decideRetaliation(on.state, 'p1', level, ENDED, rng)).toBeNull(); // it hit p2, not p1
    expect(decideRetaliation(on.state, 'p2', level, { ...ENDED, fromId: 'p2' }, rng)).toBeNull();
    expect(decideRetaliation(on.state, 'p2', level, { ...ENDED, fromId: 'p9' }, rng)).toBeNull();
    expect(rng.draws).toBe(0);
  });

  it('with a chance below 1, only that share of interferences gets an answer', () => {
    const d = ranked();
    const half: BotProfile = {
      ...level,
      interference: { ...level.interference, retaliate: { ...STEALTH_BOT_CONFIG.retaliate, chance: 0.5 } },
    };
    const rng = createRng(10);
    const answered = Array.from({ length: 1000 }, () =>
      decideRetaliation(d.state, 'p2', half, ENDED, rng),
    ).filter(Boolean).length;
    expect(answered / 1000).toBeGreaterThan(0.45);
    expect(answered / 1000).toBeLessThan(0.55);
  });
});
