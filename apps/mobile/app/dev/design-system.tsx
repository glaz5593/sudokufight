import { Redirect, router } from 'expo-router';

import { DesignSystemScreen } from '../../src/screens/DesignSystemScreen';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/design-system (stage 3): every component in its states. Development builds only. */
export default function DesignSystemRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DesignSystemScreen onClose={close} />;
}
