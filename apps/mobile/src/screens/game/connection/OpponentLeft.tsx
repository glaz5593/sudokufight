import { type ComponentRef, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarId } from '../../../assets/avatars';
import { Avatar } from '../../../components/player/Avatar';
import { signedText } from '../../../components/player/format';
import type { Gender } from '../../../components/player/wording';
import { Button } from '../../../components/ui/Button';
import { color, radius, space, text, tokens } from '../../../theme';
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
  myAvatar?: AvatarId | null;
  opponentAvatar?: AvatarId | null;
  /** The opponent's grammatical gender, for the Hebrew verb ("עזבה"). */
  gender?: Gender;
  testID?: string;
}

/**
 * The opponent did not come back in time (spec §16.2: "במשחק של 2 שחקנים היריב מנצח, ורואה את המסך 'יריב
 * נטש' עם כפתור 'לתוצאות'"; design Opponent-Left in C's look). Over the finished game: the opponent's avatar,
 * grey, "הזמן נגמר · 15 שניות בלי חיבור", "NinaVolt עזב את המשחק", "ניצחת בנטישה" landing in gold (motion.md
 * `sf-slam` → C; reduced motion: a fade), my rating change when the game was rated, the final scores, and
 * "לתוצאות" (the one primary) with "לבית".
 *
 * Screen readers: a modal; it is announced once and the focus starts on "לתוצאות".
 */
export function OpponentLeft({
  model: m,
  onResults,
  onHome,
  myAvatar,
  opponentAvatar,
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
        <Avatar
          avatarId={opponentAvatar}
          size="home"
          colorIndex={m.colorIndex}
          presence="left"
          backdrop={color.surface}
          inactive
        />
        <Text style={styles.timeUp}>{t('connection.left.timeUp', { seconds: m.graceSeconds })}</Text>
        <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
          {title}
        </Text>
        <Animated.Text style={[styles.win, slam]} testID={`${testID}-win`}>
          {win}
        </Animated.Text>
        {m.ratingDelta === null ? null : (
          <View
            accessible
            accessibilityLabel={t('connection.left.ratingLabel', { delta: signedText(m.ratingDelta), type })}
            style={styles.rating}
            testID={`${testID}-rating`}
          >
            <Text style={styles.ratingDelta}>{signedText(m.ratingDelta)}</Text>
            <Text style={styles.ratingWord}>{t('connection.left.rating')}</Text>
            <View style={styles.dot} />
            <Text style={styles.ratingWord}>{type}</Text>
          </View>
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
            style={styles.primary}
            testID={`${testID}-results`}
          />
          <Button
            label={t('connection.left.home')}
            onPress={onHome}
            variant="ghost"
            testID={`${testID}-home`}
          />
        </View>
      </Animated.View>
      <Announcer line={sentences([title, win], t)} testID={`${testID}-live`} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  ratingWord: { ...text('micro'), color: color.textMuted },
  dot: { width: space[2], height: space[2], borderRadius: radius.pill, backgroundColor: color.textMuted },
  scores: { marginTop: space[2] },
  actions: { alignSelf: 'stretch', gap: space[4], marginTop: space[6] },
  primary: { alignSelf: 'stretch' },
});
