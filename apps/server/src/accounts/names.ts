import { type DisplayNameProblem, validateDisplayName } from '@sudoku-fight/protocol';

import type { BlockedMatch, BlockedWords } from './blockedWords';

/**
 * The rules a display name must follow before the database is asked whether it is taken (spec §3.1):
 * NAME_RULES (shared with the app), then the blocked-words list (server only).
 */
export type NameCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid'; problem: DisplayNameProblem }
  | { ok: false; reason: 'blocked'; match: BlockedMatch };

export function checkName(name: string, words: BlockedWords): NameCheck {
  const problem = validateDisplayName(name);
  if (problem !== null) return { ok: false, reason: 'invalid', problem };
  const match = words.match(name);
  if (match !== null) return { ok: false, reason: 'blocked', match };
  return { ok: true };
}
