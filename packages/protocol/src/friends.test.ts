import {
  extractFriendCode,
  FRIEND_CODE_LENGTH,
  friendCodeFromLink,
  FRIENDS_APP_ERRORS,
  FRIENDS_CLOSE_REASONS,
  FRIENDS_ERROR_CODES,
  FRIENDS_ERROR_STATUS,
  FRIENDS_JOIN_RESULTS,
  FRIENDS_LOBBY_COMMAND_TYPES,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  FRIENDS_PATHS,
  FRIENDS_ROOM_CLOSED_REASONS,
  FRIENDS_ROOM_NAME,
  friendsErrorOf,
  friendsJoinResultOf,
  friendsLobbyCommandOf,
  type FriendRoomTicket,
  formatFriendCode,
  GAME_ROOM_ERRORS,
  GAME_ROOM_NAME,
  gameRoomErrorOf,
  isFriendCode,
  isFriendRoomTicket,
  type LobbyPlayer,
  MATCHMAKING_ROOM_NAME,
  normalizeFriendCode,
  roomAppLink,
  roomLink,
  roomLinkPath,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
  TELEMETRY_EVENT_GENERATION,
  TELEMETRY_EVENT_NAMES,
} from './index';

const LRI = '\u2066';
const PDI = '\u2069';
const LRM = '\u200e';
const RLM = '\u200f';
const NBSP = '\u00a0';

describe('the room and its code [D86]', () => {
  it('a room of its own, 2–4 players, 6 digits', () => {
    expect(FRIENDS_ROOM_NAME).toBe('friends');
    expect([GAME_ROOM_NAME, MATCHMAKING_ROOM_NAME]).not.toContain(FRIENDS_ROOM_NAME);
    expect(FRIEND_CODE_LENGTH).toBe(6);
    expect([FRIENDS_MIN_PLAYERS, FRIENDS_MAX_PLAYERS]).toEqual([2, 4]);
  });

  it('normalizeFriendCode: spaces, dashes, dots, bidi marks and other digits come off', () => {
    for (const typed of [
      '123456',
      ' 123456 ',
      '123 456',
      `123${NBSP}456`,
      '123-456',
      '123\u2013456',
      '12 34 56',
      '1 2 3 4 5 6',
      '123.456',
      `${LRI}123 456${PDI}`,
      `${LRM}123456${RLM}`,
      '\u0661\u0662\u0663\u0664\u0665\u0666', // Arabic-Indic
      '\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6', // Eastern Arabic-Indic
      '\uff11\uff12\uff13\uff14\uff15\uff16', // full width
    ])
      expect([typed, normalizeFriendCode(typed)]).toEqual([typed, '123456']);
    expect(normalizeFriendCode('000000')).toBe('000000');
  });

  it('normalizeFriendCode: anything else is not a code', () => {
    for (const bad of [
      '',
      '12345',
      '1234567',
      '12345a',
      'ABCDEF',
      '123:456',
      '123,456',
      '+123456',
      '1'.repeat(65),
    ])
      expect([bad, normalizeFriendCode(bad)]).toEqual([bad, null]);
    for (const bad of [null, undefined, 123456, {}, ['123456']]) expect(normalizeFriendCode(bad)).toBeNull();
    expect(isFriendCode('123456')).toBe(true);
    expect(isFriendCode('123 456')).toBe(false);
    expect(isFriendCode(123456)).toBe(false);
  });

  it('formatFriendCode: "123 456", and leaves what is not a code alone', () => {
    expect(formatFriendCode('123456')).toBe('123 456');
    expect(formatFriendCode('123-456')).toBe('123 456');
    expect(formatFriendCode('000042')).toBe('000 042');
    expect(formatFriendCode('abc')).toBe('abc');
  });
});

