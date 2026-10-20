import {
  FRIEND_CODE_PATTERN,
  FRIENDS_ROOM_NAME,
  type FriendsRoomClosedReason,
  isFriendRoomTicket,
} from '@sudoku-fight/protocol';

import type { BlockPair } from '../moderation/watch';
import { fakeClock, type FakeClock, quietLog } from '../testing';
import type { LobbyMember } from './lobby';
import { FRIENDS_RULES } from './options';
import {
  type FriendRoomsResult,
  FriendRoomsService,
  type FriendsCaller,
  type FriendsRoomLink,
  type FriendsSeatAuth,
} from './service';

const MINUTE = 60_000;

const caller = (userId: string, more: Partial<FriendsCaller> = {}): FriendsCaller => ({
  userId,
  name: `${userId[0]!.toUpperCase()}${userId.slice(1)}`,
  suspended: false,
  ipKey: '203.0.113.7',
  ...more,
});

const cardOf = (userId: string, name: string): LobbyMember => ({
  id: userId,
  name,
  avatarId: 'noam',
  country: 'IL',
  rating: userId === 'ana' ? 1287 : null,
});

interface Opened {
  roomId: string;
  link: FriendsRoomLink;
  closedWith: FriendsRoomClosedReason[];
}

/** The service with a fake database and a fake Colyseus: rooms claim at once, reservations are recorded. */
function setup(
  rules: Partial<typeof FRIENDS_RULES> = {},
  codes: number[] = [],
  /** The block query takes this long (real time), as a database read does. */
  { blocksDelayMs = 0 }: { blocksDelayMs?: number } = {},
) {
  const clock: FakeClock = fakeClock();
  const blocks: BlockPair[] = [];
  const rooms: Opened[] = [];
  const reservations: { roomId: string; auth: FriendsSeatAuth; options: object }[] = [];
  let ids = 0;
  let draws = 0;
  const log = quietLog();
  let failOpen = false;
  let failReserve = false;
  const service: FriendRoomsService = new FriendRoomsService({
    store: {
      member: (userId, name) => Promise.resolve(cardOf(userId, name)),
      blocksAmong: (userIds) =>
        new Promise((resolve) => {
          const answer = () =>
            resolve(blocks.filter((b) => userIds.includes(b.blockerId) && userIds.includes(b.blockedId)));
          if (blocksDelayMs > 0) setTimeout(answer, blocksDelayMs);
          else answer();
        }),
    },
    opener: {
      open(claimId) {
        if (failOpen) return Promise.reject(new Error('no room'));
        const closedWith: FriendsRoomClosedReason[] = [];
        const link = service.claim(claimId, { close: (reason) => closedWith.push(reason) });
        if (!link) return Promise.reject(new Error('not claimed'));
        const roomId = `room-${rooms.length + 1}-long-and-random`;
        rooms.push({ roomId, link, closedWith });
        return Promise.resolve(roomId);
      },
      reserve(roomId, auth, options) {
        if (failReserve) return Promise.reject(new Error('full'));
        reservations.push({ roomId, auth, options });
        return Promise.resolve({ name: FRIENDS_ROOM_NAME, sessionId: `s${reservations.length}`, roomId });
      },
    },
    now: clock.now,
    random: (n) => (draws < codes.length ? codes[draws++]! % n : (draws++ * 7919) % n),
    newId: () => `claim-${++ids}`,
    log,
    rules,
  });
  return {
    service,
    clock,
    blocks,
    rooms,
    reservations,
    log,
    failOpen: (v: boolean) => (failOpen = v),
    failReserve: (v: boolean) => (failReserve = v),
  };
}

type Ok = Extract<FriendRoomsResult, { ok: true }>;

function ticketOf(result: FriendRoomsResult): Ok['ticket'] {
  if (!result.ok) throw new Error(`refused: ${result.error} (${result.message})`);
  expect(isFriendRoomTicket(result.ticket)).toBe(true);
  return result.ticket;
}

/** The app of `userId` enters with its ticket (the room's onJoin does this). */
function enter(room: Opened, userId: string): void {
  const r = room.link.lobby.connect(cardOf(userId, userId));
  if (!r.ok) throw new Error(`could not enter: ${r.error}`);
}

