import { getLocales } from 'expo-localization';

import { I18N_CONFIG } from '../config/i18n';
import { ENABLED_LANGUAGES, isLanguage, type Language } from './languages';

/**
 * The phone's language as one of the app's (localization plan 0א, D101, D105). Its own file, importing only
 * leaves (languages.ts, config/i18n.ts) and expo-localization: settings.ts, i18n/index.ts and the countries'
 * tables read it without an import cycle (until 1.0.4 it lived in i18n/index.ts, which settings.ts imported).
 */

interface TagParts {
  language: string;
  script: string | null;
  region: string | null;
}

/** "zh_hant_tw" → zh, Hant, TW: the language in lower case, a script in title case, a region in upper case. */
function parseTag(tag: string): TagParts {
  const [first = '', ...rest] = tag.trim().replace(/_/g, '-').split('-');
  const script = rest.find((p) => /^[A-Za-z]{4}$/.test(p));
  const region = rest.find((p) => /^([A-Za-z]{2}|\d{3})$/.test(p));
  return {
    language: first.toLowerCase(),
    script: script ? script[0]!.toUpperCase() + script.slice(1).toLowerCase() : null,
    region: region ? region.toUpperCase() : null,
  };
}

/**
 * A device or BCP 47 tag as one of the app's languages, or null when none of `enabled` fits (D105, config/i18n.ts
 * regionMap): Android's old iw and in as he and id; Chinese by its script, else by its region (TW, HK and MO
 * Traditional, anything else Simplified); every Spanish as es and every Portuguese as pt-BR; otherwise the tag's
 * language ("de-AT" → de). A pseudo-locale of the phone (en-XA, ar-XB) is its language, en or ar.
 */
export function resolveLanguageTag(tag: string, enabled: readonly string[]): Language | null {
  const map = I18N_CONFIG.regionMap;
  const parts = parseTag(tag);
  if (!parts.language) return null;
  const language = map.legacy[parts.language] ?? parts.language;
  let candidate: string;
  const exact = parts.region ? map.byTag[`${language}-${parts.region}`] : undefined;
  if (exact) candidate = exact;
  else if (language === 'zh') {
    const { Hans, Hant, traditionalRegions } = map.chinese;
    if (parts.script === 'Hant' || parts.script === 'Hans') candidate = parts.script === 'Hant' ? Hant : Hans;
    else candidate = parts.region && traditionalRegions.includes(parts.region) ? Hant : Hans;
  } else candidate = map.byLanguage[language] ?? language;
  return isLanguage(candidate) && enabled.includes(candidate) ? candidate : null;
}

/** The tags the phone prefers, first to last (expo-localization; on Android 13+ the per-app language comes first). */
function preferredTags(): string[] {
  try {
    return getLocales().map((locale) => locale.languageTag ?? locale.languageCode ?? '');
  } catch {
    return [];
  }
}

/**
 * The phone's first preferred language as the system reports it, in one spelling ("he-IL", "zh-Hant-TW",
 * "pt-PT"; Android's old iw and in as he and id), or null when it reports none. Deliberately not one of the
 * app's languages: languageRules.ts compares it with the previous launch's to tell a choice made in the system
 * settings, and an update that enables more languages (or a change of D105's mapping) changes the language a tag
 * maps to without the player touching anything.
 */
export function systemLocaleTag(): string | null {
  const { language, script, region } = parseTag(preferredTags()[0] ?? '');
  if (!language) return null;
  const canonical = I18N_CONFIG.regionMap.legacy[language] ?? language;
  return [canonical, script, region].filter(Boolean).join('-');
}

/**
 * The first of the phone's preferred languages the app has (all of them, not just the first: a phone set to
 * French then Hebrew gets Hebrew), else the fallback language, English (D101).
 */
export function deviceLanguage(enabled: readonly string[] = ENABLED_LANGUAGES): Language {
  for (const tag of preferredTags()) {
    const lang = resolveLanguageTag(tag, enabled);
    if (lang) return lang;
  }
  return I18N_CONFIG.fallbackLanguage;
}
