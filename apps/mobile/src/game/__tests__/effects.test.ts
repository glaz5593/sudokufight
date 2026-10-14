import { type HostUpdate, THINK_TIME_MS } from '@sudoku-fight/engine';
import { MUTED_REACTION_EMOJI } from '@sudoku-fight/protocol';

import { effectsOf, matchEffectsOf, type UiEffect } from '../effects';
import { answerIn, emptyCellsOf, PUZZLE, testHost, wrongIn } from '../testing/practice';

const EMPTY = emptyCellsOf(PUZZLE);
const [A, B, C] = EMPTY as [number, number, number];

/** A real game (me and a bot, or me alone) whose updates are turned into effects as they come. */
function game(players: 'solo' | 'withBot' = 'withBot') {
  const t =
    players === 'solo'
      ? testHost()
      : testHost({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] });
  const updates: HostUpdate[] = [];
  t.host.subscribe((u) => updates.push(u));
  /** The effects of the updates since the last call. */
  const next = (): UiEffect[] => updates.splice(0).flatMap((u) => effectsOf(u, 'me'));
  const bot = (action: { type: 'select'; cell: number } | { type: 'place'; cell: number; digit: number }) =>
    t.host.dispatch({ ...action, playerId: 'bot' } as Parameters<typeof t.host.dispatch>[0]);
  return { ...t, next, bot };
}

describe('effectsOf (spec §6.2–§6.5)', () => {
  it('a correct digit: the points, the breakdown and the score after it; mine', () => {
    const g = game();
    g.host.select(A);
    expect(g.next()).toEqual([
      { kind: 'locked', seq: expect.any(Number), cell: A, playerId: 'me', byMe: true },
    ]);
    g.scheduler.advance(2000);
    g.host.place(A, answerIn(PUZZLE, A));
    const [fx] = g.next();
    const view = g.host.getView();
    expect(fx).toEqual({
      kind: 'correct',
      seq: view.seq,
      cell: A,
      digit: answerIn(PUZZLE, A),
      points: view.players[0]!.score,
      breakdown: expect.objectContaining({ points: view.players[0]!.score }),
      playerId: 'me',
      score: view.players[0]!.score,
      byMe: true,
    });
  });

  it('a wrong digit: the penalty, then the cell released [D3]', () => {
    const g = game();
    g.host.select(A);
    g.next();
    const digit = wrongIn(PUZZLE, A);
    g.host.place(A, digit);
    expect(g.next()).toEqual([
      {
        kind: 'wrong',
        seq: expect.any(Number),
        cell: A,
        digit,
        penalty: 1,
        playerId: 'me',
        score: -1,
        byMe: true,
      },
      { kind: 'released', seq: expect.any(Number), cell: A, reason: 'mistake', playerId: 'me', byMe: true },
    ]);
  });

  it("someone else's moves are not mine", () => {
    const g = game();
    g.bot({ type: 'select', cell: A });
    g.bot({ type: 'place', cell: A, digit: answerIn(PUZZLE, A) });
    g.bot({ type: 'select', cell: B });
    g.bot({ type: 'place', cell: B, digit: wrongIn(PUZZLE, B) });
    expect(g.next().map((fx) => [fx.kind, 'byMe' in fx && fx.byMe, 'playerId' in fx && fx.playerId])).toEqual(
      [
        ['locked', false, 'bot'],
        ['correct', false, 'bot'],
        ['locked', false, 'bot'],
        ['wrong', false, 'bot'],
        ['released', false, 'bot'],
      ],
    );
  });

  it('"taken": my select on a cell the bot holds (a buzz, no penalty)', () => {
    const g = game();
    g.bot({ type: 'select', cell: A });
    g.next();
    g.host.select(A);
    expect(g.next()).toEqual([{ kind: 'taken', cell: A }]);
    expect(g.host.getView().players[0]!.score).toBe(0);
  });

  it('other refusals carry the reason, and the cell when the action had one', () => {
    const g = game('solo');
    g.host.select(A);
    g.host.release();
    g.next();
    g.host.select(A); // the re-lock wait [D2]
    expect(g.next()).toEqual([{ kind: 'refused', reason: 'cooldown', cell: A }]);
    g.host.release(); // nothing to let go of
    expect(g.next()).toEqual([{ kind: 'refused', reason: 'noLock' }]);
    const given = [...PUZZLE.givens].findIndex((c) => c !== '0');
    g.host.select(given);
    expect(g.next()).toEqual([{ kind: 'refused', reason: 'cellFilled', cell: given }]);
  });

  it('releases by cancel, switch and timeout', () => {
    const g = game('solo');
    g.host.select(A);
    g.host.release();
    g.host.select(B);
    g.host.select(C);
    g.scheduler.advance(THINK_TIME_MS.fast + 1);
    expect(g.next().filter((fx) => fx.kind === 'released')).toEqual([
      expect.objectContaining({ cell: A, reason: 'cancel', byMe: true }),
      expect.objectContaining({ cell: B, reason: 'switch', byMe: true }),
      expect.objectContaining({ cell: C, reason: 'timeout', byMe: true }),
    ]);
  });

  it('the end of the game, with its id', () => {
    const g = game('solo');
    g.host.surrender();
    const fx = g.next();
    expect(fx.at(-1)).toEqual({ kind: 'ended', seq: g.host.getView().seq, gameId: 'test-game' });
  });

  it('a whole game: one correct effect per empty cell, and one end', () => {
    const g = game('solo');
    for (const cell of EMPTY) {
      g.scheduler.advance(1000);
      g.host.select(cell);
      g.host.place(cell, answerIn(PUZZLE, cell));
    }
    const fx = g.next();
    expect(fx.filter((f) => f.kind === 'correct')).toHaveLength(EMPTY.length);
    expect(fx.filter((f) => f.kind === 'ended')).toHaveLength(1);
    const lastMove = fx.filter((f) => f.kind === 'correct').at(-1);
    expect(lastMove).toMatchObject({ points: 1.5 }); // the last cell is always worth 1.5 (spec §6.4)
  });

  it('a spectator (no id) owns nothing; events with no effect give none', () => {
    const g = game();
    g.host.select(A);
    const updates: HostUpdate[] = [];
    g.host.subscribe((u) => updates.push(u));
    g.host.react('😎');
    expect(updates.flatMap((u) => effectsOf(u, 'me'))).toEqual([]);
    g.host.place(A, answerIn(PUZZLE, A));
    expect(effectsOf(updates.at(-1)!, null)).toEqual([
      expect.objectContaining({ kind: 'correct', byMe: false }),
    ]);
  });
});

