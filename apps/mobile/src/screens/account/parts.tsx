import { type ReactNode, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/authStore';
import { type PasswordRules, type PasswordStrength, strengthLevel } from '../../auth/password';
import { Icon, type IconName } from '../../components/Icon';
import { SeatGlyph } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { BackButton, GUTTER } from '../home/parts';

/**
 * Pieces shared by the account screens (Login, Register-Fighter, Register-Account, Forgot password, Verify
 * email, Edit profile), in direction C: flat surfaces, 1 dp borders, one gold action per screen.
 */

/** A screen of the account flow: safe area, keyboard-aware scrolling, the 16 dp gutter. */
export function AccountScreen({
  children,
  footer,
  testID,
}: {
  children: ReactNode;
  /** Pinned under the scrolling content (the primary action). */
  footer?: ReactNode;
  testID?: string;
}) {
  const { top, bottom } = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID={testID}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top + space[4] }]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { paddingBottom: bottom + space[6] }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/** A screen title with one word in gold ("חוזרים <accent>לזירה</accent>"), spoken as one header. */
export function AccentTitle({
  i18nKey,
  label,
  style,
}: {
  i18nKey: string;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation('account');
  return (
    <View style={style} accessible accessibilityRole="header" accessibilityLabel={label}>
      <Text style={styles.title}>
        <Trans t={t} i18nKey={i18nKey} components={{ accent: <Text style={styles.accent} /> }} />
      </Text>
    </View>
  );
}

/** "מצב פיתוח": the development sign-in is on (no Firebase in this build). Nothing in a Firebase build. */
export function DevModeBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('account');
  const provider = useAuth((s) => s.provider);
  if (provider !== 'dev') return null;
  return (
    <View
      style={[styles.devBadge, style]}
      accessible
      accessibilityLabel={t('devMode.label')}
      testID="dev-mode-badge"
    >
      <Icon name="warning" size={size.icon.inline} color={color.warning} />
      <Text style={styles.devText}>{t('devMode.badge')}</Text>
    </View>
  );
}

/** The registration's header: back, "שלב 1 מתוך 2" and its two bars (Register-Fighter / -Account). */
export function StepHeader({
  step,
  total = 2,
  onBack,
  backLabel,
  end,
}: {
  step: number;
  total?: number;
  onBack?: () => void;
  backLabel?: string;
  end?: ReactNode;
}) {
  const { t } = useTranslation('account');
  return (
    <View style={styles.stepHeader}>
      {onBack ? <BackButton onPress={onBack} label={backLabel} /> : <View style={styles.stepSpacer} />}
      <View style={styles.stepMiddle}>
        <Text style={styles.stepText}>{t('register.step', { step, total })}</Text>
        <View style={styles.stepBars} importantForAccessibility="no-hide-descendants">
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.stepBar, i < step && styles.stepBarOn]} />
          ))}
        </View>
      </View>
      {end ?? <View style={styles.stepSpacer} />}
    </View>
  );
}

/** A message for the whole form (a failed sign-in): red, with the alert icon, announced. */
export function FormAlert({ message, testID }: { message: string | null; testID?: string }) {
  if (!message) return null;
  return (
    <View style={styles.alert} accessibilityLiveRegion="assertive" testID={testID}>
      <Icon name="alert" size={size.icon.card} color={color.danger} />
      <Text style={styles.alertText} accessibilityRole="alert">
        {message}
      </Text>
    </View>
  );
}

/** A neutral note (success after sending an email, the dev-mode note). */
export function FormNote({
  message,
  tone = 'muted',
  testID,
}: {
  message: string;
  tone?: 'muted' | 'success';
  testID?: string;
}) {
  return (
    <View style={styles.note} accessibilityLiveRegion="polite" testID={testID}>
      <Icon
        name={tone === 'success' ? 'check' : 'alert'}
        size={size.icon.card}
        color={tone === 'success' ? color.success : color.textMuted}
      />
      <Text style={styles.noteText}>{message}</Text>
    </View>
  );
}

