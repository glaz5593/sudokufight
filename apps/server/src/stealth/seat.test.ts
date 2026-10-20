import {
  type BotTrace,
  canInterfere,
  defaultRules,
  eligibleCells,
  type GameConfig,
  type GameEvent,
  INTERFERENCE_KINDS,
  LEGACY_INTERFERENCE_KINDS,
  ManualClock,
  ManualScheduler,
  type PaceHistory,
  STEALTH_BOT_CONFIG,
  stealthBotLevel,
} from '@sudoku-fight/engine';

import { INTERFERENCE_UNLOCK_LEVELS, unlockedKinds } from '../../../mobile/src/screens/game/arsenal/config';
import { ServerGame } from '../game/serverGame';
import { digitAt, PUZZLE, quietLog } from '../testing';
import {
  NO_PACE_HISTORY,
  PERSONA_KIND_UNLOCK_LEVELS,
  personaKinds,
  privateBotSeed,
  ServerBotHost,
  seatStealthBot,
  type StealthBotSeat,
  stealthLevelFor,
} from './seat';

/**
 * The stealth bot's seat (stealth-bot.md §5, §7) [D96–D98]: its level from the player's pace, the kinds of its
 * persona's level, its private seed, and the engine's bot playing a seat of the server's game through
 * ServerGame.act, as the game room seats it.
 */

const T0 = Date.UTC(2026, 9, 20, 12);
const S = 1000;
const ANA = 'ana';
const PERSONA = '6f1d3c3e-8c1b-4d8e-9a55-0c1e2f3a4b5c';
const SECRET = 'a-secret-of-the-server-'.padEnd(40, 'x');

describe('the persona’s interference kinds [D17]', () => {
  it('are the app’s own unlock table', () => {
    expect(PERSONA_KIND_UNLOCK_LEVELS).toEqual(INTERFERENCE_UNLOCK_LEVELS);
    for (let level = 1; level <= 8; level++) expect(personaKinds(level)).toEqual(unlockedKinds(level));
  });

  it('a level-1 persona sends the first three only; level 4 every kind', () => {
    expect(personaKinds(1)).toEqual([...LEGACY_INTERFERENCE_KINDS]);
    expect(personaKinds(3)).toEqual(['fireworks', 'cats', 'warp', 'scramble', 'ink']);
    expect(personaKinds(4)).toEqual([...INTERFERENCE_KINDS]);
    // Not a level: the first.
    expect(personaKinds(Number.NaN)).toEqual([...LEGACY_INTERFERENCE_KINDS]);
  });
});

describe('privateBotSeed (stealth-bot.md §7)', () => {
  it('is a 32-bit number from the secret and the game id, the same for the same pair', () => {
    const seed = privateBotSeed(SECRET, 'game-1');
    expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true);
    expect(privateBotSeed(SECRET, 'game-1')).toBe(seed);
    expect(privateBotSeed(SECRET, 'game-2')).not.toBe(seed);
    expect(privateBotSeed(`${SECRET}!`, 'game-1')).not.toBe(seed);
  });
});