describe('matchEffectsOf (spec §7, §8)', () => {
  /** The match effects of the updates since the last call. */
  function match() {
    const g = game();
    const updates: HostUpdate[] = [];
    g.host.subscribe((u) => updates.push(u));
    const next = (myId: string | null = 'me') => updates.splice(0).flatMap((u) => matchEffectsOf(u, myId));
    return { ...g, next };
  }

  it('a reaction, the bot’s or mine; board moves and refusals have none', () => {
    const g = match();
    g.bot({ type: 'select', cell: A });
    g.bot({ type: 'place', cell: A, digit: answerIn(PUZZLE, A) });
    g.host.dispatch({ type: 'react', playerId: 'bot', emoji: '😂' });
    g.host.react('😎');
    g.host.react('😎'); // too soon [D19]: refused, nothing to show
    expect(g.next()).toEqual([
      { kind: 'reaction', seq: expect.any(Number), playerId: 'bot', emoji: '😂', byMe: false },
      { kind: 'reaction', seq: expect.any(Number), playerId: 'me', emoji: '😎', byMe: true },
    ]);
  });

  it('a reaction the server muted for me (spec §3.5: I blocked its sender) is nothing at all', () => {
    const update: HostUpdate = {
      kind: 'events',
      view: game().host.getView(),
      events: [
        { type: 'reaction', seq: 7, t: 1, playerId: 'nina', emoji: MUTED_REACTION_EMOJI },
        { type: 'reaction', seq: 8, t: 2, playerId: 'pip', emoji: '🔥' },
      ],
    } as HostUpdate;
    expect(matchEffectsOf(update, 'me')).toEqual([
      { kind: 'reaction', seq: 8, playerId: 'pip', emoji: '🔥', byMe: false },
    ]);
  });

  it('an interference on me: its sender, kind, cost and end; then its end', () => {
    const g = match();
    g.bot({ type: 'select', cell: A });
    g.bot({ type: 'place', cell: A, digit: answerIn(PUZZLE, A) });
    g.next();
    g.host.dispatch({ type: 'interfere', playerId: 'bot', targetId: 'me', kind: 'cats' });
    const view = g.host.getView();
    const [hit] = g.next();
    expect(hit).toEqual({
      kind: 'interference',
      seq: view.seq,
      fromId: 'bot',
      targetId: 'me',
      interference: 'cats',
      cost: 2,
      senderScore: view.players[1]!.score,
      endsAt: view.players[0]!.hitBy!.expiresAt,
      onMe: true,
      byMe: false,
    });
    g.scheduler.advance(5_000);
    expect(g.next()).toEqual([
      {
        kind: 'interferenceEnded',
        seq: expect.any(Number),
        fromId: 'bot',
        targetId: 'me',
        interference: 'cats',
        onMe: true,
        byMe: false,
      },
    ]);
  });

  it('mine on the bot is by me, not on me; a spectator is neither', () => {
    const g = match();
    g.host.select(A);
    g.host.place(A, answerIn(PUZZLE, A));
    g.next();
    g.host.interfere('bot', 'warp');
    const updates: HostUpdate[] = [];
    g.host.subscribe((u) => updates.push(u));
    expect(g.next()).toEqual([expect.objectContaining({ kind: 'interference', onMe: false, byMe: true })]);
    g.host.react('🔥');
    expect(matchEffectsOf(updates.at(-1)!, null)).toEqual([
      expect.objectContaining({ kind: 'reaction', byMe: false }),
    ]);
  });
});
