import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

/**
 * Restarts the app's JavaScript, e.g. after a language change flips RTL (work plan stage 3).
 * Release builds use expo-updates; a development build reloads from the dev server.
 */
export async function restartApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload();
  }
}
