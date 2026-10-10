import { useFonts } from 'expo-font';

/**
 * Rubik for the interface, Teko for numbers (docs/design/tokens.json "font"): the six weights in use, no more.
 * The family names are the files' names, e.g. "Rubik_700Bold", as the tokens' type styles expect. app.json's
 * expo-font plugin embeds the same six files in every native build (a test keeps the two lists equal).
 */
export const FONT_FAMILIES = [
  'Rubik_400Regular',
  'Rubik_500Medium',
  'Rubik_600SemiBold',
  'Rubik_700Bold',
  'Teko_500Medium',
  'Teko_600SemiBold',
] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];

/**
 * The fonts loaded at run time, under the tokens' names.
 *
 * - Android release builds load none: an embedded font's family there is its file name already, and leaving
 *   the files out of the JS bundle saves shipping each one twice (1.2 MB; docs/PERF.md). The condition is
 *   inlined at build time (EXPO_OS, __DEV__), so Metro drops the requires.
 * - iOS names an embedded font by its PostScript name ("Rubik-Bold"), so the files are loaded under the
 *   tokens' names; development builds load them too, which keeps one in step without a rebuild.
 *
 * One require per weight: the packages' index requires every weight and italic, which would ship all of them.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- conditional on purpose, see above */
export const FONTS: Partial<Record<FontFamily, number>> =
  process.env.EXPO_OS === 'android' && !__DEV__
    ? {}
    : {
        Rubik_400Regular: (require('@expo-google-fonts/rubik/400Regular') as { Rubik_400Regular: number })
          .Rubik_400Regular,
        Rubik_500Medium: (require('@expo-google-fonts/rubik/500Medium') as { Rubik_500Medium: number })
          .Rubik_500Medium,
        Rubik_600SemiBold: (require('@expo-google-fonts/rubik/600SemiBold') as { Rubik_600SemiBold: number })
          .Rubik_600SemiBold,
        Rubik_700Bold: (require('@expo-google-fonts/rubik/700Bold') as { Rubik_700Bold: number })
          .Rubik_700Bold,
        Teko_500Medium: (require('@expo-google-fonts/teko/500Medium') as { Teko_500Medium: number })
          .Teko_500Medium,
        Teko_600SemiBold: (require('@expo-google-fonts/teko/600SemiBold') as { Teko_600SemiBold: number })
          .Teko_600SemiBold,
      };
/* eslint-enable @typescript-eslint/no-require-imports */

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONTS as Record<string, number>);
  // A font that fails to load falls back to the system font; the app must still open.
  return loaded || error !== null;
}
