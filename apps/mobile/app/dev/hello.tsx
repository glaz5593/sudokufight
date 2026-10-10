import { Redirect, router } from 'expo-router';

type Screen = typeof import('../../src/screens/HelloScreen').HelloScreen;

/**
 * Development builds only. The require sits behind __DEV__, which a release bundle folds to false, so the
 * screen (and its echo client) never ships (docs/PERF.md).
 */
const HelloScreen: Screen | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- dropped from release bundles, see above
    (require('../../src/screens/HelloScreen') as typeof import('../../src/screens/HelloScreen')).HelloScreen
  : null;

const openDesignSystem = () => router.push('/dev/design-system');

/** /dev/hello (stage 0): the end-to-end check, moved here when Home took "/". Development builds only. */
export default function HelloRoute() {
  if (!HelloScreen) return <Redirect href="/" />;
  return <HelloScreen onOpenDesignSystem={openDesignSystem} />;
}
