import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Platform, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { Button, type ButtonVariant } from './Button';

import { Text } from './Text';
/**
 * A whole-screen or whole-list state (spec §4.1 "מצבים ריקים" and "מצבי שגיאה", §16.3; Connection-Error and
 * History-Empty in direction C): an icon, a title, a plain explanation, the small error code for support
 * (LTR, errors only), and the ways on ("נסה שוב", "עבור לאימון", "שחק את המשחק הראשון").
 *
 * - `neutral`: an empty state; the icon sits in a quiet square.
 * - `danger`: no connection, an error; the icon is red in a red-rimmed circle, and screen readers hear the
 *   title and the explanation as it appears (iOS: an announcement; Android: the title is a live region).
 *
 * Loading is not a state here: lists and cards show their skeleton (Skeleton.tsx) while they load.
 */

export type StateTone = 'neutral' | 'danger';

export interface StateAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Secondary by default: a list's state never takes the screen's one gold action from it. */
  variant?: ButtonVariant;
  /** Spins and ignores presses (a check under way: "בודק…"). */
  loading?: boolean;
  testID?: string;
}

export interface StateViewProps {
  icon: IconName;
  title: string;
  body?: string;
  tone?: StateTone;
  /** The small support code (spec §16.3), e.g. "unavailable-503". */
  code?: string | null;
  actions?: readonly StateAction[];
  /** Say it as it appears; on for `danger` unless set. */
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function StateView({
  icon,
  title,
  body,
  tone = 'neutral',
  code = null,
  actions = [],
  announce = tone === 'danger',
  style,
  testID,
}: StateViewProps) {
  const { t } = useTranslation('ui');
  const danger = tone === 'danger';
  const line = body ? t('state.line', { title, body }) : title;

  useEffect(() => {
    if (announce && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(line);
  }, [announce, line]);

  return (
    <View style={[styles.state, style]} testID={testID}>
      <View style={[styles.icon, danger ? styles.iconDanger : styles.iconNeutral]}>
        <Icon name={icon} size={size.icon.nav} color={danger ? color.danger : color.textMuted} />
      </View>
      <Text
        style={[text('sheetTitle'), styles.strong, styles.centered]}
        accessibilityRole="header"
        accessibilityLiveRegion={announce ? 'polite' : undefined}
        testID={testID ? `${testID}-title` : undefined}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={[text('bodyLong'), styles.muted, styles.centered]}
          testID={testID ? `${testID}-body` : undefined}
        >
          {body}
        </Text>
      ) : null}
      {code ? <SupportCode code={code} testID={testID ? `${testID}-code` : undefined} /> : null}
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Button
              key={a.label}
              label={a.label}
              icon={a.icon}
              variant={a.variant ?? 'secondary'}
              size="md"
              loading={a.loading}
              onPress={a.onPress}
              testID={a.testID}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The support code chip (Connection-Error): a red dot and the code, left to right in both languages. */
export function SupportCode({ code, testID }: { code: string; testID?: string }) {
  const { t } = useTranslation('ui');
  return (
    <View style={styles.code} accessible accessibilityLabel={t('state.code', { code })} testID={testID}>
      <View style={styles.codeDot} />
      <Text style={styles.codeText}>{code}</Text>
    </View>
  );
}

const ICON_BOX = size.touch + space[6];

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: space[6], paddingVertical: space[12], paddingHorizontal: space[8] },
  icon: { width: ICON_BOX, height: ICON_BOX, alignItems: 'center', justifyContent: 'center' },
  iconNeutral: { borderRadius: radius.xl, backgroundColor: color.surface2 },
  iconDanger: {
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.iconBg.danger,
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  codeDot: { width: space[3], height: space[3], borderRadius: radius.pill, backgroundColor: color.danger },
  codeText: { ...text('micro'), color: color.textFaint, writingDirection: 'ltr' },
  actions: { alignItems: 'center', gap: space[4] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  centered: { textAlign: 'center' },
});