describe('extractFriendCode: the code in a pasted message (§3.3)', () => {
  const link = 'https://sudoku-fight-staging.fly.dev/r/654321';

  it('the share message in Hebrew and in English, whole', () => {
    expect(extractFriendCode(`בוא לשחק איתי סודוקו פייט! קוד החדר: 123456\n${link}`)).toBe('654321');
    expect(extractFriendCode('בוא לשחק איתי סודוקו פייט! קוד החדר: 123456')).toBe('123456');
    expect(extractFriendCode('Join me in Sudoku Fight! Room code: 123456\nhttps://x.example/r/123456')).toBe(
      '123456',
    );
  });

  it('a code as the screens show it, inside Hebrew text', () => {
    expect(extractFriendCode(`קוד החדר ${LRI}123 456${PDI}, בוא!`)).toBe('123456');
    expect(extractFriendCode('קוד: 123-456.')).toBe('123456');
    expect(extractFriendCode('קוד 123456.')).toBe('123456');
    expect(extractFriendCode('(123456)')).toBe('123456');
  });

  it('a link alone: https, http, or the app’s own', () => {
    expect(extractFriendCode(link)).toBe('654321');
    expect(extractFriendCode('http://192.168.1.20:2567/r/111222?lang=en')).toBe('111222');
    expect(extractFriendCode('open sudokufight://room/333444 now')).toBe('333444');
  });

  it('a code alone, typed in any spacing', () => {
    expect(extractFriendCode('1 2 3 4 5 6')).toBe('123456');
    expect(extractFriendCode(' 123 456 ')).toBe('123456');
  });

  it('not a code: phone numbers, longer numbers, times, dates, glued numbers', () => {
    for (const text of [
      'call me 054-1234567',
      'call me 054 123 4567',
      '054-123-456',
      '123 456 789',
      '1234567',
      'at 12:30 on 20.10.2026',
      '123456.78',
      '12:345678',
      '1/234567',
      'price 1,234,567',
      'no digits here',
      '',
    ])
      expect([text, extractFriendCode(text)]).toEqual([text, null]);
    expect(extractFriendCode(null)).toBeNull();
    expect(extractFriendCode(42)).toBeNull();
  });

  it('a link whose code is not 6 digits is no code; the first good one counts', () => {
    expect(extractFriendCode('https://h/r/1234567')).toBeNull();
    expect(extractFriendCode('first 111111 then 222222')).toBe('111111');
  });
});

describe('links [D87, D88]', () => {
  it('roomLink: a host name or an origin, default ports and slashes dropped', () => {
    expect(roomLink('sudoku-fight-staging.fly.dev', '123456')).toBe(
      'https://sudoku-fight-staging.fly.dev/r/123456',
    );
    expect(roomLink('https://sudoku-fight-prod.fly.dev/', '123456')).toBe(
      'https://sudoku-fight-prod.fly.dev/r/123456',
    );
    expect(roomLink('https://sudoku-fight-prod.fly.dev:443', '123 456')).toBe(
      'https://sudoku-fight-prod.fly.dev/r/123456',
    );
    expect(roomLink('http://192.168.1.20:2567', '000001')).toBe('http://192.168.1.20:2567/r/000001');
    expect(roomLink('http://localhost:80', '123456')).toBe('http://localhost/r/123456');
    expect(() => roomLink('h', '12345')).toThrow(RangeError);
  });

  it('roomAppLink and the paths', () => {
    expect(roomAppLink('123456')).toBe('sudokufight://room/123456');
    expect(() => roomAppLink('x')).toThrow(RangeError);
    expect(roomLinkPath('123456')).toBe('/r/123456');
    expect(FRIENDS_PATHS).toEqual({
      rooms: '/v1/rooms',
      join: '/v1/rooms/join',
      link: '/r/:code',
      assetLinks: '/.well-known/assetlinks.json',
      appleAppSiteAssociation: '/.well-known/apple-app-site-association',
    });
  });

  it('friendCodeFromLink: our links only, with a 6-digit code', () => {
    const host = 'sudoku-fight-staging.fly.dev';
    expect(friendCodeFromLink(`https://${host}/r/123456`, host)).toBe('123456');
    expect(friendCodeFromLink(`https://${host.toUpperCase()}:443/r/123456/?x=1#y`, host)).toBe('123456');
    expect(friendCodeFromLink(`https://${host}/r/123456`)).toBe('123456');
    expect(friendCodeFromLink('http://192.168.1.20:2567/r/123456', '192.168.1.20')).toBe('123456');
    expect(friendCodeFromLink('sudokufight://room/123456')).toBe('123456');
    expect(friendCodeFromLink('sudokufight:///room/123456?ref=wa')).toBe('123456');
    expect(friendCodeFromLink('/r/123456')).toBe('123456');
    expect(friendCodeFromLink('/room/123456')).toBe('123456');
    for (const url of [
      `https://evil.example/r/123456`,
      `https://${host}.evil.example/r/123456`,
      `https://${host}/r/12345`,
      `https://${host}/r/1234567`,
      `https://${host}/r/abcdef`,
      `https://${host}/x/123456`,
      `https://${host}/r/123456abc`,
      'sudokufight://room/1234',
      'sudokufight://levels',
      '/r/',
      '',
    ])
      expect([url, friendCodeFromLink(url, host)]).toEqual([url, null]);
  });
});

