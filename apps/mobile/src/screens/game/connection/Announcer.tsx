import { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { Text } from '../../../components/ui/Text';
import { color, tokens } from '../../../theme';

export interface AnnouncerProps {
  /** What to say; said again each time it changes. Null or '' says nothing. */
  line: string | null;
  testID?: string;
}

/**
 * A live announcement for screen readers (components.md §11.6), as the game screen's own live region does
 * it: Android reads the invisible region's text as it changes, iOS gets an announcement. The connection UI
 * says each state once as it begins ("החיבור שלך אבד. מתחבר מחדש, ניסיון 2"), never every second.
 */
export function Announcer({ line, testID }: AnnouncerProps) {
  useEffect(() => {
    if (line && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(line);
  }, [line]);
  return (
    <View style={styles.live} pointerEvents="none">
      <Text accessibilityLiveRegion="polite" style={styles.text} testID={testID}>
        {line ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  live: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: tokens.border.hairline,
    height: tokens.border.hairline,
    overflow: 'hidden',
  },
  text: { color: color.bg },
});
