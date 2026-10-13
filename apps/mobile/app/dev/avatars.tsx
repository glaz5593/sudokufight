import { Redirect, router } from 'expo-router';

type Module = typeof import('../../src/screens/AvatarLabScreen');

/**
 * Development builds only. The require sits behind __DEV__, which a release bundle folds to false, so the
 * screen never ships (the avatars themselves do: every screen draws them).
 */
const AvatarLabScreen: Module['AvatarLabScreen'] | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- dropped from release bundles, see above
    (require('../../src/screens/AvatarLabScreen') as Module).AvatarLabScreen
  : null;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/avatars: every avatar with every expression and motion, idling or not. Development builds only. */
export default function AvatarsRoute() {
  if (!AvatarLabScreen) return <Redirect href="/" />;
  return <AvatarLabScreen onClose={close} />;
}
