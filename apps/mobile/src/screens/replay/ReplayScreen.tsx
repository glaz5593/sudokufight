import { type CellIndex, cellName, type Lang, type PlayerId } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Board, type BoardFlash, boardModel } from '../../components/board';
import { Icon } from '../../components/Icon';
import {
  cardModels,
  compactCardGap,
  compactCardWidth,
  ltr,
  PlayerCardCompact,
  signedText,
} from '../../components/player';
import { Button, Spinner } from '../../components/ui';
import { color, size, space, text, tokens } from '../../theme';
import { formatClock } from '../game/model';
import { ScreenHeader } from '../home/parts';
import { dayOf, shortDate } from '../history/historyModel';
import { ExplanationCard, type MomentKind, MomentChips, StepButton, Timeline, useWho } from './ReplayParts';
import { nextMoment, type Replay, type ReplayStep, stepView, type StepView } from './replayModel';
import type { ReplayLoad, ReplayMeta } from './replaySource';

/**
 * The replay of a game (spec §13; Replay.dc.html): a step per action, from the start to the end. At each step
 * the board, the players' cards with their score and state at that moment (locks, an interference on them,
 * a disconnect), a line saying what happened, a full explanation for every player [D26 not approved], the
 * key moments to jump to, and at the bottom the timeline, "שלב 7 מתוך 94" with the game clock, and
 * "◀ שלב קודם | שלב הבא ▶". Read-only: nothing on the board or the cards can be pressed. Every number and
 * every explanation comes from the engine through the replay model. Motion: the cards' scores count to the
 * step's value and the step's cell flashes, both reduced to a jump under Reduced Motion (their components).
 */

export interface ReplayScreenProps {
  gameId: string;
  load: (id: string) => Promise<ReplayLoad>;
  onBack: () => void;
  /** For "היום" / "אתמול" in the subtitle. */
  now?: () => number;
  testID?: string;
}

export function ReplayScreen({ gameId, load, onBack, now = Date.now, testID = 'replay' }: ReplayScreenProps) {
  const { t } = useTranslation('replay');
  const insets = useSafeAreaInsets();
  const [loaded, setLoaded] = useState<{ id: string; attempt: number; result: ReplayLoad } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The loader of the first render: a new function each render (an inline prop) must not load again.
  const [read] = useState(() => load);

  useEffect(() => {
    let alive = true;
    void read(gameId).then((result) => {
      if (alive) setLoaded({ id: gameId, attempt, result });
    });
    return () => {
      alive = false;
    };
  }, [gameId, read, attempt]);

  const result = loaded?.id === gameId && loaded.attempt === attempt ? loaded.result : null;
  const padding = { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[6] };

  if (result?.kind === 'found')
    return (
      <ReplayBody
        replay={result.replay}
        meta={result.meta}
        onBack={onBack}
        now={now}
        padding={padding}
        testID={testID}
      />
    );

  return (
    <View style={[styles.root, padding]} testID={result ? `${testID}-${result.kind}` : `${testID}-loading`}>
      <ScreenHeader title={t('title')} onBack={onBack} style={styles.gutter} />
      <View style={styles.center}>
        {result === null ? (
          <>
            <Spinner color={color.textMuted} />
            <Text style={[text('body'), styles.muted]} accessibilityLiveRegion="polite">
              {t('loading')}
            </Text>
          </>
        ) : (
          <>
            <Icon
              name={result.kind === 'offline' ? 'wifiOff' : 'alert'}
              size={size.icon.nav}
              color={color.textMuted}
            />
            <Text style={[text('sheetTitle'), styles.strong, styles.centered]} accessibilityRole="header">
              {t(`load.${result.kind}`)}
            </Text>
            {result.kind === 'missing' ? null : (
              <Button
                label={t('load.retry')}
                icon="refresh"
                variant="secondary"
                size="md"
                onPress={() => setAttempt((a) => a + 1)}
                testID={`${testID}-retry`}
              />
            )}
          </>
        )}
      </View>
    </View>
  );
}

