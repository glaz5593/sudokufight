import type { GameMode, GameType } from '@sudoku-fight/engine';
import { router } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { formatScore, ltr, paletteAt, scoreText, signedText, withDecimal } from '../../components/player';
import { Button, Spinner } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { decimalSeparator } from '../../i18n/compose';
import { crashReporter } from '../../services/crashlytics';
import { cue } from '../../services/feedback';
import { openPlayerCard } from '../player/navigation';
import { useProfile } from '../../state/profile';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { formatClock, formatSeconds } from '../game/model';
import type { ResultsLoad, ResultsModel } from './resultsModel';
import { AwardsSection, OpponentsSection, RankingSection, RatingSection } from './ResultsVersus';

/**
 * The basic results of a game (spec §12; Results-Victory / Results-Defeat in direction C): the final score,
 * the mistakes, the move of the game with its calculation, the time, the correct moves and the average think
 * time, and how the game ended. Against a bot or online also the headline (ניצחון / הפסד / תיקו), the
 * opponent's row and the game's awards; a practice changes no rating (spec §6.6), and the screen says so. A
 * ranked game won because the opponent did not come back gets the "ניצחת בנטישה" tag (spec §12, §16.2), and
 * a rated game shows my rating change counting from the old rating to the new one, and each opponent's. A game
 * of 3–4 players shows the full ranking: a podium and the 4th place (Results-4P). Each award says what it is
 * for. A practice is read from the saved game, so it works after an app restart too. Buttons: "משחק חדש" (the
 * one gold action), "צפייה חוזרת" (stage 11: the game's replay) and "לבית".
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
  /** "צפייה חוזרת": the game's replay (default: the /replay route, from the phone or the server). */
  onReplay?: (gameId: string, mode: GameMode) => void;
  /** Another player of a ranked game: their card, with this game for a report (the /player route by default). */
  onOpenPlayer?: (playerId: string, gameId: string) => void;
  /** The game was just played here: a full board gets its fanfare (motion.md §7, "Win"). */
  celebrate?: boolean;
  testID?: string;
}

const ME = paletteAt(0);
const victory = tokens.motion.sequence.victory;

/** The replay route: a practice from the phone's log, a ranked game from the server (spec §13). */
export const openReplay = (gameId: string, mode: GameMode): void =>
  router.push({
    pathname: '/replay/[id]',
    params: { id: gameId, source: mode === 'ranked' ? 'ranked' : 'practice' },
  });

