import {
  applyAction,
  createGame,
  defaultRules,
  type GameState,
  parseCellName,
  toView,
} from '@sudoku-fight/engine';

import { A8, F8, fourPlayerView, NOW, player, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import {
  barShares,
  cardModel,
  cardModels,
  colorIndexFor,
  leadModel,
  lockModel,
  mistakePips,
  pipsForWidth,
  timeLeft,
} from '../cardModel';
import { compactCardWidth } from '../metrics';

describe('colorIndexFor: me is always P1, the others P2–P4 by seat (CLAUDE.md)', () => {
  it('maps my seat to 0 wherever I sit', () => {
    expect(colorIndexFor(2, 2, [0, 1, 2, 3])).toBe(0);
    expect(colorIndexFor(0, 2, [0, 1, 2, 3])).toBe(1);
    expect(colorIndexFor(1, 2, [0, 1, 2, 3])).toBe(2);
    expect(colorIndexFor(3, 2, [0, 1, 2, 3])).toBe(3);
  });

  it('a spectator sees seats as they are', () => {
    expect(colorIndexFor(1, null, [0, 1])).toBe(1);
  });
});

describe('timeLeft', () => {
  it('counts down a running timer and holds a stopped one', () => {
    expect(timeLeft({ expiresAt: NOW + 4200, remainingMs: 99 }, NOW)).toBe(4200);
    expect(timeLeft({ expiresAt: NOW - 10, remainingMs: 0 }, NOW)).toBe(0);
    expect(timeLeft({ expiresAt: null, remainingMs: 3000 }, NOW)).toBe(3000);
  });
});

describe('cardModel: the opponent', () => {
  it('is "choosing A8" with its lock timer, in P2 colours', () => {
    const m = cardModel(twoPlayerView(), 'nina', 0, NOW);
    expect(m).toMatchObject({
      isMe: false,
      colorIndex: 1,
      name: 'NinaVolt',
      rating: 1305,
      score: 39.5,
      presence: 'online',
      out: null,
      mine: null,
      interference: { kind: 'available', cost: 2 },
    });
    expect(m.activity).toEqual({
      kind: 'locking',
      cell: 'A8',
      cellIndex: A8,
      remainingMs: 9000,
      // The deadline the ring drains toward on the UI thread (it starts again only when this changes).
      expiresAt: NOW + 9000,
      totalMs: 12000,
      secondsLeft: 9,
      paused: false,
      turn: false,
    });
  });

  it('shows a stopped lock as paused, with the time it had left (§6.2.7)', () => {
    const view = withPlayer(twoPlayerView(), 'nina', {
      lock: { cell: A8, expiresAt: null, remainingMs: 4100 },
    });
    expect(cardModel(view, 'nina', 0, NOW).activity).toMatchObject({
      paused: true,
      expiresAt: null,
      remainingMs: 4100,
      secondsLeft: 5,
    });
  });

  it('a disconnected opponent shows the grace countdown, and the ⚡ gives way to it (§16.2)', () => {
    let view = withPlayer(twoPlayerView(), 'nina', {
      connected: false,
      graceEndsAt: NOW + 11_300,
      lock: null,
    });
    view = {
      ...view,
      status: 'paused',
      interference: {
        nextCost: 2,
        missingPoints: 0,
        targets: [{ playerId: 'nina', blockedBy: 'disconnected' }],
      },
    };
    const m = cardModel(view, 'nina', 0, NOW);
    expect(m.presence).toBe('reconnecting');
    expect(m.activity).toEqual({ kind: 'reconnecting', secondsLeft: 12 });
    expect(m.interference).toEqual({ kind: 'disconnected', cost: 2 });
    // A second later the screen re-runs the model and the countdown moves on.
    expect(cardModel(view, 'nina', 0, NOW + 1000).activity).toEqual({
      kind: 'reconnecting',
      secondsLeft: 11,
    });
  });

  it('maps every interference block reason (§7.2) [D10, D11]', () => {
    const target = (
      blockedBy: 'out' | 'disconnected' | 'busy' | 'points' | 'notRunning' | null,
      busyUntil?: number,
    ) =>
      cardModel(
        twoPlayerView({
          interference: {
            nextCost: 8,
            missingPoints: blockedBy === 'points' ? 3 : 0,
            targets: [{ playerId: 'nina', blockedBy, ...(busyUntil === undefined ? null : { busyUntil }) }],
          },
        }),
        'nina',
        0,
        NOW,
      ).interference;

    expect(target(null)).toEqual({ kind: 'available', cost: 8 });
    expect(target('points')).toEqual({ kind: 'points', cost: 8, missing: 3 });
    expect(target('busy', NOW + 3400)).toEqual({ kind: 'busy', cost: 8, secondsLeft: 4 });
    expect(target('notRunning')).toEqual({ kind: 'notRunning', cost: 8 });
    expect(target('disconnected')).toEqual({ kind: 'disconnected', cost: 8 });
    expect(target('out')).toEqual({ kind: 'out', cost: 8 });
  });

  it('has no ⚡ when interferences are off or I cannot send any', () => {
    expect(cardModel(twoPlayerView({ interference: null }), 'nina', 0, NOW).interference).toBeNull();
  });

  it('an opponent in the soft phase of a lost connection [D42]: "unstable", still playing, no countdown', () => {
    const view = withPlayer(twoPlayerView(), 'nina', { softEndsAt: NOW + 8000 });
    const m = cardModel(view, 'nina', 0, NOW);
    expect(m.presence).toBe('unstable');
    expect(m.activity).toMatchObject({ kind: 'locking', cell: 'A8' });
    expect(m.out).toBeNull();
    // Hard (the grace) wins over soft; left wins over both.
    const hard = withPlayer(view, 'nina', { connected: false, graceEndsAt: NOW + 15_000 });
    expect(cardModel(hard, 'nina', 0, NOW).presence).toBe('reconnecting');
    const left = withPlayer(view, 'nina', { status: 'abandoned', connected: false });
    expect(cardModel(left, 'nina', 0, NOW).presence).toBe('left');
  });

  it('marks a player who left or surrendered (§6.7, D36)', () => {
    const left = cardModel(
      withPlayer(twoPlayerView(), 'nina', { status: 'abandoned', lock: null }),
      'nina',
      0,
      NOW,
    );
    expect(left).toMatchObject({ presence: 'left', out: 'abandoned', activity: { kind: 'left' } });
    const gaveUp = cardModel(withPlayer(twoPlayerView(), 'nina', { status: 'surrendered' }), 'nina', 0, NOW);
    expect(gaveUp).toMatchObject({
      presence: 'online',
      out: 'surrendered',
      activity: { kind: 'surrendered' },
    });
  });

  it('carries an interference on the player for the hit chip (§7.4)', () => {
    const view = withPlayer(twoPlayerView(), 'nina', {
      hitBy: { fromId: 'moshe', kind: 'cats', expiresAt: NOW + 2500, remainingMs: 2500 },
    });
    expect(cardModel(view, 'nina', 0, NOW).hit).toEqual({
      fromId: 'moshe',
      kind: 'cats',
      secondsLeft: 3,
      paused: false,
    });
  });

  it('thinks without a lock, and is quiet before the start and after the end', () => {
    const free = withPlayer(twoPlayerView(), 'nina', { lock: null });
    expect(cardModel(free, 'nina', 0, NOW).activity).toEqual({ kind: 'thinking' });
    expect(cardModel({ ...free, status: 'over' }, 'nina', 0, NOW).activity).toEqual({ kind: 'idle' });
  });

  it("in the 'turns' model shows whose turn it is [D1]", () => {
    const turns = twoPlayerView({
      rules: { ...twoPlayerView().rules, turnModel: 'turns' },
      turn: { playerId: 'nina', expiresAt: NOW + 5000, remainingMs: 5000 },
    });
    expect(cardModel(turns, 'nina', 0, NOW).activity).toMatchObject({ kind: 'locking', turn: true });
    const noLock = withPlayer(turns, 'nina', { lock: null });
    expect(cardModel(noLock, 'nina', 0, NOW).activity).toEqual({ kind: 'turn', secondsLeft: 5 });
  });
});

describe('cardModel: me', () => {
  it('is P1 with my own actions and no ⚡', () => {
    const m = cardModel(twoPlayerView(), 'moshe', 0, NOW);
    expect(m).toMatchObject({ isMe: true, colorIndex: 0, mistakes: 1, interference: null, isLeader: true });
    expect(m.mine).toEqual({ practice: false, canSurrender: true, reactionReady: true });
  });

  it('calls it practice outside ranked games (§6.6) and waits out the reaction cooldown [D19]', () => {
    const m = cardModel(twoPlayerView({ mode: 'bot', reactionReadyAt: NOW + 1500 }), 'moshe', 0, NOW);
    expect(m.mine).toMatchObject({ practice: true, reactionReady: false });
    expect(cardModel(twoPlayerView({ status: 'over' }), 'moshe', 0, NOW).mine?.canSurrender).toBe(false);
  });

  it('without my connection (its soft phase) [D42]: marked, and neither surrender nor reactions', () => {
    const m = cardModel(withPlayer(twoPlayerView(), 'moshe', { softEndsAt: NOW + 5000 }), 'moshe', 0, NOW);
    expect(m.presence).toBe('unstable');
    expect(m.mine).toEqual({ practice: false, canSurrender: false, reactionReady: false });
  });

  it('fails loudly for a player who is not in the game', () => {
    expect(() => cardModel(twoPlayerView(), 'ghost', 0, NOW)).toThrow(RangeError);
  });

  it('keeps the seat order for every card (spec §6.8)', () => {
    const models = cardModels(fourPlayerView(), 0, NOW);
    expect(models.map((m) => m.seat)).toEqual([0, 1, 2, 3]);
    expect(models.map((m) => m.place)).toEqual([3, 4, 2, 1]);
  });
});

describe('mistakePips (§7.2)', () => {
  it('shows the last two penalties the engine charged, halves kept, and "×n" from five mistakes', () => {
    expect(mistakePips(0, [])).toEqual({ overflow: null, penalties: [] });
    expect(mistakePips(1, [8])).toEqual({ overflow: null, penalties: [8] });
    expect(mistakePips(2, [8, 6.5])).toEqual({ overflow: null, penalties: [8, 6.5] });
    expect(mistakePips(4, [8, 6.5, 6, 5])).toEqual({ overflow: null, penalties: [6, 5] });
    expect(mistakePips(5, [8, 6.5, 6, 5, 3.5])).toEqual({ overflow: 5, penalties: [5, 3.5] });
  });

  it('shows what it has when a snapshot from an older server lists fewer penalties than mistakes', () => {
    expect(mistakePips(3, [])).toEqual({ overflow: null, penalties: [] });
    expect(mistakePips(6, [4.5])).toEqual({ overflow: 6, penalties: [4.5] });
  });

  it('a list it is given stays as it was', () => {
    const penalties = [8, 6.5, 6];
    mistakePips(3, penalties).penalties.push(1);
    expect(penalties).toEqual([8, 6.5, 6]);
  });

  it('as many as the card has room for: two in a 3-player card, the last one in 4 players or beside "×n"', () => {
    const two = mistakePips(2, [8, 6.5]);
    // 3 players: 114 dp each.
    expect(pipsForWidth(two, compactCardWidth(3, false))).toEqual({ overflow: null, penalties: [8, 6.5] });
    // 4 players: mine 106, the others 78 ("−15.5 −8 −7.5" is ~111 dp, more than either).
    expect(pipsForWidth(two, compactCardWidth(4, true))).toEqual({ overflow: null, penalties: [6.5] });
    expect(pipsForWidth(two, compactCardWidth(4, false))).toEqual({ overflow: null, penalties: [6.5] });
    // "×n" takes the room of one.
    const many = mistakePips(6, [8, 6.5, 6, 5, 3.5, 2]);
    expect(pipsForWidth(many, compactCardWidth(3, false))).toEqual({ overflow: 6, penalties: [2] });
    // Fewer than two, or a width not given: as they are.
    expect(pipsForWidth(mistakePips(1, [8]), 78)).toEqual({ overflow: null, penalties: [8] });
    expect(pipsForWidth(two, undefined)).toBe(two);
  });

  it("the card takes them from the view's mistakePenalties (§6.5), not from the mistake number", () => {
    expect(cardModel(twoPlayerView(), 'moshe', 0, NOW).pips).toEqual({ overflow: null, penalties: [6.5] });
    expect(cardModel(fourPlayerView(), 'nina', 0, NOW).pips).toEqual({
      overflow: null,
      penalties: [5.5, 4.5],
    });
  });

  it('a real game: the pips are the penalties of the events', () => {
    let state: GameState = createGame(
      {
        id: 'g',
        mode: 'ranked',
        gameType: 'fast',
        puzzle: {
          id: 'p',
          givens: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
          solution: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
        },
        players: [{ id: 'a' }, { id: 'b' }],
        rules: defaultRules('ranked', 'fast'),
      },
      0,
    ).state;
    const act = (action: Parameters<typeof applyAction>[1], now: number) => {
      state = applyAction(state, action, now).state;
    };
    act({ type: 'start' }, 0);
    for (const [k, cell] of ['A1', 'A2'].entries()) {
      act({ type: 'select', playerId: 'a', cell: parseCellName(cell) }, 1000 * k);
      act({ type: 'place', playerId: 'a', cell: parseCellName(cell), digit: 1 }, 1000 * k + 500);
    }
    const view = toView(state, 'a', 2000);
    expect(view.players[0]!.mistakePenalties).toEqual([8, 7.5]);
    expect(cardModel(view, 'a', 0, 2000).pips).toEqual({ overflow: null, penalties: [8, 7.5] });
  });
});

describe('the lead bar (§9)', () => {
  it('splits by score share, clamped to 6–94 %, and splits 0:0 evenly', () => {
    expect(barShares([55, 39.5])).toEqual([55 / 94.5, 39.5 / 94.5]);
    const [a, b] = barShares([100, 1]);
    expect(a).toBeCloseTo(0.94);
    expect(b).toBeCloseTo(0.06);
    expect(barShares([-4, 10])).toEqual([0.06, 0.94]);
    expect(barShares([0, 0])).toEqual([0.5, 0.5]);
  });

  it('keeps every one of four segments at 6 % or more, summing to 1', () => {
    const s = barShares([39, 36.5, 30.5, 0]);
    expect(Math.min(...s)).toBeCloseTo(0.06);
    expect(s.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });

  it('2 players: my segment first, under my card, and the leader by 15.5', () => {
    const m = leadModel(twoPlayerView(), 0);
    expect(m.segments.map((s) => [s.playerId, s.colorIndex])).toEqual([
      ['moshe', 0],
      ['nina', 1],
    ]);
    expect(m.splitShare).toBeCloseTo(55 / 94.5);
    expect(m.leader).toEqual({ playerId: 'moshe', colorIndex: 0, name: 'MosheG', gap: 15.5 });
    // Seen from NinaVolt's phone her segment comes first, and she is P1 there.
    expect(leadModel(twoPlayerView(), 1).segments.map((s) => [s.playerId, s.colorIndex])).toEqual([
      ['nina', 0],
      ['moshe', 1],
    ]);
  });

  it('a tie has no leader', () => {
    let view = withPlayer(twoPlayerView(), 'nina', { score: 55, place: 1, isLeader: true });
    expect(leadModel(view, 0).leader).toBeNull();
    // Equal scores split by fewer mistakes still read as a tie on the bar.
    view = withPlayer(view, 'nina', { isLeader: false, place: 2 });
    expect(leadModel(view, 0).leader).toBeNull();
  });

  it('3–4 players: segments by place, the tag between 1st and 2nd', () => {
    const m = leadModel(fourPlayerView(), 0);
    expect(m.segments.map((s) => s.playerId)).toEqual(['aiko', 'santi', 'moshe', 'nina']);
    expect(m.leader).toMatchObject({ playerId: 'aiko', colorIndex: 3, gap: 2.5 });
    expect(m.splitShare).toBe(m.segments[0]!.share);
  });
});

describe('lockModel (§10)', () => {
  it('shows my cell, its seconds rounded up, and the think time from the rules', () => {
    expect(lockModel(twoPlayerView(), NOW)).toEqual({
      kind: 'locked',
      cell: 'F8',
      cellIndex: F8,
      remainingMs: 6200,
      expiresAt: NOW + 6200,
      totalMs: 12000,
      secondsLeft: 7,
      paused: false,
      urgent: false,
    });
  });

  it('turns urgent in the last 3 seconds, never while paused', () => {
    expect(lockModel(twoPlayerView(), NOW + 3300)).toMatchObject({ secondsLeft: 3, urgent: true });
    const paused = withPlayer(twoPlayerView(), 'moshe', {
      lock: { cell: F8, expiresAt: null, remainingMs: 2000 },
    });
    expect(lockModel(paused, NOW)).toMatchObject({ paused: true, urgent: false, secondsLeft: 2 });
  });

  it('is empty without a lock, or for a spectator', () => {
    expect(lockModel(withPlayer(twoPlayerView(), 'moshe', { lock: null }), NOW)).toEqual({ kind: 'none' });
    expect(lockModel(twoPlayerView({ me: null }), NOW)).toEqual({ kind: 'none' });
  });
});

describe('with the real engine', () => {
  /** A valid solved grid: row r is the digits shifted by 3r + ⌊r/3⌋. */
  const SOLUTION = Array.from({ length: 81 }, (_, i) => {
    const r = Math.floor(i / 9);
    const c = i % 9;
    return ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;
  }).join('');
  const GIVENS = SOLUTION.split('')
    .map((d, i) => (i % 3 === 0 ? '0' : d))
    .join('');

  it('maps a fresh lock from toView()', () => {
    const config = {
      id: 'g',
      mode: 'ranked' as const,
      gameType: 'normal' as const,
      puzzle: { id: 'p', givens: GIVENS, solution: SOLUTION },
      players: [player({ id: 'a', seat: 0 }), player({ id: 'b', seat: 1 })].map((p) => ({
        id: p.id,
        name: p.id.toUpperCase(),
        rating: 1200,
      })),
      rules: defaultRules('ranked', 'normal'),
    };
    let state: GameState = createGame(config, 0).state;
    state = applyAction(state, { type: 'start' }, 0).state;
    const cell = parseCellName('A1');
    const locked = applyAction(state, { type: 'select', playerId: 'b', cell }, 1000);
    expect(locked.rejected).toBeUndefined();
    const view = toView(locked.state, 'a', 4000);

    const nina = cardModel(view, 'b', 0, 4000);
    expect(nina.activity).toMatchObject({ kind: 'locking', cell: 'A1', secondsLeft: 9, totalMs: 12000 });
    expect(nina.interference).toEqual({ kind: 'points', cost: 2, missing: 2 });
    expect(lockModel(view, 4000)).toEqual({ kind: 'none' });
  });

  it('a practice against a bot has no interferences either way: no "הפרעה" on the bot’s card [D44]', () => {
    const viewOf = (mode: 'bot' | 'ranked') => {
      const config = {
        id: `g-${mode}`,
        mode,
        gameType: 'normal' as const,
        puzzle: { id: 'p', givens: GIVENS, solution: SOLUTION },
        players: [
          { id: 'a', name: 'A' },
          { id: 'bot-3', name: 'Mr. Hoot', isBot: true },
        ],
        rules: defaultRules(mode, 'normal'),
      };
      let state: GameState = createGame(config, 0).state;
      state = applyAction(state, { type: 'start' }, 0).state;
      return toView(state, 'a', 1000);
    };
    const bot = viewOf('bot');
    expect(bot.rules.interferences).toBe(false);
    expect(bot.interference).toBeNull();
    expect(cardModel(bot, 'bot-3', 0, 1000).interference).toBeNull();
    // The same two players in a ranked game: the button is there (short of points at the start).
    expect(cardModel(viewOf('ranked'), 'bot-3', 0, 1000).interference).toEqual({
      kind: 'points',
      cost: 2,
      missing: 2,
    });
  });
});
