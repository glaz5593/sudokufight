import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';

import { size as sizes } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { sparkLength, sparkPoints } from './playerCardModel';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

export interface SparklineProps {
  /** Oldest first. Fewer than two points draw nothing. */
  trend: readonly number[];
  width: number;
  height: number;
  color: string;
  testID?: string;
}

/**
 * A rating's trend (spec §14.3: "לכל דירוג מוצגים המגמה והשיא"): a small line, drawn in from the start once
 * (the design's state change, 240 ms); with reduced motion it is simply there. Decorative: the tile's label
 * says the trend in words.
 */
export function Sparkline({ trend, width, height, color, testID }: SparklineProps) {
  const reduce = useReduceMotion();
  const points = useMemo(() => sparkPoints(trend, width, height), [trend, width, height]);
  const length = useMemo(() => sparkLength(points), [points]);
  const drawn = useSharedValue(reduce ? 1 : 0);

  useEffect(() => {
    if (reduce) {
      drawn.set(1);
      return;
    }
    drawn.set(0);
    drawn.set(
      withTiming(1, {
        duration: motion.duration.stateChange,
        easing: Easing.out(Easing.cubic),
        reduceMotion: reduceMotionFlag(reduce),
      }),
    );
  }, [reduce, points, drawn]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.get()) }));

  return (
    <View
      style={{ width, height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {points ? (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <AnimatedPolyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={sizes.iconStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={reduce ? undefined : [length, length]}
            animatedProps={animatedProps}
          />
        </Svg>
      ) : null}
    </View>
  );
}
