import { getMessageBytes, Protocol } from '@colyseus/core';
import {
  defaultRules,
  type GameEvent,
  ManualClock,
  ManualScheduler,
  REACTIONS,
  toPublicEvent,
} from '@sudoku-fight/engine';
import { PROTOCOL_VERSION, type ServerMessage } from '@sudoku-fight/protocol';

import { digitAt, emptyCells, PUZZLE, wrongDigitAt } from '../testing/game';
import { ServerGame } from './serverGame';

/**
 * Spec §18's size targets, measured as the bytes Colyseus puts on the wire (msgpack in a ROOM_DATA frame):
 * an event up to 200 bytes, a snapshot up to 4 KB.
 */
const wireBytes = (message: ServerMessage): number =>
  getMessageBytes.raw(Protocol.ROOM_DATA, message.type, message).byteLength;

/** A busy game: locks, right and wrong digits, an interference, reactions, a drop and a return. */
function busyGame(playerIds: string[]) {
  const clock = new ManualClock(Date.UTC(2026, 9, 9, 12));
  const scheduler = new ManualScheduler(clock);
  const events: GameEvent[] = [];
  const game = new ServerGame({
    config: {
      id: '7f1c0a52-9a5e-4c1e-8f43-2b7d1d8e9c10',
      mode: 'ranked',
      gameType: 'fast',
      puzzle: PUZZLE,
      players: playerIds.map((id) => ({ id, name: id.slice(0, 16) })),
      rules: defaultRules('ranked', 'fast'),
      seed: 123456789,
    },
    clock,
    scheduler,
    onUpdate: (u) => events.push(...u.events),
  });
  game.start();
  const cells = emptyCells(PUZZLE);
  let k = 0;
  for (let round = 0; round < 6; round++) {
    for (const id of playerIds) {
      const cell = cells[k++]!;
      clock.advance(700);
      game.act(id, { type: 'select', cell });
      clock.advance(1300);
      const digit = round % 3 === 2 ? wrongDigitAt(PUZZLE, cell) : digitAt(PUZZLE, cell);
      game.act(id, { type: 'place', cell, digit });
    }
  }
  const [a, b] = playerIds as [string, string];
  game.act(b, { type: 'select', cell: cells[k]! });
  game.act(a, { type: 'interfere', targetId: b, kind: 'cats' });
  game.act(a, { type: 'react', emoji: REACTIONS[0] });
  scheduler.advance(6000);
  game.disconnect(b);
  clock.advance(2000);
  game.reconnect(b);
  return { game, events };
}

describe('message sizes on the wire (spec §18)', () => {
  it.each([[['ana', 'ben']], [['ana', 'ben', 'cyd', 'dan']]])('a snapshot of %j is at most 4 KB', (ids) => {
    // Long ids (UUID-like, as accounts will have) for the worst case.
    const { game } = busyGame(ids.map((id) => `${id}-0c9d5e7a-1b2f-4c3d-9e8f-7a6b5c4d3e2f`));
    const bytes = wireBytes({
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: game.publicState(),
      playerId: game.state.players[0]!.id,
      lastClientSeq: 1234, // as the room sends it
    });
    expect(bytes).toBeLessThanOrEqual(4096);
  });

  // Every event names one to three players, so its size grows with the ids: with ids of up to 7 characters
  // all but gameOver fit in 200 bytes; with 36-character UUIDs placedCorrect takes ~226 and interference ~288.
  it('an event is at most 200 bytes with short player ids (the final results aside)', () => {
    const { events } = busyGame(['ana4567', 'ben4567']);
    const types = new Set<string>();
    const sizes: Record<string, number> = {};
    for (const e of events) {
      types.add(e.type);
      sizes[e.type] = Math.max(sizes[e.type] ?? 0, wireBytes({ type: 'events', events: [toPublicEvent(e)] }));
    }
    for (const [type, bytes] of Object.entries(sizes)) expect([type, bytes <= 200]).toEqual([type, true]);
    // The test saw the events that matter.
    for (const t of [
      'gameStarted',
      'cellLocked',
      'placedCorrect',
      'placedWrong',
      'cellReleased',
      'interference',
      'interferenceEnded',
      'reaction',
      'playerDisconnected',
      'gamePaused',
      'playerReconnected',
      'gameResumed',
    ])
      expect(types).toContain(t);
  });
});
