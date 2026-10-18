import { OnlineError } from '../../../../net/errors';
import type { OnlineInfo } from '../../../../net/remoteGameHost';
import { connectionStatusOf, refusalOf } from '../connectionStatus';

/** The host's socket state → the connection UI's status (stage 7): every case, nothing decided here. */

const base: OnlineInfo = {
  status: 'connecting',
  closeReason: null,
  error: null,
  code: null,
  playerId: null,
  lobby: null,
  reconnect: null,
  pendingCell: null,
  hasGame: false,
  resyncedAt: null,
  offlinePlay: null,
  queuedMoves: [],
};
const info = (o: Partial<OnlineInfo>): OnlineInfo => ({ ...base, ...o });
const lobby = {
  code: 'ABC234',
  gameType: 'fast' as const,
  playerCount: 2,
  players: [{ id: 'me', name: 'Moshe' }],
};

describe('connectionStatusOf', () => {
  it('before the game: the server, the room, the lobby, the first snapshot', () => {
    expect(connectionStatusOf(base)).toEqual({ kind: 'connecting', step: 'server' });
    expect(connectionStatusOf(info({ status: 'lobby', code: 'ABC234' }))).toEqual({
      kind: 'connecting',
      step: 'room',
    });
    expect(connectionStatusOf(info({ status: 'lobby', lobby, playerId: 'me' }))).toEqual({
      kind: 'lobby',
      lobby: { ...lobby, playerId: 'me' },
    });
    expect(connectionStatusOf(info({ status: 'live' }))).toEqual({ kind: 'connecting', step: 'sync' });
  });

  it('in the game: online, with the last return for the "synced" banner', () => {
    expect(connectionStatusOf(info({ status: 'live', hasGame: true }))).toEqual({
      kind: 'online',
      resyncedAt: null,
    });
    expect(connectionStatusOf(info({ status: 'live', hasGame: true, resyncedAt: 5000 }))).toEqual({
      kind: 'online',
      resyncedAt: 5000,
    });
    // A lobby message while the game runs (someone's seat) does not leave the game.
    expect(connectionStatusOf(info({ status: 'lobby', hasGame: true, lobby, playerId: 'me' }))).toEqual({
      kind: 'online',
      resyncedAt: null,
    });
  });

  it('reconnecting: the attempt and when it was lost (server time); resyncing once a room took us back', () => {
    const reconnect = {
      cause: 'drop' as const,
      attempt: 2,
      since: 100,
      lostAt: 900,
      softEndsAt: 10_900,
      graceEndsAt: 25_900,
      deadline: 99,
      resyncing: false,
    };
    // The soft phase and the grace ends [D42], in the server's clock like lostAt, and whether the host plays
    // on here meanwhile (its offlinePlay).
    const offlinePlay = { since: 900, softEndsAt: 10_900, playable: true };
    expect(
      connectionStatusOf(info({ status: 'reconnecting', hasGame: true, reconnect, offlinePlay })),
    ).toEqual({
      kind: 'reconnecting',
      attempt: 2,
      lostAt: 900,
      softEndsAt: 10_900,
      playable: true,
      graceEndsAt: 25_900,
    });
    // The game was frozen, or 'turns', or no offline moves: the host does not play on.
    expect(
      connectionStatusOf(
        info({
          status: 'reconnecting',
          hasGame: true,
          reconnect,
          offlinePlay: { ...offlinePlay, playable: false },
        }),
      ),
    ).toMatchObject({ kind: 'reconnecting', playable: false });
    // In the background no attempt has been made yet: still "attempt 1" on the screen.
    expect(
      connectionStatusOf(
        info({
          status: 'reconnecting',
          hasGame: true,
          reconnect: { ...reconnect, cause: 'background', attempt: 0 },
        }),
      ),
    ).toMatchObject({ kind: 'reconnecting', attempt: 1 });
    expect(
      connectionStatusOf(
        info({
          status: 'reconnecting',
          hasGame: true,
          reconnect: { ...reconnect, resyncing: true },
          offlinePlay,
        }),
      ),
    ).toEqual({ kind: 'resyncing', lostAt: 900, softEndsAt: 10_900, playable: true, graceEndsAt: 25_900 });
    // A game without a soft phase (an older server's rules): none.
    expect(
      connectionStatusOf(
        info({ status: 'reconnecting', hasGame: true, reconnect: { ...reconnect, softEndsAt: null } }),
      ),
    ).toMatchObject({ kind: 'reconnecting', softEndsAt: null, graceEndsAt: 25_900 });
  });

  it('closed: the end, or leaving, show nothing of their own', () => {
    for (const closeReason of ['gameOver', 'left'] as const)
      expect(connectionStatusOf(info({ status: 'closed', closeReason, hasGame: true }))).toEqual({
        kind: 'online',
        resyncedAt: null,
      });
  });

  it('closed by a refusal or a lost connection: the error screen, with the small support code', () => {
    const refused = (error: OnlineError) =>
      connectionStatusOf(info({ status: 'closed', closeReason: 'refused', error }));
    expect(refused(new OnlineError('network', 'Network request failed'))).toEqual({
      kind: 'failed',
      failure: 'unreachable',
      code: 'network',
    });
    expect(refused(new OnlineError('notFound', 'room "X" not found', 522))).toEqual({
      kind: 'failed',
      failure: 'refused',
      code: 'notFound-522',
      refusal: 'notFound',
    });
    expect(refused(new OnlineError('roomFull', 'locked', 522))).toMatchObject({ refusal: 'full' });
    expect(refused(new OnlineError('gameStarted', 'gameStarted: …', 4211))).toMatchObject({
      refusal: 'gameStarted',
      code: 'gameStarted-4211',
    });
    expect(refused(new OnlineError('unknown', '?'))).toMatchObject({ failure: 'refused', refusal: null });

    expect(
      connectionStatusOf(
        info({
          status: 'closed',
          closeReason: 'lostConnection',
          hasGame: true,
          error: new OnlineError('network', 'x'),
        }),
      ),
    ).toEqual({ kind: 'failed', failure: 'lost', code: 'network' });
    expect(connectionStatusOf(info({ status: 'closed', closeReason: 'lostConnection' }))).toEqual({
      kind: 'failed',
      failure: 'lost',
      code: 'lostConnection',
    });
    expect(connectionStatusOf(info({ status: 'closed', closeReason: 'serverClosed' }))).toEqual({
      kind: 'failed',
      failure: 'lost',
      code: 'serverClosed',
    });
    expect(
      connectionStatusOf(
        info({ status: 'closed', closeReason: 'protocol', error: new OnlineError('protocol', 'v2') }),
      ),
    ).toEqual({ kind: 'failed', failure: 'refused', code: 'protocol' });
  });
});

describe('refusalOf', () => {
  it('the refusals a screen explains', () => {
    expect(refusalOf('badCode')).toBe('notFound');
    expect(refusalOf('roomGone')).toBe('notFound');
    expect(refusalOf('roomFull')).toBe('full');
    for (const code of [
      'badOptions',
      'codeTaken',
      'unauthenticated',
      'suspended',
      'alreadyInRoom',
      'gameStarted',
    ] as const)
      expect(refusalOf(code)).toBe(code);
    for (const code of ['network', 'tokenExpired', 'protocol', 'unknown'] as const)
      expect(refusalOf(code)).toBeNull();
  });
});
