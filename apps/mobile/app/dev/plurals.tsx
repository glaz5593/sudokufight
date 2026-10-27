import { Redirect, router } from 'expo-router';

import { pseudoLanguagesAllowed } from '../../src/i18n/pseudoLanguages';
import { PluralCheckScreen } from '../../src/screens/PluralCheckScreen';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * /dev/plurals (localization plan 0יג): every plural key with 0, 1, 2, 5, 11, 21, 100 and 1.5, a date and a
 * decimal, in the app's language. Development and staging builds (Settings → "בדיקה"), so the first APK of the
 * localization shows it on Moshe's phone; a production build goes Home (i18n/pseudoLanguages.ts).
 */
export default function PluralsRoute() {
  if (!pseudoLanguagesAllowed()) return <Redirect href="/" />;
  return <PluralCheckScreen onClose={close} />;
}
