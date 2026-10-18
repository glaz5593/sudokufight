import { Client } from '@colyseus/sdk';

import { OnlineError } from '../errors';
import {
  createOnlineClient,
  type NetIdentity,
  roomOf,
  type SdkClientLike,
  type SdkRoomLike,
} from '../onlineClient';

jest.mock('@colyseus/sdk', () => ({ Client: jest.fn() }));

function sdkRoom(roomId = 'ABC234'): SdkRoomLike & { [k: string]: jest.Mock | unknown } {
  return {
    roomId,
    reconnectionToken: `${roomId}:secret`,
    reconnection: { enabled: true },
    onMessage: jest.fn(),
    onLeave: jest.fn(),
    onError: jest.fn(),
    send: jest.fn(),
    leave: jest.fn(() => Promise.resolve(4000)),
  };
}

function sdkClient(room = sdkRoom()) {
  const sdk = {
    auth: { token: undefined as string | undefined },
    create: jest.fn((_name: string, _options: object) => Promise.resolve(room)),
    joinById: jest.fn((_id: string, _options: object) => Promise.resolve(room)),
    reconnect: jest.fn((_token: string) => Promise.resolve(room)),
    consumeSeatReservation: jest.fn((_reservation: object) => Promise.resolve(room)),
  } satisfies SdkClientLike;
  return { sdk, room };
}

const dev: NetIdentity = { kind: 'dev', devUserId: 'dev-1', name: 'Moshe' };
const sdkError = (message: string, code?: number) => Object.assign(new Error(message), { code });
/** Every create and join says which interference kinds this app can show [D47]. */
const ALL_KINDS = ['fireworks', 'cats', 'warp', 'scramble', 'ink', 'keypad'];

describe('createOnlineClient', () => {
  it('creates a private dev room with the dev identity in the options', async () => {
    const { sdk, room } = sdkClient();
    const client = createOnlineClient({ sdk, identity: async () => dev });
    const joined = await client.create({ gameType: 'hard', playerCount: 3, rules: { graceMs: 5000 } });
    expect(sdk.create).toHaveBeenCalledWith('game', {
      private: true,
      devUserId: 'dev-1',
      name: 'Moshe',
      interferenceKinds: ALL_KINDS,
      gameType: 'hard',
      playerCount: 3,
      rules: { graceMs: 5000 },
    });
    expect(sdk.auth.token).toBeUndefined();
    expect(joined.roomId).toBe('ABC234');
    expect(joined.reconnectionToken).toBe('ABC234:secret');
    // Reconnecting is RemoteGameHost's job, not the SDK's.
    expect(room.reconnection.enabled).toBe(false);
  });

  it('stage 8: a token identity goes in the SDK’s auth token, asked again on every join', async () => {
    const { sdk } = sdkClient();
    let n = 0;
    const client = createOnlineClient({ sdk, identity: async () => ({ kind: 'token', token: `tok${++n}` }) });
    await client.join('ABC234');
    expect(sdk.auth.token).toBe('tok1');
    expect(sdk.joinById).toHaveBeenCalledWith('ABC234', { interferenceKinds: ALL_KINDS });
    await client.join('ABC234');
    expect(sdk.auth.token).toBe('tok2');
  });

  it('joins by the code as typed, normalised; a code that can’t be one never reaches the server', async () => {
    const { sdk } = sdkClient();
    const client = createOnlineClient({ sdk, identity: async () => dev });
    await client.join(' abc-234 ');
    expect(sdk.joinById).toHaveBeenCalledWith('ABC234', {
      devUserId: 'dev-1',
      name: 'Moshe',
      interferenceKinds: ALL_KINDS,
    });
    await expect(client.join('AB1')).rejects.toMatchObject({ code: 'badCode' });
    await expect(client.join('ABCDE0')).rejects.toBeInstanceOf(OnlineError);
    expect(sdk.joinById).toHaveBeenCalledTimes(1);
  });

  it('maps refusals to typed errors', async () => {
    const { sdk } = sdkClient();
    const client = createOnlineClient({ sdk, identity: async () => dev });
    sdk.joinById.mockRejectedValueOnce(sdkError('gameStarted: the game in this room has started', 526));
    await expect(client.join('ABC234')).rejects.toMatchObject({ code: 'gameStarted', status: 526 });
    sdk.joinById.mockRejectedValueOnce(sdkError('room "ABC234" not found', 522));
    await expect(client.join('ABC234')).rejects.toMatchObject({ code: 'notFound' });
    sdk.create.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(client.create({})).rejects.toMatchObject({ code: 'network' });
    sdk.reconnect.mockRejectedValueOnce(sdkError('reconnection token invalid or expired.', 524));
    await expect(client.reconnect('ABC234:secret')).rejects.toMatchObject({ code: 'tokenExpired' });
  });

  it('reconnects with the token', async () => {
    const { sdk } = sdkClient();
    const client = createOnlineClient({ sdk, identity: async () => dev });
    await client.reconnect('ABC234:secret');
    expect(sdk.reconnect).toHaveBeenCalledWith('ABC234:secret');
  });

  it('takes a reserved seat in a ranked match room, asking no identity (stage 9)', async () => {
    const { sdk, room } = sdkClient();
    const identity = jest.fn(async () => dev);
    const client = createOnlineClient({ sdk, identity });
    const reservation = { name: 'game', roomId: 'ABC234', sessionId: 's1' };
    const like = await client.consumeSeatReservation(reservation);
    expect(sdk.consumeSeatReservation).toHaveBeenCalledWith(reservation);
    expect(identity).not.toHaveBeenCalled();
    expect(like.roomId).toBe('ABC234');
    expect(room.reconnection.enabled).toBe(false);
    sdk.consumeSeatReservation.mockRejectedValueOnce(sdkError('room "ABC234" not found', 522));
    await expect(client.consumeSeatReservation(reservation)).rejects.toMatchObject({ code: 'notFound' });
  });

  it('makes an SDK client for the endpoint when none is given', async () => {
    const { sdk } = sdkClient();
    jest.mocked(Client).mockImplementation(() => sdk as unknown as Client);
    const endpoint = { hostname: '192.168.1.20', port: 2567, secure: false };
    const client = createOnlineClient({ endpoint, identity: async () => dev });
    expect(Client).toHaveBeenCalledWith(endpoint);
    await client.create({});
    expect(sdk.create).toHaveBeenCalled();
  });
});

describe('roomOf: an SDK room as a RoomLike', () => {
  it('passes everything through', async () => {
    const room = sdkRoom();
    const like = roomOf(room);
    const cb = jest.fn();
    like.onMessage('events', cb);
    expect(room.onMessage).toHaveBeenCalledWith('events', cb);
    const onLeave = jest.fn();
    like.onLeave(onLeave);
    (room.onLeave as jest.Mock).mock.calls[0][0](1006, 'gone');
    expect(onLeave).toHaveBeenCalledWith(1006);
    like.onError(cb);
    expect(room.onError).toHaveBeenCalledWith(cb);
    like.send('ping', { type: 'ping', t: 1 });
    expect(room.send).toHaveBeenCalledWith('ping', { type: 'ping', t: 1 });
    await like.leave(false);
    expect(room.leave).toHaveBeenCalledWith(false);
    // The token is read when needed (the SDK sets it once the join completes).
    room.reconnectionToken = 'ABC234:later';
    expect(like.reconnectionToken).toBe('ABC234:later');
  });
});
