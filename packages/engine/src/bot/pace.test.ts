import { parseCellName } from '../sudoku/board';
import { answer, GameDriver, wrongDigit } from '../testing/game';
import { cellDifficulty } from './brain';
import { movePace, type PaceGame, paceFromHistory, stealthGuardScale } from './pace';
import { STEALTH_BOT_CONFIG } from './stealth';

/* A player's pace (stealth-bot plan §5.1, §5.2) [D96, D97a]: movePace on a game's log, paceFromHistory over games. */

/** A ranked two-player game (p1, p2) started at 0. */
const ranked = () => GameDriver.of({ mode: 'ranked' });

/**
 * `player` locks `cell` and enters its digit (or a wrong one) at `at`; returns the cell's difficulty factor on the
 * board just before (what movePace divides by).
 */
function digit(d: GameDriver, player: string, cell: string, at: number, wrong = false): number {
  d.tickTo(at);
  const factor = cellDifficulty(d.state, parseCellName(cell)).factor;
  const tried = d.state.wrong[parseCellName(cell)]!.map((w) => w.digit);
  d.select(player, cell, at);
  d.place(player, cell, wrong ? wrongDigit(cell, tried) : answer(cell), at);
  return factor;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('movePace: one game (plan §5.1)', () => {
  it("a move runs from his previous digit (or the start) to this one; the base is each move ÷ its cell's factor", () => {
    const d = ranked();
    const f = [digit(d, 'p1', 'A1', 6000), digit(d, 'p1', 'A2', 14_000), digit(d, 'p1', 'A5', 24_000)];
    digit(d, 'p2', 'A6', 25_000); // the opponent's digits are not his moves
    const pace = movePace(d.log, 'p1')!;
    const ms = [6000, 8000, 10_000];
    expect(pace).toMatchObject({ moves: 3, digits: 3, mistakes: 0 });
    expect(pace.rawMs).toBeCloseTo(mean(ms), 6);
    expect(pace.meanFactor).toBeCloseTo(mean(f), 6);
    expect(pace.baseMs).toBeCloseTo(mean(ms.map((m, k) => m / f[k]!)), 6);
  });

  it('divides by the factor: the cells here are not all naked singles, and the base is not the raw mean', () => {
    const d = ranked();
    const f = ['A1', 'A2', 'A5', 'A6', 'A8', 'B1'].map((c, k) => digit(d, 'p1', c, 5000 * (k + 1)));
    expect(new Set(f).size).toBeGreaterThan(1);
    const pace = movePace(d.log, 'p1')!;
    expect(pace.rawMs).toBe(5000);
    expect(pace.baseMs).toBeCloseTo(mean(f.map((x) => 5000 / x)), 6);
    expect(pace.baseMs).not.toBeCloseTo(5000, 0);
  });

  it('a wrong digit is a move, and a mistake', () => {
    const d = ranked();
    digit(d, 'p1', 'A1', 5000);
    digit(d, 'p1', 'A2', 10_000, true);
    digit(d, 'p1', 'A5', 15_000);
    expect(d.log.some((e) => e.type === 'placedWrong')).toBe(true);
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 3, digits: 3, mistakes: 1, rawMs: 5000 });
  });

  it('leaves out the time the game was frozen', () => {
    const d = ranked();
    digit(d, 'p1', 'A1', 5000);
    d.disconnect('p2', { at: 8000 }); // two players: the game freezes [D4]
    expect(d.state.status).toBe('paused');
    d.reconnect('p2', 18_000);
    expect(d.last('gameResumed')).toMatchObject({ pausedMs: 10_000 });
    digit(d, 'p1', 'A2', 25_000);
    // 20 s from his previous digit, 10 of them frozen.
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 2, rawMs: (5000 + 10_000) / 2 });
  });

  it('leaves out the time he was under an interference', () => {
    const d = ranked();
    digit(d, 'p2', 'A6', 1000);
    digit(d, 'p2', 'A8', 2000);
    digit(d, 'p1', 'A1', 5000);
    d.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 7000);
    d.tickTo(12_000);
    expect(d.last('interferenceEnded')).toMatchObject({ targetId: 'p1', t: 12_000 });
    digit(d, 'p1', 'A2', 17_000);
    // 12 s, 5 of them under the interference.
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 2, rawMs: (5000 + 7000) / 2 });
    // Its sender's moves keep their time.
    expect(movePace(d.log, 'p2')).toMatchObject({ moves: 2, rawMs: 1000 });
  });

  it('leaves out the time he was away (the soft phase of a lost connection [D42])', () => {
    const d = ranked();
    digit(d, 'p1', 'A1', 5000);
    d.disconnect('p1', { soft: true, at: 7000 });
    expect(d.last('playerConnectionLost')).toMatchObject({ playerId: 'p1' });
    d.reconnect('p1', 11_000);
    digit(d, 'p1', 'A2', 15_000);
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 2, rawMs: (5000 + 6000) / 2 });
  });

  it('a digit sent offline [D42] is a digit, not a move; the next move runs from it', () => {
    const d = ranked();
    digit(d, 'p1', 'A1', 5000);
    d.disconnect('p1', { soft: true, at: 7000 });
    d.reconnect('p1', 9000);
    d.offlineMove('p1', 'A2', { at: 9000, digit: wrongDigit('A2') });
    expect(d.last('placedWrong')).toMatchObject({ offline: true });
    digit(d, 'p1', 'A5', 14_000);
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 2, digits: 3, mistakes: 1, rawMs: 5000 });
  });

  it('leaves out a move longer than 3× his median (the phone rang)', () => {
    const d = ranked();
    ['A1', 'A2', 'A5', 'A6'].forEach((c, k) => digit(d, 'p1', c, 10_000 * (k + 1)));
    digit(d, 'p1', 'A8', 40_000 + 31_000); // 31 s > 3 × 10 s
    digit(d, 'p1', 'B1', 71_000 + 30_000); // exactly 3 × 10 s: counted
    expect(movePace(d.log, 'p1')).toMatchObject({ moves: 5, digits: 6, rawMs: (4 * 10_000 + 30_000) / 5 });
    expect(STEALTH_BOT_CONFIG.outlierFactor).toBe(3);
  });

  it('null without a move, for a player not in the game, and for a log without its start', () => {
    const d = ranked();
    digit(d, 'p2', 'A1', 5000);
    expect(movePace(d.log, 'p1')).toBeNull();
    expect(movePace(d.log, 'p9')).toBeNull();
    expect(movePace([], 'p1')).toBeNull();
    expect(movePace(d.log.slice(1), 'p2')).toBeNull();
  });
});

