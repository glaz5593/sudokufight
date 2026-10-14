// Types of version.mjs, for the tests that import it (src/__tests__/version.test.ts).

export type VersionPart = 'patch' | 'minor' | 'major';

export declare const MAX_PART: number;
export declare const PARTS: readonly VersionPart[];
export declare const BUMP_USAGE: string;

export declare function parseVersion(text: unknown): { major: number; minor: number; patch: number } | null;
export declare function buildNumber(version: string): number;
export declare function bumpVersion(version: string, part?: VersionPart): string;
export declare function setAppJsonVersion(text: string, next: string): { text: string; from: string };
export declare function parseBumpArgs(
  argv: readonly string[],
): { kind: 'help' } | { kind: 'error'; error: string } | { kind: 'bump'; part: VersionPart; dryRun: boolean };
