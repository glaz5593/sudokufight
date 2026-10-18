import {
  cellName,
  evolve,
  formatScoreLine,
  type GameEvent,
  type GameState,
  missedPoints,
  type Rules,
  stripIsolates,
  TECHNIQUES,
} from '@sudoku-fight/engine';

import { buildReplay, nextMoment, type Replay, stepAtFraction, stepView } from '../replayModel';
import { botGame, configOf, fourPlayerGame, softDropDuel, soloGame, Table } from '../testing/games';

/**
 * The replay model (spec §13; work plan stage 11) on real engine games: a solo practice, a practice played by
 * the engine's bot, and a four-player ranked game with every kind of step.
 */

const EXPLAINED = new Set<string>([...TECHNIQUES, 'chain']);

/** The engine's state after every event, rebuilt one event at a time (the reference for the replay). */
function statesOf(events: readonly GameEvent[]): GameState[] {
  const out: GameState[] = [];
  let s: GameState | null = null;
  for (const e of events) {
    s = evolve(s, e);
    out.push(s);
  }
  return out;
}

/** Spec §13: stepping through every step reproduces the game, and every step covers the log in order. */
function expectFaithful(replay: Replay, events: readonly GameEvent[], final: GameState) {
  const reference = statesOf(events);
  let next = 0;
  for (const step of replay.steps) {
    expect(step.from).toBe(next);
    expect(step.to).toBeGreaterThanOrEqual(step.from);
    next = step.to + 1;
    const view = stepView(replay, step.index, 'he');
    expect(view.state).toEqual(reference[step.to]);
  }
  expect(next).toBe(events.length);
  const last = stepView(replay, replay.steps.length - 1, 'he');
  expect(last.state).toEqual(final);
  expect(last.number).toBe(replay.steps.length);
  expect(last.total).toBe(replay.steps.length);
}

/** Spec §13.2: a correct move is explained (to whoever made it) with a technique and the right digit. */
function expectCorrectMovesExplained(replay: Replay, lang: 'he' | 'en' = 'he') {
  const correct = replay.steps.filter((s) => s.kind === 'correct');
  expect(correct.length).toBeGreaterThan(0);
  for (const s of correct) {
    const view = stepView(replay, s.index, lang);
    const mine = view.explanations.find((x) => x.playerId === s.playerId)!;
    const right = replay.solution![s.cell!];
    expect(mine).toMatchObject({ status: 'correct', live: true, cell: s.cell, answer: right, played: right });
    expect(EXPLAINED.has(mine.technique!)).toBe(true);
    expect(mine.techniqueName).toMatch(/\S/);
    const text = stripIsolates(mine.text!);
    expect(text).toContain(cellName(s.cell!));
    expect(text).toContain(String(right));
    expect(mine.scoreLine).toBe(formatScoreLine(s.breakdown!));
  }
}

