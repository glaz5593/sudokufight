import type { Expression } from '@sudoku-fight/avatars';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { AVATAR_REACTIONS, type AvatarIdOrNone } from '../../../avatars';
import { Avatar, Flag, paletteAt, SeatGlyph } from '../../../components/player';
import { color, text } from '../../../theme';
import { arsenalMetrics as m } from './metrics';
import { isolate } from './wording';

/** One end of the route: who, in which seat colour, with which avatar. */
export interface RouteEnd {
  name: string;
  /** Palette index as this phone shows them (0 = me). */
  colorIndex: number;
  avatarId?: AvatarIdOrNone | null;
  /** ISO alpha-2. */
  country?: string | null;
}

export interface RouteLineProps {
  /** Me. */
  from: RouteEnd;
  /** The card the picker was opened from. */
  to: RouteEnd;
  testID?: string;
}

/**
 * The 3–4 player route under the picker's title (original §17, spec §7.3.5) [D45]: "[my avatar ●] אני ← [their
 * avatar ▲] Biscuit 🇩🇪". Both mini avatars are ringed in their seat colour, each with its seat shape, so the
 * target is never told by colour alone. The target is the card whose "הפרעה" button was tapped, and it can't be
 * changed in here: to hit someone else, close the picker and tap their card's button. One element for screen
 * readers: "הפרעה ממני אל Biscuit".
 */
export function RouteLine({ from, to, testID = 'arsenal-route' }: RouteLineProps) {
  const { t } = useTranslation('game');
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t('arsenal.routeLabel', { name: isolate(to.name) })}
      testID={testID}
    >
      <RouteFace end={from} expression={AVATAR_REACTIONS.moods.sender} />
      <Text style={styles.me} numberOfLines={1}>
        {t('arsenal.me')}
      </Text>
      <Text style={styles.arrow}>{t('arsenal.routeArrow')}</Text>
      <RouteFace end={to} expression={AVATAR_REACTIONS.moods.target} />
      <Text style={styles.name} numberOfLines={1}>
        {to.name}
      </Text>
      <Flag country={to.country} size="sheet" decorative />
    </View>
  );
}

/**
 * A route end's mini avatar, ringed in its seat colour, and its shape (ownership never by colour alone); the
 * sender's face and the target's (AVATAR_REACTIONS.moods).
 */
function RouteFace({ end, expression }: { end: RouteEnd; expression: Expression }) {
  const ring = paletteAt(end.colorIndex).ring;
  return (
    <>
      <Avatar
        avatarId={end.avatarId}
        size="cell"
        expression={expression}
        style={[styles.avatar, { borderColor: ring }]}
        testID={`arsenal-route-avatar-${end.colorIndex}`}
      />
      <SeatGlyph colorIndex={end.colorIndex} size={m.subtitle.glyph} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: m.subtitle.gap, minWidth: 0 },
  me: { ...text('label'), color: color.text },
  arrow: { ...text('label'), color: color.textMuted },
  name: { ...text('label'), color: color.text, flexShrink: 1 },
  avatar: {
    borderWidth: m.subtitle.avatarRing,
    borderRadius: m.subtitle.avatarRadius,
    overflow: 'hidden',
  },
});