describe('the HTTP answers', () => {
  it('each error code has its status', () => {
    expect(Object.keys(FRIENDS_ERROR_STATUS).sort()).toEqual([...FRIENDS_ERROR_CODES].sort());
    expect(FRIENDS_ERROR_STATUS).toMatchObject({
      notFound: 404,
      roomFull: 409,
      gameStarted: 409,
      roomClosed: 410,
      kicked: 403,
      cantJoin: 403,
      tooManyRooms: 409,
      tooManyRequests: 429,
      suspended: 403,
    });
    // §7.2's codes are all there (notHost and notEnoughPlayers are the room's: FRIENDS_LOBBY_ERRORS).
    for (const code of ['notFound', 'roomFull', 'gameStarted', 'roomClosed', 'kicked', 'cantJoin'])
      expect(FRIENDS_ERROR_CODES).toContain(code);
    expect(FRIENDS_APP_ERRORS).toEqual(['network', 'notAvailable']);
  });

  it('friendsErrorOf: a room that is not there, against a server without the routes', () => {
    expect(friendsErrorOf(404, { error: 'notFound', rooms: true })).toBe('notFound');
    // An older server's 404 for an unknown route: the feature is not there yet.
    expect(friendsErrorOf(404, { error: 'notFound' })).toBe('notAvailable');
    expect(friendsErrorOf(404, '<html>')).toBe('notAvailable');
    expect(friendsErrorOf(404, { error: 'notRegistered', rooms: true })).toBe('notRegistered');
    expect(friendsErrorOf(409, { error: 'roomFull', rooms: true })).toBe('roomFull');
    expect(friendsErrorOf(429, { error: 'tooManyRequests' })).toBe('tooManyRequests');
    expect(friendsErrorOf(429, null)).toBe('tooManyRequests');
    expect(friendsErrorOf(401, {})).toBe('unauthorized');
    expect(friendsErrorOf(400, { error: 'weird' })).toBe('badRequest');
    expect(friendsErrorOf(413, undefined)).toBe('tooLarge');
    expect(friendsErrorOf(502, 'Bad gateway')).toBe('unavailable');
    expect(friendsErrorOf(500, { error: 'internal' })).toBe('internal');
    expect(friendsErrorOf(418, {})).toBe('internal');
  });

  const ticket: FriendRoomTicket = {
    reservation: { name: 'friends', sessionId: 's1', roomId: 'r-long-random-id' },
    room: {
      code: '123456',
      gameType: 'fast',
      players: 1,
      maxPlayers: 4,
      state: 'lobby',
      host: { name: 'MosheG', avatarId: 'av00', country: 'IL' },
    },
  };

  it('isFriendRoomTicket takes a good answer and refuses a broken one', () => {
    expect(isFriendRoomTicket(ticket)).toBe(true);
    expect(
      isFriendRoomTicket({
        ...ticket,
        room: { ...ticket.room, host: { ...ticket.room.host, country: null } },
      }),
    ).toBe(true);
    expect(isFriendRoomTicket({ ...ticket, room: { ...ticket.room, state: 'playing' } })).toBe(true);
    for (const bad of [
      null,
      {},
      { ...ticket, reservation: { ...ticket.reservation, sessionId: '' } },
      { ...ticket, reservation: undefined },
      { ...ticket, room: { ...ticket.room, code: '123 456' } },
      { ...ticket, room: { ...ticket.room, gameType: 'blitz' } },
      { ...ticket, room: { ...ticket.room, players: 5 } },
      { ...ticket, room: { ...ticket.room, players: -1 } },
      { ...ticket, room: { ...ticket.room, state: 'gone' } },
      { ...ticket, room: { ...ticket.room, host: { ...ticket.room.host, avatarId: 'nope' } } },
      { ...ticket, room: { ...ticket.room, host: { ...ticket.room.host, country: 'XX' } } },
      { ...ticket, room: { ...ticket.room, host: null } },
    ])
      expect(isFriendRoomTicket(bad)).toBe(false);
  });
});