function ReplayBody({
  replay,
  meta,
  onBack,
  now,
  padding,
  testID,
}: {
  replay: Replay;
  meta: ReplayMeta;
  onBack: () => void;
  now: () => number;
  padding: { paddingTop: number; paddingBottom: number };
  testID: string;
}) {
  const { t, i18n } = useTranslation('replay');
  const { t: tg } = useTranslation('game');
  const { t: th } = useTranslation('history');
  const who = useWho();
  const { width } = useWindowDimensions();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'he';
  const [index, setIndex] = useState(0);
  const total = replay.steps.length;
  const go = useCallback((k: number) => setIndex(Math.max(0, Math.min(total - 1, k))), [total]);

  const sv = useMemo(() => stepView(replay, index, lang), [replay, index, lang]);
  const step = sv.step;
  const me = replay.players.find((p) => p.isMe) ?? null;
  const mySeat = me?.seat ?? null;
  const playerOf = (id: PlayerId | null) => replay.players.find((p) => p.id === id);

  const avatars = useMemo(() => Object.fromEntries(replay.players.map((p) => [p.id, p.avatar])), [replay]);
  const board = useMemo(() => {
    const model = boardModel(sv.view, mySeat, step.t, { avatars });
    // Read-only: no cell can be pressed in a replay.
    return { ...model, cells: model.cells.map((c) => ({ ...c, interactive: false, cooldown: false })) };
  }, [sv.view, mySeat, step.t, avatars]);
  const flashes = useMemo(() => flashesOf(step), [step]);
  const cards = useMemo(
    () => cardModels(sv.view, mySeat, step.t).map((c) => ({ ...c, mine: null, interference: null })),
    [sv.view, mySeat, step.t],
  );

  const gutter = tokens.layout.gutterGame;
  const side = Math.min(size.board, width - 2 * gutter);
  const clock = formatClock(step.clockMs);
  const day = dayOf(replay.startedAt, now());
  const subtitle = t('subtitle', {
    mode: t(`mode.${replay.mode}`),
    type: tg(`type.${replay.gameType}`),
    date: day ? th(`card.${day}`) : shortDate(replay.startedAt, lang),
  });

  const jump = (kind: MomentKind) => {
    const m = replay.keyMoments;
    const target =
      kind === 'bestMove'
        ? m.bestMove
        : kind === 'turningPoint'
          ? m.turningPoint
          : nextMoment(kind === 'mistakes' ? m.mistakes : m.interferences, index);
    if (target !== null) go(target);
  };

  return (
    <View style={[styles.root, { paddingTop: padding.paddingTop }]} testID={testID}>
      <ScreenHeader
        title={t('title')}
        subtitle={subtitle}
        onBack={onBack}
        style={styles.gutter}
        end={
          <Text
            style={[text('scoreSm'), styles.strong, styles.ltr]}
            accessibilityLabel={t('step.clockLabel', { clock })}
            testID={`${testID}-clock`}
          >
            {clock}
          </Text>
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}>
        <View style={[styles.cards, { gap: compactCardGap(cards.length) }]}>
          {cards.map((c) => {
            const p = playerOf(c.playerId);
            return (
              <PlayerCardCompact
                key={c.playerId}
                model={c}
                avatarId={p?.avatar ?? null}
                country={meta.countries[c.playerId] ?? null}
                width={compactCardWidth(Math.max(3, cards.length), c.isMe)}
                testID={`${testID}-card-${c.playerId}`}
              />
            );
          })}
        </View>

        <Text
          style={[text('label'), styles.strong, styles.centered]}
          accessibilityLiveRegion="polite"
          testID={`${testID}-narration`}
        >
          {narration(sv, replay, who, t)}
        </Text>

        <View style={styles.boardBox}>
          <Board model={board} width={side} flashes={flashes} testID={`${testID}-board`} />
        </View>

        <MomentChips moments={replay.keyMoments} onJump={jump} />

        <View style={styles.explanations}>
          <Text style={[text('label'), styles.muted]} accessibilityRole="header">
            {t('explain.title')}
          </Text>
          {sv.explanations.map((x) => (
            <ExplanationCard
              key={x.playerId}
              player={playerOf(x.playerId)!}
              explanation={x}
              testID={`${testID}-explain-${x.playerId}`}
            />
          ))}
        </View>
        {replay.complete ? null : (
          <Text style={[text('caption'), styles.muted, styles.centered]} testID={`${testID}-partial`}>
            {t('load.partial')}
          </Text>
        )}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: padding.paddingBottom, paddingHorizontal: gutter }]}>
        <Timeline
          total={total}
          index={index}
          dots={replay.timeline}
          valueText={t('nav.timelineValue', { number: index + 1, total, clock })}
          onSeek={go}
        />
        <Text style={[text('caption'), styles.muted, styles.centered]} testID={`${testID}-counter`}>
          {t('step.counter', { number: sv.number, total: sv.total })}
        </Text>
        <View style={styles.nav}>
          <StepButton
            direction="prev"
            disabled={index === 0}
            onPress={() => go(index - 1)}
            testID={`${testID}-prev`}
          />
          <StepButton
            direction="next"
            disabled={index >= total - 1}
            onPress={() => go(index + 1)}
            testID={`${testID}-next`}
          />
        </View>
      </View>
    </View>
  );
}

