import { StyleSheet, View } from 'react-native';

import { color } from '../../theme';

/**
 * A small progress bar (components.md §19.3: the gate plate's 4 dp bar, the gate sheet's 6): gold over
 * `color.border`, filling from the start side like any progress in the app's direction. Decorative: the plate or
 * sheet around it says the numbers ("17 מתוך 20").
 */
export interface MiniBarProps {
  /** 0–1; clamped. */
  share: number;
  /** 4 on the plate, 6 in the sheet. */
  height?: number;
  testID?: string;
}

export function MiniBar({ share, height = 4, testID = 'mini-bar' }: MiniBarProps) {
  const fill = Math.max(0, Math.min(1, share));
  const round = height / 2;
  return (
    <View
      style={[styles.track, { height, borderRadius: round }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <View
        style={[styles.fill, { width: `${fill * 100}%`, borderRadius: round }]}
        testID={`${testID}-fill`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', overflow: 'hidden', backgroundColor: color.border },
  fill: { backgroundColor: color.accent },
});
