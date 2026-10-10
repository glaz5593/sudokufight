/**
 * Random ids for usage reports (spec §27.1): RFC 4122 version-4 UUIDs, in lower case, which the server's
 * schema accepts. Pure: no React Native or Expo imports, so the server's tests can check them too.
 *
 * They are ids, not secrets: crypto.getRandomValues when the runtime has it (Hermes may not, without a
 * polyfill), Math.random otherwise.
 */

/** Fills the array with random bytes. */
export type RandomBytes = (bytes: Uint8Array) => void;

/** Any version 1–8 UUID, in either case: the shape the server's `z.uuid()` checks. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

interface CryptoLike {
  getRandomValues?: (bytes: Uint8Array) => unknown;
}

export const mathRandomBytes: RandomBytes = (bytes) => {
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
};

/** crypto.getRandomValues when there is one (looked up on every call), else Math.random. */
export const systemRandomBytes: RandomBytes = (bytes) => {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto;
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else mathRandomBytes(bytes);
};

/** A new version-4 UUID, e.g. "3f0c9a52-7d1e-4b8a-9c2f-5e6d7a8b9c0d". Never throws. */
export function uuidV4(randomBytes: RandomBytes = systemRandomBytes): string {
  const b = new Uint8Array(16);
  try {
    randomBytes(b);
  } catch {
    mathRandomBytes(b);
  }
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
