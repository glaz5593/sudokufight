import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

import { crashReporter } from './crashlytics';

/**
 * Restarts the app's JavaScript, e.g. after a language change (work plan stage 3; localization plan D104: on
 * every language change, since fonts and line heights are set as the app starts). Release builds use
 * expo-updates; a development build reloads from the dev server. One restart at a time: a second call while
 * one is on its way waits for it.
 */
let restarting: Promise<void> | null = null;

export function restartApp(): Promise<void> {
  restarting ??= (async () => {
    try {
      await Updates.reloadAsync();
    } catch {
      DevSettings.reload();
    } finally {
      restarting = null;
    }
  })();
  return restarting;
}

/**
 * The direction the last restart was for ('rtl' | 'ltr'); with a '!' after it ('rtl!') once a restart for it
 * did not take; '' while the app runs in the direction it wants.
 */
export const DIRECTION_RESTART_KEY = 'restart.direction';

const directionName = (rtl: boolean) => (rtl ? 'rtl' : 'ltr');
const GAVE_UP = '!';

/**
 * Restarts so a new layout direction takes effect (React Native sets it as the app starts), unless the last
 * restart was for this same direction and the app still came up in the other one: then no second restart, the
 * app goes on in the wrong direction, and the error is recorded once (localization plan 0א, D104). Later runs
 * don't try again for that direction (no restart on every launch) until the app runs in the direction it wants
 * (directionSettled) or restarts for the other one. On iOS a native module can reset the direction on every
 * launch (plan 0יא), and without this the app would restart for ever. Returns whether it restarts.
 */
export function restartForDirection(rtl: boolean): boolean {
  const wanted = directionName(rtl);
  const last = Storage.getItemSync(DIRECTION_RESTART_KEY) ?? '';
  if (last === wanted + GAVE_UP) return false;
  if (last === wanted) {
    Storage.setItemSync(DIRECTION_RESTART_KEY, wanted + GAVE_UP);
    crashReporter().recordError(
      new Error(`The layout is still ${rtl ? 'LTR' : 'RTL'} after a restart for ${wanted}`),
      'i18n: direction',
    );
    return false;
  }
  Storage.setItemSync(DIRECTION_RESTART_KEY, wanted);
  void restartApp();
  return true;
}

/** The app runs in the direction it wanted: a later mismatch may restart again. */
export function directionSettled(): void {
  if (Storage.getItemSync(DIRECTION_RESTART_KEY)) Storage.setItemSync(DIRECTION_RESTART_KEY, '');
}
