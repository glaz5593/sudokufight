import {
  defaultRules,
  type GameConfig,
  type GameEvent,
  ManualClock,
  ManualScheduler,
  publicState,
  replay,
  toPublicEvent,
} from '@sudoku-fight/engine';

import { ServerGame } from '../../game/serverGame';
import { digitAt, emptyCells, NEARLY_DONE, wrongDigitAt } from '../game';
import { GameMirror } from './mirror';

/** A server game on a manual clock, and every public event it sent. */
function serverGame() {
  const clock = new ManualClock(Date.UTC(2026, 9, 9, 12));
  const config: GameConfig = {
    id: 'g1',
    mode: 'ranked',
    gameType: 'fast',
    puzzle: NEARLY_DONE,
    players: [
      { id: 'ana', name: 'Ana' },
      { id: 'ben', name: 'Ben' },
    ],
    rules: defaultRules('ranked', 'fast'),
    seed: 1,
  };
  const sent: GameEvent[] = [];
  const game = new ServerGame({
    config,
    clock,
    scheduler: new ManualScheduler(clock),
    onUpdate: ({ events }) => sent.push(...events.map(toPublicEvent)),
  });
  return { game, clock, sent };
}

const [C1, C2, C3, C4] = emptyCells(NEARLY_DONE) as [number, number, number, number];

describe('GameMirror', () => {
  it('a snapshot moved on by the events is the server state, without the solution', () => {
    const { game, clock, sent } = serverGame();
    const mirror = new GameMirror();
    mirror.snapshot(game.publicState(), 'ana');
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    clock.advance(500);
    game.act('ana', { type: 'place', cell: C1, digit: digitAt(NEARLY_DONE, C1) });
    game.act('ben', { type: 'select', cell: C2 });

    expect(mirror.events(sent).map((e) => e.seq)).toEqual(sent.map((e) => e.seq));
    expect(mirror.state).toEqual(game.publicState());
    expect(mirror.state!.config.puzzle.solution).toBe('');
    expect(mirror.playerId).toBe('ana');
    expect(mirror.inSync).toBe(true);
    expect(mirror.snapshots).toBe(1);
  });

  it('skips events it already has, and stops at a gap until the next snapshot', () => {
    const { game, sent } = serverGame();
    const mirror = new GameMirror();
    mirror.snapshot(game.publicState(), 'ben');
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    game.act('ben', { type: 'select', cell: C2 });
    const [started, locked1, locked2] = sent as [GameEvent, GameEvent, GameEvent];

    expect(mirror.events([started, locked1])).toEqual([started, locked1]);
    expect(mirror.events([started, locked1])).toEqual([]); // again: duplicates
    expect(mirror.duplicates).toBe(2);

    game.act('ben', { type: 'release' });
    const released = sent[3]!;
    // locked2 never came: a gap. Nothing after it is applied.
    expect(mirror.events([released])).toEqual([]);
    expect(mirror.gaps).toBe(1);
    expect(mirror.inSync).toBe(false);
    expect(mirror.events([locked2, released])).toEqual([]);
    expect(mirror.state!.seq).toBe(locked1.seq);

    // A snapshot puts it right.
    mirror.snapshot(game.publicState(), 'ben');
    expect(mirror.inSync).toBe(true);
    expect(mirror.state).toEqual(game.publicState());
  });

  it('ignores events before any snapshot', () => {
    const { game, sent } = serverGame();
    game.start();
    const mirror = new GameMirror();
    expect(mirror.events(sent)).toEqual([]);
    expect(mirror.state).toBeNull();
    expect(mirror.inSync).toBe(false);
  });

  it('stateAt: any state since the last snapshot, as the server had it', () => {
    const { game, clock, sent } = serverGame();
    game.start();
    const mirror = new GameMirror();
    mirror.snapshot(game.publicState(), 'ana'); // after the start: seq 2
    game.act('ana', { type: 'select', cell: C1 });
    clock.advance(300);
    game.act('ana', { type: 'place', cell: C1, digit: wrongDigitAt(NEARLY_DONE, C1) });
    game.act('ben', { type: 'select', cell: C3 });
    mirror.events(sent);
    const server = replay(game.events).map(publicState);

    for (let seq = 2; seq <= game.state.seq; seq++) expect(mirror.stateAt(seq)).toEqual(server[seq - 1]);
    expect(mirror.stateAt(1)).toBeNull(); // before the snapshot
    expect(mirror.stateAt(game.state.seq + 1)).toBeNull(); // not yet
  });

  it('with the solution after gameOver it is the server final state; a running snapshot with it is a leak', () => {
    const { game, sent } = serverGame();
    const mirror = new GameMirror();
    mirror.snapshot(game.publicState(), 'ana');
    game.start();
    for (const cell of [C1, C2, C3, C4]) {
      game.act('ana', { type: 'select', cell });
      game.act('ana', { type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
    }
    mirror.events(sent);
    expect(mirror.state!.status).toBe('over');
    expect(mirror.state).not.toEqual(game.publicState()); // the server's has the solution now
    mirror.solution(game.solution);
    expect(mirror.state).toEqual(game.publicState());
    expect(mirror.leaks).toBe(0);

    mirror.snapshot({ ...game.state, status: 'running' }, 'ana');
    expect(mirror.leaks).toBe(1);
  });
});
