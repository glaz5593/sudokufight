// Types of i18n-numbers.mjs (rule 21 of the translation check), for the tests that import it
// (apps/mobile/src/__tests__/numberRule.test.ts).

export declare const COUNTED_NOUNS: readonly string[];
export declare const COUNT_ADJECTIVES: readonly string[];
export declare const WORD_PLACEHOLDERS: readonly string[];
export declare const WHY: Readonly<Record<string, string>>;
export declare const NUMBER_OK: {
  /** placeholder name → reason, in every key (never for a counted noun after it). */
  placeholders: Record<string, string>;
  /** 'ns:key' (a plural's base) → placeholder → reason. */
  keys: Record<string, Record<string, string>>;
};

export declare function withoutNesting(s: string): string;
export declare function shownPlaceholders(s: string): string[];
export declare function nestedCounts(s: string): string[];
export declare function countedNounAfter(value: string, placeholder: string): string | null;
export declare function numberAllowed(
  ns: string,
  base: string,
  placeholder: string,
  options?: { noun?: string | null },
): string | null;

/** What the t() calls pass a placeholder. */
export interface PassedNumber {
  /** Where a number is passed that is not the plural's count ("file:line"). */
  numberAt: string[];
  /** A call passes it the plural's count, shown another way. */
  showsCount: boolean;
}

export interface NumberProblemsInput {
  ns: string;
  base: string;
  value: string;
  isPlural: boolean;
  nested?: boolean;
  code?: Map<string, PassedNumber>;
}

export interface NumberProblem {
  placeholder: string;
  noun: string | null;
  numberAt: string[];
}

export declare function numberProblems(input: NumberProblemsInput): {
  problems: NumberProblem[];
  allowed: string[];
};
export declare function allowListEntries(): string[];
