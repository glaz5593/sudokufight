import { fakeClock, type FakeClock } from '../testing';
import { FriendsLobby, type LobbyMember } from './lobby';
import { FRIENDS_RULES } from './options';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const member = (id: string): LobbyMember => ({
  id,
  name: `${id[0]!.toUpperCase()}${id.slice(1)}`,
  avatarId: 'noam',
  country: 'IL',
  rating: 1200,
});

let clock: FakeClock;
const lobbyOf = (overrides: Partial<typeof FRIENDS_RULES> = {}) =>
  new FriendsLobby({
    hostId: 'ana',
    gameType: 'fast',
    rules: { ...FRIENDS_RULES, ...overrides },
    now: clock.now,
  });

/** Admitted, then connected: a seat. */
function seat(lobby: FriendsLobby, id: string): void {
  expect(lobby.admit(id)).toEqual({ ok: true, seat: 'new' });
  expect(lobby.connect(member(id))).toEqual({ ok: true, takeover: false });
}

beforeEach(() => {
  clock = fakeClock();
});

describe('the friends lobby: host and seats', () => {
  it('the creator is the host; seats keep the order people came in', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    seat(lobby, 'cy');
    expect(lobby.hostId).toBe('ana');
    expect(lobby.view().map((p) => p.id)).toEqual(['ana', 'ben', 'cy']);
    expect(lobby.view()[1]).toEqual({
      id: 'ben',
      name: 'Ben',
      avatarId: 'noam',
      country: 'IL',
      rating: 1200,
      away: false,
    });
  });

  it('keeps the creator as host while they are on the way in', () => {
    const lobby = lobbyOf();
    expect(lobby.admit('ana').ok).toBe(true);
    expect(lobby.admit('ben').ok).toBe(true);
    expect(lobby.connect(member('ben')).ok).toBe(true);
    expect(lobby.hostId).toBe('ana');
    expect(lobby.connect(member('ana')).ok).toBe(true);
    expect(lobby.hostId).toBe('ana');
    expect(lobby.view().map((p) => p.id)).toEqual(['ben', 'ana']);
  });

  it('the fifth player gets roomFull; reservations count, and free up when they lapse', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    expect(lobby.admit('dan')).toEqual({ ok: true, seat: 'new' });
    expect(lobby.taken).toBe(4);
    expect(lobby.admit('eve')).toEqual({ ok: false, error: 'roomFull' });
    // Dan never comes: his reservation lapses, and the seat is free again.
    clock.advance(FRIENDS_RULES.seatReservationMs);
    expect(lobby.admit('eve')).toEqual({ ok: true, seat: 'new' });
    expect(lobby.connect(member('eve')).ok).toBe(true);
    expect(lobby.admit('fay')).toEqual({ ok: false, error: 'roomFull' });
    expect(lobby.connect(member('fay'))).toEqual({ ok: false, error: 'roomFull' });
  });

  it('a held (away) seat counts towards the 4', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy', 'dan']) seat(lobby, id);
    lobby.drop('dan');
    expect(lobby.view().find((p) => p.id === 'dan')?.away).toBe(true);
    expect(lobby.connected).toBe(3);
    expect(lobby.admit('eve')).toEqual({ ok: false, error: 'roomFull' });
  });

  it('a cancelled reservation frees its seat', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    expect(lobby.admit('ben').ok).toBe(true);
    expect(lobby.members()).toEqual(['ana', 'ben']);
    lobby.cancel('ben');
    expect(lobby.members()).toEqual(['ana']);
  });
});

describe('the friends lobby: the same account again (seat takeover)', () => {
  it('takes its own seat back, away or connected elsewhere, and stays the host', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    // Connected on another device: the same seat.
    expect(lobby.admit('ana')).toEqual({ ok: true, seat: 'own' });
    expect(lobby.connect(member('ana'))).toEqual({ ok: true, takeover: true });
    // The app was closed (away), then opened again without its reconnection token.
    lobby.drop('ana');
    expect(lobby.admit('ana')).toEqual({ ok: true, seat: 'own' });
    expect(lobby.connect({ ...member('ana'), name: 'Ana_New' })).toEqual({ ok: true, takeover: true });
    expect(lobby.hostId).toBe('ana');
    expect(lobby.view()).toEqual([
      expect.objectContaining({ id: 'ana', name: 'Ana_New', away: false }),
      expect.objectContaining({ id: 'ben', away: false }),
    ]);
    expect(lobby.taken).toBe(2);
  });

  it('a seat away comes back with the reconnection token', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    lobby.drop('ana');
    expect(lobby.back('ana')).toBe(true);
    expect(lobby.view()[0]?.away).toBe(false);
    expect(lobby.back('nobody')).toBe(false);
  });
});

