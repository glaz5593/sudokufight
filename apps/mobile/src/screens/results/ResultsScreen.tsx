import type { GameMode, GameType } from '@sudoku-fight/engine';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { formatScore, ltr, paletteAt, scoreText, signedText } from '../../components/player';
import { Button, Spinner } from '../../components/ui';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { formatClock, formatSeconds } from '../game/model';
import type { ResultsLoad, ResultsModel } from './resultsModel';
import { AwardsSection, OpponentsSection } from './ResultsVersus';

/**
 * The basic results of a game (spec §12; Results-Victory / Results-Defeat in direction C): the final score,
 * the mistakes, the move of the game with its calculation, the time, the correct moves and the average think
 * time, and how the game ended. Against a bot or online also the headline (ניצחון / הפסד / תיקו), the
 * opponent's row and the game's awards; a practice changes no rating (spec §6.6), and the screen says so. A
 * ranked game won because the opponent did not come back gets the "ניצחת בנטישה" tag (spec §12, §16.2); its
 * rating change comes with stage 9, and until then the screen says the rating does not change yet. A practice
 * is read from the saved game, so it works after an app restart too. Buttons: "משחק חדש" (the one gold action),
 * "צפייה חוזרת" (stage 11: disabled, "בקרוב") and "לבית".
 */
export interface ResultsScreenProps {
  gameId: string;
  load: (id: string) => Promise<ResultsLoad>;
  /**
   * "משחק חדש": the game-type screen, with this practice's type chosen; `mode` comes with a practice that was
   * not solo (against a bot), so the next game can be the same kind.
   */
  onNewGame: (gameType: GameType, mode?: GameMode) => void;
  onHome: () => void;
  /** The game was just played here: a full board gets its fanfare (motion.md §7, "Win"). */
  celebrate?: boolean;
  testID?: string;
}

const ME = paletteAt(0);
const victory = tokens.motion.sequence.victory;

export function ResultsScreen({
  gameId,
  load,
  onNewGame,
  onHome,
  celebrate = false,
  testID = 'results',
}: ResultsScreenProps) {
  const { t } = useTranslation('game');
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState<{ id: string; result: ResultsLoad } | null>(null);

  useEffect(() => {
    let alive = true;
    void load(gameId).then((result) => {
      if (alive) setLoaded({ id: gameId, result });
    });
    return () => {
      alive = false;
    };
  }, [gameId, load]);

  const result = loaded?.id === gameId ? loaded.result : null;
  const model = result?.kind === 'found' ? result.model : null;

  // Just played: a full board alone, or a game against a bot, gets its sound as the title lands (+200 ms).
  const fanfare =
    !celebrate || !model
      ? null
      : model.outcome === 'win'
        ? 'win'
        : model.outcome === 'loss'
          ? 'lose'
          : model.players === 1 && model.end === 'completed'
            ? 'practiceDone'
            : null;
  useEffect(() => {
    if (!fanfare) return;
    const id = setTimeout(() => cue(fanfare), victory.slamAt);
    return () => clearTimeout(id);
  }, [fanfare]);

  const padding = { paddingTop: insets.top + space[4], paddingBottom: insets.bottom + space[8] };

  if (!result) {
    return (
      <View style={[styles.root, styles.center, padding]} testID={`${testID}-loading`}>
        <Spinner color={color.textMuted} />
        <Text style={[text('body'), styles.muted]} accessibilityLiveRegion="polite">
          {t('results.loading')}
        </Text>
      </View>
    );
  }

  if (!model) {
    return (
      <View style={[styles.root, styles.center, padding]} testID={`${testID}-${result.kind}`}>
        <Icon name="alert" size={size.icon.nav} color={color.textMuted} />
        <Text style={[text('sheetTitle'), styles.title]} accessibilityRole="header">
          {result.kind === 'missing' ? t('results.missing') : t('results.unavailable')}
        </Text>
        <Button
          label={t('results.actions.home')}
          icon="home"
          onPress={onHome}
          size="md"
          testID="results-home"
        />
      </View>
    );
  }

  return (
    <ResultsBody model={model} onNewGame={onNewGame} onHome={onHome} padding={padding} testID={testID} />
  );
}

