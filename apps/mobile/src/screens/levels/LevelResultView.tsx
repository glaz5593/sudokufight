import {
  type AppLevel,
  type BotLevelId,
  cellName,
  type CellIndex,
  type Digit,
  type GateState,
  type LevelOutcome,
  levelNumber,
  maxLevel,
} from '@sudoku-fight/engine';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarIdOrNone } from '../../avatars';
import { Icon } from '../../components/Icon';
import { BossBadge } from '../../components/levels/BossBadge';
import { revealMs, Star, StarRow, STAR_MOTION, STAR_SIZES } from '../../components/levels/StarRow';
import { Avatar, CountUpText, SeatGlyph } from '../../components/player';
import { formatScore, ltr, signedText } from '../../components/player/format';
import { Button } from '../../components/ui';
import { Confetti } from '../../components/ui/Confetti';
import { timing } from '../../components/ui/motion';
import { Text } from '../../components/ui/Text';
import { LEVEL_MOTION } from '../../config/levels';
import { decimalSeparator } from '../../i18n/compose';
import type { LevelFinished } from '../../levels/appLevels';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { KIND_ICON } from './LevelNode';
import {
  bossGateText,
  bossResultText,
  chapterName,
  headline,
  kindName,
  type LevelsT,
  metricParts,
  starsOf3,
} from './levelWording';

/**
 * A stage's result (components.md §19.10; the Level-Result board): a state inside the stage's own route, never a
 * new screen or a window (the black screen of 1.0.0 came with those). What it shows:
 * - the title ("שלב 37 הושלם", or the stage and how it ended), the stars (popping in one by one, motion.md
 *   `level.stars.reveal`; at once under Reduced Motion), the measure in Teko 64 and P1 ("7.6 ש׳", "4 מתוך 5
 *   מקומות", "פער 17"), "שיא חדש!" or "השיא שלך: ★★";
 * - "‎+20 XP" only when there are new stars (the phone's estimate; the server pays its own count), and the
 *   chapter's line, "בפרק הזה: ★ 18/30 · לשער צריך 20";
 * - from the original §23: my mistakes, the time when the measure is not the time, the bot's row in a stage
 *   against it ("ניצחת" or "Pip ניצח", its avatar with ▲, its score or spots), and the best move of a duel or a
 *   point hunter;
 * - "למה?": the session's explanation of the target, with my wrong tap;
 * - "לשלב הבא" (the quick entry), "שוב" and "למפה". Three stars: one confetti burst (never under Reduced Motion).
 * - a boss (levels-ui.md §3.2, D77): over the title, a 56 dp crown medallion and "ניצחת את הבוס!" (the crown
 *   pops, `level.boss.won`; at once under Reduced Motion) or "הבוס ניצח הפעם" (still), and the gate's line in
 *   front: "השער לפרק 2: ★ 22/20 · נפתח!". Who won is the engine's verdict, levelOutcome().bossBeaten, never the
 *   stars: a race gives a star for 2 spots of 5 and is still the bot's with 3. It is only the word on the screen:
 *   the gate still needs only "played the boss" (spec §5.3.5).
 * Every number in it comes from the engine's reading of the end (levelOutcome) and what levels.db stored.
 */

/** The bot's row (a stage against it), as the session read it off the end. */
export interface LevelOpponent {
  name: string;
  avatar: AvatarIdOrNone;
  botLevel: BotLevelId;
  /** Its score (a duel) or the spots it took (a race). */
  value: number;
  /**
   * The end, as the engine ranked it: I won, the bot did, or a tie. A boss: the engine's bossBeaten [D72], and
   * `bossTie` for equal places that do not beat it ("תיקו: הבוס נשאר"), never a plain tie under "הבוס ניצח הפעם".
   */
  verdict: 'won' | 'lost' | 'tie' | 'bossTie';
}

/** What the stage screens hand the result when a stage ends (app/levels/play.tsx's `playing` phase). */
export interface LevelPlayed {
  /** How it ended, as the engine reads it (levelOutcome of the host's end). */
  outcome: LevelOutcome;
  /** What levels.db stored (levelFinished): null when it could not (no account, no database). */
  finished: LevelFinished | null;
  /** My mistakes (wrong taps or digits). */
  mistakes: number;
  /** A stage against the bot: its row. */
  opponent: LevelOpponent | null;
  /** The duel and point hunter: the best move (the board's, or mine). */
  bestMove: { cell: CellIndex; digit: Digit; points: number } | null;
  /** "למה?": the explanation of the target, my wrong tap included (cell names already LTR). */
  why: string | null;
}

/** The chapter's line: its stars after this attempt, and the gate at its end (none in the last chapter). */
export interface ResultChapter {
  stars: number;
  max: number;
  gate: GateState | null;
}