/** The terms checkbox (Register-Account): the whole row is the target; red and shaking when required. */
export function Checkbox({
  checked,
  onChange,
  label,
  error,
  shake = 0,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  error?: string | null;
  shake?: number;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (shake === 0 || reduce) return;
    const step = (to: number) =>
      withTiming(to, { duration: motion.duration.wrongShake / 4, reduceMotion: reduceMotionFlag(false) });
    x.set(withSequence(step(-space[3]), step(space[3]), step(-space[2]), step(0)));
  }, [shake, reduce, x]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View style={styles.checkWrap}>
      <Animated.View style={shakeStyle} testID={testID && `${testID}-shake`}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={label}
          accessibilityState={{ checked }}
          onPress={() => onChange(!checked)}
          style={({ pressed }) => [
            styles.checkRow,
            checked && styles.checkRowOn,
            error ? styles.checkRowError : null,
            pressed && styles.pressed,
          ]}
          testID={testID}
        >
          <View style={[styles.box, checked && styles.boxOn, error ? styles.boxError : null]}>
            {checked ? <Icon name="check" size={size.icon.inline} color={color.onAccent} /> : null}
          </View>
          <Text style={styles.checkLabel}>{label}</Text>
        </Pressable>
      </Animated.View>
      {error ? (
        <View style={styles.alertInline} accessibilityLiveRegion="polite">
          <Icon name="alert" size={size.icon.inline} color={color.danger} />
          <Text style={styles.inlineError} accessibilityRole="alert" testID={testID && `${testID}-error`}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const STRENGTH_TINT = [color.danger, color.warning, color.success, color.success] as const;

/** The 4-level meter under a new password (spec §3.1; Register-Account). */
export function StrengthMeter({ strength, testID }: { strength: PasswordStrength; testID?: string }) {
  const { t } = useTranslation('account');
  const level = strengthLevel(strength);
  const words = level ? t(`password.strength.${level}`) : undefined;
  const tint = strength === 0 ? color.border : STRENGTH_TINT[strength - 1]!;
  return (
    <View
      style={styles.meterRow}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('password.strengthLabel')}
      accessibilityValue={{ min: 0, max: 4, now: strength, text: words }}
      testID={testID}
    >
      <View style={styles.meter}>
        {[1, 2, 3, 4].map((n) => (
          <View key={n} style={[styles.meterBar, { backgroundColor: n <= strength ? tint : color.border }]} />
        ))}
      </View>
      {words ? <Text style={[styles.meterText, { color: tint }]}>{words}</Text> : null}
    </View>
  );
}

/** The password's three rules, each with a tick once met (spec §3.1). */
export function PasswordChecklist({ rules, testID }: { rules: PasswordRules; testID?: string }) {
  const { t } = useTranslation('account');
  return (
    <View style={styles.rules} testID={testID}>
      {(['length', 'letter', 'digit'] as const).map((rule) => {
        const met = rules[rule];
        const name = t(`password.rules.${rule}`);
        return (
          <View
            key={rule}
            style={styles.rule}
            accessible
            accessibilityLabel={t(met ? 'password.ruleMet' : 'password.ruleMissing', { rule: name })}
            testID={testID && `${testID}-${rule}`}
          >
            <Icon
              name={met ? 'check' : 'close'}
              size={size.icon.inline}
              color={met ? color.success : color.textMuted}
            />
            <Text style={[styles.ruleText, met && styles.ruleMet]}>{name}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A text button of 44 (ghost look) that is a link: "הרשמה" and the terms in gold; "שכחתי סיסמה" and the
 * fighter's "עריכה" in the muted tone (the Login and Register-Account boards), so gold stays with the one
 * main way on.
 */
export function LinkButton({
  label,
  onPress,
  hint,
  role = 'button',
  tone = 'accent',
  icon,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  role?: 'button' | 'link';
  tone?: 'accent' | 'muted';
  /** Before the label ("✎ עריכה"). */
  icon?: IconName;
  /** What a screen reader says, when the short visible label needs more ("עריכה" → "עריכת הלוחם"). */
  accessibilityLabel?: string;
  testID?: string;
}) {
  const tint = tone === 'muted' ? color.textMuted : color.accent;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      onPress={onPress}
      hitSlop={space[2]}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      testID={testID}
    >
      {icon ? <Icon name={icon} size={size.icon.inline} color={tint} /> : null}
      <Text style={[styles.linkText, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const STEP_BAR_WIDTH = space[12];
const CHECK_BOX = space[11];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: GUTTER.screen, paddingBottom: space[12], gap: space[9] },
  footer: { paddingHorizontal: GUTTER.screen, paddingTop: space[6], backgroundColor: color.bg },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  accent: { color: color.accent },
  devBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space[3],
    minHeight: space[12],
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.warning,
    backgroundColor: color.iconBg.warning,
  },
  devText: { ...text('micro'), color: color.warning },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: space[6], minHeight: size.header },
  stepSpacer: { width: size.iconButton },
  stepMiddle: { flex: 1, alignItems: 'center', gap: space[4] },
  stepText: { ...text('label'), color: color.textMuted },
  stepBars: { flexDirection: 'row', gap: space[3] },
  stepBar: {
    width: STEP_BAR_WIDTH,
    height: size.dominanceBar.height,
    borderRadius: radius.bar,
    backgroundColor: color.border,
  },
  stepBarOn: { backgroundColor: color.accent },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[6],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerSubtle,
  },
  alertText: { ...text('body'), color: color.text, flex: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[6],
    borderRadius: radius.button,
    backgroundColor: color.surface,
  },
  noteText: { ...text('body'), color: color.textMuted, flex: 1 },
  checkWrap: { gap: space[4] },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.touch,
    padding: space[6],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  checkRowOn: { borderColor: color.success },
  checkRowError: { borderColor: color.danger, backgroundColor: color.dangerSubtle },
  box: {
    width: CHECK_BOX,
    height: CHECK_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xs,
    borderWidth: tokens.border.avatarFrame,
    borderColor: color.textMuted,
    backgroundColor: color.surface2,
  },
  boxOn: { borderColor: color.accent, backgroundColor: color.accent },
  boxError: { borderColor: color.danger },
  checkLabel: { ...text('body'), color: color.text, flex: 1 },
  alertInline: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  inlineError: { ...text('caption'), color: color.danger, flexShrink: 1 },
  pressed: { opacity: 0.85 },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  meter: { flex: 1, flexDirection: 'row', gap: space[2] },
  meterBar: { flex: 1, height: size.dominanceBar.height, borderRadius: radius.bar },
  meterText: { ...text('micro') },
  rules: { gap: space[2] },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  ruleText: { ...text('caption'), color: color.textMuted },
  ruleMet: { color: color.text },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.touch,
    paddingHorizontal: space[2],
  },
  linkText: { ...text('buttonSm') },
});

/**
 * The wordmark (Dir-C-Home's "SUDOKU FIGHT", the Hebrew name under it) and the four seat shapes: the Splash.
 * `compact`: the wordmark alone, as Login's board has it over its arena. In English the name under the
 * wordmark would only repeat it, so it shows in Hebrew only (as on Home and Home-EN).
 */
export function Brand({ compact = false, testID }: { compact?: boolean; testID?: string }) {
  const { t, i18n } = useTranslation('home');
  return (
    <View
      style={brand.wrap}
      accessible
      accessibilityRole={compact ? 'image' : 'header'}
      accessibilityLabel={t('brand.name')}
      testID={testID}
    >
      {compact ? null : (
        <View style={brand.glyphs}>
          {[0, 1, 2, 3].map((i) => (
            <SeatGlyph key={i} colorIndex={i} size={space[7]} />
          ))}
        </View>
      )}
      <Text style={brand.wordmark} numberOfLines={1}>
        <Text style={brand.start}>{t('brand.wordStart')}</Text>{' '}
        <Text style={brand.end}>{t('brand.wordEnd')}</Text>
      </Text>
      {compact || i18n.dir() !== 'rtl' ? null : <Text style={brand.sub}>{t('brand.sub')}</Text>}
    </View>
  );
}

const brand = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[4] },
  glyphs: { flexDirection: 'row', gap: space[6] },
  wordmark: { ...text('brandWordmark'), writingDirection: 'ltr' },
  start: { color: color.textMuted },
  end: { color: color.text },
  sub: { ...text('brandSub'), color: color.textMuted },
});
