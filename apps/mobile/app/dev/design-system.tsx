import { Redirect, router } from 'expo-router';

type Screen = typeof import('../../src/screens/DesignSystemScreen').DesignSystemScreen;

/**
 * Development builds only. The require sits behind __DEV__, which a release bundle folds to false, so the
 * screen and the design system's demos (src/components/dev) never ship (docs/PERF.md).
 */
const DesignSystemScreen: Screen | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- dropped from release bundles, see above
    (require('../../src/screens/DesignSystemScreen') as typeof import('../../src/screens/DesignSystemScreen'))
      .DesignSystemScreen
  : null;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/design-system (stage 3): every component in its states. Development builds only. */
export default function DesignSystemRoute() {
  if (!DesignSystemScreen) return <Redirect href="/" />;
  return <DesignSystemScreen onClose={close} />;
}
