// Types of store-check.mjs, for the tests that import it (apps/server/test/storeCheck.test.ts).

export type Store = 'googlePlay' | 'appStore';

export declare const STORE_LOCALES: Record<string, Record<Store, readonly string[]>>;
export declare const LIMITS: {
  googlePlay: Record<'title' | 'shortDescription' | 'fullDescription' | 'whatsNew', number>;
  appStore: Record<'name' | 'subtitle' | 'promotionalText' | 'description' | 'keywords' | 'whatsNew', number>;
};
export declare const SCREENSHOT_CAPTIONS: number;
export declare const BRAND: string;
export declare const KEYWORD_BYTES: number;
export declare const PLAY_BANNED: Record<string, readonly string[]>;
export declare const REAL_PEOPLE: Record<string, readonly RegExp[]>;

export declare function length(s: string): number;

export interface StoreCheckResult {
  errors: string[];
  warnings: string[];
}

export declare function checkStoreFile(lang: string, data: unknown): StoreCheckResult;
export declare function checkStoreLocales(files: Record<string, unknown>): StoreCheckResult;
