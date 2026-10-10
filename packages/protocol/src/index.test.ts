import {
  CELL_COUNT,
  defaultRules,
  evolve,
  type GameState,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
  parseCellName,
  publicState,
  toView,
} from '@sudoku-fight/engine';

import {
  asGameHost,
  CLIENT_MESSAGE_TYPES,
  type ClientMessage,
  GAME_ROOM_NAME,
  type GameHost,
  normalizeRoomCode,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from './index';

const PUZZLE = {
  id: 'p',
  givens: '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
  solution: '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
};

describe('protocol', () => {
  it('has a version', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('lists the client messages of spec §18', () => {
    expect(CLIENT_MESSAGE_TYPES).toEqual([
      'select',
      'release',
      'place',
      'interfere',
      'react',
      'surrender',
      'ping',
    ]);
  });

  it('lists the server messages: the events of spec §18 travel inside `events`', () => {
    expect(SERVER_MESSAGE_TYPES).toEqual([
      'lobby',
      'countdown',
      'snapshot',
      'events',
      'rejected',
      'solution',
      'pong',
    ]);
  });

  it('builds on the engine package', () => {
    const msg: ClientMessage = { type: 'select', cell: 31, clientSeq: 1 };
    expect(msg.type === 'select' && msg.cell < CELL_COUNT).toBe(true);
  });
});

describe('GameHost', () => {
  it('LocalGameHost plays a game through the interface alone', () => {
    const clock = new ManualClock(0);
    const host: GameHost = asGameHost(
      new LocalGameHost({
        config: {
          id: 'g',
          mode: 'solo',
          gameType: 'fast',
          puzzle: PUZZLE,
          players: [{ id: 'me' }],
          rules: defaultRules('solo', 'fast'),
        },
        playerId: 'me',
        clock,
        scheduler: new ManualScheduler(clock),
      }),
    );
    const kinds: string[] = [];
    host.subscribe((u) => kinds.push(u.kind));
    const a1 = parseCellName('A1');
    host.select(a1);
    host.place(a1, 8);
    expect(host.getView().grid[a1]).toBe(8);
    host.select(parseCellName('A3')); // a given: refused
    expect(kinds).toEqual(['events', 'events', 'rejected']);
    host.surrender();
    expect(host.getView().status).toBe('over');
    host.close();
  });
});

describe('a client mirror (how RemoteGameHost will work, stage 7)', () => {
  it('a public snapshot plus the public events, through evolve and toView, give the same view as the host', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({
      config: {
        id: 'g',
        mode: 'bot',
        gameType: 'fast',
        puzzle: PUZZLE,
        players: [{ id: 'me' }, { id: 'bot', isBot: true }],
        rules: defaultRules('bot', 'fast'),
      },
      playerId: 'me',
      clock,
      scheduler,
    });
    // What the server would send on join: no solution while the game runs.
    const snapshot: ServerMessage = {
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: publicState(host.state),
      playerId: 'me',
    };
    expect(JSON.stringify(snapshot)).not.toContain(PUZZLE.solution);
    let mirror = (snapshot as { state: GameState }).state;
    host.subscribe((u) => {
      if (u.kind !== 'events') return;
      for (const e of u.events) mirror = evolve(mirror, e);
      expect(toView(mirror, 'me', clock.now())).toEqual(u.view);
    });

    const a1 = parseCellName('A1');
    host.select(a1);
    host.place(a1, 8);
    host.dispatch({ type: 'select', playerId: 'bot', cell: parseCellName('A2') });
    clock.set(500);
    host.interfere('bot', 'cats');
    scheduler.advance(9000); // the bot's lock times out, the interference ends
    host.react('😎');
    expect(mirror.seq).toBe(host.state.seq);
    expect(JSON.stringify(mirror)).not.toContain(PUZZLE.solution);
  });
});

describe('the game room (stage 7)', () => {
  it('is called "game"', () => {
    expect(GAME_ROOM_NAME).toBe('game');
  });

  it('codes are 6 characters from an alphabet without look-alikes (0/O, 1/I/L)', () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    for (const ch of '01OIL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('normalises a typed code: case, spaces and dashes', () => {
    expect(normalizeRoomCode('abc234')).toBe('ABC234');
    expect(normalizeRoomCode(' ab-c 2-34 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23')).toBeNull(); // too short
    expect(normalizeRoomCode('ABC2345')).toBeNull(); // too long
    expect(normalizeRoomCode('ABC230')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode('ABCDÉF')).toBeNull();
  });
});
