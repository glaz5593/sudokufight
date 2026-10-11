import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, radius, size, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { easing, NEVER_REDUCE } from './anim';
import type { LeadModel } from './cardModel';
import { signedText } from './format';
import { metrics, paletteAt } from './metrics';
import { sameData, sameProps, sameStyle } from './sameProps';
import { SeatGlyph } from './SeatGlyph';
import { type Gender, leadLabel } from './wording';

export interface LeadBarProps {
  model: LeadModel;
  /** The leader's gender, for "מובילה" (components.md §17.8). */
  gender?: Gender;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A flex share that moves to its new value over 650 ms (motion.md `dominance.bar`); jumps with reduced motion. */
function useFlex(share: number, reduce: boolean) {
  const grow = useSharedValue(share);
  useEffect(() => {
    grow.set(
      reduce
        ? share
        : withTiming(share, {
            duration: motion.duration.dominanceSlide,
            easing: easing.standard,
            reduceMotion: NEVER_REDUCE,
          }),
    );
  }, [share, reduce, grow]);
  return useAnimatedStyle(() => ({ flexGrow: grow.get() }));
}

function Segment({ share, tint, reduce }: { share: number; tint: string; reduce: boolean }) {
  const flex = useFlex(share, reduce);
  return <Animated.View style={[styles.segment, { backgroundColor: tint }, flex]} />;
}

function Spacer({ share, reduce }: { share: number; reduce: boolean }) {
  const flex = useFlex(share, reduce);
  return <Animated.View style={[styles.spacer, flex]} />;
}

/**
 * The score bar under the cards (components.md §9): one segment per player in the seat colour, sized by score
 * share, and a tag at the split with the leader's margin ("+15.5") or "שוויון". 2 players: my segment under
 * my card (the start edge). 3–4 players: by place, and the tag adds the leader's shape. The row follows the
 * layout direction, so it mirrors in English by itself.
 */
export const LeadBar = memo(function LeadBar({ model, gender, style, testID }: LeadBarProps) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const leader = model.leader;
  const tint = leader ? paletteAt(leader.colorIndex).ring : color.border;
  const many = model.segments.length > 2;

  return (
    <View
      style={[styles.wrap, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={leadLabel(model, t, gender)}
      testID={testID}
    >
      <View style={styles.bar}>
        {model.segments.map((s) => (
          <Segment key={s.playerId} share={s.share} tint={paletteAt(s.colorIndex).ring} reduce={reduce} />
        ))}
      </View>
      <View style={styles.tagRow} pointerEvents="none">
        <Spacer share={model.splitShare} reduce={reduce} />
        <View style={styles.anchor}>
          <View style={[styles.tag, { borderColor: tint }]} testID="lead-tag">
            {leader ? (
              <>
                {many ? <SeatGlyph colorIndex={leader.colorIndex} size={metrics.glyph.leadTag} /> : null}
                <Text style={[metrics.lead.tagStyle, { color: tint }]}>{signedText(leader.gap)}</Text>
              </>
            ) : (
              <Text style={[text('plateNameCompact'), styles.tie]}>{t('lead.tie')}</Text>
            )}
          </View>
        </View>
        <Spacer share={1 - model.splitShare} reduce={reduce} />
      </View>
    </View>
  );
}, sameLeadBar);

/** The screen renders 4 times a second; the bar only when its model (by content) or its look changed. */
function sameLeadBar(a: LeadBarProps, b: LeadBarProps): boolean {
  return sameProps(a, b, { model: sameData, style: sameStyle });
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  bar: {
    height: size.dominanceBar.height,
    flexDirection: 'row',
    gap: size.dominanceBar.gap,
  },
  segment: { height: size.dominanceBar.height, borderRadius: radius.bar, flexBasis: 0, minWidth: 0 },
  tagRow: {
    marginTop: metrics.lead.tagTop,
    height: metrics.lead.tagHeight,
    flexDirection: 'row',
  },
  spacer: { flexBasis: 0, minWidth: metrics.lead.edgeMin },
  anchor: { width: 0, alignItems: 'center', overflow: 'visible' },
  tag: {
    position: 'absolute',
    top: 0,
    height: metrics.lead.tagHeight,
    paddingHorizontal: metrics.lead.tagPaddingX,
    borderRadius: metrics.lead.tagRadius,
    borderWidth: tokens.border.hairline,
    backgroundColor: color.bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: metrics.lead.tagGap,
  },
  tie: { color: color.textMuted },
});
