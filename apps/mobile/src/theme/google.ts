/**
 * Google's own colours for the "Continue with Google" button (Google Identity's branding guidelines for Android,
 * https://developers.google.com/identity/branding-guidelines). These are a third party's brand colours, not
 * design tokens: Google asks for them exactly, so they live here and not in docs/design/tokens.json.
 *
 * The button (screens/account/GoogleButton.tsx) uses the dark theme, which the guidelines give for dark
 * backgrounds like direction C's; the light and neutral themes are listed for completeness.
 */
export const GOOGLE_BRAND = {
  /** The standard multi-colour "G" (never recoloured, never on its own without the button's text here). */
  logo: { blue: '#4285F4', green: '#34A853', yellow: '#FBBC05', red: '#EA4335' },
  /**
   * Dark theme: fill #131314, a 1 dp #8E918F stroke inside, text #E3E3E3. Pressed: Google's state layer, the
   * text colour at 12% over the fill (#2C2C2D).
   */
  dark: { fill: '#131314', stroke: '#8E918F', text: '#E3E3E3', pressed: '#2C2C2D' },
  light: { fill: '#FFFFFF', stroke: '#747775', text: '#1F1F1F' },
  neutral: { fill: '#F2F2F2', stroke: '#F2F2F2', text: '#1F1F1F' },
} as const;

/**
 * The guidelines' measures (a 40 dp button: an 18 dp logo, 12 dp before it, 10 dp between it and the text,
 * Roboto Medium 14 sp), on the app's taller button (size.buttonMd, 52 dp): the same paddings, with the logo and
 * the text one step up (20 dp, 16 sp) so they keep their weight in it. Roboto is the system font on Android.
 */
export const GOOGLE_BUTTON = {
  logo: 20,
  paddingStart: 12,
  gap: 10,
  fontSize: 16,
  lineHeight: 20,
  fontWeight: '500',
} as const;