describe('a solo practice', () => {
  const table = soloGame();
  const replay = buildReplay(table.log, { me: 'me' });

  it('is a step per action: start, select, correct, wrong, release (cancel, timeout), end practice', () => {
    expect(replay.steps.map((s) => (s.kind === 'release' ? `release:${s.releaseReason}` : s.kind))).toEqual([
      'start',
      'select',
      'correct',
      'select',
      'correct',
      'select',
      'wrong',
      'select',
      'release:cancel',
      'select',
      'release:timeout',
      'select',
      'correct',
      'surrender',
    ]);
    expect(replay.steps[0]!.playerId).toBeNull();
    expect(replay.steps.at(-1)!.ends).toBe(true);
    expect(replay.complete).toBe(true);
    expect(replay.result?.reason).toBe('practiceEnded');
    expect(replay.players).toEqual([
      expect.objectContaining({ id: 'me', name: 'Moshe', isMe: true, colorIndex: 0, isBot: false }),
    ]);
  });

  it('reproduces every state of the game, step by step', () => {
    expectFaithful(replay, table.log, table.state);
  });

  it('explains every correct move with a technique, the right digit and the score line', () => {
    expectCorrectMovesExplained(replay, 'he');
    expectCorrectMovesExplained(replay, 'en');
  });

  it('explains the mistake: the right digit, why, and why the played one was wrong', () => {
    const wrong = replay.steps.find((s) => s.kind === 'wrong')!;
    const mine = stepView(replay, wrong.index, 'en').explanations[0]!;
    expect(mine.status).toBe('wrong');
    expect(mine.played).toBe(wrong.digit);
    expect(mine.answer).toBe(replay.solution![wrong.cell!]);
    expect(mine.answer).not.toBe(mine.played);
    expect(mine.wrongText).toMatch(new RegExp(`^${wrong.digit} `));
    expect(stripIsolates(mine.text!)).toContain(cellName(wrong.cell!));
    expect(mine.scoreLine).toBeNull();
  });

  it('explains the penalty: what the right digit would have scored there, with the same formula (§6.5, §13.2)', () => {
    const wrong = replay.steps.find((s) => s.kind === 'wrong')!;
    const event = table.log.find((e) => e.type === 'placedWrong')!;
    const mine = stepView(replay, wrong.index, 'he').explanations[0]!;
    expect(mine.penalty).toBe(event.type === 'placedWrong' && event.penalty);
    const before = replay.states[wrong.main! - 1]!.grid;
    const missed = missedPoints(before, wrong.cell!, mine.answer!);
    expect(mine.penalty).toBe(missed.points);
    expect(mine.penaltyLine).toBe(formatScoreLine(missed));
    expect(mine.penaltyLine).toMatch(/^points = 9 − \d \+ \(9 − \d\) \/ 2 = [\d.]+$/);
    expect(replay.penaltiesAreMissedPoints).toBe(true);
    // Only a wrong move has one.
    const correct = replay.steps.find((s) => s.kind === 'correct')!;
    expect(stepView(replay, correct.index, 'he').explanations[0]!.penaltyLine).toBeNull();
  });

  it('a game played before the rule (the 1, 2, 4, 8 ladder) shows no penalty line on any wrong move', () => {
    // Two mistakes under today's rule: both explained.
    const now = new Table(configOf('solo', [{ id: 'me', name: 'Moshe' }], { id: 'two-misses' }));
    now.miss('me', now.cells[0]!);
    now.miss('me', now.cells[1]!);
    const fresh = buildReplay(now.log, { me: 'me' });
    const lines = (r: Replay) =>
      r.steps
        .filter((s) => s.kind === 'wrong')
        .map((s) => stepView(r, s.index, 'he').explanations[0]!)
        .map((x) => ({ status: x.status, penalty: x.penalty, line: x.penaltyLine }));
    expect(fresh.penaltiesAreMissedPoints).toBe(true);
    expect(lines(fresh).every((x) => x.line !== null)).toBe(true);

    // The same game as app 1.0.0 stored it: the [D14] cap in its rules and the first mistake charged 1. The
    // second one keeps a value missed points could have (as a 2, 4 or 8 of the ladder can), and still gets
    // no line: the whole game was played under the old rule.
    let k = 0;
    const stored = now.log.map((e): GameEvent => {
      if (e.type === 'gameCreated') {
        const rules = { ...e.config.rules, mistakePenaltyCap: null } as Rules;
        return { ...e, config: { ...e.config, rules } };
      }
      return e.type === 'placedWrong' && k++ === 0 ? { ...e, penalty: 1 } : e;
    });
    const old = buildReplay(stored, { me: 'me' });
    expect(old.penaltiesAreMissedPoints).toBe(false);
    const recorded = stored.flatMap((e) => (e.type === 'placedWrong' ? [e.penalty] : []));
    expect(recorded[0]).toBe(1);
    expect(lines(old)).toEqual(recorded.map((penalty) => ({ status: 'wrong', penalty, line: null })));
  });

  it('teaching mode: a choice shows its answer at once; a choice let go of says why', () => {
    const selects = replay.steps.filter((s) => s.kind === 'select');
    const choosing = stepView(replay, selects[0]!.index, 'he').explanations[0]!;
    expect(choosing).toMatchObject({ status: 'choosing', live: true, played: null });
    expect(choosing.answer).toBe(replay.solution![selects[0]!.cell!]);
    expect(choosing.text).toMatch(/\S/);

    const cancel = replay.steps.find((s) => s.releaseReason === 'cancel')!;
    expect(stepView(replay, cancel.index, 'he').explanations[0]).toMatchObject({
      status: 'released',
      releaseReason: 'cancel',
      cell: cancel.cell,
    });
    const timeout = replay.steps.find((s) => s.releaseReason === 'timeout')!;
    expect(stepView(replay, timeout.index, 'he').explanations[0]).toMatchObject({
      status: 'released',
      releaseReason: 'timeout',
    });
  });

  it('nobody has been explained before the first choice', () => {
    expect(stepView(replay, 0, 'he').explanations).toEqual([
      expect.objectContaining({ playerId: 'me', status: 'none', text: null }),
    ]);
  });

  it('runs the game clock from the start, and the timeline marks correct and wrong moves', () => {
    expect(replay.steps[0]!.clockMs).toBe(0);
    const clocks = replay.steps.map((s) => s.clockMs);
    expect([...clocks].sort((a, b) => a - b)).toEqual(clocks);
    expect(replay.steps.at(-1)!.clockMs).toBe(replay.durationMs);
    expect(replay.timeline.map((d) => d.kind)).toEqual(['correct', 'correct', 'wrong', 'correct']);
    expect(replay.timeline.every((d) => d.colorIndex === 0)).toBe(true);
  });

  it('key moments: the best move and the mistake; no turning point alone', () => {
    const correct = replay.steps.filter((s) => s.kind === 'correct');
    const best = Math.max(...correct.map((s) => s.points!));
    expect(replay.steps[replay.keyMoments.bestMove!]!.points).toBe(best);
    expect(replay.keyMoments.mistakes).toEqual([replay.steps.find((s) => s.kind === 'wrong')!.index]);
    expect(replay.keyMoments.interferences).toEqual([]);
    expect(replay.keyMoments.turningPoint).toBeNull();
  });

  it('draws what the engine draws: the view at the step, the solution only once it is over', () => {
    const select = replay.steps.find((s) => s.kind === 'select')!;
    const view = stepView(replay, select.index, 'he').view;
    expect(view.players[0]!.lock?.cell).toBe(select.cell);
    expect(view.solution).toBeNull();
    expect(stepView(replay, replay.steps.length - 1, 'he').view.solution).toBe(table.config.puzzle.solution);
  });
});

