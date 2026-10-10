import { Client } from '@colyseus/sdk';
import { AppState } from 'react-native';

import { serverEndpoint } from '../../config/server';
import { systemClock, timeoutScheduler } from '../../game/clock';
import { track } from '../../services/analytics';
import { createDevRoom, DEV_PING_EVERY_MS, deviceHost, deviceHostDeps, joinDevRoom } from '../device';
import { resetDevIdentityCache } from '../identity';

jest.mock('@colyseus/sdk', () => ({ Client: jest.fn() }));
jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

function fakeSdk() {
  const room = {
    roomId: 'ABC234',
    reconnectionToken: 'ABC234:secret',
    reconnection: { enabled: true },
    onMessage: jest.fn(),
    onLeave: jest.fn(),
    onError: jest.fn(),
    send: jest.fn(),
    leave: jest.fn(() => Promise.resolve(4000)),
  };
  const sdk = {
    auth: { token: undefined },
    create: jest.fn(() => Promise.resolve(room)),
    joinById: jest.fn(() => Promise.resolve(room)),
    reconnect: jest.fn(() => Promise.resolve(room)),
  };
  jest.mocked(Client).mockImplementation(() => sdk as unknown as Client);
  return { sdk, room };
}

beforeEach(() => resetDevIdentityCache());

describe('the online game wired to the phone', () => {
  it('uses the configured server, the wall clock, the JS timers, AppState and analytics', () => {
    fakeSdk();
    const deps = deviceHostDeps();
    expect(Client).toHaveBeenCalledWith(serverEndpoint);
    expect(deps).toMatchObject({
      clock: systemClock,
      scheduler: timeoutScheduler,
      appState: AppState,
      track,
    });
    // A development build pings once a second, for the debug screen's 200 round trips.
    expect(deps.options).toEqual({ pingEveryMs: DEV_PING_EVERY_MS });
    expect(DEV_PING_EVERY_MS).toBe(1000);
  });

  it('deviceHost: a host wired to the phone, not in any room yet', () => {
    fakeSdk();
    const host = deviceHost();
    expect(host.online).toMatchObject({ status: 'connecting', hasGame: false });
    host.close();
  });

  it('createDevRoom and joinDevRoom go to the server with the dev identity', async () => {
    const { sdk, room } = fakeSdk();
    const { host, code } = await createDevRoom({ gameType: 'fast', playerCount: 2 });
    expect(code).toBe('ABC234');
    expect(sdk.create).toHaveBeenCalledWith(
      'game',
      expect.objectContaining({ private: true, devUserId: expect.stringMatching(/^dev-/), gameType: 'fast' }),
    );
    expect(room.send).toHaveBeenCalledWith('ping', expect.objectContaining({ type: 'ping' }));
    host.close();
    expect(room.leave).toHaveBeenCalledWith(true);

    const joined = await joinDevRoom('abc 234');
    expect(sdk.joinById).toHaveBeenCalledWith(
      'ABC234',
      expect.objectContaining({ devUserId: expect.any(String) }),
    );
    joined.close();
  });
});
