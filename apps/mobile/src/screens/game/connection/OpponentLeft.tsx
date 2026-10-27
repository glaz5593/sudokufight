import { type ComponentRef, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarIdOrNone } from '../../../avatars';
import { Icon } from '../../../components/Icon';
import { Avatar } from '../../../components/player/Avatar';
import { flagEmoji } from '../../../components/player/countryFlag';
import { Flag } from '../../../components/player/Flag';
import { signedText } from '../../../components/player/format';
import { metrics as playerMetrics } from '../../../components/player/metrics';
import type { Gender } from '../../../components/player/wording';
import { Button } from '../../../components/ui/Button';
import { Text } from '../../../components/ui/Text';
import { decimalSeparator } from '../../../i18n/compose';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { Announcer } from './Announcer';
import type { OpponentLeftModel } from './connectionModel';
import { metrics } from './metrics';
import { useEnter, useSlam } from './motion';
import { ScoreLine } from './ScoreLine';
import { about, nameOf, sentences } from './wording';

export interface OpponentLeftProps {
  model: OpponentLeftModel;
  /** "לתוצאות": the results of the game, won by abandonment. */
  onResults: () => void;
  /** "לבית". */
  onHome: () => void;
  myAvatar?: AvatarIdOrNone | null;
  opponentAvatar?: AvatarIdOrNone | null;
  /** The leaver's country (a ranked match's profiles): its flag on the avatar's other corner. */
  opponentCountry?: string | null;
  /** The opponent's grammatical gender, for the Hebrew verb ("עזבה"). */
  gender?: Gender;
  testID?: string;
}

/**
 * The opponent did not come back in time (spec §16.2: "במשחק של 2 שחקנים היריב מנצח, ורואה את המסך 'יריב
 * נטש' עם כפתור 'לתוצאות'"; design Opponent-Left in C's look). Over the finished game: the opponent's avatar,
 * grey with the exit badge (and their flag, when the match's profiles gave a country), "הזמן נגמר · 15 שניות בלי חיבור", "NinaVolt עזב את המשחק", "ניצחת בנטישה"
 * landing in gold (motion.md `sf-slam` → C; reduced motion: a fade), my rating change (the star chip) when the
 * game was rated (a 0 in muted text, with the reason under the chip when a leave guard held it, spec §11.2),
 * the final scores, and "לתוצאות" (the one primary, with the trophy) over "לבית" (the
 * secondary outline, with the house), as on the board.
 *
 * Screen readers: a modal; it is announced once and the focus starts on "לתוצאות".
 */
