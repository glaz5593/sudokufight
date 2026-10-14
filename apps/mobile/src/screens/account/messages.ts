import type { TFunction } from 'i18next';

import { isAccountApiError } from '../../api/accountApi';
import { toAuthError } from '../../auth/errors';
import type { AuthErrorCode } from '../../auth/types';

/**
 * What to tell the player about a failed account action, in the app's language: the sign-in's errors
 * (errors.auth.*: wrong password, unknown user, too many attempts, no connection…) and the server's
 * (errors.api.*: name taken, rename too soon, server unreachable…).
 */
export function errorMessage(t: TFunction, error: unknown): string {
  if (isAccountApiError(error)) return t('account:errors.api.' + error.code);
  return t('account:errors.auth.' + toAuthError(error).code);
}

/**
 * Password failures that may just mean "this address signed up with Google" (it then has no password):
 * with Google on the screen, the message also points at its button.
 */
const GOOGLE_HINTS: Partial<Record<AuthErrorCode, string>> = {
  wrongPassword: 'account:google.passwordHint',
  invalidCredentials: 'account:google.passwordHint',
  userNotFound: 'account:google.passwordHint',
  emailInUse: 'account:google.emailInUseHint',
};

/** errorMessage, and when the screen offers Google, the hint that fits (GOOGLE_HINTS). */
export function withGoogleHint(t: TFunction, error: unknown, google: boolean): string {
  const message = errorMessage(t, error);
  if (!google || isAccountApiError(error)) return message;
  const hint = GOOGLE_HINTS[toAuthError(error).code];
  return hint ? `${message} ${t(hint)}` : message;
}