describe('a practice against the engine bot, to the end', () => {
  const game = botGame(3);
  const replay = buildReplay(game.events, { me: 'me' });

  it('reproduces the whole game', () => {
    expect(replay.complete).toBe(true);
    expectFaithful(replay, game.events, game.host.state);
  });

  it('explains every correct move, mine and the bot’s', () => {
    expectCorrectMovesExplained(replay);
    const players = new Set(replay.steps.filter((s) => s.kind === 'correct').map((s) => s.playerId));
    expect(players).toEqual(new Set(['me', game.botId]));
  });

  it('explains both players at every step (spec §13.2: two explanations in a two-player game)', () => {
    for (const s of replay.steps) {
      const { explanations } = stepView(replay, s.index, 'he');
      expect(explanations.map((x) => x.playerId)).toEqual(['me', game.botId]);
      for (const x of explanations) {
        if (x.status === 'none') continue;
        expect(x.answer).toBe(replay.solution![x.cell!]);
      }
    }
  });

  it('colours the bot as P2 and me as P1', () => {
    expect(replay.players.map((p) => [p.id, p.colorIndex, p.isBot])).toEqual([
      ['me', 0, false],
      [game.botId, 1, true],
    ]);
  });
});

describe('a four-player ranked game', () => {
  const table = fourPlayerGame();
  const replay = buildReplay(table.log, { me: 'p2' });

  it('has every kind of step: moves, a mistake, an interference, a disconnect and return, a surrender, an abandonment', () => {
    const kinds = new Set(replay.steps.map((s) => s.kind));
    for (const k of [
      'start',
      'select',
      'correct',
      'wrong',
      'interference',
      'disconnect',
      'reconnect',
      'surrender',
      'abandon',
    ])
      expect(kinds).toContain(k);
    const hit = replay.steps.find((s) => s.kind === 'interference')!;
    expect(hit).toMatchObject({ playerId: 'p2', targetId: 'p1', interference: 'cats', cost: 2 });
    expect(stepView(replay, hit.index, 'he').state.players[0]!.hitBy).toMatchObject({ fromId: 'p2' });
  });

  it('reproduces every state', () => {
    expectFaithful(replay, table.log, table.state);
  });

  it('explains all four players at every step [D26 not approved: in full, for everyone]', () => {
    expectCorrectMovesExplained(replay);
    for (const s of replay.steps) {
      const { explanations } = stepView(replay, s.index, 'en');
      expect(explanations).toHaveLength(4);
      for (const x of explanations) {
        if (x.status === 'none') continue;
        expect(x.text).toMatch(/\S/);
        expect(x.answer).toBe(replay.solution![x.cell!]);
      }
    }
    // After everyone has played, nobody is left without an explanation.
    const late = stepView(replay, replay.steps.length - 1, 'he').explanations;
    expect(late.every((x) => x.status !== 'none')).toBe(true);
  });

  it('keeps the explanation of the disconnected player’s choice, let go of by the disconnect', () => {
    const away = replay.steps.find((s) => s.kind === 'disconnect')!;
    const x = stepView(replay, away.index, 'he').explanations[3]!;
    expect(x).toMatchObject({ playerId: 'p4', status: 'released', releaseReason: 'disconnect' });
  });

  it('marks the lead changing hands: the turning point is the last change', () => {
    const changes: number[] = [];
    let held: string | null = null;
    replay.leaders.forEach((l, k) => {
      if (l === null) return;
      if (held !== null && l !== held) changes.push(k);
      held = l;
    });
    expect(changes.length).toBeGreaterThan(0);
    expect(replay.keyMoments.turningPoint).toBe(changes.at(-1));
    expect(replay.keyMoments.interferences).toHaveLength(1);
    expect(replay.keyMoments.mistakes).toHaveLength(1);
  });

  it('colours me (p2) as P1 and the others P2–P4 by seat', () => {
    expect(replay.players.map((p) => [p.id, p.colorIndex])).toEqual([
      ['p1', 1],
      ['p2', 0],
      ['p3', 2],
      ['p4', 3],
    ]);
    expect(replay.timeline.filter((d) => d.playerId === 'p2').every((d) => d.colorIndex === 0)).toBe(true);
  });
});