describe('the friends service: create', () => {
  it('opens a room with a 6-digit code, the caller its host with a seat reserved', async () => {
    const t = setup({}, [123456]);
    const ticket = ticketOf(
      await t.service.create(caller('ana'), { gameType: 'hard', interferenceKinds: ['cats'] }),
    );
    expect(ticket.room).toEqual({
      code: '123456',
      gameType: 'hard',
      players: 1,
      maxPlayers: 4,
      state: 'lobby',
      host: { name: 'Ana', avatarId: 'noam', country: 'IL' },
    });
    expect(ticket.room.code).toMatch(FRIEND_CODE_PATTERN);
    // The room's id is not the code.
    expect(ticket.reservation).toEqual({
      name: FRIENDS_ROOM_NAME,
      sessionId: 's1',
      roomId: t.rooms[0]!.roomId,
    });
    expect(ticket.reservation.roomId).not.toContain('123456');
    expect(t.reservations[0]).toEqual({
      roomId: t.rooms[0]!.roomId,
      auth: { userId: 'ana', name: 'Ana', member: cardOf('ana', 'Ana') },
      options: { interferenceKinds: ['cats'] },
    });
    expect(t.rooms[0]!.link.setup).toMatchObject({ code: '123456', gameType: 'hard', hostId: 'ana' });
    expect(t.rooms[0]!.link.lobby.hostId).toBe('ana');
  });

  it('defaults to "normal" [D82]', async () => {
    const t = setup();
    expect(ticketOf(await t.service.create(caller('ana'), {})).room.gameType).toBe('normal');
  });

  it('one open room per host: tooManyRooms with its code, and replace closes it first', async () => {
    const t = setup({}, [111111, 222222]);
    ticketOf(await t.service.create(caller('ana'), {}));
    enter(t.rooms[0]!, 'ana');
    expect(await t.service.create(caller('ana'), {})).toMatchObject({
      ok: false,
      error: 'tooManyRooms',
      code: '111111',
    });
    // Someone else may open one.
    ticketOf(await t.service.create(caller('ben'), {}));
    const second = ticketOf(await t.service.create(caller('ana'), { replace: true }));
    expect(t.rooms[0]!.closedWith).toEqual(['closed']);
    expect(second.room.code).not.toBe('111111');
    // The old code now says the room closed.
    expect(await t.service.join(caller('cy'), { code: '111111' })).toMatchObject({ error: 'roomClosed' });
  });

  it('a room whose host left is no longer theirs', async () => {
    const t = setup();
    const first = ticketOf(await t.service.create(caller('ana'), {}));
    enter(t.rooms[0]!, 'ana');
    ticketOf(await t.service.join(caller('ben'), { code: first.room.code }));
    enter(t.rooms[0]!, 'ben');
    t.rooms[0]!.link.lobby.leave('ana');
    ticketOf(await t.service.create(caller('ana'), {}));
    expect(t.rooms[0]!.closedWith).toEqual([]);
  });

  it('refuses a suspended account', async () => {
    const t = setup();
    expect(await t.service.create(caller('ana', { suspended: true }), {})).toMatchObject({
      ok: false,
      error: 'suspended',
    });
  });

  it('unavailable when no code is free, or the room does not open', async () => {
    const t = setup({ codeSpace: 1 });
    ticketOf(await t.service.create(caller('ana'), {}));
    expect(await t.service.create(caller('ben'), {})).toMatchObject({ ok: false, error: 'unavailable' });
    const u = setup();
    u.failOpen(true);
    expect(await u.service.create(caller('ana'), {})).toMatchObject({ ok: false, error: 'unavailable' });
    expect(u.service.openRooms()).toEqual([]);
    u.failOpen(false);
    ticketOf(await u.service.create(caller('ana'), {}));
  });

  it('a claim is single use', async () => {
    const t = setup();
    ticketOf(await t.service.create(caller('ana'), {}));
    expect(t.service.claim('claim-1', { close: () => undefined })).toBeUndefined();
    expect(t.service.claim('nobody', { close: () => undefined })).toBeUndefined();
  });
});