export function OpponentLeft({
  model: m,
  onResults,
  onHome,
  myAvatar,
  opponentAvatar,
  opponentCountry = null,
  gender,
  testID = 'opponent-left',
}: OpponentLeftProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce, 'scale');
  const slam = useSlam(reduce);
  const resultsRef = useRef<ComponentRef<typeof View>>(null);

  const name = nameOf(m.name, t);
  const ctx = about(gender);
  const title = t('connection.left.title', { name, ...ctx });
  const win = t('connection.left.win');
  const type = t(`type.${m.gameType}`);
  const unchanged = m.ratingGuard ? t(`connection.left.ratingUnchanged.${m.ratingGuard}`) : null;
  const delta = m.ratingDelta === null ? null : signedText(m.ratingDelta, decimalSeparator(t));

  // The game's end already sounds (the game screen's gameOver cue, then the results' fanfare): no cue here.
  useEffect(() => {
    if (resultsRef.current) AccessibilityInfo.sendAccessibilityEvent(resultsRef.current, 'focus');
  }, []);

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
      testID={testID}
    >
      <View style={styles.scrim} />
      <Animated.View style={[styles.card, enter]} testID={`${testID}-card`}>
        <View>
          <Avatar
            avatarId={opponentAvatar}
            size="home"
            colorIndex={m.colorIndex}
            presence="left"
            backdrop={color.surface}
            inactive
          />
          {/* The board's exit badge on the avatar's corner: they left (not only grey). Decorative. */}
          <View
            style={styles.exitBadge}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={`${testID}-exit`}
          >
            <Icon name="logout" size={EXIT_GLYPH} color={color.text} />
          </View>
          {/* Their flag, dimmed with the avatar, on the other corner (Opponent-Left). Decorative: the name says who. */}
          {flagEmoji(opponentCountry) ? (
            <View
              style={styles.flagBadge}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID={`${testID}-flag`}
            >
              <Flag country={opponentCountry} size="compact" decorative style={styles.flagOut} />
            </View>
          ) : null}
        </View>
        <Text style={styles.timeUp}>
          {t('connection.left.timeUp', { count: m.graceSeconds, seconds: m.graceSeconds })}
        </Text>
        <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
          {title}
        </Text>
        <Animated.Text style={[styles.win, slam]} testID={`${testID}-win`}>
          {win}
        </Animated.Text>
        {m.ratingDelta === null ? null : (
          <View
            accessible
            accessibilityLabel={sentences([t('connection.left.ratingLabel', { delta, type }), unchanged], t)}
            style={styles.rating}
            testID={`${testID}-rating`}
          >
            <Icon name="star" size={size.icon.inline - space[2]} color={color.accent} />
            <Text
              style={[styles.ratingDelta, m.ratingDelta === 0 && styles.ratingZero]}
              testID={`${testID}-rating-delta`}
            >
              {delta}
            </Text>
            <Text style={styles.ratingWord}>{t('connection.left.rating')}</Text>
            <View style={styles.dot} />
            <Text style={styles.ratingWord}>{type}</Text>
          </View>
        )}
        {m.ratingDelta === null || unchanged === null ? null : (
          // Why the star chip says 0 (spec §11.2, guard (b)); spoken with the chip, so hidden here.
          <Text
            style={styles.unchanged}
            accessibilityElementsHidden
            importantForAccessibility="no"
            testID={`${testID}-rating-reason`}
          >
            {unchanged}
          </Text>
        )}
        <ScoreLine
          myName={m.me.name}
          myScore={m.me.score}
          myAvatar={myAvatar}
          opponentName={m.name}
          opponentScore={m.opponentScore}
          opponentAvatar={opponentAvatar}
          opponentColorIndex={m.colorIndex}
          opponentOut
          style={styles.scores}
          testID={`${testID}-scores`}
        />
        <View style={styles.actions}>
          <Button
            ref={resultsRef}
            label={t('connection.left.toResults')}
            onPress={onResults}
            variant="primary"
            size="lg"
            icon="trophy"
            style={styles.primary}
            testID={`${testID}-results`}
          />
          <Button
            label={t('connection.left.home')}
            onPress={onHome}
            variant="secondary"
            size="md"
            icon="home"
            style={styles.primary}
            testID={`${testID}-home`}
          />
        </View>
      </Animated.View>
      <Announcer line={sentences([title, win], t)} testID={`${testID}-live`} />
    </View>
  );
}

/** The exit badge on the opponent's avatar (Opponent-Left: a 32 circle, its glyph 16). */
const EXIT_BADGE = space[12];
const EXIT_GLYPH = space[8];
/** The flag badge on the other corner (Opponent-Left: a 26 circle). */
const FLAG_BADGE = space[12] - space[3];

const styles = StyleSheet.create({
  exitBadge: {
    position: 'absolute',
    bottom: -space[4],
    end: -space[4],
    width: EXIT_BADGE,
    height: EXIT_BADGE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens.border.hairline,
    borderColor: color.textMuted,
    backgroundColor: color.bg,
  },
  flagBadge: {
    position: 'absolute',
    bottom: -space[4],
    start: -space[4],
    width: FLAG_BADGE,
    height: FLAG_BADGE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  flagOut: { opacity: playerMetrics.avatarDisconnectedOpacity },
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.layout.gutterGame,
  },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: color.scrim },
  card: {
    width: '100%',
    maxWidth: metrics.cardMaxWidth + space[13],
    alignItems: 'center',
    gap: space[4],
    padding: space[9],
    borderRadius: radius.xxl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  timeUp: { ...text('micro'), color: color.textMuted, textAlign: 'center' },
  title: { ...text('h1'), color: color.text, textAlign: 'center' },
  win: { ...text('screenTitle'), color: color.accent, textAlign: 'center' },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.accentSubtle,
  },
  ratingDelta: { ...text('scoreSm'), color: color.accent },
  /** A 0 is no win to celebrate: muted, not gold. */
  ratingZero: { color: color.textMuted },
  ratingWord: { ...text('micro'), color: color.textMuted },
  unchanged: { ...text('micro'), color: color.textMuted, textAlign: 'center' },
  dot: { width: space[2], height: space[2], borderRadius: radius.pill, backgroundColor: color.textMuted },
  scores: { marginTop: space[2] },
  actions: { alignSelf: 'stretch', gap: space[4], marginTop: space[6] },
  primary: { alignSelf: 'stretch' },
});