describe('a lost connection in its soft phase (D42)', () => {
  const table = softDropDuel();
  const replay = buildReplay(table.log, { me: 'me' });

  it('the loss is a step of its own; the digits sent on the return are steps like any, marked offline', () => {
    const offline = replay.steps.filter((s) => s.kind === 'offline');
    expect(offline).toHaveLength(1);
    expect(offline[0]).toMatchObject({ playerId: 'nina', cell: null, offline: false });
    const marked = replay.steps.filter((s) => s.offline);
    expect(marked.map((s) => [s.kind, s.playerId])).toEqual([
      ['correct', 'nina'],
      ['wrong', 'nina'],
    ]);
    expect(replay.steps.filter((s) => s.kind === 'correct' && !s.offline).length).toBeGreaterThan(0);
    // Nothing froze: no disconnect step, and the game ran all along.
    expect(replay.steps.some((s) => s.kind === 'disconnect')).toBe(false);
    expect(stepView(replay, offline[0]!.index, 'he').state.status).toBe('running');
  });

  it('reproduces every state', () => {
    expectFaithful(replay, table.log, table.state);
  });

  it('explains the digit sent on the return like any other', () => {
    const correct = replay.steps.find((s) => s.offline && s.kind === 'correct')!;
    const x = stepView(replay, correct.index, 'he').explanations.find((e) => e.playerId === 'nina')!;
    expect(x).toMatchObject({ status: 'correct', live: true, cell: correct.cell });
  });
});

describe('logs from outside', () => {
  it('skips repeated events and a damaged tail', () => {
    const table = soloGame();
    const events = table.log;
    const damaged = [...events.slice(0, 8), events[5]!, { ...events[8]!, seq: 99 }];
    const replay = buildReplay(damaged, { me: 'me' });
    expect(replay.events).toEqual(events.slice(0, 8));
    expect(replay.complete).toBe(false);
  });

  it('works without the solution (a log cut off mid-game): the logic finds the answer', () => {
    const table = soloGame();
    const [created, ...rest] = table.log;
    if (created!.type !== 'gameCreated') throw new Error('no gameCreated');
    const hidden: GameEvent = {
      ...created!,
      config: { ...created!.config, puzzle: { ...created!.config.puzzle, solution: '' } },
    };
    const replay = buildReplay([hidden, ...rest.slice(0, 5)], { me: 'me' });
    expect(replay.solution).toBeNull();
    const correct = replay.steps.find((s) => s.kind === 'correct')!;
    const x = stepView(replay, correct.index, 'he').explanations[0]!;
    expect(x.answer).toBe(correct.digit);
    expect(EXPLAINED.has(x.technique!)).toBe(true);
  });

  it('refuses a log without its creation', () => {
    expect(() => buildReplay([])).toThrow(RangeError);
  });

  it('a viewer who did not play sees the seats in their own colours', () => {
    const replay = buildReplay(soloGame().log, { me: 'stranger' });
    expect(replay.me).toBeNull();
    expect(replay.players[0]!.isMe).toBe(false);
  });
});

describe('helpers', () => {
  it('nextMoment goes round the list both ways', () => {
    expect(nextMoment([3, 8, 12], 5)).toBe(8);
    expect(nextMoment([3, 8, 12], 12)).toBe(3);
    expect(nextMoment([3, 8, 12], 5, -1)).toBe(3);
    expect(nextMoment([3, 8, 12], 3, -1)).toBe(12);
    expect(nextMoment([], 3)).toBeNull();
  });

  it('stepAtFraction maps the timeline to a step', () => {
    const steps = { steps: Array.from({ length: 11 }) } as unknown as Replay;
    expect(stepAtFraction(steps, 0)).toBe(0);
    expect(stepAtFraction(steps, 0.5)).toBe(5);
    expect(stepAtFraction(steps, 1)).toBe(10);
    expect(stepAtFraction(steps, 7)).toBe(10);
    expect(stepAtFraction(steps, -1)).toBe(0);
  });
});