describe('the friends lobby: no time limit [D84a]', () => {
  it('a host away 15 minutes, then 2 hours, is still the host of an open room', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    lobby.drop('ana');
    clock.advance(15 * MINUTE);
    expect(lobby.expire()).toEqual({ gone: [], hostChanged: false, closed: false });
    clock.advance(2 * HOUR);
    expect(lobby.expire().closed).toBe(false);
    expect(lobby.state).toBe('lobby');
    expect(lobby.hostId).toBe('ana');
    expect(lobby.connect(member('ana')).ok).toBe(true);
    expect(lobby.hostId).toBe('ana');
  });

  it("the host's seat lapses after 6 hours: the earliest of the others is the host", () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    lobby.drop('ana');
    expect(lobby.nextDeadline()).toBe(clock.now() + 6 * HOUR);
    clock.advance(6 * HOUR - 1);
    expect(lobby.expire().gone).toEqual([]);
    clock.advance(1);
    expect(lobby.expire()).toEqual({ gone: ['ana'], hostChanged: true, closed: false });
    expect(lobby.hostId).toBe('ben');
    expect(lobby.view().map((p) => p.id)).toEqual(['ben', 'cy']);
  });

  it('every seat lapses: the room closes', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    lobby.drop('ana');
    clock.advance(HOUR);
    lobby.drop('ben');
    clock.advance(5 * HOUR);
    expect(lobby.expire()).toEqual({ gone: ['ana'], hostChanged: true, closed: false });
    clock.advance(HOUR);
    expect(lobby.expire()).toEqual({ gone: ['ben'], hostChanged: true, closed: true });
    expect(lobby.state).toBe('closed');
    expect(lobby.admit('ana')).toEqual({ ok: false, error: 'roomClosed' });
  });

  it('an optional lobby limit closes the room (off by default)', () => {
    expect(FRIENDS_RULES.lobbyMaxMs).toBeNull();
    const lobby = lobbyOf({ lobbyMaxMs: HOUR });
    seat(lobby, 'ana');
    expect(lobby.nextDeadline()).toBe(clock.now() + HOUR);
    clock.advance(HOUR);
    expect(lobby.expire()).toEqual({ gone: ['ana'], hostChanged: true, closed: true });
  });

  it('a room whose creator never comes in closes when the reservation lapses', () => {
    const lobby = lobbyOf();
    expect(lobby.admit('ana').ok).toBe(true);
    expect(lobby.expire().closed).toBe(false);
    clock.advance(FRIENDS_RULES.seatReservationMs);
    expect(lobby.expire().closed).toBe(true);
  });
});

describe('the friends lobby: leaving', () => {
  it('the host leaves: the earliest of the others is the host [D84b]', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    expect(lobby.leave('ana')).toEqual({ gone: ['ana'], hostChanged: true, closed: false });
    expect(lobby.hostId).toBe('ben');
    expect(lobby.leave('cy')).toEqual({ gone: ['cy'], hostChanged: false, closed: false });
  });

  it('everyone pressed "יציאה מהחדר": the room closes', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    expect(lobby.leave('ben').closed).toBe(false);
    expect(lobby.leave('ana')).toEqual({ gone: ['ana'], hostChanged: true, closed: true });
    expect(lobby.state).toBe('closed');
  });

  it('a room with someone on the way in stays open', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    expect(lobby.admit('ben').ok).toBe(true);
    expect(lobby.leave('ana')).toEqual({ gone: ['ana'], hostChanged: true, closed: false });
    expect(lobby.hostId).toBeNull();
    expect(lobby.connect(member('ben')).ok).toBe(true);
    expect(lobby.hostId).toBe('ben');
  });
});

