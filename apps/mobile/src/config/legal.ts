import { contentLanguage, LANGUAGES } from '../i18n/languages';
import { accountConfig } from './account';
import { I18N_CONFIG } from './i18n';
import { httpBaseUrl } from './server';

/**
 * The legal pages (spec §23; work plan stage 14): the privacy policy, the terms of use and the account deletion
 * page, served by the game server at /legal/… (apps/server/src/legal): Hebrew and English, and a translated
 * version per language as they are added (D112). The registration's checkbox and the settings link here; the
 * stores get the same URLs (docs/store/).
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

/**
 * The version a language opens (D112, config/i18n.ts legalLanguageFor): 'own', the app's language itself, and
 * the server shows its translation, or English while it has none (so a version added on the server reaches
 * the apps already installed); 'english', English for every language but Hebrew. A language that is not one of
 * the app's (a pseudo language of the development builds): English.
 */
export function legalLanguage(language: string): string {
  if (I18N_CONFIG.legalLanguageFor === 'english') return language === 'he' ? 'he' : 'en';
  return contentLanguage(language, LANGUAGES);
}

/** A page in the app's language (legalLanguage). */
export function legalUrl(page: LegalPage, language: string, base: string = legalBaseUrl()): string {
  return `${base}/${page}?lang=${legalLanguage(language)}`;
}
