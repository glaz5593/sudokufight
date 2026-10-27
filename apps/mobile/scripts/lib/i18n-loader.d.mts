// Types of i18n-loader.mjs, for the test that imports it (src/i18n/__tests__/localeLoaders.test.ts).

export interface LocaleFolder {
  language: string;
  namespaces: readonly string[];
}

export declare const SOURCE_LANGUAGE: string;
export declare const LOADER_PATH: string;
export declare const LOCALES_PATH: string;

export declare function scanLocales(localesDir: string): { language: string; namespaces: string[] }[];
export declare function renderLocaleLoaders(locales: readonly LocaleFolder[]): string;
