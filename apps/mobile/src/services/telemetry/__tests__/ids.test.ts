import { isUuid, mathRandomBytes, systemRandomBytes, uuidV4 } from '../uuid';

/**
 * Spec §27.1: event ids and the install id. The install id is made on the first launch, kept in the
 * key-value store, and the same on every launch after it. The store here outlives the module, as the phone's
 * disk outlives a run: each "launch" loads the module afresh.
 */

const mockKv = new Map<string, string>();
const mockKvFails = { read: false, write: false };
/** One api for every load of the module (jest.isolateModules would otherwise make a new mock for each). */
const mockKvApi = {
  getItem: jest.fn(async (key: string) => {
    if (mockKvFails.read) throw new Error('kv read failed');
    return mockKv.get(key) ?? null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    if (mockKvFails.write) throw new Error('kv write failed');
    mockKv.set(key, value);
  }),
};
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: mockKvApi }));

type Ids = typeof import('../ids');
/** A new run of the app: the module (and its memory) afresh, the same store. */
const launch = (): Ids => {
  let mod!: Ids;
  jest.isolateModules(() => {
    mod = jest.requireActual<Ids>('../ids');
  });
  return mod;
};
const kv = () => mockKvApi;

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  mockKv.clear();
  mockKvFails.read = false;
  mockKvFails.write = false;
  jest.clearAllMocks();
});

describe('uuidV4', () => {
  it('makes lower-case version-4 UUIDs, all different', () => {
    const ids = Array.from({ length: 2000 }, () => uuidV4());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets the version and variant bits whatever the random bytes are', () => {
    expect(uuidV4((b) => b.fill(0))).toBe('00000000-0000-4000-8000-000000000000');
    expect(uuidV4((b) => b.fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('falls back to Math.random when the random source throws', () => {
    const id = uuidV4(() => {
      throw new Error('no crypto');
    });
    expect(id).toMatch(V4);
  });

  it('uses crypto.getRandomValues when there is one, Math.random when there is none', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const getRandomValues = jest.fn((bytes: Uint8Array) => bytes.fill(7));
    try {
      Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues }, configurable: true });
      expect(uuidV4()).toBe('07070707-0707-4707-8707-070707070707');
      expect(getRandomValues).toHaveBeenCalledTimes(1);

      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const bytes = new Uint8Array(4);
      systemRandomBytes(bytes);
      expect([...bytes]).toEqual([128, 128, 128, 128]);
      expect(random).toHaveBeenCalledTimes(4);
      random.mockRestore();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  });

  it('Math.random bytes are bytes', () => {
    const bytes = new Uint8Array(64);
    mathRandomBytes(bytes);
    for (const b of bytes) expect(b).toBeLessThan(256);
  });

  it('isUuid takes the shape the server takes, in either case', () => {
    expect(isUuid(uuidV4())).toBe(true);
    expect(isUuid('7D8F1D8E-2F0A-4C55-9A3B-0C6A2B9D4E11')).toBe(true);
    expect(isUuid('7d8f1d8e-2f0a-0c55-9a3b-0c6a2b9d4e11')).toBe(false); // version 0
    expect(isUuid('7d8f1d8e-2f0a-4c55-7a3b-0c6a2b9d4e11')).toBe(false); // variant
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('the install id', () => {
  it('is made on the first launch, saved, and the same on every launch after it', async () => {
    const first = await launch().getInstallId();
    expect(first).toMatch(V4);
    expect(kv().setItem).toHaveBeenCalledTimes(1);
    expect(mockKv.get('telemetry.installId')).toBe(first);

    const again = launch();
    expect(await again.getInstallId()).toBe(first);
    expect(await again.getInstallId()).toBe(first);
    expect(kv().setItem).toHaveBeenCalledTimes(1);
  });

  it('calls at once on the first launch share one id (one read, one write)', async () => {
    const { getInstallId } = launch();
    const ids = await Promise.all([getInstallId(), getInstallId(), getInstallId()]);
    expect(new Set(ids).size).toBe(1);
    expect(kv().getItem).toHaveBeenCalledTimes(1);
    expect(kv().setItem).toHaveBeenCalledTimes(1);
  });

  it('a stored value that is not a UUID is replaced; one in upper case is the same id', async () => {
    mockKv.set('telemetry.installId', 'garbage');
    const made = await launch().getInstallId();
    expect(made).toMatch(V4);
    expect(mockKv.get('telemetry.installId')).toBe(made);

    mockKv.set('telemetry.installId', '7D8F1D8E-2F0A-4C55-9A3B-0C6A2B9D4E11');
    expect(await launch().getInstallId()).toBe('7d8f1d8e-2f0a-4c55-9a3b-0c6a2b9d4e11');
  });

  it('a failure to read or to save rejects, and the next call tries again', async () => {
    const { getInstallId } = launch();
    mockKvFails.read = true;
    await expect(getInstallId()).rejects.toThrow('kv read failed');
    mockKvFails.read = false;
    mockKvFails.write = true;
    await expect(getInstallId()).rejects.toThrow('kv write failed');
    expect(mockKv.size).toBe(0);
    mockKvFails.write = false;
    const id = await getInstallId();
    expect(mockKv.get('telemetry.installId')).toBe(id);
  });
});