describe('the friends lobby: the host commands', () => {
  it('setGameType: the host only, before the start [D82]', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    expect(lobby.gameType).toBe('fast');
    expect(lobby.setGameType('ben', 'hard')).toEqual({ ok: false, error: 'notHost' });
    expect(lobby.setGameType('ana', 'hard')).toEqual({ ok: true, value: 'hard' });
    expect(lobby.gameType).toBe('hard');
    expect(lobby.start('ana').ok).toBe(true);
    expect(lobby.setGameType('ana', 'normal')).toEqual({ ok: false, error: 'gameStarted' });
  });

  it('kick: the host only, a guest, before the start; the kicked account never gets back in [D85a]', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    expect(lobby.kick('ben', 'cy')).toEqual({ ok: false, error: 'notHost' });
    expect(lobby.kick('ana', 'ana')).toEqual({ ok: false, error: 'badCommand' });
    expect(lobby.kick('ana', 'nobody')).toEqual({ ok: false, error: 'badCommand' });
    expect(lobby.kick('ana', 'ben')).toEqual({
      ok: true,
      value: { gone: ['ben'], hostChanged: false, closed: false },
    });
    expect(lobby.view().map((p) => p.id)).toEqual(['ana', 'cy']);
    expect(lobby.wasKicked('ben')).toBe(true);
    expect(lobby.admit('ben')).toEqual({ ok: false, error: 'kicked' });
    expect(lobby.connect(member('ben'))).toEqual({ ok: false, error: 'kicked' });
    // An away guest may be kicked too.
    lobby.drop('cy');
    expect(lobby.kick('ana', 'cy').ok).toBe(true);
    expect(lobby.start('ana').ok).toBe(false);
    seat(lobby, 'dan');
    expect(lobby.start('ana').ok).toBe(true);
    expect(lobby.kick('ana', 'dan')).toEqual({ ok: false, error: 'gameStarted' });
  });

  it('start: the host only, with at least 2 connected', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    expect(lobby.start('ana')).toEqual({ ok: false, error: 'notEnoughPlayers' });
    seat(lobby, 'ben');
    expect(lobby.start('ben')).toEqual({ ok: false, error: 'notHost' });
    expect(lobby.start('ana')).toEqual({ ok: true, value: { players: ['ana', 'ben'], left: [] } });
    expect(lobby.state).toBe('started');
    expect(lobby.roomState).toBe('playing');
    expect(lobby.startedAt).toBe(clock.now());
    expect(lobby.start('ana')).toEqual({ ok: false, error: 'gameStarted' });
  });

  it('start counts the connected only; an away seat needs the host\'s "start without" [D83]', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    lobby.drop('ben');
    lobby.drop('cy');
    // One connected: not enough, whoever is away.
    expect(lobby.start('ana', ['ben', 'cy'])).toEqual({ ok: false, error: 'notEnoughPlayers' });
    lobby.back('cy');
    expect(lobby.start('ana')).toEqual({ ok: false, error: 'playersAway', away: ['ben'] });
    expect(lobby.start('ana', ['cy'])).toEqual({ ok: false, error: 'playersAway', away: ['ben'] });
    expect(lobby.state).toBe('lobby');
    expect(lobby.start('ana', ['ben'])).toEqual({
      ok: true,
      value: { players: ['ana', 'cy'], left: ['ben'] },
    });
    expect(lobby.gamePlayers).toEqual(['ana', 'cy']);
    // Ben, back later: the game started without him. The players may come back to it.
    expect(lobby.admit('ben')).toEqual({ ok: false, error: 'gameStarted' });
    expect(lobby.admit('cy')).toEqual({ ok: true, seat: 'own' });
    expect(lobby.admit('eve')).toEqual({ ok: false, error: 'gameStarted' });
    expect(lobby.connect(member('eve'))).toEqual({ ok: false, error: 'gameStarted' });
    expect(lobby.nextDeadline()).toBeNull();
  });
});

describe('the friends lobby: a block inside the room [D85c]', () => {
  it('the blocked one is out, and can not come back on that reservation', () => {
    const lobby = lobbyOf();
    for (const id of ['ana', 'ben', 'cy']) seat(lobby, id);
    expect(lobby.block('ana', 'ben')).toEqual({ gone: ['ben'], hostChanged: false, closed: false });
    expect(lobby.view().map((p) => p.id)).toEqual(['ana', 'cy']);
    expect(lobby.admit('ben')).toEqual({ ok: false, error: 'roomClosed' });
    // A guest who blocks the host: the host is out, and passes the role on.
    expect(lobby.block('cy', 'ana')).toEqual({ gone: ['ana'], hostChanged: true, closed: false });
    expect(lobby.hostId).toBe('cy');
  });

  it('touches nobody outside the room, nor after the start', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    expect(lobby.block('ana', 'zed')).toBeNull();
    expect(lobby.block('ana', 'ana')).toBeNull();
    lobby.start('ana');
    expect(lobby.block('ana', 'ben')).toBeNull();
  });

  it('a reservation on the way in is out too', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    lobby.admit('ben');
    expect(lobby.block('ben', 'ana')?.gone).toEqual(['ana']);
    expect(lobby.block('ben', 'ana')).toBeNull();
  });
});

describe('the friends lobby: closing', () => {
  it('close() empties it for good', () => {
    const lobby = lobbyOf();
    seat(lobby, 'ana');
    seat(lobby, 'ben');
    expect(lobby.close()).toEqual({ gone: ['ana', 'ben'], hostChanged: true, closed: true });
    expect(lobby.connect(member('ana'))).toEqual({ ok: false, error: 'roomClosed' });
    expect(lobby.nextDeadline()).toBeNull();
  });
});
