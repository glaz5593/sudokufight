/**
 * Password and email checks of the registration (spec §3.1): at least 8 characters and nothing else (Moshe,
 * 14.10.2026: "it's not a bank account": no letter, digit, case or symbol rules), and a strength meter with 4
 * levels that only advises. Firebase checks the password again on its side (its own minimum is 6; a password
 * policy in the Firebase console could ask for more, and it should stay off).
 */

export const PASSWORD_MIN_LENGTH = 8;

/** The registration's password rules, each met or not: there is one. */
export interface PasswordRules {
  length: boolean;
}

export const PASSWORD_RULES = ['length'] as const satisfies readonly (keyof PasswordRules)[];

const DIGIT = /\p{Nd}/u;

export function passwordRules(password: string): PasswordRules {
  return { length: [...password].length >= PASSWORD_MIN_LENGTH };
}

export const passwordOk = (password: string): boolean => passwordRules(password).length;

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
 * The meter (Register-Account), advice only: any password of 8 characters can be used. Shorter than that, or
 * predictable ("12345678", "aaaaaaaa"), it is "weak"; otherwise "fair", and longer passwords that mix more
 * kinds of characters (lower case, upper case, digits, symbols) go up from there.
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