export function ResultsScreen({
  gameId,
  load,
  onNewGame,
  onHome,
  onReplay = openReplay,
  onOpenPlayer = openPlayerCard,
  celebrate = false,
  testID = 'results',
}: ResultsScreenProps) {
  const { t } = useTranslation('game');
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState<{ id: string; result: ResultsLoad } | null>(null);

  useEffect(() => {
    let alive = true;
    crashReporter().log('results: loading');
    const show = (result: ResultsLoad) => {
      crashReporter().log(`results: ${result.kind}`);
      if (alive) setLoaded({ id: gameId, result });
    };
    // A load that fails says so ("unavailable", with "לבית"), reported, instead of a spinner for ever.
    load(gameId).then(show, (error: unknown) => {
      crashReporter().recordError(error, 'results: could not load');
      show({ kind: 'unavailable' });
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
    <ResultsBody
      model={model}
      onNewGame={onNewGame}
      onHome={onHome}
      onReplay={onReplay}
      onOpenPlayer={onOpenPlayer}
      padding={padding}
      testID={testID}
    />
  );
}

function ResultsBody({
  model,
  onNewGame,
  onHome,
  onReplay,
  onOpenPlayer,
  padding,
  testID,
}: {
  model: ResultsModel;
  onNewGame: (gameType: GameType, mode?: GameMode) => void;
  onHome: () => void;
  onReplay: (gameId: string, mode: GameMode) => void;
  onOpenPlayer: (playerId: string, gameId: string) => void;
  padding: { paddingTop: number; paddingBottom: number };
  testID: string;
}) {
  const { t } = useTranslation('game');
  const { t: th } = useTranslation('history');
  const myAvatar = useProfile((s) => s.avatarId);
  const reduce = useReduceMotion();
  const enter = enteringFor(reduce);
  const none = t('results.stats.none');
  const decimal = decimalSeparator(t);
  const best = model.bestMove;
  // Another player's card from here carries this game: a report from it is about this game (spec §3.5).
  const { gameId } = model;
  const openPlayer = useCallback(
    (playerId: string) => onOpenPlayer(playerId, gameId),
    [onOpenPlayer, gameId],
  );
  const versus = model.players > 1;
  // A full board against someone was filled by both: "the board filled up", not "you filled it".
  const reason = versus && model.end === 'completed' ? t('results.end.full') : t(`results.end.${model.end}`);
  // Results-4P: behind the winner in a game of 3–4 the headline is the place ("מקום 2!"), not "הפסד".
  const placeTitle = model.outcome === 'loss' && model.players >= 3 && model.place !== null;
  const title = placeTitle
    ? t('results.placeTitle', { place: model.place })
    : model.outcome
      ? t(`results.outcome.${model.outcome}`)
      : t(`results.title.${model.end}`);
  // Spec §12 "מקום סופי": "מקום 1 מתוך 2" (Results-Victory), or "מתוך 4 שחקנים" under "מקום 2!" (Results-4P).
  const players = t('progress:common.players', { count: model.players });
  const placeLine =
    model.place === null
      ? null
      : placeTitle
        ? t('results.outOf', { players })
        : t('results.placeOf', { place: model.place, total: model.players });
  const ranked = model.mode === 'ranked';
  // A friends room's game (1.0.4) is a ranked game without a rating [D81a]: named for what it is.
  const modeTitle = model.friends
    ? t('friends:modeLong')
    : ranked
      ? t('titleRanked')
      : model.mode === 'bot'
        ? t('titleBot')
        : t('title');
  const header = versus
    ? t('results.header', { title: modeTitle, type: t(`type.${model.gameType}`), players })
    : t('subtitle', { title: modeTitle, type: t(`type.${model.gameType}`) });
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
          : t('results.stats.seconds', { value: formatSeconds(model.avgThinkMs, decimal) }),
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
          <Text style={[text('caption'), styles.muted, styles.shrink]} numberOfLines={1}>
            {header}
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
          {placeLine || model.abandonWin ? (
            <View style={styles.tags}>
              {placeLine ? (
                <View style={[styles.tag, model.place === 1 ? null : styles.tagPlain]} testID="results-place">
                  <Text style={[text('badge'), model.place === 1 ? styles.tagText : styles.strong]}>
                    {placeLine}
                  </Text>
                </View>
              ) : null}
              {model.abandonWin ? (
                <View style={styles.tag} testID="results-abandon-win">
                  <Text style={[text('badge'), styles.tagText]}>{t('results.abandonWin')}</Text>
                </View>
              ) : null}
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
          accessibilityLabel={t('results.scoreLabel', {
            count: model.score,
            score: scoreText(model.score, decimal),
          })}
        >
          <Text style={[text('label'), styles.muted]}>{t('results.score')}</Text>
          <View style={styles.scoreRow}>
            <Text style={[text('scoreXL'), styles.score]} testID="results-score">
              {scoreText(model.score, decimal)}
            </Text>
            <Text style={[text('status'), styles.muted]}>{t('results.points')}</Text>
          </View>
        </Animated.View>

        {model.ranking.length ? (
          <Animated.View entering={enter.section(1)}>
            <RankingSection
              ranking={model.ranking}
              myAvatar={myAvatar}
              onOpenPlayer={ranked ? openPlayer : undefined}
            />
          </Animated.View>
        ) : model.opponents.length ? (
          <Animated.View entering={enter.section(1)}>
            <OpponentsSection
              opponents={model.opponents}
              outcome={model.outcome}
              onOpenPlayer={ranked ? openPlayer : undefined}
            />
          </Animated.View>
        ) : null}

        {model.rating ? (
          <Animated.View entering={enter.section(1)}>
            <RatingSection
              rating={model.rating}
              gameType={model.gameType}
              pairs={model.ratingPairs}
              guards={model.ratingGuards}
            />
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
                      count: best.points,
                      points: ltr(formatScore(best.points, decimal)),
                      digit: best.digit,
                      cell: ltr(best.cell),
                    }),
                    t('results.best.formulaLabel', { line: ltr(withDecimal(best.line, decimal)) }),
                  ].join(t('listSep'))
                : t('results.best.none')
            }
            testID="results-best"
          >
            {best ? (
              <>
                <View style={styles.bestRow}>
                  <Text style={[text('rating'), styles.bestPoints]}>{signedText(best.points, decimal)}</Text>
                  <Text style={[text('cellRef'), styles.strong]}>
                    {ltr(t('results.best.move', { cell: best.cell, digit: best.digit }))}
                  </Text>
                </View>
                <Text style={[text('micro'), styles.muted]}>{t('results.best.formula')}</Text>
                <Text style={[text('body'), styles.strong, styles.ltr]} testID="results-best-line">
                  {ltr(withDecimal(best.line, decimal))}
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

        {versus && !model.rating ? (
          <Text style={[text('caption'), styles.muted, styles.centered]} testID="results-unrated">
            {model.friends ? t('friends:label') : ranked ? t('results.ratingSoon') : t('results.unrated')}
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
        <Button
          label={t('results.actions.newGame')}
          size="md"
          onPress={newGame}
          style={styles.action}
          testID="results-new-game"
        />
        <Button
          label={th('results.replay')}
          icon="history"
          variant="secondary"
          size="md"
          onPress={() => onReplay(model.gameId, model.mode)}
          accessibilityHint={th('results.replayHint')}
          style={styles.action}
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[3] },
  tag: {
    paddingHorizontal: space[6],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    backgroundColor: color.accentSubtle,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
  },
  tagPlain: { backgroundColor: color.surface2, borderColor: color.border },
  tagText: { color: color.accent },
  shrink: { flexShrink: 1 },
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
  // Results-Victory / -Defeat / -4P: "משחק חדש" and "צפייה חוזרת" side by side; on a narrow phone or with a
  // large font the second one wraps to its own line instead of cutting its label.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: tokens.layout.gutterHome,
    paddingTop: space[6],
    gap: space[6],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  action: { flexGrow: 1, flexBasis: 'auto' },
});
