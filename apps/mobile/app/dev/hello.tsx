import { Redirect, router } from 'expo-router';

import { HelloScreen } from '../../src/screens/HelloScreen';

const openDesignSystem = () => router.push('/dev/design-system');

/** /dev/hello (stage 0): the end-to-end check, moved here when Home took "/". Development builds only. */
export default function HelloRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <HelloScreen onOpenDesignSystem={openDesignSystem} />;
}
