import { expectedScore } from '../rating';
import { DIGITS, digitCount, parseCellName } from '../sudoku/board';
import {
  answer,
  cellNameOf,
  EMPTY,
  GameDriver,
  makeConfig,
  PUZZLE,
  solveAll,
  type ConfigOptions,
} from '../testing/game';
import { DEFAULT_RATING_RULES, type RatingRules } from './rules';
import type { AwardKind, GameEvent, GameResult, PlayerInfo } from './types';

/*
 * End of game (spec §6.6, §6.7, §11.2, §12; decisions D7, D8, D16, D23, D31, D32, D36).
 *
 * Exact scores come from a nearly solved board: PUZZLE's solution with only the nine cells of T left empty. T has one
 * cell in each row, column and box and one of each digit, so every correct move there sees row = col = box = num = 8:
 * X = Y = 8 and points = 9 − 8 + (9 − 8)/2 = 1.5 (spec §6.4). Mistakes cost 1, 2, 4, 8 … (spec §6.5).
 *
 * After any release, a mistake included, the same player may lock the same cell again only a second later (spec
 * §6.2.6) [D2]: the helpers below wait that second out when they go back to a cell.
 */

const T = ['A1', 'B7', 'C4', 'D2', 'E5', 'F8', 'G3', 'H9', 'I6'] as const;
/** T without I6: eight cells, for even splits. */
const T8 = T.slice(0, 8);
/** T and A2: ten cells, so two players can both make five moves. */
const T10 = [...T, 'A2'];

function nearlySolved(blanks: readonly string[]) {
  const empty = new Set(blanks.map(parseCellName));
  return {
    id: `near-${blanks.join('')}`,
    givens: [...PUZZLE.solution].map((c, i) => (empty.has(i) ? '0' : c)).join(''),
    solution: PUZZLE.solution,
  };
}

/** A game on the nearly solved board (default: the nine cells of T). */
const near = (
  o: ConfigOptions = {},
  blanks: readonly string[] = T,
  opts?: { start?: boolean; at?: number },
) => GameDriver.of({ ...o, puzzle: nearlySolved(blanks) }, opts);

/** The earliest time from now at which `playerId` may lock `cell`: after its re-lock wait, if any (§6.2.6). */
function freeAt(g: GameDriver, playerId: string, cell: string): number {
  const wait = g.state.cooldowns.find((c) => c.playerId === playerId && c.cell === parseCellName(cell));
  return Math.max(g.now, wait?.until ?? 0);
}

/**
 * A wrong digit that may still be pressed in `cell`: not tried there yet, and not all nine on the board. Without
 * `at`, now, or once the re-lock wait of an earlier try ends.
 */
function err(g: GameDriver, playerId: string, cell: string, at?: number): GameEvent[] {
  const tried = g.state.wrong[parseCellName(cell)]!.map((w) => w.digit);
  const digit = DIGITS.find(
    (d) => d !== answer(cell) && !tried.includes(d) && digitCount(g.state.grid, d) < 9,
  );
  if (!digit) throw new Error(`No wrong digit left for ${cell}`);
  return [...g.select(playerId, cell, at ?? freeAt(g, playerId, cell)), ...g.place(playerId, cell, digit)];
}

/** Solves each cell for `playerId`, at the driver's current time (or once a re-lock wait on that cell ends). */
function solveEach(g: GameDriver, playerId: string, cells: readonly string[]): void {
  for (const cell of cells) g.solve(playerId, cell, freeAt(g, playerId, cell));
}

/** Locks `cell` now and places the right digit `thinkMs` later. */
function solveIn(g: GameDriver, playerId: string, cell: string, thinkMs: number): void {
  g.select(playerId, cell);
  g.place(playerId, cell, answer(cell), g.now + thinkMs);
}

function result(g: GameDriver): GameResult {
  if (!g.state.result) throw new Error('The game is not over');
  return g.state.result;
}
const places = (g: GameDriver): Record<string, number> =>
  Object.fromEntries(result(g).ranking.map((r) => [r.playerId, r.place]));
const order = (g: GameDriver): string[] => result(g).ranking.map((r) => r.playerId);
const award = (g: GameDriver, kind: AwardKind) => result(g).awards.find((a) => a.kind === kind);
const change = (g: GameDriver, id: string) => result(g).ratingChanges.find((c) => c.playerId === id);
const gameOver = (g: GameDriver) => g.last('gameOver')!;

const rated = (...ratings: [number, number | undefined][]): PlayerInfo[] =>
  ratings.map(([rating, ratedGames], k) =>
    ratedGames === undefined ? { id: `p${k + 1}`, rating } : { id: `p${k + 1}`, rating, ratedGames },
  );
/** Rules overrides that change some of the rating settings, the rest staying at their defaults. */
const withRating = (rating: Partial<RatingRules>) => ({ rating: { ...DEFAULT_RATING_RULES, ...rating } });

// ---------------------------------------------------------------------------------------------------------

