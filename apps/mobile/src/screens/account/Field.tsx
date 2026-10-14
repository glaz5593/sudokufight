import { type ReactNode, type Ref, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon, type IconName } from '../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';

/**
 * A form field of the account screens (Login, Register-Account; components in direction C: surface2 fill,
 * 1 dp border, gold when focused, red with an error). The label sits above the box; an icon at the start, an
 * optional status (e.g. "פנוי") and an end button (the password's eye) inside it; the error or a hint under
 * it. Emails, passwords and codes are LTR content in both languages (`ltr`).
 *
 * `shake`: bump it to shake the field (motion.md `form.error`, ±5 dp over 300 ms). With reduced motion
 * nothing moves: the red border and the message carry it.
 */
export interface FieldProps extends Pick<
  TextInputProps,
  | 'value'
  | 'onChangeText'
  | 'autoComplete'
  | 'textContentType'
  | 'keyboardType'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'secureTextEntry'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'maxLength'
  | 'placeholder'
  | 'editable'
  | 'submitBehavior'
> {
  label: string;
  icon?: IconName;
  /** LTR content (email, password): typed and shown left to right in Hebrew too. */
  ltr?: boolean;
  /** Shown under the field in red, and spoken with the field. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string | null;
  /** Inside the box, before the end button: a short status ("פנוי", "תואמת"). */
  status?: ReactNode;
  /** Inside the box, at the end: a 44×44 button. */
  end?: ReactNode;
  /** Spoken after the label (e.g. the name check's state). */
  accessibilityStatus?: string;
  shake?: number;
  inputRef?: Ref<TextInput>;
  testID?: string;
}

const SHAKE_PX = space[3] + 1;

export function Field({
  label,
  icon,
  ltr = false,
  error = null,
  hint = null,
  status,
  end,
  accessibilityStatus,
  shake = 0,
  inputRef,
  testID,
  ...input
}: FieldProps) {
  const reduce = useReduceMotion();
  const [focused, setFocused] = useState(false);
  const x = useSharedValue(0);

  useEffect(() => {
    if (shake === 0 || reduce) return;
    const step = (to: number) =>
      withTiming(to, { duration: motion.duration.wrongShake / 6, reduceMotion: reduceMotionFlag(false) });
    x.set(withSequence(step(-SHAKE_PX), step(SHAKE_PX), step(-SHAKE_PX), step(SHAKE_PX), step(-2), step(0)));
  }, [shake, reduce, x]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const spokenLabel = [label, accessibilityStatus, error].filter(Boolean).join(', ');
  return (
    <View style={styles.field}>
      <Text style={[styles.label, focused && styles.labelFocused]} importantForAccessibility="no">
        {label}
      </Text>
      <Animated.View
        style={[
          styles.box,
          focused && styles.boxFocused,
          error ? styles.boxError : null,
          input.editable === false && styles.disabled,
          shakeStyle,
        ]}
        testID={testID && `${testID}-box`}
      >
        {icon ? <Icon name={icon} size={size.icon.card} color={color.textMuted} /> : null}
        <TextInput
          ref={inputRef}
          {...input}
          accessibilityLabel={spokenLabel}
          placeholderTextColor={color.input.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, ltr && styles.ltrInput]}
          testID={testID}
        />
        {status}
        {end}
      </Animated.View>
      <FieldMessage error={error} hint={hint} testID={testID} />
    </View>
  );
}

/**
 * The line under a field (this one, and the pickers' PickerField): the error in red after the alert icon,
 * announced as it appears (a live region: TalkBack ignores the alert role), or else the hint.
 */
export function FieldMessage({
  error = null,
  hint = null,
  testID,
}: {
  error?: string | null;
  hint?: string | null;
  testID?: string;
}) {
  if (error)
    return (
      <View style={styles.messageRow} accessibilityLiveRegion="polite" testID={testID && `${testID}-message`}>
        <Icon name="alert" size={size.icon.inline} color={color.danger} />
        <Text style={styles.error} accessibilityRole="alert" testID={testID && `${testID}-error`}>
          {error}
        </Text>
      </View>
    );
  if (hint)
    return (
      <Text style={styles.hint} testID={testID && `${testID}-hint`}>
        {hint}
      </Text>
    );
  return null;
}

/** A short status inside a field: icon and word in a colour ("✓ פנוי", "תפוס"). */
export function FieldStatus({
  label,
  tone,
  icon,
  testID,
}: {
  label: string;
  tone: 'ok' | 'bad' | 'muted';
  icon?: IconName;
  testID?: string;
}) {
  const tint = tone === 'ok' ? color.success : tone === 'bad' ? color.danger : color.textMuted;
  return (
    <View style={styles.status} importantForAccessibility="no-hide-descendants" testID={testID}>
      {icon ? <Icon name={icon} size={size.icon.inline} color={tint} /> : null}
      <Text style={[styles.statusText, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface PasswordFieldProps extends Omit<FieldProps, 'secureTextEntry' | 'end' | 'ltr' | 'icon'> {
  /** Shown as text (the eye pressed). Two fields can share one switch (password + confirm). */
  shown: boolean;
  onToggleShown?: () => void;
}

/** A password: LTR, hidden by default, with the eye button that shows it (Login, Register-Account). */
export function PasswordField({ shown, onToggleShown, testID, ...field }: PasswordFieldProps) {
  const { t } = useTranslation('account');
  return (
    <Field
      {...field}
      icon="key"
      ltr
      secureTextEntry={!shown}
      autoCapitalize="none"
      testID={testID}
      end={
        onToggleShown ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? t('fields.hidePassword') : t('fields.showPassword')}
            accessibilityState={{ selected: shown }}
            onPress={onToggleShown}
            style={({ pressed }) => [styles.eye, pressed && styles.eyePressed]}
            testID={testID && `${testID}-eye`}
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} size={size.icon.header} color={color.textMuted} />
          </Pressable>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: space[4] },
  label: { ...text('label'), color: color.input.label, alignSelf: 'flex-start' },
  labelFocused: { color: color.accent },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.input,
    paddingStart: space[6],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.input.border,
    backgroundColor: color.input.bg,
  },
  boxFocused: { borderColor: color.input.borderFocus },
  boxError: { borderColor: color.input.borderError },
  disabled: { opacity: tokens.opacity.disabled },
  input: {
    ...text('input'),
    flex: 1,
    minHeight: size.input,
    paddingVertical: space[4],
    paddingEnd: space[6],
    color: color.input.text,
  },
  // Emails and passwords read left to right in Hebrew too (CLAUDE.md); React Native puts "left" at the start
  // of an RTL layout.
  ltrInput: { writingDirection: 'ltr', textAlign: 'left' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  error: { ...text('caption'), color: color.danger, flexShrink: 1 },
  hint: { ...text('caption'), color: color.textMuted, alignSelf: 'flex-start' },
  status: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingEnd: space[4] },
  statusText: { ...text('micro') },
  eye: {
    width: size.touch,
    height: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  eyePressed: { backgroundColor: color.surface },
});
