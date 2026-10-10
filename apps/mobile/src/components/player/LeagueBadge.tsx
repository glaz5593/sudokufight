import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { color, text } from '../../theme';
import { LEAGUE_THRESHOLDS, leagueFor, type League, type LeagueThresholds } from './league';
import { metrics } from './metrics';

export interface LeagueBadgeProps {
  /**
   * The player's highest rating [D9]. Null hides the badge: it appears only once 10 provisional games are
   * done in some rating key (spec §11.3).
   */
  rating: number | null;
  level?: number | null;
  /** `text`: "ליגת זהב · רמה 14" (Home). `icon`: hexagon, tier name in its colour, then the level. */
  variant?: 'text' | 'icon';
  thresholds?: LeagueThresholds;
  style?: StyleProp<ViewStyle>;
}

const { hexWidth: W, hexHeight: H } = metrics.league;
const HEXAGON = `${W / 2},0 ${W},${H / 4} ${W},${(3 * H) / 4} ${W / 2},${H} 0,${(3 * H) / 4} 0,${H / 4}`;

/** The league of a rating (components.md §5.2). */
export function LeagueBadge({
  rating,
  level = null,
  variant = 'text',
  thresholds = LEAGUE_THRESHOLDS,
  style,
}: LeagueBadgeProps) {
  const { t } = useTranslation('player');
  if (rating === null) return null;
  const league: League = leagueFor(rating, thresholds);
  const tier = t(`league.${league}`);
  const name = t('league.name', { league: tier });
  const levelText = level === null ? null : t('league.level', { level });
  const sep = t('sep');
  const a11y = levelText ? `${name}${t('listSep')}${levelText}` : name;
  const tint = color.league[league];

  if (variant === 'text') {
    return (
      <Text style={[text('body'), styles.muted, style]} accessibilityLabel={a11y} testID={`league-${league}`}>
        {levelText ? `${name}${sep}${levelText}` : name}
      </Text>
    );
  }

  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11y}
      testID={`league-${league}`}
    >
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Polygon points={HEXAGON} fill={tint} />
      </Svg>
      <Text style={[text('micro'), { color: tint }]}>{tier}</Text>
      {level === null ? null : (
        <Text style={[text('micro'), styles.muted]}>{t('league.levelAfter', { level })}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: metrics.league.gap },
  muted: { color: color.textMuted },
});
