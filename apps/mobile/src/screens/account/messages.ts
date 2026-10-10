import type { TFunction } from 'i18next';

import { isAccountApiError } from '../../api/accountApi';
import { toAuthError } from '../../auth/errors';

/**
 * What to tell the player about a failed account action, in the app's language: the sign-in's errors
 * (errors.auth.*: wrong password, unknown user, too many attempts, no connection…) and the server's
 * (errors.api.*: name taken, rename too soon, server unreachable…).
 */
export function errorMessage(t: TFunction, error: unknown): string {
  if (isAccountApiError(error)) return t('account:errors.api.' + error.code);
  return t('account:errors.auth.' + toAuthError(error).code);
}
