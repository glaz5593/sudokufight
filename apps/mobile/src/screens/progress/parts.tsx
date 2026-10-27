import type { ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import { Button, Spinner, type StateAction, type StateTone, StateView } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../theme';

/**
 * Pieces shared by the stage-12 screens (the leaderboard, the player card, progress, the interferences), in
 * direction C: flat surfaces, 1 dp borders, no glows (components.md §0.1).
 */

/** A bar that fills from the start edge: XP to the next level, a league's way to the next. */
export function ProgressBar({
  share,
  fill = color.accent,
  label,
  height = space[3],
  style,
  testID,
}: {
  /** 0–1. */
  share: number;
  fill?: string;
  /** Spoken: "620 XP to level 15". Without it the bar is decorative (its numbers are next to it). */
  label?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  const percent = Math.round(clamped * 100);
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2 }, style]}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label !== undefined ? { min: 0, max: 100, now: percent } : undefined}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      testID={testID}
    >
      <View
        style={[styles.fill, { width: `${percent}%`, backgroundColor: fill, borderRadius: height / 2 }]}
      />
    </View>
  );
}

/**
 * A whole-screen (or whole-list) state: empty, offline, an error (the shared StateView, stage 13), or a short
 * wait with a spinner. Lists and cards show their skeleton while they load instead.
 */
export function StateMessage({
  icon,
  title,
  body,
  action,
  loading = false,
  tone,
  code,
  testID,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: StateAction;
  loading?: boolean;
  tone?: StateTone;
  code?: string | null;
  testID?: string;
}) {
  if (!loading)
    return (
      <StateView
        icon={icon ?? 'alert'}
        title={title}
        body={body}
        tone={tone}
        code={code}
        actions={action ? [action] : []}
        testID={testID}
      />
    );
  return (
    <View style={styles.state} testID={testID}>
      <Spinner color={color.textMuted} />
      <Text style={[text('body'), styles.muted, styles.centered]} accessibilityLiveRegion="polite">
        {title}
      </Text>
    </View>
  );
}

/** A note over a list: offline, an error, with "נסה שוב". */
export function Note({
  children,
  retry,
  testID,
}: {
  children: string;
  retry?: { label: string; onPress: () => void };
  testID?: string;
}) {
  return (
    <View style={styles.note} testID={testID}>
      <Icon name="wifiOff" size={size.icon.inline} color={color.textMuted} />
      <Text style={[text('caption'), styles.muted, styles.noteText]}>{children}</Text>
      {retry ? (
        <Button
          label={retry.label}
          variant="ghost"
          onPress={retry.onPress}
          testID={testID ? `${testID}-retry` : undefined}
        />
      ) : null}
    </View>
  );
}

/** A card on the screen's surface. */
export function Panel({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.panel, style]} testID={testID}>
      {children}
    </View>
  );
}

export interface SegmentItem<K> {
  key: K;
  label: string;
  /** What a screen reader hears, when the visible label is short ("2" → "2 players"). */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A row of chips, one chosen (the leaderboard's tabs, the 2 / 3 / 4 picker): tabs in a tablist, or radios in a
 * radio group. Each is a 44 dp target; the chosen one has the gold border of a selected chip (components.md
 * §1.2).
 */
export function Segmented<K extends string | number>({
  items,
  value,
  onChange,
  role,
  label,
  style,
  testID,
}: {
  items: readonly SegmentItem<K>[];
  value: K | null;
  onChange: (key: K) => void;
  role: 'tab' | 'radio';
  /** The group's name for screen readers. */
  label: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      style={[styles.segments, style]}
      accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={label}
      testID={testID}
    >
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={String(item.key)}
            accessibilityRole={role}
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={role === 'tab' ? { selected: on } : { checked: on }}
            onPress={() => {
              if (!on) onChange(item.key);
            }}
            style={({ pressed }) => [
              styles.segment,
              on && styles.segmentOn,
              pressed && styles.segmentPressed,
            ]}
            testID={item.testID}
          >
            <Text style={[text('label'), on ? styles.segmentTextOn : styles.muted]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', backgroundColor: color.progress.track, overflow: 'hidden' },
  fill: { height: '100%' },
  state: { alignItems: 'center', gap: space[6], paddingVertical: space[12], paddingHorizontal: space[8] },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingStart: space[5],
    paddingVertical: space[2],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
    minHeight: size.touch,
  },
  noteText: { flex: 1 },
  panel: {
    padding: space[8],
    gap: space[6],
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  segments: { flexDirection: 'row', gap: space[2] },
  segment: {
    flex: 1,
    minWidth: 0,
    minHeight: size.touch,
    paddingHorizontal: space[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  segmentOn: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  segmentPressed: { backgroundColor: color.pressedOverlay },
  segmentTextOn: { color: color.accent },
  muted: { color: color.textMuted },
  centered: { textAlign: 'center' },
});
