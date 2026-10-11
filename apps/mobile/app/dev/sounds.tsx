import { Redirect, router } from 'expo-router';

type Module = typeof import('../../src/screens/SoundAuditionScreen');

/**
 * Development builds only. The require sits behind __DEV__, which a release bundle folds to false, so the
 * screen, its candidate list and the candidate WAV files (assets/sounds/candidates) never ship (docs/PERF.md).
 */
const SoundAuditionScreen: Module['SoundAuditionScreen'] | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- dropped from release bundles, see above
    (require('../../src/screens/SoundAuditionScreen') as Module).SoundAuditionScreen
  : null;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/sounds: the final-sound candidates next to the current sounds, with their haptics. Development builds only. */
export default function SoundsRoute() {
  if (!SoundAuditionScreen) return <Redirect href="/" />;
  return <SoundAuditionScreen onClose={close} />;
}
