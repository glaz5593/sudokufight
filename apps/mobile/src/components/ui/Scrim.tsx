import { Pressable, StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { color } from '../../theme';

export interface ScrimProps {
  /** 0 → 1 as the overlay enters. */
  progress: SharedValue<number>;
  onPress: () => void;
  /**
   * With a label the scrim is a button for screen readers ("סגירת הארסנל וחזרה ללוח"). Without one it is hidden
   * from them, because the overlay already has its own safe action.
   */
  accessibilityLabel?: string;
  testID?: string;
}

/** The dark layer behind a sheet or a modal (`color.scrim`). A tap closes the overlay. */
export function Scrim({ progress, onPress, accessibilityLabel, testID }: ScrimProps) {
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const spoken = accessibilityLabel !== undefined;
  return (
    <Pressable
      onPress={onPress}
      accessible={spoken}
      accessibilityRole={spoken ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!spoken}
      importantForAccessibility={spoken ? 'yes' : 'no-hide-descendants'}
      testID={testID}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, fade]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: color.scrim,
  },
});
