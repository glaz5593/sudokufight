import Storage from 'expo-sqlite/kv-store';

import { uuidV4 } from '../services/telemetry/uuid';
import { useProfile } from '../state/profile';
import type { IdentitySource, NetIdentity } from './onlineClient';

/**
 * Who this phone is to the game server.
 *
 * Until stage 8 is wired in: a dev identity ({ devUserId, name }, refused by a production server). The id is a
 * random one made on first use and kept in expo-sqlite's key-value store, so a rejoin after a restart is the
 * same player; the name is the profile's, made to fit the server's rules (spec §3.1), or "Dev_xxxxxx".
 *
 * TODO(stage 8): the account's Firebase ID token instead. The auth code calls
 * setNetIdentitySource(async () => ({ kind: 'token', token: await <the auth store's fresh ID token>() })) once
 * the player is signed in; nothing in src/net changes (createOnlineClient sends a token as the SDK's auth
 * token). The token is a bearer secret: never logged, never stored here.
 */

export const DEV_USER_ID_KEY = 'net.devUserId';

/** The server's dev user id rule: 1–64 letters, digits, '_' or '-'. */
const DEV_USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The server's display name rule (spec §3.1): 3–16 Hebrew or English letters, digits, '_' and '.'. */
const DISPLAY_NAME = /^[A-Za-z0-9_.א-ת]{3,16}$/;

export interface IdentityStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** A name the server takes: spaces become '_', other characters it refuses are dropped; too short → "Dev_…". */
export function devNameOf(name: string | null | undefined, devUserId: string): string {
  const cleaned = (name ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_.א-ת]/g, '')
    .slice(0, 16);
  if (DISPLAY_NAME.test(cleaned)) return cleaned;
  return `Dev_${devUserId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'player'}`;
}

let reading: Promise<string> | null = null;

/**
 * This phone's dev user id, made and saved on first use. Calls at once share one read; a failure rejects and
 * the next call tries again.
 */
export function getDevUserId(storage: IdentityStorage = Storage): Promise<string> {
  if (reading) return reading;
  const attempt = (async () => {
    const stored = await storage.getItem(DEV_USER_ID_KEY);
    if (stored && DEV_USER_ID.test(stored)) return stored;
    const id = `dev-${uuidV4()}`;
    await storage.setItem(DEV_USER_ID_KEY, id);
    return id;
  })();
  reading = attempt;
  attempt.catch(() => {
    if (reading === attempt) reading = null;
  });
  return attempt;
}

/** Forgets the shared read (tests). */
export function resetDevIdentityCache(): void {
  reading = null;
}

/** The dev identity: the stored id, and the profile's name made to fit. */
export async function devIdentity(storage?: IdentityStorage): Promise<NetIdentity> {
  const devUserId = await getDevUserId(storage);
  return { kind: 'dev', devUserId, name: devNameOf(useProfile.getState().name, devUserId) };
}

let source: IdentitySource = () => devIdentity();

/** Stage 8 plugs the account in here (see the TODO above). */
export function setNetIdentitySource(next: IdentitySource): void {
  source = next;
}

/** Who this phone is now: what createOnlineClient asks on every join. */
export const netIdentity: IdentitySource = () => source();