function ResultsBody({
  model,
  onNewGame,
  onHome,
  padding,
  testID,
}: {
  model: ResultsModel;
  onNewGame: (gameType: GameType, mode?: GameMode) => void;
  onHome: () => void;
  padding: { paddingTop: number; paddingBottom: number };
  testID: string;
}) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const enter = enteringFor(reduce);
  const none = t('results.stats.none');
  const best = model.bestMove;
  const versus = model.players > 1;
  // A full board against someone was filled by both: "the board filled up", not "you filled it".
  const reason = versus && model.end === 'completed' ? t('results.end.full') : t(`results.end.${model.end}`);
  const title = model.outcome ? t(`results.outcome.${model.outcome}`) : t(`results.title.${model.end}`);
  const ranked = model.mode === 'ranked';
  const modeTitle = ranked ? t('titleRanked') : model.mode === 'bot' ? t('titleBot') : t('title');
  const gold = model.outcome ? model.outcome === 'win' : model.end === 'completed';
  const newGame = () => (versus ? onNewGame(model.gameType, model.mode) : onNewGame(model.gameType));

  const stats: { key: string; label: string; value: string; unit?: string }[] = [
    {
      key: 'time',
      label: t('results.stats.time'),
      value: model.durationMs === null ? none : formatClock(model.durationMs),
    },
    { key: 'mistakes', label: t('results.stats.mistakes'), value: String(model.mistakes) },
    { key: 'correct', label: t('results.stats.correct'), value: String(model.correct) },
    {
      key: 'think',
      label: t('results.stats.think'),
      value:
        model.avgThinkMs === null
          ? none
          : t('results.stats.seconds', { value: formatSeconds(model.avgThinkMs) }),
    },
  ];

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: padding.paddingTop }]}>
        <View style={styles.header}>
          <Button
            label={t('results.actions.home')}
            icon="home"
            variant="ghost"
            onPress={onHome}
            testID="results-home"
          />
          <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
            {t('subtitle', { title: modeTitle, type: t(`type.${model.gameType}`) })}
          </Text>
        </View>

        <Animated.View entering={enter.title} style={styles.titleBlock}>
          <Text
            style={[text('screenTitle'), styles.title, gold ? styles.titleDone : null]}
            accessibilityRole="header"
            testID="results-title"
          >
            {title}
          </Text>
          {model.abandonWin ? (
            <View style={styles.tag} testID="results-abandon-win">
              <Text style={[text('badge'), styles.tagText]}>{t('results.abandonWin')}</Text>
            </View>
          ) : null}
          <Text style={[text('body'), styles.muted, styles.centered]} testID="results-end">
            {t('results.end.line', { label: t('results.end.label'), reason })}
          </Text>
        </Animated.View>

        <Animated.View
          entering={enter.section(0)}
          style={styles.scoreBlock}
          accessible
          accessibilityRole="text"
          accessibilityLabel={t('results.scoreLabel', { score: scoreText(model.score) })}
        >
          <Text style={[text('label'), styles.muted]}>{t('results.score')}</Text>
          <View style={styles.scoreRow}>
            <Text style={[text('scoreXL'), styles.score]} testID="results-score">
              {scoreText(model.score)}
            </Text>
            <Text style={[text('status'), styles.muted]}>{t('results.points')}</Text>
          </View>
        </Animated.View>

        {model.opponents.length ? (
          <Animated.View entering={enter.section(1)}>
            <OpponentsSection opponents={model.opponents} />
          </Animated.View>
        ) : null}

        <Animated.View entering={enter.section(1)}>
          <Section
            title={t('results.best.title')}
            icon="trophy"
            label={
              best
                ? [
                    t('results.best.label', {
                      points: ltr(formatScore(best.points)),
                      digit: best.digit,
                      cell: ltr(best.cell),
                    }),
                    t('results.best.formulaLabel', { line: ltr(best.line) }),
                  ].join(t('listSep'))
                : t('results.best.none')
            }
            testID="results-best"
          >
            {best ? (
              <>
                <View style={styles.bestRow}>
                  <Text style={[text('rating'), styles.bestPoints]}>{signedText(best.points)}</Text>
                  <Text style={[text('cellRef'), styles.strong]}>
                    {ltr(t('results.best.move', { cell: best.cell, digit: best.digit }))}
                  </Text>
                </View>
                <Text style={[text('micro'), styles.muted]}>{t('results.best.formula')}</Text>
                <Text style={[text('body'), styles.strong, styles.ltr]} testID="results-best-line">
                  {ltr(best.line)}
                </Text>
              </>
            ) : (
              <Text style={[text('body'), styles.muted]}>{t('results.best.none')}</Text>
            )}
          </Section>
        </Animated.View>

        <Animated.View entering={enter.section(2)} style={styles.grid}>
          {stats.map((s) => (
            <View
              key={s.key}
              style={styles.tile}
              accessible
              accessibilityRole="text"
              accessibilityLabel={t('results.stats.label', { label: s.label, value: s.value })}
              testID={`results-stat-${s.key}`}
            >
              <Text style={[text('cellRef'), styles.strong]}>{s.value}</Text>
              <Text style={[text('micro'), styles.muted]} numberOfLines={2}>
                {s.label}
              </Text>
            </View>
          ))}
        </Animated.View>

        {model.awards.length ? (
          <Animated.View entering={enter.section(3)}>
            <AwardsSection awards={model.awards} />
          </Animated.View>
        ) : null}

        {versus ? (
          <Text style={[text('caption'), styles.muted, styles.centered]} testID="results-unrated">
            {ranked ? t('results.ratingSoon') : t('results.unrated')}
          </Text>
        ) : null}

        {model.saved || ranked ? null : (
          <Text style={[text('caption'), styles.muted, styles.centered]}>{t('results.notSaved')}</Text>
        )}
      </ScrollView>

      <Animated.View
        entering={enter.actions}
        style={[styles.actions, { paddingBottom: padding.paddingBottom }]}
      >
        <Button label={t('results.actions.newGame')} size="lg" onPress={newGame} testID="results-new-game" />
        <Button
          label={t('results.actions.replay')}
          icon="history"
          variant="secondary"
          size="md"
          disabled
          accessibilityHint={t('results.actions.replayHint')}
          testID="results-replay"
        />
      </Animated.View>
    </View>
  );
}

