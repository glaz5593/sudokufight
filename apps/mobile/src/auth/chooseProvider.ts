import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { createDevAuthProvider } from './devProvider';
import { createFirebaseAuthProvider } from './firebaseProvider';
import type { AuthProvider } from './types';

/**
 * Whether this build has Firebase on this platform. app.config.ts sets `extra.firebase` from the config
 * files it found at build time (apps/mobile/config/firebase/, or EAS file variables), so a build without
 * them says false and the app falls back to the development sign-in instead of crashing.
 */
export function firebaseConfigured(
  extra: unknown = Constants.expoConfig?.extra,
  platform: string = Platform.OS,
): boolean {
  if (typeof extra !== 'object' || extra === null) return false;
  const firebase = (extra as { firebase?: unknown }).firebase;
  if (typeof firebase !== 'object' || firebase === null) return false;
  return (firebase as Record<string, unknown>)[platform] === true;
}

/**
 * Firebase when the build has it for this platform; otherwise the development sign-in (local accounts,
 * "dev:<uid>" tokens a production server refuses). Dropping the Firebase files in and rebuilding switches
 * to Firebase with no code change.
 */
export function chooseAuthProvider(
  configured: boolean = firebaseConfigured(),
  make: { firebase: () => AuthProvider; dev: () => AuthProvider } = {
    firebase: () => createFirebaseAuthProvider(),
    dev: () => createDevAuthProvider({ storage: Storage }),
  },
): AuthProvider {
  return configured ? make.firebase() : make.dev();
}
