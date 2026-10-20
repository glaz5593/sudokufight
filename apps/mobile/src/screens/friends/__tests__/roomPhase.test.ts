import type { FriendsRoomView, FriendsSeat } from '../../../net/friends';
import { entryFailure, roomScreenPhase } from '../roomPhase';

const seat = (id: string, more: Partial<FriendsSeat> = {}): FriendsSeat => ({
  id,
  name: id,
  away: false,
  isHost: false,
  isMe: false,
  ...more,
});

const view = (more: Partial<FriendsRoomView> = {}): FriendsRoomView => ({
  phase: 'lobby',
  code: '123456',
  gameType: 'normal',
  seats: [seat('me', { isHost: true, isMe: true }), seat('dana')],
  minPlayers: 2,
  maxPlayers: 4,
  meId: 'me',
  hostId: 'me',
  host: null,
  isHost: true,
  connected: 2,
  away: [],
  canStart: true,
  startsAt: null,
  closed: null,
  refused: null,
  ticket: null,
  ...more,
});

describe('the room route’s phase (screens/friends/roomPhase.ts)', () => {
  it('the lobby, with the seats, the host and my id; reconnecting keeps it, with a line', () => {
    const lobby = roomScreenPhase(view(), null, 0);
    expect(lobby).toMatchObject({
      kind: 'lobby',
      myId: 'me',
      reconnecting: false,
      lobby: { code: '123456', gameType: 'normal', hostId: 'me', minPlayers: 2, maxPlayers: 4 },
    });
    expect(roomScreenPhase(view({ phase: 'reconnecting' }), null, 0)).toMatchObject({
      kind: 'lobby',
      reconnecting: true,
    });
  });

  it('a refused command goes through with its sequence number', () => {
    const p = roomScreenPhase(
      view({ refused: { type: 'lobbyRefused', command: 'start', reason: 'notHost', seq: 3 } }),
      null,
      0,
    );
    expect(p).toMatchObject({ kind: 'lobby', refused: { reason: 'notHost', seq: 3 } });
  });

  it('counts 3, 2, 1, GO from the server’s GO', () => {
    const at = (now: number) => roomScreenPhase(view({ phase: 'countdown', startsAt: 10_000 }), null, now);
    expect(at(7_100)).toMatchObject({ kind: 'countdown', step: 3 });
    expect(at(8_500)).toMatchObject({ step: 2 });
    expect(at(9_900)).toMatchObject({ step: 1 });
    expect(at(10_000)).toMatchObject({ step: 'go' });
    expect(roomScreenPhase(view({ phase: 'game' }), null, 0)).toEqual({ kind: 'starting' });
  });

  it('back to a seat whose game started meanwhile: "המשחק התחיל בלעדיך" [D83]', () => {
    const closed = {
      closeReason: 'lostConnection' as const,
      reason: null,
      problem: 'gameStarted' as const,
      retryAfterMs: null,
    };
    expect(roomScreenPhase(view({ phase: 'closed', closed }), null, 0)).toMatchObject({
      kind: 'failed',
      failure: 'gameStarted',
      startedWithout: true,
    });
    // Never named in the room (no id): the plain words.
    expect(roomScreenPhase(view({ phase: 'closed', closed, meId: null }), null, 0)).not.toHaveProperty(
      'startedWithout',
    );
  });

  it('out of the room: the server’s reason, a problem to explain, or nothing (I left)', () => {
    const closed = (c: FriendsRoomView['closed']) =>
      roomScreenPhase(view({ phase: 'closed', closed: c }), null, 0);
    expect(
      closed({ closeReason: 'serverClosed', reason: 'kicked', problem: 'kicked', retryAfterMs: null }),
    ).toEqual({
      kind: 'closed',
      reason: 'kicked',
    });
    expect(
      closed({ closeReason: 'lostConnection', reason: null, problem: 'tooManyRequests', retryAfterMs: 1500 }),
    ).toEqual({ kind: 'failed', failure: 'tooManyRequests', code: '123456', retryAfterSec: 2 });
    expect(closed({ closeReason: 'left', reason: null, problem: null, retryAfterMs: null })).toEqual({
      kind: 'gone',
    });
    expect(roomScreenPhase(view({ phase: 'connecting' }), null, 0)).toEqual({ kind: 'opening', via: 'join' });
    expect(roomScreenPhase(null, null, 0)).toEqual({ kind: 'gone' });
  });

  it('the route’s own way in comes first', () => {
    expect(roomScreenPhase(view(), { kind: 'opening', via: 'create' }, 0)).toEqual({
      kind: 'opening',
      via: 'create',
    });
    expect(roomScreenPhase(view(), { kind: 'replace', openCode: '654321' }, 0)).toEqual({
      kind: 'replace',
      openCode: '654321',
    });
  });

  it('a refused create asks about the lobby I host; any other refusal is said, with what to retry', () => {
    const refused = { ok: false as const, retryAfterMs: null, openCode: null, field: null };
    expect(entryFailure({ ...refused, problem: 'tooManyRooms', openCode: '654321' })).toEqual({
      kind: 'replace',
      openCode: '654321',
    });
    expect(entryFailure({ ...refused, problem: 'network' })).toEqual({
      kind: 'failed',
      failure: 'network',
      code: null,
      retryAfterSec: null,
      retry: 'create',
    });
    expect(entryFailure({ ...refused, problem: 'notFound' }, '123456')).toMatchObject({
      failure: 'notFound',
      code: '123456',
      retry: 'join',
    });
  });

  it('the way back to my seat (resume) refused gameStarted: "המשחק התחיל בלעדיך" [D83]; a stranger’s join: not', () => {
    const refused = { ok: false as const, retryAfterMs: null, openCode: null, field: null };
    const back = entryFailure({ ...refused, problem: 'gameStarted' }, '123456', { resume: true });
    expect(back).toMatchObject({ kind: 'failed', failure: 'gameStarted', startedWithout: true });
    expect(roomScreenPhase(null, back, 0)).toEqual({
      kind: 'failed',
      failure: 'gameStarted',
      code: '123456',
      retryAfterSec: null,
      startedWithout: true,
    });
    const stranger = entryFailure({ ...refused, problem: 'gameStarted' }, '123456');
    expect(stranger).not.toHaveProperty('startedWithout');
    expect(roomScreenPhase(null, stranger, 0)).not.toHaveProperty('startedWithout');
    // Any other refusal of the way back reads as it always does.
    expect(
      entryFailure({ ...refused, problem: 'roomClosed' }, '123456', { resume: true }),
    ).not.toHaveProperty('startedWithout');
  });
});