function Section({
  title,
  icon,
  label,
  children,
  testID,
}: {
  title: string;
  icon: 'trophy';
  label: string;
  children: ReactNode;
  testID: string;
}) {
  return (
    <View
      style={styles.section}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.sectionHead}>
        <Icon name={icon} size={size.icon.inline} color={color.textMuted} />
        <Text style={[text('label'), styles.muted]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * motion.md §4.7: the title drops 12 dp in at +200, the sections rise 14 dp from +700 (150 ms apart), the
 * actions rise at +1900. Reduced motion: 200 ms fades, together.
 */
function enteringFor(reduce: boolean) {
  const fade = FadeIn.duration(motion.duration.reducedFade).reduceMotion(ReduceMotion.Never);
  if (reduce) return { title: fade, section: () => fade, actions: fade };
  return {
    title: FadeInDown.duration(motion.duration.rewardMin)
      .delay(victory.slamAt)
      .withInitialValues({ opacity: 0, transform: [{ translateY: -TITLE_DROP }] })
      .reduceMotion(ReduceMotion.Never),
    section: (i: number) =>
      FadeInUp.duration(motion.duration.rewardMin)
        .delay(victory.crownAt + i * victory.awardsStagger)
        .withInitialValues({ opacity: 0, transform: [{ translateY: SECTION_RISE }] })
        .reduceMotion(ReduceMotion.Never),
    actions: FadeInUp.duration(motion.duration.stateChange)
      .delay(victory.actionsAt)
      .withInitialValues({ opacity: 0, transform: [{ translateY: ACTIONS_RISE }] })
      .reduceMotion(ReduceMotion.Never),
  };
}

/** The title drops 12 dp (`results.title.loss`); sections rise 14 dp and actions 8 dp (motion.md §4.7). */
const TITLE_DROP = space[6];
const ACTIONS_RISE = space[4];
const SECTION_RISE = space[7];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: space[8], paddingHorizontal: space[10] },
  content: { paddingHorizontal: tokens.layout.gutterHome, gap: space[10] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[6],
  },
  titleBlock: { alignItems: 'center', gap: space[4] },
  title: { color: color.text, textAlign: 'center' },
  titleDone: { color: color.accent },
  tag: {
    paddingHorizontal: space[6],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.accentSubtle,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
  },
  tagText: { color: color.accent },
  centered: { textAlign: 'center' },
  muted: { color: color.textMuted },
  strong: { color: color.text },
  ltr: { writingDirection: 'ltr' },
  scoreBlock: { alignItems: 'center', gap: space[4] },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  score: { color: ME.ring, includeFontPadding: false },
  section: {
    gap: space[4],
    padding: space[8],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  bestRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[6] },
  bestPoints: { color: ME.ring, includeFontPadding: false },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: size.listRow,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[6],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  actions: {
    paddingHorizontal: tokens.layout.gutterHome,
    paddingTop: space[6],
    gap: space[6],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
});
