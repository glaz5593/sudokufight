import Storage from 'expo-sqlite/kv-store';

import { isUuid, uuidV4 } from './uuid';

export { uuidV4 } from './uuid';

/**
 * This install's id (spec §27.1): a random UUID made on the first launch and kept in expo-sqlite's key-value
 * store, so every later launch reports under the same one and an install counts even without an account.
 * Uninstalling wipes it (the next install is a new one): uninstalls are not tracked, the admin site's
 * "last seen" tells who left.
 */
export const INSTALL_ID_KEY = 'telemetry.installId';

let reading: Promise<string> | null = null;

/**
 * The id, made and saved on the first call ever. Calls made at once share one read, so the first launch
 * can't make two. A failure to read or to save it rejects and the next call tries again: nothing is sent
 * under an id that could not be kept, which would count one phone as many installs.
 */
export function getInstallId(): Promise<string> {
  if (reading) return reading;
  const attempt = (async () => {
    const stored = await Storage.getItem(INSTALL_ID_KEY);
    if (isUuid(stored)) return stored.toLowerCase();
    const id = uuidV4();
    await Storage.setItem(INSTALL_ID_KEY, id);
    return id;
  })();
  reading = attempt;
  attempt.catch(() => {
    if (reading === attempt) reading = null;
  });
  return attempt;
}
