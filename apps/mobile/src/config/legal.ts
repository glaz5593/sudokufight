import { accountConfig } from './account';
import { httpBaseUrl } from './server';

/**
 * The legal pages (spec §23; work plan stage 14): the privacy policy, the terms of use and the account deletion
 * page, served by the game server at /legal/… in Hebrew and English (apps/server/src/legal). The registration's
 * checkbox and the settings link here; the stores get the same URLs (docs/store/).
 */
export type LegalPage = 'privacy' | 'terms' | 'delete-account';

/**
 * Where the pages are, without a trailing slash: EXPO_PUBLIC_LEGAL_BASE_URL (accountConfig.legal.baseUrl) when
 * set, e.g. a website of the game; else the game server's /legal.
 */
export function legalBaseUrl(
  configured: string | null = accountConfig.legal.baseUrl,
  server: string = httpBaseUrl(),
): string {
  const base = configured?.trim() ? configured.trim() : `${server}/legal`;
  return base.replace(/\/+$/, '');
}

/** A page in the app's language (Hebrew unless the app is in English). */
export function legalUrl(page: LegalPage, language: string, base: string = legalBaseUrl()): string {
  const lang = language === 'en' ? 'en' : 'he';
  return `${base}/${page}?lang=${lang}`;
}
