import { AVATAR_IDS } from '@sudoku-fight/protocol';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';

import { Avatar, paletteAt } from '../../components/player';
import { radius, space, text } from '../../theme';

/** Four rivals from the catalogue, around the empty seat (any four: the picture only says "they wait"). */
const RIVALS = [AVATAR_IDS[3]!, AVATAR_IDS[17]!, AVATAR_IDS[24]!, AVATAR_IDS[40]!] as const;
const ME = paletteAt(0);
/** The board's fan: the outer pair tilts 12°, the inner pair 6°. */
const TILT = { outer: 12, inner: 6 } as const;

/**
 * The Login board's arena: rivals fanned around an empty seat in my P1 frame, "המקום שלך" under it. Direction
 * C: flat frames, no glow and no bobbing (so nothing moves, with or without reduced motion). Decoration only,
 * hidden from screen readers: the title under it says the same.
 *
 * React Native mirrors the row in Hebrew but not a rotation, so each tilt turns over with it and the fan opens
 * outwards in both directions.
 */
export function LoginArena({ testID = 'login-arena' }: { testID?: string }) {
  const { t } = useTranslation('account');
  const tilt = (deg: number) => ({ transform: [{ rotate: `${I18nManager.isRTL ? -deg : deg}deg` }] });
  return (
    <View
      style={styles.arena}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Avatar avatarId={RIVALS[0]} size="card" style={[styles.outer, tilt(-TILT.outer)]} />
      <Avatar avatarId={RIVALS[1]} size="row" presence="online" style={[styles.inner, tilt(-TILT.inner)]} />
      <View style={styles.seat}>
        <Avatar avatarId={null} size="home" colorIndex={0} testID={`${testID}-seat`} />
        <View style={styles.spot}>
          <Text style={styles.spotText} numberOfLines={1}>
            {t('login.arenaSpot')}
          </Text>
        </View>
      </View>
      <Avatar avatarId={RIVALS[2]} size="row" presence="online" style={[styles.inner, tilt(TILT.inner)]} />
      <Avatar avatarId={RIVALS[3]} size="card" style={[styles.outer, tilt(TILT.outer)]} />
    </View>
  );
}

const styles = StyleSheet.create({
  arena: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: space[3] },
  outer: { marginTop: space[13], opacity: 0.85 },
  inner: { marginTop: space[10] },
  seat: { alignItems: 'center', gap: space[4] },
  spot: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    backgroundColor: ME.ring,
  },
  spotText: { ...text('micro'), color: ME.onRing },
});
