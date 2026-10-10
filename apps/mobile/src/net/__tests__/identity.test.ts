import Storage from 'expo-sqlite/kv-store';

import { useProfile } from '../../state/profile';
import {
  DEV_USER_ID_KEY,
  devIdentity,
  devNameOf,
  getDevUserId,
  netIdentity,
  resetDevIdentityCache,
  setNetIdentitySource,
} from '../identity';

/** The server's rules for a dev identity (apps/server/src/auth/identity.ts). */
const DEV_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DISPLAY_NAME = /^[A-Za-z0-9_.א-ת]{3,16}$/;

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: jest.fn(async (k: string) => map.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void map.set(k, v)),
  };
}

beforeEach(() => resetDevIdentityCache());

describe('the dev identity (until stage 8)', () => {
  it('makes a stable random id on first use and keeps it', async () => {
    const storage = memoryStorage();
    const id = await getDevUserId(storage);
    expect(id).toMatch(/^dev-[0-9a-f-]{36}$/);
    expect(id).toMatch(DEV_USER_ID);
    expect(storage.setItem).toHaveBeenCalledWith(DEV_USER_ID_KEY, id);
    resetDevIdentityCache();
    expect(await getDevUserId(storage)).toBe(id);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('calls at once share one read; a failed read is tried again next time', async () => {
    const storage = memoryStorage();
    const [a, b] = await Promise.all([getDevUserId(storage), getDevUserId(storage)]);
    expect(a).toBe(b);
    expect(storage.getItem).toHaveBeenCalledTimes(1);

    resetDevIdentityCache();
    const broken = memoryStorage();
    broken.getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(getDevUserId(broken)).rejects.toThrow('disk');
    expect(await getDevUserId(broken)).toMatch(DEV_USER_ID);
  });

  it('replaces a stored id the server would refuse', async () => {
    const storage = memoryStorage({ [DEV_USER_ID_KEY]: 'not ok!' });
    expect(await getDevUserId(storage)).toMatch(/^dev-/);
  });

  it.each([
    ['Moshe', 'Moshe'],
    ['Moshe G', 'Moshe_G'],
    ['  משה  ', 'משה'],
    ['a.b_c', 'a.b_c'],
    ['VeryLongPlayerName123', 'VeryLongPlayerNa'],
    ['Mo!', 'Dev_abc123'],
    ['😎😎😎', 'Dev_abc123'],
    [null, 'Dev_abc123'],
  ])('the name %p is sent as %p', (name, expected) => {
    const sent = devNameOf(name, 'dev-x-abc123');
    expect(sent).toBe(expected);
    expect(sent).toMatch(DISPLAY_NAME);
  });

  it('uses the profile’s name and the kv-store by default', async () => {
    useProfile.setState({ name: 'Moshe G' });
    const id = await devIdentity();
    expect(id).toEqual({ kind: 'dev', devUserId: expect.stringMatching(/^dev-/), name: 'Moshe_G' });
    expect(await Storage.getItem(DEV_USER_ID_KEY)).toBe(id.kind === 'dev' ? id.devUserId : null);
  });

  it('stage 8 swaps in the account: netIdentity asks whatever source is set', async () => {
    expect((await netIdentity()).kind).toBe('dev');
    setNetIdentitySource(async () => ({ kind: 'token', token: 'firebase-id-token' }));
    expect(await netIdentity()).toEqual({ kind: 'token', token: 'firebase-id-token' });
    setNetIdentitySource(() => devIdentity());
  });
});