describe('paceFromHistory: his last ranked games (plan §5.1, §5.2) [D96, D97a]', () => {
  const game = (paceMs: number, paceMoves = 20, gameType: PaceGame['gameType'] = 'fast'): PaceGame => ({
    gameType,
    paceMs,
    paceMoves,
    digits: paceMoves,
    mistakes: 0,
  });

  it('the newest 10 games, each base weighted by its moves', () => {
    const games = [
      game(8000, 30),
      game(12_000, 10),
      ...Array.from({ length: 8 }, () => game(10_000, 20)),
      game(40_000, 50), // the 11th: too old
    ];
    const pace = paceFromHistory({ gameType: 'fast', games });
    expect(pace.baseMs).toBeCloseTo((8000 * 30 + 12_000 * 10 + 10_000 * 160) / 200, 6);
    expect(pace).toMatchObject({ games: 10, sameTypeOnly: true, scale: 1 });
  });

  it('only games of the type about to be played, when at least 5 of the 10 are', () => {
    const five = [
      ...Array.from({ length: 5 }, () => game(6000, 20, 'fast')),
      ...Array.from({ length: 5 }, () => game(20_000, 20, 'hard')),
    ];
    expect(paceFromHistory({ gameType: 'fast', games: five })).toMatchObject({
      baseMs: 6000,
      games: 5,
      sameTypeOnly: true,
    });
    expect(paceFromHistory({ gameType: 'hard', games: five })).toMatchObject({ baseMs: 20_000, games: 5 });
    const four = [
      ...Array.from({ length: 4 }, () => game(6000, 20, 'fast')),
      ...Array.from({ length: 6 }, () => game(20_000, 20, 'hard')),
    ];
    expect(paceFromHistory({ gameType: 'fast', games: four })).toMatchObject({
      baseMs: (4 * 6000 + 6 * 20_000) / 10,
      games: 10,
      sameTypeOnly: false,
    });
  });

  it('a new player: 14 s and 8%; one or two games: n/3 his, the rest the default', () => {
    expect(paceFromHistory({ gameType: 'fast', games: [] })).toEqual({
      baseMs: 14_000,
      mistakeRate: 0.08,
      scale: 1,
      games: 0,
      sameTypeOnly: false,
    });
    const one = { ...game(8000), digits: 20, mistakes: 4 }; // 20%
    expect(paceFromHistory({ gameType: 'fast', games: [one] })).toMatchObject({
      baseMs: (8000 + 2 * 14_000) / 3,
      mistakeRate: (0.2 + 2 * 0.08) / 3,
      games: 1,
    });
    expect(paceFromHistory({ gameType: 'fast', games: [one, one] }).baseMs).toBeCloseTo(
      (2 * 8000 + 14_000) / 3,
      6,
    );
    expect(paceFromHistory({ gameType: 'fast', games: [one, one, one] })).toMatchObject({
      baseMs: 8000,
      mistakeRate: 0.2,
      games: 3,
    });
  });

  it('the mistake rate: wrong digits ÷ digits of the same games', () => {
    const games = [
      { ...game(9000), digits: 40, mistakes: 2 },
      { ...game(9000), digits: 30, mistakes: 3 },
      { ...game(9000), digits: 30, mistakes: 5 },
    ];
    expect(paceFromHistory({ gameType: 'fast', games }).mistakeRate).toBeCloseTo(10 / 100, 9);
  });

  it('within 3–40 s and 2%–20%', () => {
    const quick = Array.from({ length: 3 }, () => ({ ...game(1000), digits: 20, mistakes: 0 }));
    expect(paceFromHistory({ gameType: 'fast', games: quick })).toMatchObject({
      baseMs: 3000,
      mistakeRate: 0.02,
    });
    const slow = Array.from({ length: 3 }, () => ({ ...game(90_000), digits: 20, mistakes: 15 }));
    expect(paceFromHistory({ gameType: 'fast', games: slow })).toMatchObject({
      baseMs: 40_000,
      mistakeRate: 0.2,
    });
  });

  it('skips games without a pace; a game without its digits counts for the base only', () => {
    const games: PaceGame[] = [
      { gameType: 'fast', paceMs: Number.NaN, paceMoves: 20 },
      { gameType: 'fast', paceMs: 0, paceMoves: 20 },
      { gameType: 'fast', paceMs: 9000, paceMoves: 0 },
      { gameType: 'fast', paceMs: 9000, paceMoves: 20 },
      { gameType: 'fast', paceMs: 9000, paceMoves: 20 },
      { gameType: 'fast', paceMs: 9000, paceMoves: 20, digits: 25, mistakes: 5 },
    ];
    const pace = paceFromHistory({ gameType: 'fast', games });
    expect(pace).toMatchObject({ baseMs: 9000, games: 3 });
    // One game with digits: a third his 20%, the rest the default 8%.
    expect(pace.mistakeRate).toBeCloseTo((0.2 + 2 * 0.08) / 3, 9);
  });

  it('carries the guard: a player who beats the stealth bot too often gets a quicker one', () => {
    const games = Array.from({ length: 3 }, () => game(9000));
    expect(paceFromHistory({ gameType: 'fast', games, stealthWins: Array(10).fill(true) }).scale).toBe(0.95);
    expect(paceFromHistory({ gameType: 'fast', games, stealthWins: [] }).scale).toBe(1);
  });
});

