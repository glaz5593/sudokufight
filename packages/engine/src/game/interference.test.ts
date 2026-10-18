import { parseCellName } from '../sudoku/board';
import { answer, type ConfigOptions, GameDriver, solveAll, wrongDigit } from '../testing/game';
import {
  defaultRules,
  GAME_MODES,
  INTERFERENCE_KINDS,
  INTERFERENCES_BY_MODE,
  type InterferenceKind,
  isInterferenceKind,
  LEGACY_INTERFERENCE_KINDS,
  REACTIONS,
} from './rules';
import { toView } from './view';

/*
 * Interferences (spec §7.2, §7.4) and reactions (spec §8): [D10] cost, [D11] no double interference,
 * [D17, D47] which kinds are open, [D44] none against a bot, [D19] reaction rate. The lock (and in 'turns' the turn) timer of the target
 * stops while it is under interference (§6.2.7) [D11]; the events carry those timers (§18 locks[]).
 *
 * Points used below (PUZZLE, starting board): A1 is worth 8; with A1 solved, A2 is worth 6.5 and B7 is worth 6.
 */

const A2 = parseCellName('A2');
const B7 = parseCellName('B7');

const send = (g: GameDriver, from: string, to: string, at?: number, kind: InterferenceKind = 'cats') =>
  g.playerAct(from, { type: 'interfere', targetId: to, kind }, at);
/** Sends and returns the interference event (timers that ran first may come before it). */
const hit = (g: GameDriver, from: string, to: string, at?: number, kind: InterferenceKind = 'cats') =>
  send(g, from, to, at, kind).find((e) => e.type === 'interference');
const refuse = (g: GameDriver, from: string, to: string, at?: number, kind: InterferenceKind = 'cats') =>
  g.reject({ type: 'interfere', playerId: from, targetId: to, kind }, at);
const react = (g: GameDriver, who: string, emoji: string, at?: number) =>
  g.playerAct(who, { type: 'react', emoji }, at);
const refuseReaction = (g: GameDriver, who: string, emoji: string, at?: number) =>
  g.reject({ type: 'react', playerId: who, emoji }, at);
const disconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'disconnect', playerId }, at);
const reconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'reconnect', playerId }, at);
const surrender = (g: GameDriver, playerId: string, at?: number) =>
  g.playerAct(playerId, { type: 'surrender' }, at);

/** p2 solves A1 at 0 and has 8 points to spend. */
function withPoints(o: ConfigOptions = {}): GameDriver {
  const g = GameDriver.of(o);
  g.solve('p2', 'A1', 0);
  expect(g.score('p2')).toBe(8);
  return g;
}

// ---------------------------------------------------------------------------------------------------------

