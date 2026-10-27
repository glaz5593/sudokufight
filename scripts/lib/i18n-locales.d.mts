// Types of i18n-locales.mjs, for the tests that import it (apps/mobile/src/__tests__/i18nParity.test.ts…).

export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export declare const PLURAL_FORMS: readonly PluralForm[];
export declare const PLURAL_SUFFIX: RegExp;
export declare const REFERENCE: 'en';
export declare const SOURCE_LANGUAGES: readonly string[];
export declare const DEFAULT_ENABLED: readonly string[];
export declare const RTL_LANGUAGES: readonly string[];
export declare const PSEUDO_LANGUAGES: readonly string[];
export declare const NON_LATIN_LANGUAGES: readonly string[];
export declare const DEV_ONLY: { namespaces: readonly string[]; keys: Record<string, readonly string[]> };
export declare const KEEP_LATIN: readonly string[];
export declare const SAME_AS_ENGLISH_OK: Record<string, Record<string, string>>;
export declare const BLANK_OK: RegExp;

export declare function isDevOnly(ns: string, key?: string | null): boolean;
export declare function flatten(tree: object, prefix?: string): [key: string, value: unknown][];
export declare function placeholdersOf(s: string): string[];
export declare function nestingOf(s: string): string[];
export declare function tagsOf(s: string): string[];
export declare function isolateProblem(s: string): string | null;
export declare function pluralBases(keys: Iterable<string>): Map<string, Set<PluralForm>>;

/** namespace → Map(dotted key → value) */
export type Dictionary = Record<string, Map<string, unknown>>;

export interface LanguageRules {
  categories: readonly string[];
  select(n: number): string;
}

export interface CheckLanguageInput {
  lang: string;
  dict: Dictionary;
  en: Dictionary;
  he?: Dictionary;
  plural: LanguageRules;
  release?: boolean;
  devTranslated?: boolean;
}

export interface CheckLanguageResult {
  errors: string[];
  warnings: string[];
  /** `ns:key` of the plural forms the language's rules never pick. */
  extraForms: string[];
  /**
   * The errors (also in `errors`) that only lag behind English and Hebrew: a namespace, key or plural form not
   * translated yet, one English dropped, Arabic's isolation behind Hebrew's. D120: daily warnings for an enabled
   * translated language, errors for Hebrew, English and with --release.
   */
  incomplete: string[];
}

export declare function checkLanguage(input: CheckLanguageInput): CheckLanguageResult;
export declare function extraFormsSummary(lang: string, extraForms: readonly string[]): string;