export interface LevelResultViewProps {
  level: AppLevel;
  played: LevelPlayed;
  chapter: ResultChapter | null;
  /** The next stage, when it is open; null at a closed gate or after the last one. */
  next: string | null;
  onNext: () => void;
  onAgain: () => void;
  onMap: () => void;
}

export function LevelResultView({
  level,
  played,
  chapter,
  next,
  onNext,
  onAgain,
  onMap,
}: LevelResultViewProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const { top, bottom } = useSafeAreaInsets();
  const { outcome, finished } = played;
  const n = levelNumber(level.id) ?? 0;
  const completed = outcome.reason === 'completed';
  const bot = played.opponent?.name ?? '';

  // motion.md `level.result.enter`: the result cross-fades in.
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [opacity, reduce]);
  const enter = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const bossWords = level.boss ? bossResultText(outcome.bossBeaten, t) : null;
  const big = headline(level, outcome);
  const parts = metricParts(level, big.measure, big.value, t);
  const newBest =
    finished !== null &&
    (finished.newStars > 0 || (outcome.metric !== null && finished.bestMetric === outcome.metric));
  const xp = finished && finished.newStars > 0 ? finished.xpEstimate : 0;

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="level-result">
      <Animated.View style={[styles.flex, enter]}>
        <ScrollView contentContainerStyle={styles.content}>
          {bossWords ? (
            <BossVerdict won={outcome.bossBeaten === true} words={bossWords} reduce={reduce} />
          ) : null}
          <Text style={styles.over} numberOfLines={1}>
            {t('panel.sub', { chapter: level.chapter, name: chapterName(level.chapter, t) })}
          </Text>
          <Text accessibilityRole="header" style={styles.title} testID="level-result-title">
            {completed ? t('result.completed', { n }) : t('result.ended', { n })}
          </Text>
          {completed ? null : (
            <Text style={styles.reason} testID="level-result-reason">
              {t(`result.reasons.${outcome.reason}`, { bot })}
            </Text>
          )}
          <View style={styles.kind}>
            <Icon
              name={level.boss ? 'crown' : KIND_ICON[level.kind]}
              size={size.icon.inline}
              color={color.textMuted}
            />
            <Text style={styles.kindText} numberOfLines={1}>
              {kindName(level, t)}
            </Text>
            {level.boss ? <BossBadge /> : null}
          </View>

          <StarRow
            stars={outcome.stars}
            size={STAR_SIZES.result}
            label={starsOf3(outcome.stars, t)}
            reveal
            testID="level-result-stars"
          />

          <View style={styles.metric} accessible accessibilityLabel={parts.text} testID="level-result-metric">
            {parts.before ? <Text style={styles.unit}>{parts.before}</Text> : null}
            <Text style={styles.metricValue}>{parts.value}</Text>
            {parts.after ? <Text style={styles.unit}>{parts.after}</Text> : null}
          </View>

          {finished ? (
            newBest ? (
              <View style={styles.bestChip} testID="level-result-new-best">
                <Text style={styles.bestChipText}>{t('result.newBest')}</Text>
              </View>
            ) : (
              <View
                style={styles.yourBest}
                accessible
                accessibilityLabel={t('result.yourBestLabel', { stars: starsOf3(finished.best, t) })}
                testID="level-result-your-best"
              >
                <Text style={styles.muted}>{t('result.yourBest')}</Text>
                <StarRow
                  stars={finished.best}
                  size={STAR_SIZES.panel}
                  label={null}
                  testID="level-result-best-stars"
                />
              </View>
            )
          ) : null}

          {xp > 0 ? <XpLine xp={xp} stars={outcome.stars} reduce={reduce} t={t} /> : null}

          {chapter ? (
            level.boss && chapter.gate ? (
              <BossGateLine level={level} gate={chapter.gate} t={t} />
            ) : (
              <ChapterLine chapter={chapter} t={t} />
            )
          ) : null}

          <Stats level={level} played={played} measure={big.measure} t={t} />

          {played.opponent ? <OpponentRow level={level} opponent={played.opponent} t={t} /> : null}

          {played.bestMove ? (
            <Text style={styles.line} testID="level-result-best-move">
              {t('result.bestMove', {
                digit: played.bestMove.digit,
                cell: ltr(cellName(played.bestMove.cell)),
                count: played.bestMove.points,
                points: formatScore(played.bestMove.points, decimalSeparator(t)),
              })}
            </Text>
          ) : null}

          {played.why ? (
            <View style={styles.why} testID="level-result-why">
              <Text accessibilityRole="header" style={styles.whyTitle}>
                {t('result.why')}
              </Text>
              <Text style={styles.whyText}>{played.why}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: bottom + space[6] }]}>
          {next ? (
            <Button label={t('result.next')} size="lg" onPress={onNext} testID="level-result-next" />
          ) : (
            <Text style={styles.note} testID="level-result-no-next">
              {n >= maxLevel() ? t('result.last') : t('result.nextLocked')}
            </Text>
          )}
          <View style={styles.row}>
            <Button
              label={t('result.again')}
              variant="secondary"
              size="modal"
              icon="refresh"
              onPress={onAgain}
              style={styles.flex}
              testID="level-result-again"
            />
            <Button
              label={t('result.toMap')}
              variant="ghost"
              icon="map"
              onPress={onMap}
              style={styles.flex}
              testID="level-result-map"
            />
          </View>
        </View>
      </Animated.View>
      {outcome.stars === 3 && !reduce ? (
        <Confetti delayMs={STAR_MOTION.confettiAtMs} testID="level-result-confetti" />
      ) : null}
    </View>
  );
}

