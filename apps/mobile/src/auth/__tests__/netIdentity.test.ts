// auth/index.ts: the app's wiring, which installs accountNetIdentity as net/identity's source.
import '..';

import { netIdentity } from '../../net/identity';
import { AuthError } from '../types';
import { initAuth, setAuthDeps, signOut } from '../authStore';
import { accountNetIdentity } from '../netIdentity';
import { installSignedInPlayer, installTestAuth } from '../testing/testAuth';

/**
 * Who the phone is to the game rooms (stage 8): the account's ID token once signed in (the server maps it to
 * the account), the development identity before. auth/index.ts installs this as net/identity's source.
 */

const DEV = { kind: 'dev', devUserId: 'dev-phone', name: 'Dev_phone' } as const;
const fallback = jest.fn(async () => DEV);

afterEach(() => {
  setAuthDeps(null);
  fallback.mockClear();
});

describe('accountNetIdentity', () => {
  it('signed out: the development identity', async () => {
    installTestAuth();
    await initAuth();
    await expect(accountNetIdentity(fallback)).resolves.toEqual(DEV);
  });

  it("signed in: the account's ID token, not a forced refresh; signed out again: the dev identity", async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const getIdToken = jest.spyOn(auth.provider, 'getIdToken');
    const id = await accountNetIdentity(fallback);
    expect(id).toEqual({
      kind: 'token',
      token: expect.stringMatching(/^dev:[A-Za-z0-9]{28}:player@example\.com$/),
    });
    expect(getIdToken).toHaveBeenCalledWith(false);
    expect(fallback).not.toHaveBeenCalled();

    await signOut();
    await expect(accountNetIdentity(fallback)).resolves.toEqual(DEV);
  });

  it('signed in but no token (offline refresh): the join fails, the player never becomes someone else', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    jest.spyOn(auth.provider, 'getIdToken').mockRejectedValue(new AuthError('network'));
    await expect(accountNetIdentity(fallback)).rejects.toMatchObject({ code: 'network' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('auth/index.ts makes it the source the online client asks on every join', async () => {
    const auth = await installSignedInPlayer();
    await initAuth();
    const token = await auth.provider.getIdToken();
    await expect(netIdentity()).resolves.toEqual({ kind: 'token', token });
  });
});
