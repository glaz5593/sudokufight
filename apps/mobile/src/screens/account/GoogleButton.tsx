import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { LARGE_TEXT_SCALE, Spinner } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { GOOGLE_BRAND, GOOGLE_BUTTON } from '../../theme/google';

/**
 * Google's "G", drawn from the geometry Google publishes with its sign-in button (a 48-unit square, four
 * paths in Google's four colours). Never mirrored, never recoloured, and no network asset.
 */
export function GoogleLogo({ size: px = GOOGLE_BUTTON.logo }: { size?: number }) {
  const { logo } = GOOGLE_BRAND;
  return (
    <Svg width={px} height={px} viewBox="0 0 48 48" importantForAccessibility="no-hide-descendants">
      <Path
        fill={logo.red}
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill={logo.blue}
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill={logo.yellow}
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill={logo.green}
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/**
 * "המשך עם Google" / "Continue with Google" (Moshe, 14.10.2026), after Google's branding guidelines for
 * Android: the dark theme (direction C is dark), the standard multi-colour G at the start (the right in Hebrew,
 * as a plain row mirrors), Google's approved wording, and the system font (Roboto on Android), at the height
 * of the app's buttons (size.buttonMd). No animation: pressing only darkens the fill (Google's pressed state),
 * so reduced motion has nothing to change. While it works, a spinner takes the G's place and the button says
 * it is busy. At large system text sizes (LARGE_TEXT_SCALE, as the app's Button) the words may take a second
 * line and the button grows, so "Continue with Google" is never cut.
 */
export function GoogleButton({
  onPress,
  loading = false,
  disabled = false,
  testID,
}: {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const { fontScale } = useWindowDimensions();
  const twoLines = fontScale >= LARGE_TEXT_SCALE;
  const label = t('google.continue');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loading ? t('ui:button.loading', { label }) : label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !loading ? styles.pressed : null,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <View style={styles.content}>
        {loading ? (
          <Spinner
            color={GOOGLE_BRAND.dark.text}
            size={GOOGLE_BUTTON.logo}
            testID={testID && `${testID}-busy`}
          />
        ) : (
          <GoogleLogo />
        )}
        <Text
          style={[styles.label, twoLines && styles.labelWrap]}
          numberOfLines={twoLines ? 2 : 1}
          testID={testID && `${testID}-label`}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** "או": a line, the word, a line, between the Google button and the email form. */
export function OrDivider({ label, testID }: { label: string; testID?: string }) {
  return (
    <View style={styles.divider} testID={testID}>
      <View style={styles.rule} />
      <Text style={styles.or}>{label}</Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: size.buttonMd,
    justifyContent: 'center',
    paddingHorizontal: GOOGLE_BUTTON.paddingStart,
    // Room above and below two lines of large text; one line is centred in minHeight as before.
    paddingVertical: space[3],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: GOOGLE_BRAND.dark.stroke,
    backgroundColor: GOOGLE_BRAND.dark.fill,
  },
  pressed: { backgroundColor: GOOGLE_BRAND.dark.pressed },
  disabled: { opacity: tokens.opacity.disabled },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: GOOGLE_BUTTON.gap,
  },
  label: {
    color: GOOGLE_BRAND.dark.text,
    fontSize: GOOGLE_BUTTON.fontSize,
    lineHeight: GOOGLE_BUTTON.lineHeight,
    fontWeight: GOOGLE_BUTTON.fontWeight,
    flexShrink: 1,
  },
  labelWrap: { textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  or: { ...text('caption'), color: color.textMuted },
});