/**
 * A boss's verdict over the title: the 56 dp crown medallion and the engine's word. Won: gold, the crown pops
 * (LEVEL_MOTION.bossWonPopMs, `lv-pop`; Reduced Motion: it is simply there). Lost: muted, still.
 */
function BossVerdict({ won, words, reduce }: { won: boolean; words: string; reduce: boolean }) {
  const pop = won && !reduce;
  const scale = useSharedValue(pop ? POP_FROM : 1);
  useEffect(() => {
    if (!pop) {
      scale.set(1);
      return;
    }
    scale.set(withTiming(1, timing(LEVEL_MOTION.bossWonPopMs, 'emphasized', false)));
  }, [pop, scale]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <View style={styles.boss} testID="level-result-boss">
      <Animated.View
        style={[styles.medallion, won ? styles.medallionWon : styles.medallionLost, popStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="level-result-boss-crown"
      >
        <Icon name="crown" size={MEDALLION_CROWN} color={won ? color.accent : color.textMuted} />
      </Animated.View>
      <Text
        style={[styles.bossWords, won ? styles.bossWon : styles.bossLost]}
        testID="level-result-boss-words"
      >
        {words}
      </Text>
    </View>
  );
}

/** A boss's chapter line, in front: "השער לפרק 2: ★ 22/20 · נפתח!" (the count an LTR isolate). */
function BossGateLine({ level, gate, t }: { level: AppLevel; gate: GateState; t: LevelsT }) {
  const words = bossGateText(level.chapter, gate.stars, gate.need, gate.open, t);
  return (
    <View
      style={[styles.bossGate, gate.open && styles.bossGateOpen]}
      accessible
      accessibilityLabel={words}
      testID="level-result-chapter"
    >
      <Text style={[styles.bossGateText, gate.open && styles.bossGateTextOpen]}>{words}</Text>
    </View>
  );
}

/** "‎+20 XP": counts up once the stars are in (at once under Reduced Motion). Only with new stars. */
function XpLine({ xp, stars, reduce, t }: { xp: number; stars: number; reduce: boolean; t: LevelsT }) {
  const [counted, setCounted] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const timer = setTimeout(() => setCounted(xp), revealMs(stars));
    return () => clearTimeout(timer);
  }, [xp, stars, reduce]);
  const shown = reduce ? xp : counted;
  const unit = t('result.xpUnit');
  const decimal = decimalSeparator(t);
  const format = (value: number): string => {
    'worklet';
    return `${ltr(`+${formatScore(value, decimal)}`)} ${unit}`;
  };
  return (
    <View
      style={styles.xp}
      accessible
      accessibilityLabel={t('result.xpLabel', { xp: signedText(xp, decimal) })}
      testID="level-result-xp"
    >
      <CountUpText value={shown} format={format} style={styles.xpText} testID="level-result-xp-value" />
    </View>
  );
}

/** "בפרק הזה: ★ 18/30 · לשער צריך 20" (or "השער פתוח"; the last chapter has no gate). */
function ChapterLine({ chapter, t }: { chapter: ResultChapter; t: LevelsT }) {
  const gate = chapter.gate;
  const gateWords = gate
    ? gate.open
      ? t('result.chapterOpen')
      : t('result.chapterNeed', { need: gate.need })
    : '';
  return (
    <View
      style={styles.chapter}
      accessible
      accessibilityLabel={t('result.chapterLine', {
        count: chapter.stars,
        stars: chapter.stars,
        max: chapter.max,
        gate: gateWords,
      })}
      testID="level-result-chapter"
    >
      <Text style={styles.muted}>{t('result.chapterLabel')}</Text>
      <Star filled size={STAR_SIZES.chip + 3} />
      <Text style={styles.chapterCount}>
        {ltr(t('result.chapterStars', { stars: chapter.stars, max: chapter.max }))}
      </Text>
      {gate ? <Text style={styles.muted}>{t('result.chapterGate', { gate: gateWords })}</Text> : null}
    </View>
  );
}

