// One import per weight: the packages' index requires every weight and italic, which would ship all of them.
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Teko_500Medium } from '@expo-google-fonts/teko/500Medium';
import { Teko_600SemiBold } from '@expo-google-fonts/teko/600SemiBold';
import { useFonts } from 'expo-font';

/**
 * Rubik for the interface, Teko for numbers (docs/design/tokens.json "font"). The release build embeds them
 * (app.json, expo-font plugin); loading them here as well keeps a development build in step without a rebuild.
 * The family names are the files' names, e.g. "Rubik_700Bold", as the tokens' type styles expect.
 */
export const FONTS = {
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
  Teko_500Medium,
  Teko_600SemiBold,
};

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONTS);
  // A font that fails to load falls back to the system font; the app must still open.
  return loaded || error !== null;
}