describe('the friends service: join', () => {
  async function room(t: ReturnType<typeof setup>) {
    const ticket = ticketOf(await t.service.create(caller('ana'), {}));
    enter(t.rooms[0]!, 'ana');
    return ticket.room.code;
  }

  it('gives a seat in the room with the code', async () => {
    const t = setup();
    const code = await room(t);
    const ticket = ticketOf(await t.service.join(caller('ben'), { code }));
    expect(ticket.room).toMatchObject({
      code,
      players: 2,
      state: 'lobby',
      host: { name: 'ana', avatarId: 'noam', country: 'IL' },
    });
    expect(ticket.reservation.roomId).toBe(t.rooms[0]!.roomId);
  });

  it('a wrong code: notFound; a closed room: roomClosed for 30 minutes, then notFound', async () => {
    const t = setup();
    const code = await room(t);
    expect(
      await t.service.join(caller('ben'), { code: '000000' === code ? '000001' : '000000' }),
    ).toMatchObject({
      ok: false,
      error: 'notFound',
    });
    // The room goes away (everyone left, its game ended...).
    t.rooms[0]!.link.closed();
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ ok: false, error: 'roomClosed' });
    t.clock.advance(30 * MINUTE);
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ ok: false, error: 'notFound' });
  });

  it('[D85c] someone in the room blocked me: notFound, exactly as a wrong code', async () => {
    const t = setup();
    const code = await room(t);
    t.blocks.push({ blockerId: 'ana', blockedId: 'ben' });
    const blocked = await t.service.join(caller('ben'), { code });
    const wrong = await t.service.join(caller('ben'), { code: code === '999999' ? '999998' : '999999' });
    expect(blocked).toEqual(wrong);
    expect(blocked).toMatchObject({ ok: false, error: 'notFound' });
  });

  it('[D85c] I blocked someone in the room: cantJoin', async () => {
    const t = setup();
    const code = await room(t);
    t.blocks.push({ blockerId: 'ben', blockedId: 'ana' });
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ ok: false, error: 'cantJoin' });
  });

  it('[D85c] blocks with someone on the way in count too', async () => {
    const t = setup();
    const code = await room(t);
    ticketOf(await t.service.join(caller('cy'), { code }));
    t.blocks.push({ blockerId: 'cy', blockedId: 'ben' });
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ error: 'notFound' });
  });

  it('refuses a suspended account', async () => {
    const t = setup();
    const code = await room(t);
    expect(await t.service.join(caller('ben', { suspended: true }), { code })).toMatchObject({
      error: 'suspended',
    });
  });

  it('[D85b] asks nothing about the email: a new, unverified account joins', async () => {
    const t = setup();
    const code = await room(t);
    // FriendsCaller has no email at all: nothing here can refuse one.
    ticketOf(await t.service.join(caller('newbie'), { code }));
  });

  it('[D85a] a kicked account is refused kicked', async () => {
    const t = setup();
    const code = await room(t);
    ticketOf(await t.service.join(caller('ben'), { code }));
    enter(t.rooms[0]!, 'ben');
    expect(t.rooms[0]!.link.lobby.kick('ana', 'ben').ok).toBe(true);
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ ok: false, error: 'kicked' });
  });

  it('the fifth one: roomFull', async () => {
    const t = setup();
    const code = await room(t);
    for (const id of ['ben', 'cy', 'dan']) ticketOf(await t.service.join(caller(id), { code }));
    expect(await t.service.join(caller('eve'), { code })).toMatchObject({ ok: false, error: 'roomFull' });
  });

  it('the same account again gets its own seat (another device, the app closed)', async () => {
    const t = setup();
    const code = await room(t);
    ticketOf(await t.service.join(caller('ben'), { code }));
    enter(t.rooms[0]!, 'ben');
    t.rooms[0]!.link.lobby.drop('ben');
    const again = ticketOf(await t.service.join(caller('ben'), { code }));
    expect(again.room.players).toBe(2);
    // The host too, and it stays the host.
    ticketOf(await t.service.join(caller('ana'), { code }));
    expect(t.rooms[0]!.link.lobby.hostId).toBe('ana');
  });

  it('after the start: gameStarted, but a player of the game gets a ticket back to it', async () => {
    const t = setup();
    const code = await room(t);
    ticketOf(await t.service.join(caller('ben'), { code }));
    enter(t.rooms[0]!, 'ben');
    expect(t.rooms[0]!.link.lobby.start('ana').ok).toBe(true);
    expect(await t.service.join(caller('cy'), { code })).toMatchObject({ ok: false, error: 'gameStarted' });
    const back = ticketOf(await t.service.join(caller('ben'), { code }));
    expect(back.room).toMatchObject({ state: 'playing', players: 2 });
  });

  it('[D85c] a block made during the game locks neither of its players out of the way back', async () => {
    const t = setup();
    const code = await room(t);
    ticketOf(await t.service.join(caller('ben'), { code }));
    enter(t.rooms[0]!, 'ben');
    expect(t.rooms[0]!.link.lobby.start('ana').ok).toBe(true);
    // Mid-game Ana blocks Ben (the game room only mutes reactions; nobody is removed).
    t.blocks.push({ blockerId: 'ana', blockedId: 'ben' });
    // The blocked one, and the one who blocked, both get back into the game they are playing.
    expect(ticketOf(await t.service.join(caller('ben'), { code })).room).toMatchObject({ state: 'playing' });
    expect(ticketOf(await t.service.join(caller('ana'), { code })).room).toMatchObject({ state: 'playing' });
    // Anyone else still hears gameStarted, or what a block says.
    expect(await t.service.join(caller('cy'), { code })).toMatchObject({ ok: false, error: 'gameStarted' });
    t.blocks.push({ blockerId: 'ben', blockedId: 'cy' });
    expect(await t.service.join(caller('cy'), { code })).toMatchObject({ ok: false, error: 'notFound' });
  });

  it('[D85c] two joins at once with a block between them: only one gets a seat', async () => {
    for (const order of [
      ['avi', 'dana'],
      ['dana', 'avi'],
    ] as const) {
      const t = setup({}, [], { blocksDelayMs: 5 });
      const code = await room(t);
      t.blocks.push({ blockerId: 'avi', blockedId: 'dana' });
      const [first, second] = await Promise.all(order.map((id) => t.service.join(caller(id), { code })));
      // The earlier one is in; the later one sees it and is refused as a block says.
      expect(first).toMatchObject({ ok: true });
      expect(second).toMatchObject({ ok: false, error: order[1] === 'dana' ? 'notFound' : 'cantJoin' });
      expect(t.rooms[0]!.link.lobby.members().sort()).toEqual(['ana', order[0]].sort());
    }
  });

  it('[D85c] joins at once with no block between them all get seats', async () => {
    const t = setup({}, [], { blocksDelayMs: 5 });
    const code = await room(t);
    const results = await Promise.all(['ben', 'cy', 'dan'].map((id) => t.service.join(caller(id), { code })));
    for (const r of results) ticketOf(r);
    expect(t.rooms[0]!.link.lobby.members().sort()).toEqual(['ana', 'ben', 'cy', 'dan']);
  });

  it('a seat that could not be reserved is free again', async () => {
    const t = setup();
    const code = await room(t);
    t.failReserve(true);
    expect(await t.service.join(caller('ben'), { code })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(t.rooms[0]!.link.lobby.members()).toEqual(['ana']);
  });
});