describe('in the room', () => {
  it('the host’s three commands, checked', () => {
    expect(FRIENDS_LOBBY_COMMAND_TYPES).toEqual(['start', 'setGameType', 'kick']);
    expect(friendsLobbyCommandOf('start', {})).toEqual({ type: 'start' });
    expect(friendsLobbyCommandOf('start', undefined)).toEqual({ type: 'start' });
    expect(friendsLobbyCommandOf('start', { type: 'start', withoutAway: ['u2'] })).toEqual({
      type: 'start',
      withoutAway: ['u2'],
    });
    expect(friendsLobbyCommandOf('setGameType', { gameType: 'hard' })).toEqual({
      type: 'setGameType',
      gameType: 'hard',
    });
    expect(friendsLobbyCommandOf('kick', { playerId: 'u-3_x' })).toEqual({ type: 'kick', playerId: 'u-3_x' });
    for (const [type, message] of [
      ['start', { withoutAway: 'u2' }],
      ['start', { withoutAway: ['u1', 'u2', 'u3', 'u4', 'u5'] }],
      ['start', { withoutAway: ['../x'] }],
      ['setGameType', { gameType: 'blitz' }],
      ['setGameType', {}],
      ['kick', { playerId: '' }],
      ['kick', { playerId: 42 }],
      ['place', { cell: 1 }],
      [42, {}],
    ] as const)
      expect(friendsLobbyCommandOf(type, message)).toBeNull();
  });

  it('the new server messages are listed, and the lobby commands are not game actions', () => {
    expect(SERVER_MESSAGE_TYPES).toContain('lobbyRefused');
    expect(SERVER_MESSAGE_TYPES).toContain('roomClosed');
    const refused: ServerMessage = {
      type: 'lobbyRefused',
      command: 'start',
      reason: 'playersAway',
      away: ['u2'],
    };
    const closed: ServerMessage = { type: 'roomClosed', reason: 'otherDevice' };
    expect([refused.type, closed.type]).toEqual(['lobbyRefused', 'roomClosed']);
    expect(FRIENDS_ROOM_CLOSED_REASONS).toEqual([
      'kicked',
      'removed',
      'otherDevice',
      'serverRestart',
      'closed',
    ]);
    // No reason says "blocked" [D85c].
    expect(FRIENDS_ROOM_CLOSED_REASONS.join(' ')).not.toMatch(/block/i);
  });

  it('a friends lobby: the old fields, and optional new ones an older app ignores', () => {
    const seat: LobbyPlayer = {
      id: 'u1',
      name: 'MosheG',
      avatarId: 'av00',
      country: 'IL',
      rating: 1287,
      away: true,
    };
    const lobby: ServerMessage = {
      type: 'lobby',
      code: '123456',
      gameType: 'fast',
      playerCount: FRIENDS_MAX_PLAYERS,
      players: [seat, { id: 'u2', name: 'Dana' }],
      playerId: 'u1',
      hostId: 'u1',
      minPlayers: FRIENDS_MIN_PLAYERS,
      maxPlayers: FRIENDS_MAX_PLAYERS,
    };
    expect(lobby.type === 'lobby' && lobby.players.map((p) => p.away ?? false)).toEqual([true, false]);
  });

  it('a join refused in the room carries a GameRoomError', () => {
    expect(GAME_ROOM_ERRORS).toEqual(expect.arrayContaining(['gameStarted', 'kicked', 'roomClosed']));
    expect(gameRoomErrorOf('kicked: the host removed you')).toBe('kicked');
    expect(gameRoomErrorOf('roomClosed: closed')).toBe('roomClosed');
  });
});

describe('usage data: generation 3, no ids and no codes (§7.4)', () => {
  const FRIENDS_EVENTS = [
    'friends_room_open',
    'friends_room_join',
    'friends_invite_share',
    'friends_link_open',
    'friends_room_start',
    'friends_room_close',
  ];

  it('six events of generation 3; the older ones keep theirs', () => {
    expect(TELEMETRY_EVENT_NAMES.filter((n) => TELEMETRY_EVENT_GENERATION[n] === 3)).toEqual(FRIENDS_EVENTS);
    expect(TELEMETRY_EVENT_NAMES.filter((n) => TELEMETRY_EVENT_GENERATION[n] === 2)).toHaveLength(6);
    expect(TELEMETRY_EVENT_NAMES).toHaveLength(26);
    expect(TELEMETRY_EVENT_GENERATION.game_end).toBe(1);
  });

  it('a join result is ok, a refusal a player can meet, the app’s own, or other', () => {
    for (const r of FRIENDS_JOIN_RESULTS)
      expect([r, ['ok', 'other', ...FRIENDS_ERROR_CODES, ...FRIENDS_APP_ERRORS].includes(r)]).toEqual([
        r,
        true,
      ]);
    expect(friendsJoinResultOf('roomFull')).toBe('roomFull');
    expect(friendsJoinResultOf('network')).toBe('network');
    expect(friendsJoinResultOf('internal')).toBe('other');
    expect(friendsJoinResultOf('whatever')).toBe('other');
    expect(FRIENDS_CLOSE_REASONS).toContain('left');
    expect(FRIENDS_CLOSE_REASONS).toContain('abandoned');
  });
});
