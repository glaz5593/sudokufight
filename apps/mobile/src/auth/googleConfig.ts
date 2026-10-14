import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * "המשך עם Google" (Moshe, 14.10.2026; spec §3.3): whether this build has it, and with which web client id.
 * app.config.ts sets `extra.googleSignIn` from google-services.json at build time: on for Android when the file
 * has the web OAuth client and at least one Android client (a SHA-1 added in Firebase). iOS comes later, with
 * Sign in with Apple (spec §23). Without it the Google button is not shown; email and password stay.
 *
 * Only the Firebase sign-in uses it (chooseProvider.ts): the development sign-in has no Google.
 */
export interface GoogleSignInConfig {
  /** The web OAuth client id: Google issues the ID token for it, and Firebase checks it. Public. */
  webClientId: string;
}

const OAUTH_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function googleSignInConfig(
  extra: unknown = Constants.expoConfig?.extra,
  platform: string = Platform.OS,
): GoogleSignInConfig | null {
  if (typeof extra !== 'object' || extra === null) return null;
  const google = (extra as { googleSignIn?: unknown }).googleSignIn;
  if (typeof google !== 'object' || google === null) return null;
  if ((google as Record<string, unknown>)[platform] !== true) return null;
  const { webClientId } = google as { webClientId?: unknown };
  return typeof webClientId === 'string' && OAUTH_CLIENT_ID.test(webClientId) ? { webClientId } : null;
}