describe('the friends service: the admin site and the shutdown', () => {
  it('lists the open rooms, newest first, without codes', async () => {
    const t = setup();
    const a = ticketOf(await t.service.create(caller('ana'), { gameType: 'fast' }));
    enter(t.rooms[0]!, 'ana');
    t.clock.advance(MINUTE);
    ticketOf(await t.service.create(caller('ben'), {}));
    ticketOf(await t.service.join(caller('cy'), { code: a.room.code }));
    enter(t.rooms[0]!, 'cy');
    t.rooms[0]!.link.lobby.start('ana');
    const rows = t.service.openRooms();
    expect(rows.map((r) => r.roomId)).toEqual([t.rooms[1]!.roomId, t.rooms[0]!.roomId]);
    expect(rows[1]).toEqual({
      roomId: t.rooms[0]!.roomId,
      state: 'playing',
      gameType: 'fast',
      players: 2,
      maxPlayers: 4,
      hostId: 'ana',
      hostName: 'ana',
      openedAt: t.clock.now() - MINUTE,
      startedAt: t.clock.now(),
    });
    expect(JSON.stringify(rows)).not.toContain(a.room.code);
    expect(t.service.counts()).toEqual({ lobby: 1, playing: 1 });
    expect(t.service.report()).toMatchObject({ open: { lobby: 1, playing: 1 }, opened: 2, tickets: 3 });
  });

  it('shutdown(): every lobby is told serverRestart; nothing opens after it', async () => {
    const t = setup();
    ticketOf(await t.service.create(caller('ana'), {}));
    ticketOf(await t.service.create(caller('ben'), {}));
    enter(t.rooms[1]!, 'ben');
    await t.service.shutdown();
    expect(t.rooms.map((r) => r.closedWith)).toEqual([['serverRestart'], ['serverRestart']]);
    expect(t.service.counts()).toEqual({ lobby: 0, playing: 0 });
    expect(await t.service.create(caller('cy'), {})).toMatchObject({ error: 'unavailable' });
  });
});
