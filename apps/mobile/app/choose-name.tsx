import { Stack } from 'expo-router';

import { ChooseNameScreen } from '../src/screens/moderation';

/**
 * /choose-name: an admin reset my display name (spec §3.5, Me.nameResetRequired). The root layout keeps the
 * player here until a new name is saved (auth/redirect.ts), so there is no swipe back.
 */
export default function ChooseNameRoute() {
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <ChooseNameScreen />
    </>
  );
}