describe('stealthGuardScale: the guard against farming (plan §5.1)', () => {
  /** `wins` of 10, the wins first (newest first: the order does not matter within one run). */
  const run = (wins: number) => [...Array(wins).fill(true), ...Array(10 - wins).fill(false)] as boolean[];

  it('more than 65% of 10 won: 5% quicker; 65% or less: no change', () => {
    expect(stealthGuardScale(run(7))).toBe(0.95);
    expect(stealthGuardScale(run(6))).toBe(1);
    expect(stealthGuardScale(run(10))).toBe(0.95);
  });

  it('fewer than 10 games: no change', () => {
    expect(stealthGuardScale(Array(9).fill(true))).toBe(1);
  });

  it('each step needs 10 new games; never below 0.8', () => {
    expect(stealthGuardScale(Array(19).fill(true))).toBe(0.95);
    expect(stealthGuardScale(Array(20).fill(true))).toBe(0.9);
    expect(stealthGuardScale(Array(40).fill(true))).toBe(0.8);
    expect(stealthGuardScale(Array(200).fill(true))).toBe(0.8);
  });

  it('a later winning run of 10 counts once he wins again (a sliding window until the step)', () => {
    // Oldest first: 5 losses, then 7 wins: the last 10 hold 7 wins.
    const oldestFirst = [...Array(5).fill(false), ...Array(7).fill(true)] as boolean[];
    expect(stealthGuardScale([...oldestFirst].reverse())).toBe(0.95);
  });

  it(`only the newest ${STEALTH_BOT_CONFIG.guard.history} results count`, () => {
    const newestFirst = [...Array(STEALTH_BOT_CONFIG.guard.history).fill(false), ...Array(10).fill(true)];
    expect(stealthGuardScale(newestFirst)).toBe(1);
  });
});