describe('stealthLevelFor [D96, D97a, D97b, D98]', () => {
  const log = quietLog();
  const history = (paceMs: number, digits = 50, mistakes = 5): PaceHistory => ({
    gameType: 'fast',
    games: Array.from({ length: 10 }, () => ({ gameType: 'fast', paceMs, paceMoves: 40, digits, mistakes })),
    stealthWins: [],
  });

  it('plays at the player’s base ±30%, at his mistake rate, with his persona’s kinds, never first, no reactions', async () => {
    const level = await stealthLevelFor(
      { history: () => Promise.resolve(history(10_000)) },
      ANA,
      'fast',
      3,
      log,
    );
    expect(level.thinkMs).toEqual({ min: 7000, max: 13_000 });
    expect(level.mistakeRate).toBeCloseTo(0.1);
    expect(level.interference.chance).toBe(0);
    expect(level.interference.retaliate).toMatchObject({
      afterEndMs: { min: 2000, max: 20_000 },
      sameKindShare: 0.5,
      kinds: personaKinds(3),
    });
    expect(level.reactions).toEqual({});
    expect(level.adaptive).toBe(false);
  });

  it('asks for the pace of the player, in the game type about to be played', async () => {
    const asked: string[] = [];
    await stealthLevelFor(
      {
        history: (userId, gameType) => {
          asked.push(`${userId} ${gameType}`);
          return Promise.resolve(NO_PACE_HISTORY(gameType));
        },
      },
      ANA,
      'hard',
      1,
      log,
    );
    expect(asked).toEqual(['ana hard']);
  });

  it('a history that can’t be read gives the defaults (14 s, 8%), logged: never a lost game', async () => {
    const errors = quietLog();
    const level = await stealthLevelFor(
      { history: () => Promise.reject(new Error('db down')) },
      ANA,
      'fast',
      1,
      errors,
    );
    expect(level).toEqual(stealthBotLevel({ baseMs: 14_000, mistakeRate: 0.08, kinds: personaKinds(1) }));
    expect(errors.errors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// In a server game

function table(gameId = 'g-1') {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const config: GameConfig = {
    id: gameId,
    mode: 'ranked',
    gameType: 'fast',
    puzzle: PUZZLE,
    players: [
      { id: ANA, name: 'Ana', rating: 1200, ratedGames: 3 },
      { id: PERSONA, name: 'Tal88', rating: 1210, ratedGames: 4 },
    ],
    rules: defaultRules('ranked', 'fast', { interferenceKinds: [...INTERFERENCE_KINDS] }),
    // The public seed: the same in every run below.
    seed: 7,
  };
  let host: ServerBotHost | null = null;
  const game = new ServerGame({
    config,
    clock,
    scheduler,
    onUpdate: (u) => host?.push(u),
    onError: (e) => {
      throw e;
    },
  });
  return { clock, scheduler, game, config, attach: (h: ServerBotHost) => (host = h) };
}

const SEAT: StealthBotSeat = {
  userId: PERSONA,
  name: 'Tal88',
  level: stealthBotLevel({ baseMs: 3000, mistakeRate: 0.05, kinds: personaKinds(1) }),
  readyAfterMs: 700,
};

/**
 * A whole game: the bot in its seat, and Ana, who places a right digit every 7 s and, from `hitAt` on, sends
 * one interference at the bot when she can. Returns every event and the bot's traces.
 */
function play({ secret = SECRET, hitAt = null as number | null, gameId = 'g-1' } = {}) {
  const t = table(gameId);
  const traces: BotTrace[] = [];
  const log = quietLog();
  const bot = seatStealthBot({
    game: t.game,
    seat: SEAT,
    secret,
    clock: t.clock,
    scheduler: t.scheduler,
    log,
    onTrace: (trace) => traces.push(trace),
  });
  t.attach(bot.host);
  t.game.start();
  let hit: number | null = null;
  const ana = () => {
    const s = t.game.state;
    if (s.status === 'over') return;
    const now = t.clock.now();
    if (hitAt !== null && hit === null && now - T0 >= hitAt && canInterfere(s, ANA, PERSONA, now)) {
      t.game.act(ANA, { type: 'interfere', targetId: PERSONA, kind: 'cats' });
      hit = now;
    }
    const cell = eligibleCells(t.game.state, ANA, now)[0];
    if (cell !== undefined && t.game.state.status === 'running') {
      t.game.act(ANA, { type: 'select', cell });
      t.game.act(ANA, { type: 'place', cell, digit: digitAt(PUZZLE, cell) });
    }
    t.scheduler.setTimeout(ana, 7 * S);
  };
  t.scheduler.setTimeout(ana, 7 * S);
  for (let i = 0; i < 1200 && t.game.state.status !== 'over'; i++) t.scheduler.advance(S);
  bot.stop();
  return { ...t, events: [...t.game.events], traces, hit, bot, log };
}

const by = (events: readonly GameEvent[], playerId: string, type: GameEvent['type']) =>
  events.filter((e) => e.type === type && 'playerId' in e && e.playerId === playerId);

describe('seatStealthBot: the engine’s bot in a seat of the server’s game', () => {
  it('plays through ServerGame.act to the end: digits of its own, no interference unprovoked, no reaction', () => {
    const { events, game } = play();
    expect(game.state.status).toBe('over');
    expect(by(events, PERSONA, 'placedCorrect').length).toBeGreaterThan(10);
    expect(events.filter((e) => e.type === 'interference')).toEqual([]);
    expect(by(events, PERSONA, 'reaction')).toEqual([]);
    // It plays as a player: every one of its events names its seat, never a bot.
    expect(JSON.stringify(events)).not.toMatch(/isBot|stealth|persona/i);
  });

  it('[D98] hits back once for the one it got, 2–20 s after that one ended, with a kind of its level', () => {
    const { events, hit, traces } = play({ hitAt: 30 * S });
    expect(hit).not.toBeNull();
    expect(traces.filter((t) => t.type === 'retaliation')).toHaveLength(1);
    const received = events.filter((e) => e.type === 'interference' && e.targetId === PERSONA);
    expect(received).toHaveLength(1);
    const ended = events.find((e) => e.type === 'interferenceEnded' && e.targetId === PERSONA)!;
    const answers = events.filter(
      (e): e is Extract<GameEvent, { type: 'interference' }> =>
        e.type === 'interference' && e.fromId === PERSONA,
    );
    expect(answers).toHaveLength(1);
    const answer = answers[0]!;
    expect(answer.targetId).toBe(ANA);
    expect(answer.t - ended.t).toBeGreaterThanOrEqual(2000);
    expect(answer.t - ended.t).toBeLessThanOrEqual(20_000);
    expect(personaKinds(1)).toContain(answer.kind);
  });

  it('the same secret and game give the same bot; another secret (the same public seed) another one', () => {
    const moves = (events: readonly GameEvent[]) =>
      by(events, PERSONA, 'placedCorrect').map((e) => `${e.t}:${'cell' in e ? e.cell : ''}`);
    const a = play();
    const b = play();
    const c = play({ secret: `${SECRET}-other` });
    expect(a.config.seed).toBe(c.config.seed);
    expect(moves(b.events)).toEqual(moves(a.events));
    expect(b.bot.seed).toBe(a.bot.seed);
    expect(c.bot.seed).not.toBe(a.bot.seed);
    expect(moves(c.events)).not.toEqual(moves(a.events));
  });

  it('stops for good: after stop() it acts no more', () => {
    const t = table();
    const bot = seatStealthBot({
      game: t.game,
      seat: SEAT,
      secret: SECRET,
      clock: t.clock,
      scheduler: t.scheduler,
      log: quietLog(),
    });
    t.attach(bot.host);
    t.game.start();
    t.scheduler.advance(20 * S);
    const locks = by(t.game.events, PERSONA, 'cellLocked').length;
    expect(locks).toBeGreaterThan(0);
    bot.stop();
    t.scheduler.advance(120 * S);
    expect(by(t.game.events, PERSONA, 'cellLocked')).toHaveLength(locks);
    expect(by(t.game.events, PERSONA, 'placedCorrect').length).toBeLessThanOrEqual(locks);
  });
});

describe('ServerBotHost', () => {
  it('acts only as its own player, and only with a player’s actions', () => {
    const t = table();
    const host = new ServerBotHost(t.game, PERSONA);
    t.game.start();
    const cell = eligibleCells(t.game.state, PERSONA, t.clock.now())[0]!;
    expect(host.dispatch({ type: 'select', playerId: ANA, cell }).rejected).toBe('badAction');
    expect(host.dispatch({ type: 'disconnect', playerId: PERSONA }).rejected).toBe('badAction');
    expect(host.dispatch({ type: 'start' }).rejected).toBe('badAction');
    expect(t.game.state.players.find((p) => p.id === PERSONA)!.connected).toBe(true);
    const ok = host.dispatch({ type: 'select', playerId: PERSONA, cell });
    expect(ok.rejected).toBeUndefined();
    expect(t.game.state.locks).toEqual([expect.objectContaining({ playerId: PERSONA, cell })]);
    expect(host.state).toBe(t.game.state);
  });

  it('passes the game’s updates to its listeners, in order, until closed; a closed game throws', () => {
    const t = table();
    const host = new ServerBotHost(t.game, PERSONA);
    t.attach(host);
    const heard: string[] = [];
    host.subscribe((u) => heard.push(u.kind === 'events' ? u.events.map((e) => e.type).join('+') : 'x'));
    t.game.start();
    expect(heard).toEqual(['gameStarted']);
    host.close();
    t.game.act(ANA, { type: 'select', cell: eligibleCells(t.game.state, ANA, t.clock.now())[0]! });
    expect(heard).toEqual(['gameStarted']);
    t.game.close();
    expect(() =>
      host.dispatch({ type: 'select', playerId: PERSONA, cell: eligibleCells(t.game.state, PERSONA, 0)[0]! }),
    ).toThrow(/closed/);
  });
});

it('the engine’s defaults stand behind the level (STEALTH_BOT_CONFIG)', () => {
  expect(NO_PACE_HISTORY('fast')).toEqual({ gameType: 'fast', games: [], stealthWins: [] });
  expect(STEALTH_BOT_CONFIG.defaultBaseMs).toBe(14_000);
});