/** The step's cell flashes as it did in the game: right in the solver's colour, wrong in red. */
function flashesOf(step: ReplayStep): BoardFlash[] {
  if (step.cell === null) return [];
  if (step.kind === 'correct') return [{ cell: step.cell as CellIndex, kind: 'correct', id: step.index + 1 }];
  if (step.kind === 'wrong' && step.digit !== null)
    return [{ cell: step.cell as CellIndex, kind: 'wrong', id: step.index + 1, digit: step.digit }];
  return [];
}

type ReplayT = TFunction<'replay'>;

/** What happened at this step, in a line: "Moshe · נכון ב־D5 · +6". */
function narration(sv: StepView, replay: Replay, who: ReturnType<typeof useWho>, t: ReplayT): string {
  const s = sv.step;
  const player = replay.players.find((p) => p.id === s.playerId);
  const name = who(player);
  const cell = s.cell === null ? '' : ltr(cellName(s.cell));
  let line: string;
  switch (s.kind) {
    case 'start':
      line = t('narration.start');
      break;
    case 'select':
      line = t('narration.select', { name, cell });
      break;
    case 'correct':
      line = t('narration.correct', { name, cell, delta: signedText(s.points ?? 0) });
      break;
    case 'wrong':
      line = t('narration.wrong', { name, cell, delta: signedText(-(s.penalty ?? 0)) });
      break;
    case 'release':
      line =
        s.releaseReason === 'timeout'
          ? t('narration.release.timeout', { name, cell })
          : t('narration.release.cancel', { name, cell });
      break;
    case 'interference':
      line = t('narration.interference', {
        name,
        target: who(replay.players.find((p) => p.id === s.targetId)),
        delta: signedText(-(s.cost ?? 0)),
      });
      break;
    case 'surrender':
      line =
        replay.mode === 'ranked' ? t('narration.surrender', { name }) : t('narration.endPractice', { name });
      break;
    default:
      line = t(`narration.${s.kind}`, { name });
  }
  if (s.ends) return `${line} · ${t('narration.over')}`;
  if (sv.state.status === 'paused') return `${line} · ${t('narration.paused')}`;
  return line;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  gutter: { paddingHorizontal: tokens.layout.gutterGame },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[8],
    paddingHorizontal: space[10],
  },
  content: { gap: space[8], paddingTop: space[4], paddingBottom: space[10] },
  cards: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  boardBox: { alignItems: 'center' },
  explanations: { gap: space[4] },
  bottom: {
    gap: space[3],
    paddingTop: space[4],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  nav: { flexDirection: 'row', gap: space[4] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  centered: { textAlign: 'center' },
  ltr: { writingDirection: 'ltr' },
});
