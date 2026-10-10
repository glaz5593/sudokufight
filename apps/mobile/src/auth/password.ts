/**
 * Password and email checks of the registration (spec §3.1): at least 8 characters, at least one letter and
 * one digit, and a strength meter with 4 levels. Firebase checks the password again on its side.
 */

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRules {
  length: boolean;
  letter: boolean;
  digit: boolean;
}

/** Any letter, Hebrew included. */
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;

export function passwordRules(password: string): PasswordRules {
  return {
    length: [...password].length >= PASSWORD_MIN_LENGTH,
    letter: LETTER.test(password),
    digit: DIGIT.test(password),
  };
}

export const passwordOk = (password: string): boolean => {
  const r = passwordRules(password);
  return r.length && r.letter && r.digit;
};

/** 0: empty · 1 weak · 2 fair · 3 good · 4 strong. */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4;
export const STRENGTH_LEVELS = ['weak', 'fair', 'good', 'strong'] as const;
export type StrengthLevel = (typeof STRENGTH_LEVELS)[number];

/** One character over and over, or a run like "abcdefgh" / "12345678". */
function predictable(password: string): boolean {
  const chars = [...password.toLowerCase()];
  if (new Set(chars).size <= 2) return true;
  let run = 1;
  for (let i = 1; i < chars.length; i++) {
    const step = chars[i]!.codePointAt(0)! - chars[i - 1]!.codePointAt(0)!;
    run = step === 1 || step === -1 ? run + 1 : 1;
    if (run >= 6) return true;
  }
  return false;
}

/**
 * The meter (Register-Account): below the rules it is always "weak"; meeting them is "fair"; longer
 * passwords that mix more kinds of characters (lower case, upper case, digits, symbols) go up from there.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length === 0) return 0;
  if (!passwordOk(password) || predictable(password)) return 1;
  const length = [...password].length;
  const kinds = [/\p{Ll}/u, /\p{Lu}/u, DIGIT, /[^\p{L}\p{Nd}]/u].filter((re) => re.test(password)).length;
  // Hebrew has no case: a Hebrew letter counts as a kind of its own.
  const variety = kinds + (/[א-ת]/.test(password) ? 1 : 0);
  if ((length >= 12 && variety >= 4) || (length >= 16 && variety >= 3)) return 4;
  if (length >= 10 && variety >= 3) return 3;
  return 2;
}

export const strengthLevel = (strength: PasswordStrength): StrengthLevel | null =>
  strength === 0 ? null : STRENGTH_LEVELS[strength - 1]!;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailOk = (email: string): boolean => EMAIL.test(email.trim());