describe('interference cost (§7.2) [D10]', () => {
  it('the n-th interference of a sender costs 2^n: 2, 4, 8, paid from the score at launch', () => {
    const g = withPoints();

    const first = hit(g, 'p2', 'p1', 1000, 'fireworks');
    expect(first).toMatchObject({
      type: 'interference',
      fromId: 'p2',
      targetId: 'p1',
      kind: 'fireworks',
      cost: 2,
      endsAt: 6000,
      score: 6,
      t: 1000,
    });
    expect(g.score('p2')).toBe(6);
    expect(g.player('p2').interferencesSent).toBe(1);
    expect(g.score('p1')).toBe(0); // the target pays nothing

    const second = hit(g, 'p2', 'p1', 7000);
    expect(second).toMatchObject({ cost: 4, score: 2, endsAt: 12000 });
    expect(g.score('p2')).toBe(2);

    g.solve('p2', 'B7', 12500); // +6
    expect(g.score('p2')).toBe(8);
    const third = hit(g, 'p2', 'p1', 13000, 'warp');
    expect(third).toMatchObject({ cost: 8, score: 0 });
    expect(g.score('p2')).toBe(0);
    expect(g.player('p2').interferencesSent).toBe(3);

    // The costs are not taken from the points earned by moves.
    expect(g.player('p2').pointsGained).toBe(14);
  });

  it('a score equal to the cost is enough; one point short is not (notEnoughPoints)', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000); // 8 → 6
    send(g, 'p2', 'p1', 7000); // 6 → 2
    // The third costs 8 and p2 has 2.
    expect(refuse(g, 'p2', 'p1', 13000)).toBe('notEnoughPoints');
    expect(g.score('p2')).toBe(2);
    expect(g.player('p1').hitBy).toBeNull();
    expect(g.player('p2').interferencesSent).toBe(2);
    g.solve('p2', 'B7', 13000); // exactly 8 now
    expect(hit(g, 'p2', 'p1', 13000)).toMatchObject({ cost: 8, score: 0 });
  });

  it('refuses a player with no points, or below zero, and the refusal costs nothing', () => {
    const g = GameDriver.of();
    expect(refuse(g, 'p1', 'p2', 1000)).toBe('notEnoughPoints');
    g.miss('p1', 'A1', 2000); // −8
    expect(g.score('p1')).toBe(-8);
    expect(refuse(g, 'p1', 'p2', 3000)).toBe('notEnoughPoints');
    expect(g.score('p1')).toBe(-8);
    expect(g.player('p1').interferencesSent).toBe(0);
    expect(g.player('p2').hitBy).toBeNull();
  });

  it('every sender has a ladder of their own, whoever the target is', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0); // 8
    g.solve('p2', 'B7', 0); // 6
    expect(hit(g, 'p1', 'p2', 1000)).toMatchObject({ cost: 2, score: 6 });
    expect(hit(g, 'p1', 'p3', 1000)).toMatchObject({ cost: 4, score: 2 }); // another target, same ladder
    expect(hit(g, 'p2', 'p1', 1000)).toMatchObject({ cost: 2, score: 4 }); // p2 starts at 2
    expect(g.view('p1').interference!.nextCost).toBe(8);
    expect(g.view('p2').interference!.nextCost).toBe(4);
    expect(g.view('p3').interference!.nextCost).toBe(2);
  });

  it('the ladder starts again at 2 in every new game', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    send(g, 'p2', 'p1', 7000);
    expect(g.view('p2').interference!.nextCost).toBe(8);
    const next = withPoints();
    expect(next.view('p2').interference!.nextCost).toBe(2);
    expect(hit(next, 'p2', 'p1', 1000)).toMatchObject({ cost: 2 });
  });

  it('follows rules.interferenceCostBase (here 3: 3, 9, 27)', () => {
    const g = withPoints({ rules: { interferenceCostBase: 3 } });
    expect(hit(g, 'p2', 'p1', 1000)).toMatchObject({ cost: 3, score: 5 });
    expect(g.view('p2').interference).toMatchObject({ nextCost: 9, missingPoints: 4 });
    expect(refuse(g, 'p2', 'p1', 7000)).toBe('notEnoughPoints');
  });

  describe('[D10] alternative: launching without enough points (interferenceNeedsScore false)', () => {
    it('lets a player with no points launch, and the score goes below zero [D15]', () => {
      const g = GameDriver.of({ rules: { interferenceNeedsScore: false } });
      expect(g.view('p1').interference).toMatchObject({
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'p2', blockedBy: null }],
      });
      expect(hit(g, 'p1', 'p2', 1000)).toMatchObject({ cost: 2, score: -2 });
      expect(hit(g, 'p1', 'p2', 7000)).toMatchObject({ cost: 4, score: -6 });
      expect(g.score('p1')).toBe(-6);
      expect(g.view('p1').interference).toMatchObject({ nextCost: 8, missingPoints: 0 });
    });

    it('with scores that stop at zero [D15 alternative], the score stays at 0', () => {
      const g = GameDriver.of({ rules: { interferenceNeedsScore: false, negativeScore: false } });
      expect(hit(g, 'p1', 'p2', 1000)).toMatchObject({ cost: 2, score: 0 });
      expect(g.score('p1')).toBe(0);
      expect(g.player('p1').interferencesSent).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('interference duration (§7.2): exactly 5 seconds', () => {
  it('ends exactly 5 s after launch', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1234, 'cats');
    expect(g.player('p1').hitBy).toEqual({ fromId: 'p2', kind: 'cats', endsAt: 6234 });
    expect(g.deadline).toBe(6234);
    expect(g.tickTo(6233)).toEqual([]);
    expect(g.player('p1').hitBy).not.toBeNull();
    const ended = g.tickTo(6234);
    expect(ended).toEqual([
      expect.objectContaining({
        type: 'interferenceEnded',
        fromId: 'p2',
        targetId: 'p1',
        kind: 'cats',
        t: 6234,
      }),
    ]);
    expect(g.player('p1').hitBy).toBeNull();
    expect(g.player('p1').immuneUntil).toBe(7234);
  });

  it('ends at endsAt even when the timer runs late, and the second of immunity counts from then', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    const ended = g.tickTo(9000);
    expect(ended).toEqual([expect.objectContaining({ type: 'interferenceEnded', t: 6000 })]);
    expect(g.player('p1').immuneUntil).toBe(7000);
    // The second is long over by 9000.
    expect(hit(g, 'p2', 'p1', 9000)).toMatchObject({ type: 'interference', cost: 4 });
  });

  it('an action after endsAt ends the interference first, at endsAt', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    const events = react(g, 'p1', '😱', 8000);
    expect(g.types(events)).toEqual(['interferenceEnded', 'reaction']);
    expect(events[0]).toMatchObject({ t: 6000 });
    expect(events[1]).toMatchObject({ t: 8000 });
  });

  it('follows rules.interferenceMs', () => {
    const g = withPoints({ rules: { interferenceMs: 3000 } });
    expect(hit(g, 'p2', 'p1', 1000)).toMatchObject({ endsAt: 4000 });
    expect(g.view('p1').rules.interferenceMs).toBe(3000);
    expect(g.tickTo(4000)[0]).toMatchObject({ type: 'interferenceEnded', t: 4000 });
  });

  it('everyone sees it (§7.4): the target its banner and countdown, the others a tag on its card', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0);
    send(g, 'p2', 'p1', 1000, 'fireworks');
    for (const viewer of ['p1', 'p2', 'p3', null]) {
      const p1 = g.view(viewer).players.find((p) => p.id === 'p1')!;
      expect(p1.hitBy).toEqual({ fromId: 'p2', kind: 'fireworks', expiresAt: 6000, remainingMs: 5000 });
    }
    // The sender's score drops by the cost on every screen.
    expect(g.view('p3').players.find((p) => p.id === 'p2')!.score).toBe(6);
    g.tickTo(6000);
    expect(g.view('p3').players.find((p) => p.id === 'p1')!.hitBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('no double interference (§7.2) [D11]', () => {
  it('not on a player already under one (targetBusy)', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    expect(refuse(g, 'p2', 'p1', 3000)).toBe('targetBusy');
    expect(refuse(g, 'p2', 'p1', 5999)).toBe('targetBusy');
    expect(g.score('p2')).toBe(6);
    expect(g.player('p2').interferencesSent).toBe(1);
    expect(g.player('p1').hitBy).toMatchObject({ endsAt: 6000 });
  });

  it('not by a second sender either', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0);
    g.solve('p3', 'B7', 0);
    send(g, 'p2', 'p1', 1000);
    expect(refuse(g, 'p3', 'p1', 2000)).toBe('targetBusy');
    // Someone else can be hit at once.
    expect(hit(g, 'p3', 'p2', 2000)).toMatchObject({ targetId: 'p2', cost: 2 });
  });

  it('not in the second after it ends; fine at exactly 1000 ms after', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000); // ends at 6000
    expect(refuse(g, 'p2', 'p1', 6000)).toBe('targetBusy');
    expect(g.last('interferenceEnded')).toMatchObject({ t: 6000 });
    expect(refuse(g, 'p2', 'p1', 6999)).toBe('targetBusy');
    expect(hit(g, 'p2', 'p1', 7000)).toMatchObject({ type: 'interference', endsAt: 12000 });
  });

  it('follows rules.interferenceImmunityMs (0: right at the end; 2500)', () => {
    const none = withPoints({ rules: { interferenceImmunityMs: 0 } });
    send(none, 'p2', 'p1', 1000);
    expect(refuse(none, 'p2', 'p1', 5999)).toBe('targetBusy');
    expect(hit(none, 'p2', 'p1', 6000)).toMatchObject({ type: 'interference', t: 6000 });

    const longer = withPoints({ rules: { interferenceImmunityMs: 2500 } });
    send(longer, 'p2', 'p1', 1000);
    expect(refuse(longer, 'p2', 'p1', 8499)).toBe('targetBusy');
    expect(hit(longer, 'p2', 'p1', 8500)).toMatchObject({ type: 'interference' });
  });

  it('the sender may launch while under interference (hitting back is allowed)', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8
    g.solve('p2', 'B7', 0); // 6
    send(g, 'p2', 'p1', 1000);
    const events = send(g, 'p1', 'p2', 2000, 'warp');
    expect(g.types(events)).toEqual(['interference']);
    expect(g.player('p1').hitBy).toMatchObject({ fromId: 'p2', endsAt: 6000 });
    expect(g.player('p2').hitBy).toMatchObject({ fromId: 'p1', kind: 'warp', endsAt: 7000 });
    expect(g.score('p1')).toBe(6);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('who can be targeted (§7.2)', () => {
  it('not yourself, nor a player who is not in the game (badTarget)', () => {
    const g = withPoints();
    expect(refuse(g, 'p2', 'p2', 1000)).toBe('badTarget');
    expect(refuse(g, 'p2', 'nobody', 1000)).toBe('badTarget');
    expect(g.score('p2')).toBe(8);
  });

  it('not a disconnected player (targetDisconnected); fine once back', () => {
    // 3 players: a disconnect does not freeze the game (§16.2) [D4].
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    disconnect(g, 'p3', 1000);
    expect(g.state.status).toBe('running');
    expect(refuse(g, 'p1', 'p3', 2000)).toBe('targetDisconnected');
    expect(g.score('p1')).toBe(8);
    expect(g.view('p1').interference!.targets).toContainEqual({ playerId: 'p3', blockedBy: 'disconnected' });
    reconnect(g, 'p3', 3000);
    expect(hit(g, 'p1', 'p3', 3000)).toMatchObject({ targetId: 'p3', cost: 2 });
  });

  it('nothing is launched while a 2-player game is frozen by a disconnect (paused)', () => {
    const g = withPoints();
    disconnect(g, 'p1', 1000);
    expect(g.state.status).toBe('paused');
    expect(refuse(g, 'p2', 'p1', 2000)).toBe('paused');
    expect(g.view('p2').interference!.targets).toEqual([{ playerId: 'p1', blockedBy: 'disconnected' }]);
  });

  it('a disconnected player cannot launch, and has no interference panel while away', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    disconnect(g, 'p1', 1000);
    expect(g.state.status).toBe('running');
    expect(refuse(g, 'p1', 'p2', 2000)).toBe('disconnected');
    expect(g.view('p1').interference).toBeNull();
    reconnect(g, 'p1', 3000);
    expect(g.view('p1').interference).toMatchObject({ nextCost: 2, missingPoints: 0 });
  });

  it('not a player who surrendered (targetOut), and a player who surrendered cannot launch', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    g.solve('p3', 'B7', 0);
    surrender(g, 'p3', 1000);
    expect(refuse(g, 'p1', 'p3', 2000)).toBe('targetOut');
    expect(refuse(g, 'p3', 'p1', 2000)).toBe('notActive');
    expect(g.view('p1').interference!.targets).toContainEqual({ playerId: 'p3', blockedBy: 'out' });
    // Whoever left has no ⚡ any more, even with points to pay.
    expect(g.view('p3').interference).toBeNull();
  });

  it('not a player who abandoned (targetOut)', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    disconnect(g, 'p3', 1000);
    expect(g.tickTo(16000).map((e) => e.type)).toContain('playerAbandoned');
    expect(refuse(g, 'p1', 'p3', 16000)).toBe('targetOut');
    expect(g.view('p1').interference!.targets).toContainEqual({ playerId: 'p3', blockedBy: 'out' });
    expect(g.view('p3').interference).toBeNull();
  });

  it('only during the game: notStarted before, gameOver after', () => {
    const before = GameDriver.of({}, { start: false });
    expect(refuse(before, 'p1', 'p2', 0)).toBe('notStarted');
    // The panel says so: the game is not running yet.
    expect(before.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: 'notRunning' }]);
    const after = withPoints();
    surrender(after, 'p1', 1000);
    expect(after.state.status).toBe('over');
    expect(refuse(after, 'p2', 'p1', 2000)).toBe('gameOver');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('where interferences exist (§7.2) [D44]: ranked games only, not solo practice, not against a bot', () => {
  it('INTERFERENCES_BY_MODE: on in ranked only, and defaultRules follows it for every mode', () => {
    expect(INTERFERENCES_BY_MODE).toEqual({ solo: false, bot: false, ranked: true });
    for (const mode of GAME_MODES) {
      expect(defaultRules(mode, 'fast').interferences).toBe(INTERFERENCES_BY_MODE[mode]);
      // Narrowing the kinds is a room's business: every mode starts with all of them.
      expect(defaultRules(mode, 'fast').interferenceKinds).toEqual(INTERFERENCE_KINDS);
    }
  });

  it('off in solo practice (interferencesOff), with no interference panel in the view', () => {
    const g = GameDriver.of({ players: 1 });
    expect(g.state.config.mode).toBe('solo');
    expect(g.state.config.rules.interferences).toBe(false);
    g.solve('p1', 'A1', 0);
    expect(refuse(g, 'p1', 'p2', 1000)).toBe('interferencesOff');
    expect(refuse(g, 'p1', 'p1', 1000)).toBe('interferencesOff');
    const view = g.view('p1');
    expect(view.interference).toBeNull();
    expect(view.rules.interferences).toBe(false);
  });

  const botGame = (o: ConfigOptions = {}) => {
    const g = GameDriver.of({
      mode: 'bot',
      players: [
        { id: 'me', name: 'Me' },
        { id: 'bot', name: 'Pip', isBot: true },
      ],
      ...o,
    });
    g.solve('bot', 'A1', 0);
    g.solve('me', 'B7', 0);
    return g;
  };

  it('off in a game against a bot, both ways (interferencesOff), with no panel in the view', () => {
    const g = botGame();
    expect(g.state.config.rules.interferences).toBe(false);
    expect(refuse(g, 'bot', 'me', 1000, 'fireworks')).toBe('interferencesOff');
    expect(refuse(g, 'me', 'bot', 1000, 'cats')).toBe('interferencesOff');
    expect(g.score('me')).toBe(6); // nothing was charged
    expect(g.score('bot')).toBe(8);
    const view = g.view('me');
    expect(view.interference).toBeNull(); // so the app shows no interference button on the bot's card
    expect(view.rules.interferences).toBe(false);
  });

  it('a rules override turns them on in a game against a bot (config, not code)', () => {
    const g = botGame({ rules: { interferences: true } });
    expect(g.view('me').interference).not.toBeNull();
    expect(hit(g, 'bot', 'me', 1000, 'fireworks')).toMatchObject({ fromId: 'bot', targetId: 'me', cost: 2 });
    expect(hit(g, 'me', 'bot', 1000, 'cats')).toMatchObject({ fromId: 'me', targetId: 'bot', cost: 2 });
  });

  it('on in ranked games of 2–4 players', () => {
    for (const players of [2, 3, 4]) {
      const g = withPoints({ players });
      expect(g.state.config.mode).toBe('ranked');
      expect(hit(g, 'p2', 'p1', 1000)).toMatchObject({ type: 'interference' });
    }
  });

  it('rules.interferences false turns them off in any mode', () => {
    const g = withPoints({ rules: { interferences: false } });
    expect(refuse(g, 'p2', 'p1', 1000)).toBe('interferencesOff');
    expect(g.view('p2').interference).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('interference kinds (§7.1) [D17, D47]', () => {
  it('six kinds, in the order of the picker and of unlocking; a game allows all of them by default', () => {
    expect(INTERFERENCE_KINDS).toEqual(['fireworks', 'cats', 'warp', 'scramble', 'ink', 'keypad']);
    expect(GameDriver.of().view('p1').rules.interferenceKinds).toEqual(INTERFERENCE_KINDS);
  });

  it('the legacy kinds (what an app that declares none can show) are the first three', () => {
    expect(LEGACY_INTERFERENCE_KINDS).toEqual(['fireworks', 'cats', 'warp']);
    expect(LEGACY_INTERFERENCE_KINDS).toEqual(INTERFERENCE_KINDS.slice(0, 3));
  });

  it('isInterferenceKind knows every kind and nothing else', () => {
    for (const kind of INTERFERENCE_KINDS) expect(isInterferenceKind(kind)).toBe(true);
    for (const v of ['dragons', 'earthquake', 'Cats', '', 42, undefined, null, {}, ['cats']])
      expect(isInterferenceKind(v)).toBe(false);
  });

  it.each(INTERFERENCE_KINDS.map((kind, k) => [kind, k] as const))(
    '%s: sent, priced by order not by kind, stops the target’s lock, ends after interferenceMs',
    (kind, k) => {
      const g = withPoints();
      // Another kind first, so this one is the second of the sender: it costs 4, whatever the kind.
      const other = INTERFERENCE_KINDS[(k + 1) % INTERFERENCE_KINDS.length]!;
      expect(hit(g, 'p2', 'p1', 1000, other)).toMatchObject({ kind: other, cost: 2 });
      g.select('p1', 'A2', 6500); // would run out at 14500
      expect(hit(g, 'p2', 'p1', 7000, kind)).toMatchObject({ kind, cost: 4, score: 2, endsAt: 12000 });
      expect(g.player('p1').hitBy!.kind).toBe(kind);
      expect(g.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 7500 });
      expect(g.tickTo(11999)).toEqual([]);
      expect(g.tickTo(12000)[0]).toMatchObject({ type: 'interferenceEnded', kind, t: 12000 });
      expect(g.player('p1').hitBy).toBeNull();
      expect(g.lock('p1')!.expiresAt).toBe(19500);
      expect(g.replayMatches()).toBe(true);
    },
  );

  it('a kind the engine does not know is refused (badKind), and costs nothing', () => {
    const g = withPoints();
    for (const kind of ['earthquake', 'fog', 'bubbles', 'torch', 'dragons', ''])
      expect(refuse(g, 'p2', 'p1', 1000, kind as InterferenceKind)).toBe('badKind');
    expect(g.score('p2')).toBe(8);
    expect(g.player('p2').interferencesSent).toBe(0);
  });

  it('a room of legacy kinds refuses the new ones (badKind) and charges nothing [D47]', () => {
    const g = withPoints({ rules: { interferenceKinds: LEGACY_INTERFERENCE_KINDS } });
    expect(g.view('p2').rules.interferenceKinds).toEqual(['fireworks', 'cats', 'warp']);
    for (const kind of ['scramble', 'ink', 'keypad'] as const)
      expect(refuse(g, 'p2', 'p1', 1000, kind)).toBe('badKind');
    expect(g.score('p2')).toBe(8);
    expect(g.player('p2').interferencesSent).toBe(0);
    expect(g.player('p1').hitBy).toBeNull();
    // The old kinds go through as usual, at the first price.
    expect(hit(g, 'p2', 'p1', 1000, 'warp')).toMatchObject({ kind: 'warp', cost: 2 });
  });

  it('a game that allows no kind has no interference panel, and refuses every kind [D47]', () => {
    const g = withPoints({ rules: { interferenceKinds: [] } });
    expect(g.view('p2').interference).toBeNull();
    expect(g.view('p1').interference).toBeNull();
    expect(refuse(g, 'p2', 'p1', 1000, 'cats')).toBe('badKind');
    expect(g.score('p2')).toBe(8);
  });

  it('rules.interferenceKinds restricts what can be sent', () => {
    const g = withPoints({ rules: { interferenceKinds: ['cats'] } });
    expect(g.view('p2').rules.interferenceKinds).toEqual(['cats']);
    expect(refuse(g, 'p2', 'p1', 1000, 'fireworks')).toBe('badKind');
    expect(refuse(g, 'p2', 'p1', 1000, 'warp')).toBe('badKind');
    expect(hit(g, 'p2', 'p1', 1000, 'cats')).toMatchObject({ kind: 'cats' });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the game goes on during an interference (§7.2)', () => {
  it("the target's keypad stays usable: a right digit under interference scores as usual", () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000); // would expire at 9000
    send(g, 'p2', 'p1', 3000); // the lock stops with 6000 left
    g.tickTo(4000);
    const view = g.view('p1');
    expect(view.keypad.enabled).toBe(true);
    expect(view.players.find((p) => p.id === 'p1')!.hitBy).not.toBeNull();
    const [e] = g.place('p1', 'A2', answer('A2'), 4000);
    // The time under interference (lock stopped) is not think time.
    expect(e).toMatchObject({
      type: 'placedCorrect',
      playerId: 'p1',
      points: 6.5,
      score: 6.5,
      thinkMs: 2000,
    });
    expect(g.state.grid[parseCellName('A2')]).toBe(answer('A2'));
    expect(g.player('p1').hitBy).not.toBeNull(); // the interference itself runs on
  });

  it('a wrong digit under interference costs the usual penalty and releases the cell [D3]', () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000);
    send(g, 'p2', 'p1', 2000);
    const events = g.place('p1', 'A2', wrongDigit('A2'), 3000);
    expect(g.types(events)).toEqual(['placedWrong', 'cellReleased']);
    // A2 after p2's A1: worth 6.5 there, so that is what it costs.
    expect(events[0]).toMatchObject({ penalty: 6.5, mistakes: 1, score: -6.5 });
    expect(events[1]).toMatchObject({ reason: 'mistake' });
  });

  it("the sender's own lock keeps counting down; only the target's stops", () => {
    const g = withPoints();
    g.select('p2', 'B7', 2000); // expires at 10000
    g.select('p1', 'A2', 2000);
    const events = send(g, 'p2', 'p1', 3000);
    expect(g.types(events)).toEqual(['interference']);
    // The event carries the target's lock, stopped, with the time it had left (§18 locks[]).
    expect(g.last('interference')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: null, remainingMs: 7000 },
    ]);
    expect(g.lock('p2')!.expiresAt).toBe(10000);
    expect(g.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 7000 });
    const later = g.tickTo(10000);
    // p1's lock restarts at 8000 with 7000 left; p2's runs out on time.
    expect(g.types(later)).toEqual(['interferenceEnded', 'cellReleased']);
    expect(later[0]).toMatchObject({ t: 8000 });
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 15000, remainingMs: 7000 },
    ]);
    expect(later[1]).toMatchObject({ playerId: 'p2', reason: 'timeout', t: 10000 });
    expect(g.lock('p1')!.expiresAt).toBe(15000);
  });

  it('nothing to stop when the target holds no lock: both events carry no locks', () => {
    const g = withPoints();
    expect(g.types(send(g, 'p2', 'p1', 1000))).toEqual(['interference']);
    expect(g.last('interference')!.locks).toEqual([]);
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([]);
  });

  it('a lock that runs out at the moment of launch is released first, so nothing is stopped', () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000); // expires at 9000
    const events = send(g, 'p2', 'p1', 9000);
    expect(g.types(events)).toEqual(['cellReleased', 'interference']);
    expect(events[0]).toMatchObject({ reason: 'timeout', t: 9000 });
    expect(g.last('interference')!.locks).toEqual([]);
    expect(g.lock('p1')).toBeUndefined();
  });

  it('other players keep playing on the board', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0);
    send(g, 'p2', 'p1', 1000);
    expect(g.types(g.solve('p3', 'B7', 2000))).toEqual(['cellLocked', 'placedCorrect']);
    expect(g.types(g.solve('p1', 'A2', 3000))).toEqual(['cellLocked', 'placedCorrect']);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the lock timers an interference carries (§6.2.7, §18 locks[]) [D11]', () => {
  it('a lock taken under interference starts stopped with the full think time; the end starts it', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000); // ends at 6000
    const [locked] = g.select('p1', 'A2', 2000);
    expect(locked).toMatchObject({ type: 'cellLocked', cell: A2, expiresAt: null, remainingMs: 8000 });
    expect(g.deadline).toBe(6000);
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 14000, remainingMs: 8000 },
    ]);
    expect(g.lock('p1')).toMatchObject({ expiresAt: 14000 });
    expect(g.deadline).toBe(14000);
    expect(g.tickTo(14000)).toEqual([
      expect.objectContaining({ type: 'cellReleased', playerId: 'p1', reason: 'timeout', t: 14000 }),
    ]);
  });

  it('switching cells under interference: the new lock starts stopped, and the end starts the new one', () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000);
    send(g, 'p2', 'p1', 2000); // A2 stops with 7000 left; the interference ends at 7000
    const events = g.select('p1', 'B7', 3000);
    expect(g.types(events)).toEqual(['cellReleased', 'cellLocked']);
    expect(events[0]).toMatchObject({ cell: A2, reason: 'switch' });
    expect(events[1]).toMatchObject({ cell: B7, expiresAt: null, remainingMs: 8000 });
    g.tickTo(7000);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: B7, expiresAt: 15000, remainingMs: 8000 },
    ]);
  });

  it('a lock that ends under interference (a digit, a cancel) is not carried at the end', () => {
    const placed = withPoints();
    placed.select('p1', 'A2', 1000); // would expire at 9000
    send(placed, 'p2', 'p1', 2000); // 7000 left
    // Think time counts only while the timer runs: 1000 before the interference, none under it.
    expect(placed.place('p1', 'A2', answer('A2'), 3000)[0]).toMatchObject({
      type: 'placedCorrect',
      thinkMs: 1000,
    });
    placed.tickTo(7000);
    expect(placed.last('interferenceEnded')!.locks).toEqual([]);

    const cancelled = withPoints();
    cancelled.select('p1', 'A2', 1000);
    send(cancelled, 'p2', 'p1', 2000);
    cancelled.act({ type: 'release', playerId: 'p1' }, 3000);
    expect(cancelled.types(cancelled.tickTo(7000))).toEqual(['interferenceEnded']);
    expect(cancelled.last('interferenceEnded')!.locks).toEqual([]);
  });

  it('[D11] alternative pauseLockWhileInterfered false: nothing stops, and the events carry no locks', () => {
    const g = withPoints({ rules: { pauseLockWhileInterfered: false } });
    g.select('p1', 'A2', 1000); // expires at 9000
    send(g, 'p2', 'p1', 2000);
    expect(g.last('interference')!.locks).toEqual([]);
    expect(g.lock('p1')).toMatchObject({ expiresAt: 9000 });
    // A lock taken under interference counts down at once.
    expect(g.select('p1', 'B7', 3000)[1]).toMatchObject({ type: 'cellLocked', expiresAt: 11000 });
    g.tickTo(7000);
    expect(g.last('interferenceEnded')!.locks).toEqual([]);
    expect(g.lock('p1')).toMatchObject({ cell: B7, expiresAt: 11000 });
  });

  it('a freeze: gameResumed lists the running locks with their new expiry, not a lock an interference stopped', () => {
    const g = withPoints();
    g.select('p2', 'B7', 1000); // expires at 9000
    g.select('p1', 'A2', 1000);
    send(g, 'p2', 'p1', 2000); // A2 stops with 7000 left; the interference ends at 7000
    disconnect(g, 'p2', 3000);
    expect(g.state.status).toBe('paused');
    const back = reconnect(g, 'p2', 8000); // paused 5000
    expect(g.types(back)).toEqual(['playerReconnected', 'gameResumed']);
    const resumed = g.last('gameResumed')!;
    expect(resumed.pausedMs).toBe(5000);
    expect(resumed.locks).toEqual([expect.objectContaining({ playerId: 'p2', cell: B7, expiresAt: 14000 })]);
    // The stopped lock keeps waiting for the interference, which moved on by the pause.
    expect(g.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 7000 });
    expect(g.player('p1').hitBy!.endsAt).toBe(12000);
    expect(g.types(g.tickTo(12000))).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 19000, remainingMs: 7000 },
    ]);
    expect(g.tickTo(14000)).toEqual([
      expect.objectContaining({ type: 'cellReleased', playerId: 'p2', reason: 'timeout', t: 14000 }),
    ]);
    expect(g.replayMatches()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('interference and a frozen game (§6.2.7, §16.2) [D11]', () => {
  it('a freeze stops the interference timer too', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000); // ends at 6000
    disconnect(g, 'p2', 3000);
    expect(g.state.status).toBe('paused');
    expect(g.deadline).toBe(18000); // only the grace period runs
    expect(g.tickTo(10000)).toEqual([]);
    expect(g.player('p1').hitBy).not.toBeNull();
    const back = reconnect(g, 'p2', 10000);
    // No lock is held, so the resume carries none.
    expect(back[1]).toMatchObject({ type: 'gameResumed', pausedMs: 7000, locks: [] });
    expect(g.player('p1').hitBy!.endsAt).toBe(13000); // 3000 had passed, 2000 left
    expect(g.deadline).toBe(13000);
    expect(g.tickTo(12999)).toEqual([]);
    expect(g.tickTo(13000)[0]).toMatchObject({ type: 'interferenceEnded', t: 13000 });
    expect(g.player('p1').immuneUntil).toBe(14000);
  });

  it("the target's stopped lock waits for the freeze and then for the interference, keeping its time", () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000); // would expire at 9000
    send(g, 'p2', 'p1', 3000); // 6000 left; the interference ends at 8000
    disconnect(g, 'p1', 4000);
    reconnect(g, 'p1', 10000); // paused 6000: the interference now ends at 14000
    // The resume does not start a lock the interference still holds.
    expect(g.last('gameResumed')).toMatchObject({ pausedMs: 6000, locks: [] });
    expect(g.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 6000 });
    expect(g.deadline).toBe(14000);
    const after = g.tickTo(14000);
    expect(g.types(after)).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 20000, remainingMs: 6000 },
    ]);
    expect(g.lock('p1')).toMatchObject({ expiresAt: 20000 });
  });

  it('when the game ends during an interference, its timer stops with the game and the hit is cleared', () => {
    const g = withPoints();
    hit(g, 'p2', 'p1', 1000);
    surrender(g, 'p1', 2000);
    expect(g.state.status).toBe('over');
    // Nothing runs any more: no interference stays on screen over the results (§12).
    expect(g.player('p1').hitBy).toBeNull();
    expect(g.view('p2').players.find((p) => p.id === 'p1')!.hitBy).toBeNull();
    expect(g.deadline).toBeNull();
    expect(g.tickTo(10000)).toEqual([]);
    expect(g.types()).not.toContain('interferenceEnded');
    expect(g.replayMatches()).toBe(true);
  });

  it('a full board ends the game under interference: every hit is cleared, nothing ends later', () => {
    const g = withPoints(); // p2 has 8 points
    expect(hit(g, 'p2', 'p1', 1000)).toMatchObject({ targetId: 'p1', endsAt: 6000 });
    solveAll(g, 'p2'); // all at 1000, long before the interference would end
    expect(g.last('gameOver')).toMatchObject({ reason: 'boardComplete', t: 1000 });
    expect(g.state.players.map((p) => p.hitBy)).toEqual([null, null]);
    const view = g.view('p2');
    expect(view.players.map((p) => p.hitBy)).toEqual([null, null]);
    // The panel: the game is over, so nobody can be hit (and p1 is not "busy" any more).
    expect(view.interference!.targets).toEqual([{ playerId: 'p1', blockedBy: 'notRunning' }]);
    expect(g.deadline).toBeNull();
    expect(g.tickTo(6000)).toEqual([]);
    expect(g.types()).not.toContain('interferenceEnded');
    expect(g.replayMatches()).toBe(true);
  });

  it('the second of immunity waits out a freeze as well', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000); // ends at 6000, immune until 7000
    g.tickTo(6000);
    disconnect(g, 'p1', 6500); // 500 of the second left
    reconnect(g, 'p1', 9500); // paused 3000
    expect(g.player('p1').immuneUntil).toBe(10000);
    expect(refuse(g, 'p2', 'p1', 9999)).toBe('targetBusy');
    expect(hit(g, 'p2', 'p1', 10000)).toMatchObject({ type: 'interference' });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the interference panel in the view (§6.8, §7.2) [D10, D11]', () => {
  it('shows "10 points missing" at a score of −8 (the next one costs 2)', () => {
    const g = GameDriver.of();
    g.miss('p1', 'A1', 0); // −8
    expect(g.view('p1').interference).toEqual({
      nextCost: 2,
      missingPoints: 10,
      targets: [{ playerId: 'p2', blockedBy: 'points' }],
    });
  });

  it('nextCost climbs 2, 4, 8 as I send; missingPoints is 0 while I can pay, and may be a half point', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A2', 0); // 7.5 on the starting board
    expect(g.view('p2').interference).toEqual({
      nextCost: 2,
      missingPoints: 0,
      targets: [{ playerId: 'p1', blockedBy: null }],
    });
    send(g, 'p2', 'p1', 1000); // 5.5 left
    expect(g.view('p2').interference).toMatchObject({ nextCost: 4, missingPoints: 0 });
    send(g, 'p2', 'p1', 7000); // 1.5 left
    expect(g.score('p2')).toBe(1.5);
    expect(g.view('p2').interference).toMatchObject({ nextCost: 8, missingPoints: 6.5 });
    g.solve('p2', 'A1', 12000); // 6.5 with A2 solved: exactly 8
    expect(g.score('p2')).toBe(8);
    expect(g.view('p2').interference).toMatchObject({ nextCost: 8, missingPoints: 0 });
  });

  it('says why each opponent cannot be hit now: out, disconnected, busy', () => {
    const g = GameDriver.of({ players: 4 });
    g.solve('p1', 'A1', 0);
    send(g, 'p1', 'p2', 1000);
    disconnect(g, 'p3', 1000);
    surrender(g, 'p4', 1000);
    expect(g.view('p1').interference!.targets).toEqual([
      // busy until the interference ends (6000) and its second of immunity passes [D11]
      { playerId: 'p2', blockedBy: 'busy', busyUntil: 7000 },
      { playerId: 'p3', blockedBy: 'disconnected' },
      { playerId: 'p4', blockedBy: 'out' },
    ]);
  });

  it('busy covers the interference and the second after it, by the clock of the view', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    const blocked = () => g.view('p2').interference!.targets[0]!.blockedBy;
    expect(blocked()).toBe('busy');
    g.tickTo(6000);
    expect(blocked()).toBe('busy');
    g.tickTo(6999);
    expect(blocked()).toBe('busy');
    g.tickTo(7000);
    expect(blocked()).toBeNull();
    // Same state, other clocks.
    expect(toView(g.state, 'p2', 6999).interference!.targets[0]!.blockedBy).toBe('busy');
    expect(toView(g.state, 'p2', 7000).interference!.targets[0]!.blockedBy).toBeNull();
  });

  it('points: everyone is blocked when I cannot pay, and free once I can', () => {
    const g = GameDriver.of({ players: 3 });
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'points' },
      { playerId: 'p3', blockedBy: 'points' },
    ]);
    g.solve('p1', 'A1', 0);
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: null },
      { playerId: 'p3', blockedBy: null },
    ]);
  });

  it('notRunning: while the game is frozen, the opponents who are still connected cannot be hit', () => {
    // A 3-player game that freezes, so a connected opponent remains.
    const g = GameDriver.of({ players: 3, rules: { freezeUpToPlayers: 3 } });
    g.solve('p1', 'A1', 0);
    disconnect(g, 'p3', 1000);
    expect(g.state.status).toBe('paused');
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'notRunning' },
      { playerId: 'p3', blockedBy: 'disconnected' },
    ]);
    expect(refuse(g, 'p1', 'p2', 2000)).toBe('paused');
    reconnect(g, 'p3', 3000);
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: null },
      { playerId: 'p3', blockedBy: null },
    ]);
  });

  it('notRunning before the start and after the end, whatever my points', () => {
    const before = GameDriver.of({ players: 3 }, { start: false });
    expect(before.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'notRunning' },
      { playerId: 'p3', blockedBy: 'notRunning' },
    ]);
    const g = withPoints({ players: 3 });
    solveAll(g, 'p3');
    expect(g.state.status).toBe('over');
    expect(g.view('p2').interference!.targets).toEqual([
      { playerId: 'p1', blockedBy: 'notRunning' },
      { playerId: 'p3', blockedBy: 'notRunning' },
    ]);
  });

  it('nothing to show for a spectator, nor for a player who is out or away', () => {
    const g = withPoints({ players: 4 });
    expect(g.view(null).interference).toBeNull();
    surrender(g, 'p3', 1000);
    disconnect(g, 'p4', 1000); // 3 still in the game: it goes on [D4]
    expect(g.state.status).toBe('running');
    expect(g.view('p3').interference).toBeNull();
    expect(g.view('p4').interference).toBeNull();
    expect(g.view('p2').interference!.targets).toEqual([
      { playerId: 'p1', blockedBy: null },
      { playerId: 'p3', blockedBy: 'out' },
      { playerId: 'p4', blockedBy: 'disconnected' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('interference timers in the view (§7.4, §6.2.7, §16.2) [D11]', () => {
  const card = (g: GameDriver, id: string, viewer: string | null = null, at = g.now) =>
    toView(g.state, viewer, at).players.find((p) => p.id === id)!;

  it("the target's banner counts down: expiresAt, and remainingMs by the clock of the view", () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000, 'warp'); // ends at 6000
    expect(card(g, 'p1', 'p1', 1000).hitBy).toEqual({
      fromId: 'p2',
      kind: 'warp',
      expiresAt: 6000,
      remainingMs: 5000,
    });
    expect(card(g, 'p1', 'p2', 4500).hitBy).toEqual({
      fromId: 'p2',
      kind: 'warp',
      expiresAt: 6000,
      remainingMs: 1500,
    });
    // A view taken late, before the timer ran, never shows a negative countdown.
    expect(card(g, 'p1', null, 7000).hitBy).toMatchObject({ expiresAt: 6000, remainingMs: 0 });
    expect(card(g, 'p2', 'p1', 1000).hitBy).toBeNull();
  });

  it("the target's lock shows stopped under interference, then running again", () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000); // would expire at 9000
    send(g, 'p2', 'p1', 3000); // 6000 left; the interference ends at 8000
    for (const viewer of ['p1', 'p2', null])
      expect(card(g, 'p1', viewer, 5000).lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 6000 });
    g.tickTo(8000);
    expect(card(g, 'p1').lock).toEqual({ cell: A2, expiresAt: 14000, remainingMs: 6000 });
    expect(g.view('p1').keypad.enabled).toBe(true);
  });

  it('a freeze shows the interference stopped, with the time it had left at the freeze', () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000);
    send(g, 'p2', 'p1', 1000); // ends at 6000; A2 stops with 8000 left
    disconnect(g, 'p2', 3000);
    expect(g.state.status).toBe('paused');
    for (const at of [3000, 9000]) {
      expect(card(g, 'p1', 'p1', at).hitBy).toEqual({
        fromId: 'p2',
        kind: 'cats',
        expiresAt: null,
        remainingMs: 3000,
      });
      expect(card(g, 'p1', 'p1', at).lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 8000 });
    }
    reconnect(g, 'p2', 10000); // paused 7000
    expect(card(g, 'p1', 'p1', 10000).hitBy).toEqual({
      fromId: 'p2',
      kind: 'cats',
      expiresAt: 13000,
      remainingMs: 3000,
    });
    expect(card(g, 'p1').lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 8000 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe("'turns' model: the turn timer of a player under interference stops (§6.1, §6.2.7) [D1, D11]", () => {
  const turns = (o: ConfigOptions = {}) => GameDriver.of({ ...o, rules: { turnModel: 'turns', ...o.rules } });

  it('hitting the player whose turn it is stops the turn; it goes on from where it stopped', () => {
    const g = turns();
    g.solve('p1', 'A1', 0); // 8 points; the turn passes to p2 until 8000
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: 8000, stoppedMs: null });
    send(g, 'p1', 'p2', 1000); // interfering needs no turn; ends at 6000
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: null, stoppedMs: 7000 });
    expect(g.view('p1').turn).toEqual({ playerId: 'p2', expiresAt: null, remainingMs: 7000 });
    expect(g.deadline).toBe(6000);
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: 13000, stoppedMs: null });
    expect(g.tickTo(12999)).toEqual([]);
    expect(g.tickTo(13000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p1', endsAt: 21000, t: 13000 }),
    ]);
    expect(g.replayMatches()).toBe(true);
  });

  it('a turn that starts while its holder is under interference starts stopped, with its full time', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // turn → p2
    g.solve('p2', 'B7', 0); // 6 points; turn → p3 until 8000
    send(g, 'p2', 'p1', 1000); // ends at 6000
    // Someone else's turn is not touched.
    expect(g.state.turn).toEqual({ playerId: 'p3', endsAt: 8000, stoppedMs: null });
    g.select('p3', 'A2', 2000);
    const events = g.act({ type: 'release', playerId: 'p3' }, 2000);
    expect(g.types(events)).toEqual(['cellReleased', 'turnStarted']);
    expect(events[1]).toMatchObject({ playerId: 'p1', endsAt: null, remainingMs: 8000 });
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: null, stoppedMs: 8000 });
    g.tickTo(6000);
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 14000, stoppedMs: null });
    expect(g.replayMatches()).toBe(true);
  });

  it('the holder takes a lock under interference: the lock waits for the end, and the turn ends with it', () => {
    const g = turns();
    g.solve('p1', 'A1', 0); // turn → p2 until 8000
    send(g, 'p1', 'p2', 1000); // turn stops with 7000 left; ends at 6000
    const [locked] = g.select('p2', 'B7', 2000);
    expect(locked).toMatchObject({ type: 'cellLocked', expiresAt: null, remainingMs: 8000 });
    // The lock's timer counts instead of the turn's.
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: null, stoppedMs: null });
    g.tickTo(6000);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p2', cell: B7, expiresAt: 14000, remainingMs: 8000 },
    ]);
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: null, stoppedMs: null });
    expect(g.types(g.tickTo(14000))).toEqual(['cellReleased', 'turnStarted']);
    expect(g.state.turn).toMatchObject({ playerId: 'p1', endsAt: 22000 });
  });

  it('[D11] alternative pauseLockWhileInterfered false: the turn keeps running', () => {
    const g = turns({ rules: { pauseLockWhileInterfered: false } });
    g.solve('p1', 'A1', 0);
    send(g, 'p1', 'p2', 1000);
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: 8000, stoppedMs: null });
    expect(g.types(g.tickTo(8000))).toEqual(['interferenceEnded', 'turnStarted']);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('reactions (§8) [D19]', () => {
  it('the six base reactions are 😂 😱 😎 🤦 🔥 👀', () => {
    expect(REACTIONS).toEqual(['😂', '😱', '😎', '🤦', '🔥', '👀']);
    expect(GameDriver.of().view('p1').rules.reactions).toEqual(['😂', '😱', '😎', '🤦', '🔥', '👀']);
  });

  it('accepts each of the six', () => {
    const g = GameDriver.of();
    REACTIONS.forEach((emoji, k) => {
      const at = 1000 + k * 2000;
      expect(react(g, 'p1', emoji, at)).toEqual([
        expect.objectContaining({ type: 'reaction', playerId: 'p1', emoji, t: at }),
      ]);
    });
    expect(g.log.filter((e) => e.type === 'reaction')).toHaveLength(6);
  });

  it('refuses anything else (badEmoji), and a refused one does not start the wait', () => {
    const g = GameDriver.of();
    for (const emoji of ['👍', '❤️', '😂😂', 'lol', ''])
      expect(refuseReaction(g, 'p1', emoji, 1000)).toBe('badEmoji');
    expect(g.player('p1').lastReactionAt).toBeNull();
    expect(react(g, 'p1', '😂', 1000)).toHaveLength(1);
  });

  it('one per 2 s per player: tooSoon before, fine at exactly 2000 ms', () => {
    const g = GameDriver.of();
    react(g, 'p1', '🔥', 1000);
    expect(refuseReaction(g, 'p1', '😎', 1001)).toBe('tooSoon');
    expect(refuseReaction(g, 'p1', '😎', 2999)).toBe('tooSoon');
    // The wait is per player.
    expect(react(g, 'p2', '😂', 1500)).toHaveLength(1);
    expect(react(g, 'p1', '😎', 3000)).toHaveLength(1);
    expect(refuseReaction(g, 'p2', '😂', 3499)).toBe('tooSoon');
    expect(react(g, 'p2', '😂', 3500)).toHaveLength(1);
  });

  it('a refused reaction does not restart the wait', () => {
    const g = GameDriver.of();
    react(g, 'p1', '👀', 1000);
    expect(refuseReaction(g, 'p1', '👀', 2500)).toBe('tooSoon');
    expect(react(g, 'p1', '👀', 3000)).toHaveLength(1);
  });

  it('follows rules.reactionCooldownMs', () => {
    const g = GameDriver.of({ rules: { reactionCooldownMs: 5000 } });
    expect(g.view('p1').rules.reactionCooldownMs).toBe(5000);
    react(g, 'p1', '😂', 1000);
    expect(g.view('p1').reactionReadyAt).toBe(6000);
    expect(refuseReaction(g, 'p1', '😂', 5999)).toBe('tooSoon');
    expect(react(g, 'p1', '😂', 6000)).toHaveLength(1);
  });

  it('follows rules.reactions (more reactions unlock later)', () => {
    const g = GameDriver.of({ rules: { reactions: [...REACTIONS, '🎉'] } });
    expect(react(g, 'p1', '🎉', 1000)[0]).toMatchObject({ emoji: '🎉' });
    const narrow = GameDriver.of({ rules: { reactions: ['👍'] } });
    expect(refuseReaction(narrow, 'p1', '😂', 1000)).toBe('badEmoji');
    expect(react(narrow, 'p1', '👍', 1000)).toHaveLength(1);
  });

  it('allowed while the game is paused; not by the disconnected player', () => {
    const g = GameDriver.of();
    disconnect(g, 'p2', 1000);
    expect(g.state.status).toBe('paused');
    expect(react(g, 'p1', '😱', 1500)).toEqual([
      expect.objectContaining({ type: 'reaction', playerId: 'p1' }),
    ]);
    expect(refuseReaction(g, 'p2', '😂', 1500)).toBe('disconnected');
  });

  it('refused for a player who surrendered or abandoned (notActive)', () => {
    const g = GameDriver.of({ players: 4 });
    surrender(g, 'p3', 1000);
    expect(refuseReaction(g, 'p3', '🤦', 2000)).toBe('notActive');
    disconnect(g, 'p4', 2000);
    g.tickTo(17000); // grace over: p4 abandoned
    expect(g.player('p4').status).toBe('abandoned');
    expect(refuseReaction(g, 'p4', '🤦', 17000)).toBe('notActive');
    expect(react(g, 'p1', '😎', 17000)).toHaveLength(1);
  });

  it('allowed under interference (the bot reacts 😱 when hit, §9)', () => {
    const g = withPoints();
    send(g, 'p2', 'p1', 1000);
    expect(react(g, 'p1', '😱', 1500)).toHaveLength(1);
  });

  it('changes nothing else: no score, no lock, no timer', () => {
    const g = withPoints();
    g.select('p1', 'A2', 1000);
    const before = { score: g.score('p1'), lock: { ...g.lock('p1')! }, deadline: g.deadline };
    expect(g.types(react(g, 'p1', '😂', 2000))).toEqual(['reaction']);
    expect(g.score('p1')).toBe(before.score);
    expect(g.lock('p1')).toEqual(before.lock);
    expect(g.deadline).toBe(before.deadline);
  });

  it('reactionReadyAt in the view: 0 at first, then the last reaction + 2000', () => {
    const g = GameDriver.of();
    expect(g.view('p1').reactionReadyAt).toBe(0);
    react(g, 'p1', '🔥', 1000);
    expect(g.view('p1').reactionReadyAt).toBe(3000);
    expect(g.view('p2').reactionReadyAt).toBe(0);
    expect(g.view(null).reactionReadyAt).toBe(0);
    react(g, 'p1', '🔥', 4200);
    expect(g.view('p1').reactionReadyAt).toBe(6200);
  });

  it('works in a game against a bot', () => {
    const g = GameDriver.of({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] });
    expect(react(g, 'bot', '😂', 1000)[0]).toMatchObject({ playerId: 'bot', emoji: '😂' });
    expect(react(g, 'me', '😎', 1000)[0]).toMatchObject({ playerId: 'me', emoji: '😎' });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('replay (§13.1)', () => {
  it('interferences, their end, the frozen timers and reactions all rebuild from the log', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    g.solve('p2', 'B7', 0);
    g.select('p3', 'A2', 500);
    send(g, 'p1', 'p3', 1000, 'fireworks');
    react(g, 'p3', '😱', 1200);
    send(g, 'p2', 'p1', 2000, 'warp');
    react(g, 'p1', '🤦', 2100);
    g.tickTo(9000);
    send(g, 'p1', 'p3', 9000, 'cats');
    expect(g.replayMatches()).toBe(true);
  });
});
