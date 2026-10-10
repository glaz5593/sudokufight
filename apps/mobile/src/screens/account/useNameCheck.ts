import {
  type DisplayNameProblem,
  invalidNameChars,
  type NameAvailability,
  validateDisplayName,
} from '@sudoku-fight/protocol';
import { useEffect, useState } from 'react';

import { authDeps } from '../../auth/authStore';
import { accountConfig } from '../../config/account';

/**
 * The display name's live check (spec §3.1; work plan stage 8: "בדיקת זמינות בזמן ההקלדה, עם debounce של
 * 300ms"). The rules of the protocol are checked at once, as the player types (no server call for a name
 * that breaks them); a name that follows them is asked about 300 ms after the last keystroke, and an answer
 * to an older name is dropped. Offensive words are the server's to find ('blocked').
 *
 * - idle: nothing typed · current: the player's own name (Edit profile), nothing to check
 * - invalid (with `problem`, and `chars` for invalidChars) · checking · available · taken · blocked
 * - error: the server could not be asked (offline): the name is checked again when it is submitted.
 */
export type NameCheckState =
  'idle' | 'current' | 'invalid' | 'checking' | 'available' | 'taken' | 'blocked' | 'error';

export interface NameCheck {
  state: NameCheckState;
  /** The name as it will be sent: trimmed. */
  name: string;
  problem: DisplayNameProblem | null;
  /** invalidChars: the characters that are not allowed. */
  chars: string[];
}

export type CheckName = (name: string, signal: AbortSignal) => Promise<NameAvailability>;

const defaultCheck: CheckName = (name, signal) => authDeps().api.nameAvailable(name, signal);

interface Answer {
  name: string;
  state: 'available' | 'taken' | 'blocked' | 'invalid' | 'error';
  problem: DisplayNameProblem | null;
}

function answerOf(name: string, a: NameAvailability): Answer {
  if (a.available) return { name, state: 'available', problem: null };
  const reason = a.reason ?? 'taken';
  return { name, state: reason, problem: a.problem ?? null };
}

export function useNameCheck(
  input: string,
  {
    current = null,
    check = defaultCheck,
    debounceMs = accountConfig.nameCheckDebounceMs,
  }: { current?: string | null; check?: CheckName; debounceMs?: number } = {},
): NameCheck {
  const name = input.trim();
  const problem = name === '' ? null : validateDisplayName(name);
  const isCurrent = current !== null && name === current;
  const needsServer = name !== '' && problem === null && !isCurrent;
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (!needsServer) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      check(name, controller.signal).then(
        (a) => {
          if (!controller.signal.aborted) setAnswer(answerOf(name, a));
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ name, state: 'error', problem: null });
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [name, needsServer, check, debounceMs]);

  if (name === '') return { state: 'idle', name, problem: null, chars: [] };
  if (problem) {
    return {
      state: 'invalid',
      name,
      problem,
      chars: problem === 'invalidChars' ? invalidNameChars(name) : [],
    };
  }
  if (isCurrent) return { state: 'current', name, problem: null, chars: [] };
  if (answer?.name !== name) return { state: 'checking', name, problem: null, chars: [] };
  return {
    state: answer.state,
    name,
    problem: answer.problem,
    chars: answer.problem === 'invalidChars' ? invalidNameChars(name) : [],
  };
}

/** Whether a name in this state may be submitted (an unchecked one is checked by the server then). */
export const nameSubmittable = (state: NameCheckState): boolean =>
  state === 'available' || state === 'error' || state === 'current';