/** My mistakes, and the time when the big number is not the time (the original §23). */
function Stats({
  level,
  played,
  measure,
  t,
}: {
  level: AppLevel;
  played: LevelPlayed;
  measure: string;
  t: LevelsT;
}) {
  const mistakes =
    played.mistakes > 0 ? t('result.mistakes', { count: played.mistakes }) : t('result.noMistakes');
  const time =
    measure === 'timeMs'
      ? null
      : t('result.time', { s: metricParts(level, 'timeMs', played.outcome.elapsedMs, t).value });
  return (
    <View style={styles.stats}>
      <Text style={styles.stat} testID="level-result-mistakes">
        {mistakes}
      </Text>
      {time ? (
        <Text style={styles.stat} testID="level-result-time">
          {time}
        </Text>
      ) : null}
    </View>
  );
}

/** The bot's row: its avatar with ▲, its name, its score or spots, and who won. */
function OpponentRow({ level, opponent, t }: { level: AppLevel; opponent: LevelOpponent; t: LevelsT }) {
  const value =
    level.kind === 'findDuel'
      ? t('result.opponentSpots', { count: opponent.value })
      : t('result.opponentScore', {
          count: opponent.value,
          score: formatScore(opponent.value, decimalSeparator(t)),
        });
  const verdict =
    opponent.verdict === 'won'
      ? t('result.youWon')
      : opponent.verdict === 'lost'
        ? t('result.botWon', { bot: opponent.name })
        : opponent.verdict === 'bossTie'
          ? t('result.bossTie')
          : t('result.tie');
  return (
    <View
      style={styles.opponent}
      accessible
      accessibilityLabel={t('result.opponentLabel', { bot: opponent.name, value, verdict })}
      testID="level-result-opponent"
    >
      <Avatar avatarId={opponent.avatar} size="compact" colorIndex={1} bot />
      <SeatGlyph colorIndex={1} size={space[6]} />
      <View style={styles.opponentText}>
        <Text style={styles.opponentName} numberOfLines={1}>
          {opponent.name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text style={[styles.verdict, opponent.verdict === 'won' && styles.won]} testID="level-result-verdict">
        {verdict}
      </Text>
    </View>
  );
}

const ME = color.players[0]!;
/** levels-ui.md §3.2: the boss's crown medallion over the result's title, and its pop. */
const MEDALLION = 56;
const MEDALLION_CROWN = 30;
const POP_FROM = 0.4;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  content: {
    alignItems: 'center',
    gap: space[6],
    paddingHorizontal: tokens.layout.gutterGame,
    paddingTop: space[8],
    paddingBottom: space[8],
  },
  boss: { alignItems: 'center', gap: space[4] },
  medallion: {
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: MEDALLION / 2,
    borderWidth: tokens.border.focus,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionWon: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  medallionLost: { borderColor: color.border, backgroundColor: color.surface2 },
  bossWords: { ...text('h1'), textAlign: 'center' },
  bossWon: { color: color.accent },
  bossLost: { color: color.textMuted },
  bossGate: {
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  bossGateOpen: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  bossGateText: { ...text('rowTitle'), color: color.text, textAlign: 'center' },
  bossGateTextOpen: { color: color.accent },
  over: { ...text('label'), color: color.textMuted },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  reason: { ...text('status'), color: color.textMuted, textAlign: 'center' },
  kind: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  kindText: { ...text('body'), color: color.textMuted, flexShrink: 1 },
  metric: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  metricValue: { ...text('scoreXL'), color: ME.ring },
  unit: { ...text('h2'), color: color.textMuted },
  bestChip: {
    height: 24,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    justifyContent: 'center',
  },
  bestChipText: { ...text('badge'), color: color.accent },
  yourBest: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  muted: { ...text('caption'), color: color.textMuted },
  xp: { flexDirection: 'row', alignItems: 'center' },
  xpText: { ...text('scoreCompact'), color: color.accent },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  chapterCount: { ...text('scoreSm'), color: color.text },
  stats: { flexDirection: 'row', gap: space[8], justifyContent: 'center' },
  stat: { ...text('label'), color: color.text },
  opponent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    alignSelf: 'stretch',
    padding: space[5],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  opponentText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  opponentName: { ...text('playerName'), color: color.text },
  verdict: { ...text('label'), color: color.textMuted },
  won: { color: color.success },
  line: { ...text('body'), color: color.text, textAlign: 'center' },
  why: {
    alignSelf: 'stretch',
    gap: space[3],
    padding: space[6],
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  whyTitle: { ...text('h2'), color: color.text },
  whyText: { ...text('bodyLong'), color: color.textMuted },
  actions: { gap: space[5], paddingHorizontal: tokens.layout.gutterGame, paddingTop: space[4] },
  row: { flexDirection: 'row', gap: space[5] },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
