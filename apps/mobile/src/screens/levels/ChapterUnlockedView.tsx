import { botLevel, type BotLevelId } from '@sudoku-fight/engine';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { normalizeAvatarId } from '../../avatars';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/player';
import { signedText } from '../../components/player/format';
import { Button } from '../../components/ui';
import { curve } from '../../components/ui/motion';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { chapterName, chapterNews } from './levelWording';

/**
 * "פרק חדש נפתח" (components.md §19.11, no board: built from C's tokens; Moshe checks it on the phone), once per
 * chapter, the first time its gate is seen open (levels.db `level_gates.celebrated`): "פרק 5 · Biscuit", the
 * chapter's bot introducing itself in one line, what is new in it, and "‎+50 XP" (the gate's, an estimate the
 * server pays). A state over the map (no Modal, no navigation: the black screen of 1.0.0 came with those).
 *
 * Motion (`level.chapter.unlocked`): the title slams in (1.4 → 1), the bot's line fades in, the XP pops last.
 * Reduced Motion: nothing moves, everything is there at once.
 */

export interface ChapterUnlockedViewProps {
  chapter: number;
  /** The chapter's bot (its stages against one), or none. */
  bot: BotLevelId | null;
  /** The gate's XP (DEFAULT_PROGRESS_RULES.xp.levelGate). */
  xp: number;
  onDone: () => void;
}

/** motion.md: the slam 530, then the pop 420. */
const SLAM_MS = 530;
const POP_MS = 420;
const SLAM_FROM = 1.4;

export function ChapterUnlockedView({ chapter, bot, xp, onDone }: ChapterUnlockedViewProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const { top, bottom } = useSafeAreaInsets();
  const name = chapterName(chapter, t);
  const news = chapterNews(chapter, t);
  const info = bot ? botLevel(bot) : null;
  return (
    <View
      style={[styles.cover, { paddingTop: top + space[12], paddingBottom: bottom + space[10] }]}
      accessibilityViewIsModal
      testID="chapter-unlocked"
    >
      <View style={styles.content}>
        <View style={styles.icon}>
          <Icon name="unlock" size={size.icon.nav} color={color.accent} />
        </View>
        <Text
          accessibilityRole="header"
          accessibilityLabel={t('unlocked.label', { n: chapter, name, news })}
          accessibilityLiveRegion="polite"
          style={styles.heading}
        >
          {t('unlocked.heading')}
        </Text>
        <Enter reduce={reduce} kind="slam" testID="chapter-unlocked-title">
          <Text style={styles.title} numberOfLines={2}>
            {t('unlocked.title', { n: chapter, name })}
          </Text>
        </Enter>
        {info ? (
          <Enter reduce={reduce} kind="fade" delayMs={SLAM_MS} testID="chapter-unlocked-bot">
            <View style={styles.bot}>
              <Avatar
                avatarId={normalizeAvatarId(info.avatar)}
                size="card"
                colorIndex={1}
                bot
                expression="smile"
              />
              <Text style={styles.botLine}>{t(`unlocked.bots.${info.level}`)}</Text>
            </View>
          </Enter>
        ) : null}
        <Text style={styles.news} testID="chapter-unlocked-news">
          {t('unlocked.news', { news })}
        </Text>
        <Enter reduce={reduce} kind="pop" delayMs={SLAM_MS + POP_MS} testID="chapter-unlocked-xp">
          <Text style={styles.xp}>{t('unlocked.xp', { xp: signedText(xp) })}</Text>
        </Enter>
      </View>
      <Button label={t('unlocked.continue')} size="lg" onPress={onDone} testID="chapter-unlocked-done" />
    </View>
  );
}

/**
 * One part coming in: a slam (scale 1.4 → 1), a fade, or a pop (0.6 → 1.12 → 1). With Reduced Motion it is a
 * plain View: nothing is animated, so nothing is mounted that could move.
 */
function Enter({
  reduce,
  kind,
  delayMs = 0,
  testID,
  children,
}: {
  reduce: boolean;
  kind: 'slam' | 'fade' | 'pop';
  delayMs?: number;
  testID: string;
  children: ReactNode;
}) {
  if (reduce) return <View testID={testID}>{children}</View>;
  return (
    <Moving kind={kind} delayMs={delayMs} testID={testID}>
      {children}
    </Moving>
  );
}

function Moving({
  kind,
  delayMs,
  testID,
  children,
}: {
  kind: 'slam' | 'fade' | 'pop';
  delayMs: number;
  testID: string;
  children: ReactNode;
}) {
  const never = reduceMotionFlag(false);
  const scale = useSharedValue(kind === 'slam' ? SLAM_FROM : kind === 'pop' ? 0.6 : 1);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const ms = kind === 'slam' ? SLAM_MS : POP_MS;
    opacity.set(
      withDelay(
        delayMs,
        withTiming(1, { duration: motion.duration.stateChange, reduceMotion: never }),
        never,
      ),
    );
    if (kind === 'fade') return;
    scale.set(
      withDelay(
        delayMs,
        kind === 'slam'
          ? withTiming(1, { duration: ms, easing: curve('emphasized'), reduceMotion: never })
          : withSequence(
              withTiming(1.12, { duration: ms * 0.7, easing: curve('emphasized'), reduceMotion: never }),
              withTiming(1, { duration: ms * 0.3, easing: curve('standard'), reduceMotion: never }),
            ),
        never,
      ),
    );
  }, [kind, delayMs, scale, opacity, never]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={style} testID={testID}>
      {children}
    </Animated.View>
  );
}

const ICON = size.ctaHero - space[8];

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    paddingHorizontal: tokens.layout.gutterGame,
    backgroundColor: color.bg,
  },
  content: { alignItems: 'center', gap: space[7] },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.iconBg.warning,
  },
  heading: { ...text('label'), color: color.accent, textAlign: 'center' },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  bot: { flexDirection: 'row', alignItems: 'center', gap: space[6], alignSelf: 'stretch' },
  botLine: { ...text('bodyLong'), color: color.text, flex: 1, minWidth: 0 },
  news: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  xp: { ...text('scoreCompact'), color: color.accent },
});
