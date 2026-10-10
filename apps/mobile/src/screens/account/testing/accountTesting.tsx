/* Test-only: the account routes for expo-router's renderRouter. */
import { useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import EditProfileRoute from '../../../../app/edit-profile';
import ForgotPasswordRoute from '../../../../app/forgot-password';
import LoginRoute from '../../../../app/login';
import RegisterAccountRoute from '../../../../app/register/account';
import RegisterFighterRoute from '../../../../app/register/fighter';
import SettingsRoute from '../../../../app/settings';
import VerifyEmailRoute from '../../../../app/verify-email';

function Stub({ name }: { name: string }) {
  const params = useLocalSearchParams();
  return <Text testID={`stub-${name}`}>{`${name} ${JSON.stringify(params)}`}</Text>;
}

/** The account screens, the settings, and a stub Home. No root layout: no redirects by status. */
export const ACCOUNT_ROUTES = {
  index: () => <Stub name="home" />,
  login: LoginRoute,
  'forgot-password': ForgotPasswordRoute,
  'register/fighter': RegisterFighterRoute,
  'register/account': RegisterAccountRoute,
  'verify-email': VerifyEmailRoute,
  'edit-profile': EditProfileRoute,
  settings: SettingsRoute,
};

export interface RenderedAccount {
  pathname(): string;
  searchParams(): Record<string, string | string[]>;
}

/**
 * Renders the account routes at `url` (renderRouter turns on Jest's fake timers). Test files import
 * 'react-native-reanimated' first and mock it with itself (see homeTesting.tsx).
 */
export async function renderAccount(
  url: string,
  overrides: Partial<Record<string, () => ReactElement>> = {},
): Promise<RenderedAccount> {
  const result = renderRouter({ ...ACCOUNT_ROUTES, ...overrides }, { initialUrl: url });
  await result;
  return { pathname: () => result.getPathname(), searchParams: () => result.getSearchParams() };
}