describe('surrender (§6.6)', () => {
  it('2 players: surrender is an immediate loss; the other player is 1st, even when behind', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 1000); // p1 leads 8 – 0
    g.select('p1', 'A2', 2000);
    g.select('p2', 'A5', 2000);
    const events = g.playerAct('p1', { type: 'surrender' }, 3000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'gameOver']);
    expect(events[0]).toMatchObject({
      playerId: 'p1',
      cell: parseCellName('A2'),
      reason: 'surrender',
      t: 3000,
    });
    expect(events[1]).toMatchObject({ playerId: 'p1', t: 3000 });
    expect(events[2]).toMatchObject({ type: 'gameOver', reason: 'lastPlayerStanding', t: 3000 });
    expect(result(g).ranking).toEqual([
      { playerId: 'p2', seat: 1, place: 1, score: 0, mistakes: 0, correct: 0, status: 'active' },
      { playerId: 'p1', seat: 0, place: 2, score: 8, mistakes: 0, correct: 1, status: 'surrendered' },
    ]);
    expect(g.state.status).toBe('over');
    expect(g.state.endedAt).toBe(3000);
    // The surrendering player's lock is released, and the game over clears the other one too.
    expect(g.state.locks).toEqual([]);
    expect(g.state.owner[parseCellName('A1')]).toBe(0);
    expect(g.replayMatches()).toBe(true);
  });

  it('2 players: surrender without a lock is just the surrender and the end', () => {
    const g = GameDriver.of();
    const events = g.playerAct('p2', { type: 'surrender' }, 500);
    expect(g.types(events)).toEqual(['playerSurrendered', 'gameOver']);
    expect(order(g)).toEqual(['p1', 'p2']);
    expect(result(g).reason).toBe('lastPlayerStanding');
  });

  it('2 players frozen by a disconnect: the player still here may surrender, and the absent one wins', () => {
    const g = GameDriver.of();
    expect(g.types(g.act({ type: 'disconnect', playerId: 'p2' }, 1000))).toEqual([
      'playerDisconnected',
      'gamePaused',
    ]);
    const events = g.playerAct('p1', { type: 'surrender' }, 3000);
    expect(g.types(events)).toEqual(['playerSurrendered', 'gameOver']);
    expect(places(g)).toEqual({ p2: 1, p1: 2 });
    // The grace period ends with the game: no abandonment is coming.
    expect(g.deadline).toBeNull();
    expect(g.tickTo(60000)).toEqual([]);
  });

  it('is refused before the game starts, for a disconnected player, and for a player already out', () => {
    const waiting = GameDriver.of({}, { start: false });
    expect(waiting.reject({ type: 'surrender', playerId: 'p1' })).toBe('notStarted');

    const g = GameDriver.of({ players: 3 });
    g.act({ type: 'disconnect', playerId: 'p1' }, 1000);
    expect(g.reject({ type: 'surrender', playerId: 'p1' })).toBe('disconnected');
    g.playerAct('p2', { type: 'surrender' }, 2000);
    expect(g.reject({ type: 'surrender', playerId: 'p2' })).toBe('notActive');
    expect(g.reject({ type: 'surrender', playerId: 'nobody' })).toBe('unknownPlayer');
  });

  it('3 players [D36]: whoever surrenders leaves, keeps their solved cells, loses the lock, and the game goes on', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 1000); // 8
    g.solve('p1', 'A2', 2000); // 6.5
    g.select('p1', 'A5', 3000);
    const events = g.playerAct('p1', { type: 'surrender' }, 4000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered']);
    expect(events[0]).toMatchObject({ playerId: 'p1', cell: parseCellName('A5'), reason: 'surrender' });
    expect(g.state.status).toBe('running');
    expect(g.state.result).toBeNull();
    expect(g.player('p1')).toMatchObject({ status: 'surrendered', outOrder: 1, score: 14.5, correct: 2 });
    expect(g.lock('p1')).toBeUndefined();
    // Solved cells stay in the colour (seat) of whoever solved them.
    expect(g.state.owner[parseCellName('A1')]).toBe(0);
    expect(g.state.owner[parseCellName('A2')]).toBe(0);

    // The released cell is free for the others at once; the one who left can do nothing more.
    g.select('p2', 'A5', 4000);
    expect(g.lock('p2')!.cell).toBe(parseCellName('A5'));
    expect(g.reject({ type: 'select', playerId: 'p1', cell: parseCellName('A6') })).toBe('notActive');
    expect(g.reject({ type: 'react', playerId: 'p1', emoji: '😂' })).toBe('notActive');
    expect(g.reject({ type: 'interfere', playerId: 'p3', targetId: 'p1', kind: 'cats' })).toBe('targetOut');

    // The next surrender leaves one player: the game is over.
    const end = g.playerAct('p2', { type: 'surrender' }, 5000);
    expect(g.types(end)).toEqual(['cellReleased', 'playerSurrendered', 'gameOver']);
    expect(result(g).reason).toBe('lastPlayerStanding');
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p3', 1, 'active'],
      ['p2', 2, 'surrendered'],
      ['p1', 3, 'surrendered'],
    ]);
    expect(g.state.owner[parseCellName('A1')]).toBe(0);
    expect(g.replayMatches()).toBe(true);
  });

  it('4 players [D36]: those who left rank below everyone still playing, whatever their score; the earlier one lower', () => {
    const g = near({ players: 4 });
    solveEach(g, 'p1', ['A1', 'B7', 'C4']); // 4.5
    g.select('p1', 'D2', 1000);
    expect(g.types(g.playerAct('p1', { type: 'surrender' }, 2000))).toEqual([
      'cellReleased',
      'playerSurrendered',
    ]);
    g.solve('p2', 'D2', 3000); // 1.5, on the cell p1 let go
    g.playerAct('p2', { type: 'surrender' }, 4000);
    err(g, 'p3', 'E5', 5000);
    err(g, 'p3', 'E5'); // −1 −2: the second try a second later (§6.2.6), at 6000
    solveEach(g, 'p3', ['E5', 'F8']); // +3 → 0, at 7000
    g.solve('p4', 'G3', 8000);
    g.solve('p4', 'H9');
    const last = g.solve('p4', 'I6'); // 4.5, and the board is full

    expect(g.types(last)).toEqual(['cellLocked', 'placedCorrect', 'gameOver']);
    expect(result(g).reason).toBe('boardComplete');
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score, r.status])).toEqual([
      ['p4', 1, 4.5, 'active'],
      ['p3', 2, 0, 'active'],
      ['p2', 3, 1.5, 'surrendered'],
      ['p1', 4, 4.5, 'surrendered'],
    ]);
    for (const c of ['A1', 'B7', 'C4']) expect(g.state.owner[parseCellName(c)]).toBe(0);
    expect(g.state.owner[parseCellName('D2')]).toBe(1);
  });

  it("turns [D1]: surrendering on one's turn passes it to the next player still in the game", () => {
    const g = GameDriver.of({ players: 4, rules: { turnModel: 'turns' } });
    expect(g.state.turn?.playerId).toBe('p1');
    expect(g.types(g.playerAct('p2', { type: 'surrender' }, 500))).toEqual(['playerSurrendered']);
    expect(g.state.turn?.playerId).toBe('p1');
    g.select('p1', 'A1', 1000);
    const events = g.playerAct('p1', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'turnStarted']);
    // The next seat after p1 that is still in the game: p2 already left.
    expect(events[2]).toMatchObject({ playerId: 'p3', endsAt: 2000 + 8000, remainingMs: 8000 });
    expect(g.state.turn).toEqual({ playerId: 'p3', endsAt: 10000, stoppedMs: null });
  });

  it('turns [D1]: the surrender that ends the game starts no turn; the turn and its timer are gone', () => {
    const g = GameDriver.of({ players: 3, rules: { turnModel: 'turns' } });
    g.playerAct('p3', { type: 'surrender' }, 500);
    expect(g.state.turn?.playerId).toBe('p1');
    const events = g.playerAct('p1', { type: 'surrender' }, 1000);
    expect(g.types(events)).toEqual(['playerSurrendered', 'gameOver']);
    expect(result(g).reason).toBe('lastPlayerStanding');
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBeNull();
    expect(g.tickTo(60000)).toEqual([]);
    expect(g.replayMatches()).toBe(true);
  });

  it('solo: "end practice" ends the game (practiceEnded), with no rating and no awards', () => {
    const g = GameDriver.of({ players: 1 });
    expect(g.state.config.mode).toBe('solo');
    g.solve('p1', 'A1', 1000);
    g.select('p1', 'A2', 2000);
    const events = g.playerAct('p1', { type: 'surrender' }, 5000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'gameOver']);
    expect(gameOver(g)).toMatchObject({
      reason: 'practiceEnded',
      durationMs: 5000,
      ratingChanges: [],
      awards: [],
    });
    expect(result(g).ranking).toEqual([
      { playerId: 'p1', seat: 0, place: 1, score: 8, mistakes: 0, correct: 1, status: 'surrendered' },
    ]);
  });

  it('against a bot: the human surrendering is "end practice" (practiceEnded); the bot ranks 1st, nobody\'s rating moves', () => {
    const g = GameDriver.of({
      mode: 'bot',
      players: [
        { id: 'me', rating: 1300, ratedGames: 40 },
        { id: 'bot', isBot: true, rating: 1300, ratedGames: 40 },
      ],
    });
    g.solve('me', 'A1', 1000);
    const events = g.playerAct('me', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['playerSurrendered', 'gameOver']);
    expect(gameOver(g)).toMatchObject({
      reason: 'practiceEnded',
      t: 2000,
      durationMs: 2000,
      ratingChanges: [],
    });
    expect(places(g)).toEqual({ bot: 1, me: 2 });
    expect(result(g).ratingChanges).toEqual([]);
  });

  it('against a bot: the bot leaving is not the end of practice; the human is the last one standing', () => {
    const g = GameDriver.of({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] });
    g.solve('bot', 'A1', 1000); // the bot was ahead
    const events = g.playerAct('bot', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['playerSurrendered', 'gameOver']);
    expect(result(g)).toMatchObject({ reason: 'lastPlayerStanding', ratingChanges: [] });
    expect(places(g)).toEqual({ me: 1, bot: 2 });
  });

  it('solo: "end practice" ends the game at once, even with no move made', () => {
    const g = GameDriver.of({ players: 1 });
    expect(g.types(g.playerAct('p1', { type: 'surrender' }, 700))).toEqual(['playerSurrendered', 'gameOver']);
    expect(result(g)).toMatchObject({
      reason: 'practiceEnded',
      durationMs: 700,
      awards: [],
      ratingChanges: [],
    });
    expect(g.state.status).toBe('over');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('surrender ranking, the [D36] alternative: whoever surrenders stays in the table by score', () => {
  /**
   * 4 players: p1 (4.5) surrenders first; p2 (1.5) disconnects and abandons at the end of its grace period; p3 ends
   * on 0.5 (one mistake) and p4 on 6, still in the game when the board is full.
   */
  function play(surrenderRanking: 'exitOrder' | 'byScore') {
    const g = near({
      players: rated([1200, 10], [1200, 10], [1200, 10], [1200, 10]),
      rules: { surrenderRanking },
    });
    solveEach(g, 'p1', ['A1', 'B7', 'C4']); // 4.5
    g.playerAct('p1', { type: 'surrender' }, 1000);
    g.solve('p2', 'D2', 2000); // 1.5
    g.act({ type: 'disconnect', playerId: 'p2' }, 2000); // 3 still in the game: no freeze; grace until 17000
    err(g, 'p3', 'E5', 3000); // −1
    solveEach(g, 'p3', ['E5']); // +1.5 → 0.5, at 4000 (after the re-lock wait)
    g.solve('p4', 'F8', 5000);
    g.solve('p4', 'G3');
    g.solve('p4', 'H9');
    expect(g.types(g.tickTo(17000))).toEqual(['playerAbandoned']);
    g.solve('p4', 'I6', 18000); // 6, and the board is full
    expect(result(g).reason).toBe('boardComplete');
    return g;
  }
  const table = (g: GameDriver) => result(g).ranking.map((r) => [r.playerId, r.place, r.score, r.status]);

  it('is not the default: by default those who left rank last, by the order of leaving', () => {
    expect(makeConfig().rules.surrenderRanking).toBe('exitOrder');
    expect(table(play('exitOrder'))).toEqual([
      ['p4', 1, 6, 'active'],
      ['p3', 2, 0.5, 'active'],
      ['p2', 3, 1.5, 'abandoned'],
      ['p1', 4, 4.5, 'surrendered'],
    ]);
  });

  it('byScore: a surrendered player keeps a place by score, above active players with less; abandonment is still last', () => {
    const g = play('byScore');
    expect(table(g)).toEqual([
      ['p4', 1, 6, 'active'],
      ['p1', 2, 4.5, 'surrendered'],
      ['p3', 3, 0.5, 'active'],
      ['p2', 4, 1.5, 'abandoned'],
    ]);
    // The rating follows these places [D32]: K_pair = 32 / 3 between equal ratings.
    expect(Object.fromEntries(result(g).ratingChanges.map((c) => [c.playerId, c.delta]))).toEqual({
      p4: 16,
      p1: 5,
      p3: -5,
      p2: -16,
    });
    // The cards showed the same places, and only a player still in the game can be the leader.
    expect(g.view('p3').players.map((p) => [p.id, p.place, p.isLeader])).toEqual([
      ['p1', 2, false],
      ['p2', 4, false],
      ['p3', 3, false],
      ['p4', 1, true],
    ]);
  });

  it('byScore: equal scores of a surrendered and an active player follow the tie-break [D16]', () => {
    const g = near({ players: 3, rules: { surrenderRanking: 'byScore' } });
    solveEach(g, 'p1', ['A1', 'B7', 'C4']); // 4.5, no mistakes
    g.playerAct('p1', { type: 'surrender' }, 1000);
    err(g, 'p2', 'D2', 2000);
    err(g, 'p2', 'D2'); // −3
    solveEach(g, 'p2', ['D2', 'E5', 'F8', 'G3', 'H9']); // +7.5 → 4.5, two mistakes
    solveEach(g, 'p3', ['I6']); // 1.5
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score, r.mistakes, r.status])).toEqual([
      ['p1', 1, 4.5, 0, 'surrendered'],
      ['p2', 2, 4.5, 2, 'active'],
      ['p3', 3, 1.5, 0, 'active'],
    ]);
  });

  // D36 is about 3–4 players only: with 2, the one who surrenders loses even when ahead.
  it('byScore is for 3–4 players: in a 2-player game a surrender is still an immediate loss (§6.6) [D8, D36]', () => {
    const g = GameDriver.of({
      players: rated([1287, 10], [1305, 10]),
      rules: { surrenderRanking: 'byScore' },
    });
    g.solve('p1', 'A1', 1000); // p1 leads 8 – 0
    g.playerAct('p1', { type: 'surrender' }, 2000);
    expect(result(g).reason).toBe('lastPlayerStanding');
    expect(places(g)).toEqual({ p2: 1, p1: 2 });
    // 1305 beats 1287: E = 0.526, so +15 (the spec's +17 is the lower-rated player's win).
    expect(change(g, 'p2')).toMatchObject({ delta: 15 });
    expect(change(g, 'p1')).toMatchObject({ delta: -15 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('end of game (§6.7)', () => {
  it('ends when the last cell is filled: two players taking turns over the whole board', () => {
    const g = GameDriver.of();
    let last: GameEvent[] = [];
    EMPTY.forEach((cell, k) => {
      last = g.solve(k % 2 === 0 ? 'p1' : 'p2', cellNameOf(cell), 1000 * (k + 1));
    });
    const end = 1000 * EMPTY.length;
    expect(g.types(last)).toEqual(['cellLocked', 'placedCorrect', 'gameOver']);
    // The last cell of a board is always worth 1.5 (spec §6.4).
    expect(last[1]).toMatchObject({ points: 1.5, breakdown: { row: 8, col: 8, box: 8, num: 8, X: 8, Y: 8 } });
    expect(last[2]).toMatchObject({ reason: 'boardComplete', t: end, durationMs: end });
    expect(g.state.grid.join('')).toBe(PUZZLE.solution);
    expect(g.state).toMatchObject({ status: 'over', endedAt: end });

    const [first, second] = result(g).ranking;
    expect(first!.score).toBeGreaterThan(second!.score);
    expect([first!.place, second!.place]).toEqual([1, 2]);
    expect(g.player('p1').correct + g.player('p2').correct).toBe(EMPTY.length);
    expect(result(g).ranking.find((r) => r.playerId === 'p1')!.correct).toBe(Math.ceil(EMPTY.length / 2));
    expect(result(g).ranking.find((r) => r.playerId === 'p2')!.correct).toBe(Math.floor(EMPTY.length / 2));
    expect(g.replayMatches()).toBe(true);
  });

  it('ends when one player solves the rest (solveAll)', () => {
    const g = GameDriver.of();
    g.solve('p2', 'B4', 1000); // 9: the best opening move
    solveAll(g, 'p1');
    expect(result(g).reason).toBe('boardComplete');
    expect(g.player('p1').correct).toBe(EMPTY.length - 1);
    expect(order(g)).toEqual(['p1', 'p2']);
  });

  it('solo: a full board ends the practice as boardComplete, with no awards', () => {
    const g = near({ players: 1 });
    solveEach(g, 'p1', T);
    expect(result(g)).toMatchObject({ reason: 'boardComplete', awards: [], ratingChanges: [] });
    expect(result(g).ranking).toEqual([
      { playerId: 'p1', seat: 0, place: 1, score: 13.5, mistakes: 0, correct: 9, status: 'active' },
    ]);
  });

  it('the gameOver event carries the result, which is also in the state', () => {
    const g = near();
    solveEach(g, 'p1', T.slice(0, 5));
    solveEach(g, 'p2', T.slice(5));
    const { type, seq, t, ...body } = gameOver(g);
    expect(type).toBe('gameOver');
    expect(seq).toBe(g.state.seq);
    expect(t).toBe(g.state.endedAt);
    expect(body).toEqual(g.state.result);
    expect(Object.keys(body).sort()).toEqual([
      'awards',
      'durationMs',
      'ranking',
      'ratingChanges',
      'reason',
      'stats',
    ]);
  });

  it('after gameOver every action is refused (gameOver) and the timers are gone', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // until 6000
    g.select('p2', 'A2', 1000); // stopped under the interference
    g.select('p1', 'A5', 1500); // expires at 9500
    g.playerAct('p2', { type: 'surrender' }, 2000);
    expect(g.state.status).toBe('over');
    // Nothing runs any more: the locks, and the interference that still had 4 seconds to go.
    expect(g.state.locks).toEqual([]);
    expect(g.state.players.map((p) => p.hitBy)).toEqual([null, null]);

    const A6 = parseCellName('A6');
    const refused = [
      g.reject({ type: 'select', playerId: 'p1', cell: A6 }),
      g.reject({ type: 'release', playerId: 'p1' }),
      g.reject({ type: 'place', playerId: 'p1', cell: parseCellName('A5'), digit: answer('A5') }),
      g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'warp' }),
      g.reject({ type: 'react', playerId: 'p1', emoji: '😎' }),
      g.reject({ type: 'surrender', playerId: 'p1' }),
      g.reject({ type: 'surrender', playerId: 'p2' }),
      g.reject({ type: 'start' }),
      g.reject({ type: 'disconnect', playerId: 'p1' }),
      g.reject({ type: 'reconnect', playerId: 'p2' }),
    ];
    expect(new Set(refused)).toEqual(new Set(['gameOver']));

    expect(g.deadline).toBeNull();
    const before = g.state;
    expect(g.tickTo(6000)).toEqual([]);
    expect(g.tickTo(100000)).toEqual([]);
    expect(g.state).toBe(before);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A6 }, 200000)).toBe('gameOver');
  });

  it('durationMs runs from the start, not from the creation of the game', () => {
    const g = new GameDriver(makeConfig(), { start: false, at: 0 });
    g.act({ type: 'start' }, 2000);
    g.solve('p1', 'A1', 30000);
    g.playerAct('p2', { type: 'surrender' }, 62000);
    expect(g.state).toMatchObject({ createdAt: 0, startedAt: 2000, endedAt: 62000 });
    expect(result(g).durationMs).toBe(60000);
  });

  it('durationMs is the wall time between start and end (a freeze inside counts)', () => {
    const g = GameDriver.of();
    g.act({ type: 'disconnect', playerId: 'p2' }, 10000);
    expect(g.types(g.act({ type: 'reconnect', playerId: 'p2' }, 15000))).toEqual([
      'playerReconnected',
      'gameResumed',
    ]);
    g.playerAct('p1', { type: 'surrender' }, 20000);
    expect(result(g).durationMs).toBe(20000);
  });

  it('2 players: an abandonment ends the game when the grace period runs out; the one who stayed wins', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 500); // the leaver was ahead
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    expect(g.deadline).toBe(16000);
    expect(g.tickTo(15999)).toEqual([]);
    const events = g.tickTo(16000);
    expect(g.types(events)).toEqual(['playerAbandoned', 'gameOver']);
    expect(gameOver(g)).toMatchObject({ reason: 'lastPlayerStanding', t: 16000, durationMs: 16000 });
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p1', 1, 'active'],
      ['p2', 2, 'abandoned'],
    ]);
  });

  it('3–4 players: a player who abandons leaves at the end of the grace period, not at the disconnect', () => {
    const g = GameDriver.of({ players: 4 });
    g.act({ type: 'disconnect', playerId: 'p1' }, 0); // grace until 15000
    g.playerAct('p2', { type: 'surrender' }, 10000); // out first
    expect(g.types(g.tickTo(15000))).toEqual(['playerAbandoned']); // out second
    expect(g.state.status).toBe('running');
    g.playerAct('p3', { type: 'surrender' }, 16000); // out third: only p4 is left
    expect(result(g).reason).toBe('lastPlayerStanding');
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p4', 1, 'active'],
      ['p3', 2, 'surrendered'],
      ['p1', 3, 'abandoned'],
      ['p2', 4, 'surrendered'],
    ]);
  });

  it('3–4 players: the abandonment counts at the grace end even when nothing ticked until later', () => {
    const g = GameDriver.of({ players: 4 });
    g.act({ type: 'disconnect', playerId: 'p1' }, 0); // grace until 15000
    const events = g.playerAct('p2', { type: 'surrender' }, 20000);
    expect(g.types(events)).toEqual(['playerAbandoned', 'playerSurrendered']);
    expect(events[0]!.t).toBe(15000);
    g.playerAct('p3', { type: 'surrender' }, 21000);
    expect(order(g)).toEqual(['p4', 'p3', 'p2', 'p1']);
    expect(Object.values(places(g))).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('ranking (§6.7) [D16]', () => {
  it('by score, highest first', () => {
    const g = near({ players: 3 });
    solveEach(g, 'p2', ['A1', 'B7']); // 3
    solveEach(g, 'p3', ['C4', 'D2', 'E5', 'F8']); // 6
    solveEach(g, 'p1', ['G3', 'H9', 'I6']); // 4.5
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score])).toEqual([
      ['p3', 1, 6],
      ['p1', 2, 4.5],
      ['p2', 3, 3],
    ]);
  });

  it('scores may be negative and still rank by score [D15]', () => {
    const g = near({ players: 3 });
    err(g, 'p1', 'A1');
    err(g, 'p1', 'A1'); // −3
    err(g, 'p2', 'B7'); // −1
    solveEach(g, 'p3', T); // 13.5
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score, r.mistakes])).toEqual([
      ['p3', 1, 13.5, 0],
      ['p2', 2, -1, 1],
      ['p1', 3, -3, 2],
    ]);
  });

  it('equal score: fewer mistakes ranks higher [D16]', () => {
    const g = near({ players: 3 });
    err(g, 'p1', 'A1');
    err(g, 'p1', 'A1'); // −1 −2
    solveEach(g, 'p1', ['A1', 'B7', 'C4', 'D2']); // +6 → 3
    solveEach(g, 'p2', ['E5', 'F8']); // 3, no mistakes
    solveEach(g, 'p3', ['G3', 'H9', 'I6']); // 4.5
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score, r.mistakes])).toEqual([
      ['p3', 1, 4.5, 0],
      ['p2', 2, 3, 0],
      ['p1', 3, 3, 2],
    ]);
  });

  it('equal score and mistakes: a shared place, and the next place is skipped (1, 1, 3) [D16]', () => {
    const g = near({ players: 3 });
    err(g, 'p3', 'A1'); // −1
    solveEach(g, 'p1', ['A1', 'B7', 'C4']); // 4.5
    solveEach(g, 'p2', ['D2', 'E5', 'F8']); // 4.5
    solveEach(g, 'p3', ['G3', 'H9', 'I6']); // 4.5 − 1 = 3.5
    expect(places(g)).toEqual({ p1: 1, p2: 1, p3: 3 });
    expect(result(g).ranking.map((r) => r.score)).toEqual([4.5, 4.5, 3.5]);
  });

  it('a shared place lower down: 1, 2, 2, 4 in a 4-player game [D16]', () => {
    const g = near({ players: 4 });
    err(g, 'p4', 'A1'); // −1
    solveEach(g, 'p1', ['A1', 'B7', 'C4']); // 4.5
    solveEach(g, 'p2', ['D2', 'E5']); // 3
    solveEach(g, 'p3', ['F8', 'G3']); // 3
    solveEach(g, 'p4', ['H9', 'I6']); // 3 − 1 = 2
    expect(places(g)).toEqual({ p1: 1, p2: 2, p3: 2, p4: 4 });
  });

  it('everyone equal: everyone is 1st', () => {
    const g = near({ players: 3 });
    solveEach(g, 'p1', ['A1', 'B7', 'C4']);
    solveEach(g, 'p2', ['D2', 'E5', 'F8']);
    solveEach(g, 'p3', ['G3', 'H9', 'I6']);
    expect(places(g)).toEqual({ p1: 1, p2: 1, p3: 1 });
  });

  describe('the alternative tie-break: whoever made their last correct move earlier [D16 = earlierLastMove]', () => {
    const play = (tieBreak: 'fewerMistakes' | 'earlierLastMove') => {
      const g = near({ players: 3, rules: { tieBreak } });
      g.solve('p3', 'A1', 1000);
      g.solve('p3', 'B7', 2000);
      g.solve('p3', 'C4', 3000);
      g.solve('p1', 'D2', 4000);
      g.solve('p1', 'E5', 5000);
      g.solve('p1', 'F8', 6000);
      g.solve('p2', 'G3', 7000);
      g.solve('p2', 'H9', 8000);
      g.solve('p2', 'I6', 9000);
      return g;
    };

    it('equal scores are ordered by the time of the last correct move', () => {
      const g = play('earlierLastMove');
      expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score])).toEqual([
        ['p3', 1, 4.5],
        ['p1', 2, 4.5],
        ['p2', 3, 4.5],
      ]);
      // The same game with the default rule: everyone shares 1st.
      expect(places(play('fewerMistakes'))).toEqual({ p1: 1, p2: 1, p3: 1 });
    });

    it('mistakes do not matter under it', () => {
      const run = (tieBreak: 'fewerMistakes' | 'earlierLastMove') => {
        const g = near({ players: 3, rules: { tieBreak } });
        err(g, 'p1', 'A1', 1000);
        err(g, 'p1', 'A1', 2000); // −3
        g.solve('p1', 'A1', 3000); // after the re-lock wait (§6.2.6)
        g.solve('p1', 'B7');
        g.solve('p1', 'C4');
        g.solve('p1', 'D2'); // 3, last move at 3000
        g.solve('p3', 'E5', 4000);
        g.solve('p3', 'F8');
        g.solve('p3', 'G3'); // 4.5
        g.solve('p2', 'H9', 5000);
        g.solve('p2', 'I6', 6000); // 3, last move at 6000
        return order(g);
      };
      expect(run('earlierLastMove')).toEqual(['p3', 'p1', 'p2']);
      expect(run('fewerMistakes')).toEqual(['p3', 'p2', 'p1']);
    });

    it('last moves at the same moment: a shared place', () => {
      const g = near({ players: 3, rules: { tieBreak: 'earlierLastMove' } }, T8);
      g.solve('p1', 'A1', 1000);
      g.solve('p2', 'B7', 1000);
      g.select('p1', 'C4', 2000);
      g.select('p2', 'D2', 2000);
      g.place('p1', 'C4', answer('C4'), 3000);
      g.place('p2', 'D2', answer('D2'), 3000); // both 3, both last at 3000
      solveEach(g, 'p3', ['E5', 'F8', 'G3', 'H9']); // 6
      expect(places(g)).toEqual({ p3: 1, p1: 2, p2: 2 });
    });

    it('with no correct move at all, a player ranks after one who has a last move, on equal score', () => {
      const g = near({ players: 3, rules: { tieBreak: 'earlierLastMove' } });
      err(g, 'p2', 'A1', 1000);
      err(g, 'p2', 'A1', 2000); // −3
      g.solve('p2', 'A1', 3000); // after the re-lock wait (§6.2.6)
      g.solve('p2', 'B7'); // 0, with a last move
      solveEach(g, 'p3', ['C4', 'D2', 'E5', 'F8', 'G3', 'H9', 'I6']); // 10.5
      // p1: 0, no move at all
      expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score])).toEqual([
        ['p3', 1, 10.5],
        ['p2', 2, 0],
        ['p1', 3, 0],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('awards (§12)', () => {
  it('best move: the highest single move, not the highest total; with its cell and score line', () => {
    const g = GameDriver.of();
    g.solve('p2', 'B4'); // row 3, col 3, box 3, num 3 → 9 − 3 + (9 − 3)/2 = 9
    solveAll(g, 'p1'); // many moves, none worth 9
    expect(award(g, 'bestMove')).toEqual({ kind: 'bestMove', playerIds: ['p2'], value: 9 });
    const p2 = result(g).stats.find((s) => s.playerId === 'p2')!;
    expect(p2.bestMove).toEqual({
      cell: parseCellName('B4'),
      digit: 8,
      points: 9,
      breakdown: { row: 3, col: 3, box: 3, num: 3, X: 3, Y: 3, points: 9 },
    });
    expect(result(g).stats.find((s) => s.playerId === 'p1')!.bestMove!.points).toBeLessThan(9);
    // …while the most points went to the other player.
    expect(award(g, 'mostPoints')!.playerIds).toEqual(['p1']);
  });

  it('best move: a tie is shared', () => {
    const g = near();
    solveEach(g, 'p1', T.slice(0, 5));
    solveEach(g, 'p2', T.slice(5));
    expect(award(g, 'bestMove')).toEqual({ kind: 'bestMove', playerIds: ['p1', 'p2'], value: 1.5 });
  });

  it('fewest mistakes: the fewest; equal → the higher score', () => {
    const g = near({ players: 3 });
    err(g, 'p3', 'A1'); // −1
    solveEach(g, 'p1', ['A1', 'B7']); // 3, no mistakes
    solveEach(g, 'p2', ['C4', 'D2', 'E5', 'F8']); // 6, no mistakes
    solveEach(g, 'p3', ['G3', 'H9', 'I6']); // 3.5
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p2'], value: 0 });
  });

  it('fewest mistakes: equal mistakes and score → shared', () => {
    const g = near({ players: 3 });
    err(g, 'p3', 'A1'); // −1
    solveEach(g, 'p1', ['A1', 'B7', 'C4', 'D2']); // 6
    solveEach(g, 'p2', ['E5', 'F8', 'G3', 'H9']); // 6
    g.solve('p3', 'I6'); // 0.5
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p1', 'p2'], value: 0 });
  });

  it('fewest mistakes when nobody is perfect: the value is the number of mistakes', () => {
    const g = near();
    err(g, 'p1', 'A1'); // −1
    err(g, 'p2', 'B7');
    err(g, 'p2', 'B7'); // −3
    solveEach(g, 'p2', T.slice(0, 5)); // 7.5 − 3 = 4.5
    solveEach(g, 'p1', T.slice(5)); // 6 − 1 = 5
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p1'], value: 1 });
  });

  it('fastest: the lowest average think time of correct moves', () => {
    const g = near({}, T10);
    for (const [cell, ms] of [
      ['A1', 1000],
      ['B7', 2000],
      ['C4', 3000],
      ['D2', 1000],
      ['E5', 3000],
    ] as const)
      solveIn(g, 'p1', cell, ms); // average 2000
    for (const cell of ['F8', 'G3', 'H9', 'I6', 'A2']) solveIn(g, 'p2', cell, 2500); // average 2500
    expect(award(g, 'fastest')).toEqual({ kind: 'fastest', playerIds: ['p1'], value: 2000 });
    expect(result(g).stats.map((s) => [s.playerId, s.correct, s.avgThinkMs])).toEqual([
      ['p1', 5, 2000],
      ['p2', 5, 2500],
    ]);
  });

  it('fastest: only with at least 5 correct moves', () => {
    const g = near();
    for (const cell of T.slice(0, 5)) solveIn(g, 'p1', cell, 3000);
    for (const cell of T.slice(5)) solveIn(g, 'p2', cell, 100); // 4 moves: much faster, but too few
    expect(award(g, 'fastest')).toEqual({ kind: 'fastest', playerIds: ['p1'], value: 3000 });
  });

  it('fastest: nobody has 5 correct moves → no award', () => {
    const g = near({}, T8);
    for (const cell of T8.slice(0, 4)) solveIn(g, 'p1', cell, 1000);
    for (const cell of T8.slice(4)) solveIn(g, 'p2', cell, 2000);
    expect(result(g).stats.map((s) => s.avgThinkMs)).toEqual([1000, 2000]);
    expect(award(g, 'fastest')).toBeUndefined();
  });

  it('fewest mistakes: only players still in the game at the end; leaving early never wins it', () => {
    const g = near({ players: 3 });
    g.solve('p1', 'A1', 0); // 1.5, no mistakes
    g.playerAct('p1', { type: 'surrender' }, 500);
    err(g, 'p2', 'B7', 1000); // −1
    err(g, 'p3', 'C4', 1000);
    err(g, 'p3', 'C4'); // −3
    solveEach(g, 'p2', ['B7', 'C4', 'D2', 'E5']); // +6 → 5
    solveEach(g, 'p3', ['F8', 'G3', 'H9', 'I6']); // +6 → 3
    expect(result(g).reason).toBe('boardComplete');
    expect(result(g).stats.find((s) => s.playerId === 'p1')!.mistakes).toBe(0);
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p2'], value: 1 });
  });

  it('fewest mistakes: an abandonment does not win it either', () => {
    const g = GameDriver.of();
    g.miss('p1', 'A1', 0); // −1
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000); // no mistakes, and gone at 16000
    g.tickTo(16000);
    expect(result(g).reason).toBe('lastPlayerStanding');
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p1'], value: 1 });
  });

  it('fastest: only players still in the game at the end, however quick the one who left was', () => {
    const g = near({ players: 3 }, T10);
    for (const cell of ['A1', 'B7', 'C4', 'D2', 'E5']) solveIn(g, 'p1', cell, 100); // 5 moves, 100 ms each
    g.playerAct('p1', { type: 'surrender' });
    for (const cell of ['F8', 'G3', 'H9', 'I6', 'A2']) solveIn(g, 'p2', cell, 2500); // 5 moves, 2500 ms each
    expect(result(g).reason).toBe('boardComplete');
    expect(result(g).stats.map((s) => [s.playerId, s.correct, s.avgThinkMs])).toEqual([
      ['p1', 5, 100],
      ['p2', 5, 2500],
      ['p3', 0, null],
    ]);
    expect(award(g, 'fastest')).toEqual({ kind: 'fastest', playerIds: ['p2'], value: 2500 });
  });

  it('best move and most points still count the moves of a player who left: they stay on the board (§6.6)', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'B4', 1000); // 9: the best opening move
    g.playerAct('p1', { type: 'surrender' }, 2000);
    solveAll(g, 'p2');
    expect(award(g, 'bestMove')).toEqual({ kind: 'bestMove', playerIds: ['p1'], value: 9 });
    expect(award(g, 'mostPoints')!.playerIds).toEqual(['p2']);
  });

  it('comeback: the winner had trailed by 15 or more (exactly 15 counts)', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1'); // 8
    // Each try a second after the last: the re-lock wait after a mistake (§6.2.6).
    g.miss('p2', 'A2', 1000);
    g.miss('p2', 'A2', 2000);
    g.miss('p2', 'A2', 3000); // −1 −2 −4 = −7: 15 behind
    expect(g.player('p2').maxDeficit).toBe(15);
    g.advance(1000);
    solveAll(g, 'p2');
    expect(order(g)).toEqual(['p2', 'p1']);
    expect(award(g, 'comeback')).toEqual({ kind: 'comeback', playerIds: ['p2'], value: 15 });
  });

  it('comeback: 14.5 behind is not enough', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1'); // 8
    g.solve('p1', 'A2'); // 6.5 → 14.5
    solveAll(g, 'p2');
    expect(g.player('p2').maxDeficit).toBe(14.5);
    expect(order(g)).toEqual(['p2', 'p1']);
    expect(award(g, 'comeback')).toBeUndefined();
  });

  it('comeback: only for the winner; trailing by 15 and losing gets nothing', () => {
    const g = GameDriver.of();
    for (let k = 0; k < 4; k++) g.miss('p1', 'A1', 1000 * k); // −1 −2 −4 −8 = −15, a second apart
    expect(g.player('p1').maxDeficit).toBe(15);
    solveAll(g, 'p2');
    expect(order(g)).toEqual(['p2', 'p1']);
    expect(award(g, 'comeback')).toBeUndefined();
  });

  it('comeback: the gap counts only against players still in the game, and only for them (§12)', () => {
    /** 3 players: p1 leads 8 – 0 – 0, then maybe leaves; p2 drops to −7 and then solves the rest. */
    const play = (p1Leaves: boolean) => {
      const g = GameDriver.of({ players: 3 });
      g.solve('p1', 'A1', 0); // 8
      if (p1Leaves) g.playerAct('p1', { type: 'surrender' }, 500);
      g.miss('p2', 'A2', 1000);
      g.miss('p2', 'A2', 2000);
      g.miss('p2', 'A2', 3000); // −7
      g.advance(1000);
      solveAll(g, 'p2');
      return g;
    };

    // p1 still in the game: p2 was 15 behind it, and the win is a comeback.
    const stayed = play(false);
    expect(stayed.player('p2').maxDeficit).toBe(15);
    expect(order(stayed)[0]).toBe('p2');
    expect(award(stayed, 'comeback')).toEqual({ kind: 'comeback', playerIds: ['p2'], value: 15 });

    // p1 gone: p2's −7 is measured against p3 (0) only, so the largest gap stays the 8 from before p1 left.
    const left = play(true);
    expect(left.player('p2').maxDeficit).toBe(8);
    expect(order(left)).toEqual(['p2', 'p3', 'p1']);
    expect(award(left, 'comeback')).toBeUndefined();
    // …and a player who left is no longer tracked: p1 never trailed while it was in the game.
    expect(left.player('p1').maxDeficit).toBe(0);
    expect(left.player('p3').maxDeficit).toBeGreaterThan(15);
  });

  it('most points: the sum of correct moves before penalties and interference costs', () => {
    const g = near();
    err(g, 'p1', 'A1');
    err(g, 'p1', 'A1');
    err(g, 'p1', 'A1'); // −7
    solveEach(g, 'p1', T.slice(0, 6)); // +9 → 2
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'fireworks' }); // −2 → 0
    solveEach(g, 'p2', T.slice(6)); // 4.5
    expect(result(g).ranking.map((r) => [r.playerId, r.place, r.score])).toEqual([
      ['p2', 1, 4.5],
      ['p1', 2, 0],
    ]);
    expect(award(g, 'mostPoints')).toEqual({ kind: 'mostPoints', playerIds: ['p1'], value: 9 });
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p2'], value: 0 });
    expect(result(g).stats.find((s) => s.playerId === 'p1')).toMatchObject({
      correct: 6,
      mistakes: 3,
      pointsGained: 9,
      interferencesSent: 1,
    });
  });

  it('most points: a tie is shared', () => {
    const g = near({}, T8);
    solveEach(g, 'p1', T8.slice(0, 4));
    solveEach(g, 'p2', T8.slice(4));
    expect(award(g, 'mostPoints')).toEqual({ kind: 'mostPoints', playerIds: ['p1', 'p2'], value: 6 });
  });

  it('no correct move in the game → no best move, most points, fastest or comeback', () => {
    const g = GameDriver.of();
    g.playerAct('p1', { type: 'surrender' });
    const kinds = result(g).awards.map((a) => a.kind);
    for (const k of ['bestMove', 'mostPoints', 'fastest', 'comeback'] as const)
      expect(kinds).not.toContain(k);
    // Fewest mistakes goes to whoever is still in the game.
    expect(result(g).awards).toEqual([{ kind: 'fewestMistakes', playerIds: ['p2'], value: 0 }]);
  });

  it('solo has no awards; a game against a bot has them', () => {
    const solo = near({ players: 1 });
    for (const cell of T) solveIn(solo, 'p1', cell, 1000);
    expect(result(solo).awards).toEqual([]);

    const bot = near({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] });
    solveEach(bot, 'me', T.slice(0, 5));
    solveEach(bot, 'bot', T.slice(5));
    expect(award(bot, 'bestMove')).toEqual({ kind: 'bestMove', playerIds: ['me', 'bot'], value: 1.5 });
    expect(award(bot, 'mostPoints')).toEqual({ kind: 'mostPoints', playerIds: ['me'], value: 7.5 });
    expect(award(bot, 'fastest')).toEqual({ kind: 'fastest', playerIds: ['me'], value: 0 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('rating changes (§11.2) [D7, D8]', () => {
  /** p1 wins 7.5 – 6 on T, or loses 6 – 7.5. */
  function twoPlayerGame(players: PlayerInfo[], p1Wins: boolean, extra: Partial<ConfigOptions> = {}) {
    const g = near({ players, ...extra });
    solveEach(g, 'p1', T.slice(0, p1Wins ? 5 : 4));
    solveEach(g, 'p2', T.slice(p1Wins ? 5 : 4));
    return g;
  }

  it('the spec example: E(1287 vs 1305) = 0.474', () => {
    expect(expectedScore(1287, 1305)).toBeCloseTo(0.474, 3);
  });

  it('the spec example in a real game: 1287 beats 1305 → +17 (and the loser −17, K = 32)', () => {
    const g = twoPlayerGame(rated([1287, 10], [1305, 30]), true);
    expect(order(g)).toEqual(['p1', 'p2']);
    expect(change(g, 'p1')).toEqual({
      playerId: 'p1',
      before: 1287,
      after: 1304,
      delta: 17,
      provisional: false,
    });
    expect(change(g, 'p2')).toEqual({
      playerId: 'p2',
      before: 1305,
      after: 1288,
      delta: -17,
      provisional: false,
    });
    expect(gameOver(g).ratingChanges).toEqual(result(g).ratingChanges);
  });

  it('the spec example in a real game: 1287 loses to 1305 → −15 (and the winner +15)', () => {
    const g = twoPlayerGame(rated([1287, 10], [1305, 30]), false);
    expect(order(g)).toEqual(['p2', 'p1']);
    expect(change(g, 'p1')).toMatchObject({ before: 1287, after: 1272, delta: -15, provisional: false });
    expect(change(g, 'p2')).toMatchObject({ before: 1305, after: 1320, delta: 15, provisional: false });
  });

  it('provisional (fewer than 10 rated games in the key): K is doubled → +34 or −30, for that player only', () => {
    const win = twoPlayerGame(rated([1287, 9], [1305, 10]), true);
    expect(change(win, 'p1')).toMatchObject({ delta: 34, after: 1321, provisional: true });
    expect(change(win, 'p2')).toMatchObject({ delta: -17, provisional: false });
    const loss = twoPlayerGame(rated([1287, 9], [1305, 10]), false);
    expect(change(loss, 'p1')).toMatchObject({ delta: -30, after: 1257, provisional: true });
    expect(change(loss, 'p2')).toMatchObject({ delta: 15, provisional: false });
  });

  it('no count of rated games means a new player: provisional', () => {
    const g = twoPlayerGame(rated([1287, undefined], [1305, undefined]), true);
    expect(change(g, 'p1')).toMatchObject({ delta: 34, provisional: true });
    expect(change(g, 'p2')).toMatchObject({ delta: -34, provisional: true });
  });

  it('a shared place is a draw (S = 0.5)', () => {
    const g = near({ players: rated([1287, 10], [1305, 10]) }, T8);
    solveEach(g, 'p1', T8.slice(0, 4));
    solveEach(g, 'p2', T8.slice(4));
    expect(places(g)).toEqual({ p1: 1, p2: 1 });
    expect(change(g, 'p1')).toMatchObject({ delta: 1, after: 1288 });
    expect(change(g, 'p2')).toMatchObject({ delta: -1, after: 1304 });

    const even = near({ players: rated([1200, 10], [1200, 10]) }, T8);
    solveEach(even, 'p1', T8.slice(0, 4));
    solveEach(even, 'p2', T8.slice(4));
    expect(result(even).ratingChanges.map((c) => c.delta)).toEqual([0, 0]);
  });

  it('2 players: a win by surrender is a full win [D8]', () => {
    const g = GameDriver.of({ players: rated([1287, 10], [1305, 10]) });
    g.solve('p2', 'A1');
    g.playerAct('p2', { type: 'surrender' });
    expect(change(g, 'p1')).toMatchObject({ delta: 17 });
    expect(change(g, 'p2')).toMatchObject({ delta: -17 });
  });

  it('2 players: a win by abandonment is a full win [D8]', () => {
    const g = GameDriver.of({ players: rated([1287, 10], [1305, 10]) });
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    g.tickTo(16000);
    expect(result(g).ranking.find((r) => r.playerId === 'p2')!.status).toBe('abandoned');
    expect(change(g, 'p1')).toMatchObject({ delta: 17 });
    expect(change(g, 'p2')).toMatchObject({ delta: -17 });
  });

  it('3 players: K_pair = 32 / 2 → +16, 0, −16 between equal ratings', () => {
    const g = near({ players: rated([1200, 10], [1200, 10], [1200, 10]) });
    solveEach(g, 'p1', T.slice(0, 4)); // 6
    solveEach(g, 'p2', T.slice(4, 7)); // 4.5
    solveEach(g, 'p3', T.slice(7)); // 3
    expect(result(g).ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p1', 16],
      ['p2', 0],
      ['p3', -16],
    ]);
  });

  it('3 players with a shared 1st: +8, +8, −16', () => {
    const g = near({ players: rated([1200, 10], [1200, 10], [1200, 10]) });
    err(g, 'p3', 'A1'); // −1
    solveEach(g, 'p1', T.slice(0, 3));
    solveEach(g, 'p2', T.slice(3, 6));
    solveEach(g, 'p3', T.slice(6));
    expect(places(g)).toEqual({ p1: 1, p2: 1, p3: 3 });
    expect(Object.fromEntries(result(g).ratingChanges.map((c) => [c.playerId, c.delta]))).toEqual({
      p1: 8,
      p2: 8,
      p3: -16,
    });
  });

  it('4 players: K_pair = 32 / 3 → +16, +5, −5, −16 between equal ratings', () => {
    const g = near({ players: rated([1200, 10], [1200, 10], [1200, 10], [1200, 10]) });
    solveEach(g, 'p1', T.slice(0, 4)); // 6
    solveEach(g, 'p2', T.slice(4, 7)); // 4.5
    solveEach(g, 'p3', T.slice(7)); // 3; p4: 0
    expect(result(g).ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p1', 16],
      ['p2', 5],
      ['p3', -5],
      ['p4', -16],
    ]);
  });

  it('ratingPairs: each change split by opponent (Results-4P), adding up to it; none in practice', () => {
    const g = near({ players: rated([1318, 10], [1287, 10], [1271, 10], [1305, 10]) });
    solveEach(g, 'p2', T.slice(0, 4)); // 6
    solveEach(g, 'p1', T.slice(4, 7)); // 4.5
    solveEach(g, 'p3', T.slice(7)); // 3; p4: 0
    const r = result(g);
    expect(r.ranking.map((x) => x.playerId)).toEqual(['p2', 'p1', 'p3', 'p4']);
    expect(r.ratingPairs).toHaveLength(4);
    for (const split of r.ratingPairs!) {
      const sum = split.pairs.reduce((a, p) => a + p.delta * 10, 0) / 10;
      expect([split.playerId, Math.round(sum * 10) / 10 - split.penalty]).toEqual([
        split.playerId,
        change(g, split.playerId)!.delta,
      ]);
    }
    // 1st of 4 at 1287, a win against each (by place): exactly 5.81 + 5.09 + 5.61 = 16.51 → +17, the 0.49
    // over the tenths handed out where most owed.
    expect(r.ratingPairs!.find((p) => p.playerId === 'p2')).toEqual({
      playerId: 'p2',
      pairs: [
        { opponentId: 'p1', delta: 6 },
        { opponentId: 'p3', delta: 5.2 },
        { opponentId: 'p4', delta: 5.8 },
      ],
      penalty: 0,
    });
    expect(gameOver(g).ratingPairs).toEqual(r.ratingPairs);

    const solo = near({ players: rated([1200, 10]) });
    solveEach(solo, 'p1', T);
    expect('ratingPairs' in result(solo)).toBe(false);
    const bot = twoPlayerGame(rated([1287, 10], [1305, 10]), true, { mode: 'bot' });
    expect('ratingPairs' in result(bot)).toBe(false);
  });

  it('3 players: places from surrenders count like any other place [D32]', () => {
    const g = GameDriver.of({ players: rated([1200, 10], [1200, 10], [1200, 10]) });
    g.solve('p1', 'A1', 1000); // the first to leave is last, whatever the score
    g.playerAct('p1', { type: 'surrender' }, 2000);
    g.playerAct('p2', { type: 'surrender' }, 3000);
    expect(Object.fromEntries(result(g).ratingChanges.map((c) => [c.playerId, c.delta]))).toEqual({
      p3: 16,
      p2: 0,
      p1: -16,
    });
  });

  it('none outside ranked games, nor when a player has no rating', () => {
    const solo = near({ players: rated([1200, 10]) });
    solveEach(solo, 'p1', T);
    expect(result(solo).ratingChanges).toEqual([]);

    const bot = twoPlayerGame(rated([1287, 10], [1305, 10]), true, { mode: 'bot' });
    expect(bot.state.config.mode).toBe('bot');
    expect(result(bot).ratingChanges).toEqual([]);

    const missing = twoPlayerGame([{ id: 'p1', rating: 1287, ratedGames: 10 }, { id: 'p2' }], true);
    expect(missing.state.config.mode).toBe('ranked');
    expect(result(missing).ratingChanges).toEqual([]);
  });

  it.each(['A', 'B'] as const)('rating option %s: a ranked game still reports the changes [D7]', (option) => {
    const g = twoPlayerGame(rated([1287, 10], [1305, 10]), true, { rules: withRating({ option }) });
    expect(g.state.config.rules.rating.option).toBe(option);
    expect(result(g).ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p1', 17],
      ['p2', -17],
    ]);
  });

  describe('the settings live in rules.rating [D7, D8, D23, D31, D32]', () => {
    it('defaults: option B, K = 32, 10 provisional games with K doubled, a full win by abandonment, 1200, no penalty', () => {
      expect(makeConfig().rules.rating).toEqual({
        option: 'B',
        k: 32,
        provisionalGames: 10,
        provisionalFactor: 2,
        abandonWinScore: 1,
        initialRating: 1200,
        abandonPenalty: 0,
      });
      expect(DEFAULT_RATING_RULES).toEqual(makeConfig().rules.rating);
      expect(makeConfig({ players: 1 }).rules.rating).toEqual(DEFAULT_RATING_RULES);
      expect('ratingOption' in makeConfig()).toBe(false);
    });

    it('k [D31]: K = 16 halves the spec example → +8 / −8', () => {
      const g = twoPlayerGame(rated([1287, 10], [1305, 30]), true, { rules: withRating({ k: 16 }) });
      expect(change(g, 'p1')).toEqual({
        playerId: 'p1',
        before: 1287,
        after: 1295,
        delta: 8,
        provisional: false,
      });
      expect(change(g, 'p2')).toEqual({
        playerId: 'p2',
        before: 1305,
        after: 1297,
        delta: -8,
        provisional: false,
      });
    });

    it('provisionalGames [D23]: with 20, a player with 10–19 rated games is still provisional (K doubled)', () => {
      const g = twoPlayerGame(rated([1287, 10], [1305, 19]), true, {
        rules: withRating({ provisionalGames: 20 }),
      });
      expect(change(g, 'p1')).toMatchObject({ delta: 34, after: 1321, provisional: true });
      expect(change(g, 'p2')).toMatchObject({ delta: -34, after: 1271, provisional: true });
      const veterans = twoPlayerGame(rated([1287, 20], [1305, 20]), true, {
        rules: withRating({ provisionalGames: 20 }),
      });
      expect(veterans.state.result!.ratingChanges.map((c) => [c.delta, c.provisional])).toEqual([
        [17, false],
        [-17, false],
      ]);
    });

    it('provisionalFactor: 3 → K = 96 for the provisional player only', () => {
      const g = twoPlayerGame(rated([1287, 9], [1305, 10]), true, {
        rules: withRating({ provisionalFactor: 3 }),
      });
      expect(change(g, 'p1')).toMatchObject({ delta: 50, after: 1337, provisional: true });
      expect(change(g, 'p2')).toMatchObject({ delta: -17, provisional: false });
    });

    it('abandonWinScore [D8 alternative]: 0.5 makes a win by abandonment a partial win; a surrender stays a full win', () => {
      const rules = withRating({ abandonWinScore: 0.5 });
      const abandoned = GameDriver.of({ players: rated([1287, 10], [1305, 10]), rules });
      abandoned.act({ type: 'disconnect', playerId: 'p2' }, 1000);
      abandoned.tickTo(16000);
      expect(places(abandoned)).toEqual({ p1: 1, p2: 2 });
      expect(change(abandoned, 'p1')).toMatchObject({ delta: 1, after: 1288 }); // 32 × (0.5 − 0.474)
      expect(change(abandoned, 'p2')).toMatchObject({ delta: -17 }); // the loser's side is unchanged

      const surrendered = GameDriver.of({ players: rated([1287, 10], [1305, 10]), rules });
      surrendered.playerAct('p2', { type: 'surrender' }, 1000);
      expect(change(surrendered, 'p1')).toMatchObject({ delta: 17 });
      expect(change(surrendered, 'p2')).toMatchObject({ delta: -17 });
    });

    it('abandonPenalty [D32 alternative]: whoever abandons loses that much more; a surrender costs nothing extra', () => {
      const rules = withRating({ abandonPenalty: 10 });
      const abandoned = GameDriver.of({ players: rated([1287, 10], [1305, 10]), rules });
      abandoned.act({ type: 'disconnect', playerId: 'p2' }, 1000);
      abandoned.tickTo(16000);
      expect(change(abandoned, 'p1')).toEqual({
        playerId: 'p1',
        before: 1287,
        after: 1304,
        delta: 17,
        provisional: false,
      });
      expect(change(abandoned, 'p2')).toEqual({
        playerId: 'p2',
        before: 1305,
        after: 1278,
        delta: -27,
        provisional: false,
      });

      const surrendered = GameDriver.of({ players: rated([1287, 10], [1305, 10]), rules });
      surrendered.playerAct('p2', { type: 'surrender' }, 1000);
      expect(change(surrendered, 'p2')).toMatchObject({ delta: -17, after: 1288 });
    });

    it('abandonPenalty in a 4-player game: only the player who abandoned pays it, on top of the place', () => {
      const g = GameDriver.of({
        players: rated([1200, 10], [1200, 10], [1200, 10], [1200, 10]),
        rules: withRating({ abandonPenalty: 10 }),
      });
      g.act({ type: 'disconnect', playerId: 'p1' }, 0); // grace until 15000
      g.playerAct('p2', { type: 'surrender' }, 1000); // out first
      g.tickTo(15000); // p1 out second
      g.playerAct('p3', { type: 'surrender' }, 16000); // out third: p4 is the last one standing
      expect(result(g).ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
        ['p4', 1, 'active'],
        ['p3', 2, 'surrendered'],
        ['p1', 3, 'abandoned'],
        ['p2', 4, 'surrendered'],
      ]);
      expect(Object.fromEntries(result(g).ratingChanges.map((c) => [c.playerId, c.delta]))).toEqual({
        p4: 16,
        p3: 5,
        p1: -5 - 10,
        p2: -16,
      });
      expect(change(g, 'p1')!.after).toBe(1185);
      // Split by opponent, the penalty apart: Σ pairs − penalty = the change.
      expect(result(g).ratingPairs!.map((p) => [p.playerId, p.penalty])).toEqual([
        ['p4', 0],
        ['p3', 0],
        ['p1', 10],
        ['p2', 0],
      ]);
      const p1 = result(g).ratingPairs!.find((p) => p.playerId === 'p1')!;
      expect(p1.pairs.map((p) => [p.opponentId, p.delta])).toEqual([
        // −5.33 −5.33 +5.33 = −5.33 → −5.
        ['p4', -5.2],
        ['p3', -5.2],
        ['p2', 5.4],
      ]);
    });
  });
});
