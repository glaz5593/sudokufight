import type { GameType } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useReadyFace } from '../../../avatars/useFaces';
import { Icon } from '../../../components/Icon';
import { Avatar } from '../../../components/player/Avatar';
import { Flag } from '../../../components/player/Flag';
import { formatScore, ltr } from '../../../components/player/format';
import { SeatGlyph } from '../../../components/player/SeatGlyph';
import { Button } from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { isolateName } from '../hit/hitModel';
import { Announcer } from './Announcer';
import { CONNECTING_STEPS, type ConnectingModel } from './connectionModel';
import {
  LAST_CELL_POINTS,
  type LoadingPlayer,
  type LoadingTip,
  type MatchLoading,
  TOP_MOVE_POINTS,
} from './loadingModel';
import { metrics } from './metrics';
import { useTick } from './motion';

export interface ConnectingViewProps {
  model: ConnectingModel;
  /**
   * A ranked match's room (./loadingModel): the players with their ratings and who is ready, the tag, a small
   * board, the percent and a tip. Null (a room by code): the steps alone.
   */
  match?: MatchLoading | null;
  /** "ביטול": stop joining. Left out, there is no button. */
  onCancel?: () => void;
  testID?: string;
}

/**
 * Entering an online game (design Loading, its game card in C's look): "בכניסה למשחק" over a card titled "טוען
 * לוח…", the progress as three step marks across the card, and under it a small spinner with the step
 * ("מתחבר לשרת המשחק…", "נכנס לחדר…", "מסנכרן ניקוד וטיימרים…"). One progress bar for screen readers ("טעינת
 * המשחק, שלב 2 מתוך 3"), and each step is announced. Reduced motion: the spinner stands still and the step text
 * only fades.
 *
 * A ranked match's room (`match`: a rejoin after a lost connection) adds what the design shows: the tag
 * "מדורג · רגיל", every player with avatar, shape, flag and rating, "מוכן!" under each one who is in, a small
 * board (still: the real one is on its way), the percent next to the step, and a tip under the card. Each
 * player and the tip is one element for screen readers.
 */
export function ConnectingView({
  model,
  match = null,
  onCancel,
  testID = 'connecting',
}: ConnectingViewProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const index = CONNECTING_STEPS.indexOf(model.step);
  const step = t(`connection.connecting.step.${model.step}`);
  const tick = useTick(index, reduce);
  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.column}>
        <Text style={styles.title}>{t('connection.connecting.title')}</Text>
        <View style={styles.card} testID={`${testID}-card`}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('connection.connecting.label', {
              step: index + 1,
              total: CONNECTING_STEPS.length,
            })}
            accessibilityValue={{ min: 1, max: CONNECTING_STEPS.length, now: index + 1, text: step }}
            style={styles.progress}
            testID={`${testID}-progress`}
          >
            <View style={styles.headRow}>
              <Text style={styles.board} testID={`${testID}-board`}>
                {t('connection.connecting.board')}
              </Text>
              {match ? (
                <Text style={styles.tag} numberOfLines={1} testID={`${testID}-tag`}>
                  {t('connection.connecting.tag', { type: t(`type.${match.gameType}`) })}
                </Text>
              ) : null}
            </View>
            <View style={styles.marks}>
              {CONNECTING_STEPS.map((s, k) => (
                <View
                  key={s}
                  style={[styles.mark, k < index && styles.markDone, k === index && styles.markNow]}
                  testID={`${testID}-mark-${s}`}
                />
              ))}
            </View>
            <View style={styles.stepRow}>
              <Spinner color={color.accent} size={size.icon.inline} stroke={tokens.border.lockRing} />
              <Animated.Text style={[styles.step, tick]} numberOfLines={2} testID={`${testID}-step`}>
                {step}
              </Animated.Text>
              {match ? (
                <Text style={styles.percent} testID={`${testID}-percent`}>
                  {ltr(`${match.percent}%`)}
                </Text>
              ) : null}
            </View>
          </View>
          {match ? (
            <View style={styles.table}>
              <View style={styles.players}>
                {match.players.map((p) => (
                  <PlayerChip key={p.id} player={p} testID={`${testID}-player-${p.id}`} />
                ))}
              </View>
              <MiniBoard testID={`${testID}-mini-board`} />
            </View>
          ) : null}
        </View>
        {match ? <TipCard tip={match.tip} gameType={match.gameType} testID={`${testID}-tip`} /> : null}
      </View>
      {onCancel ? (
        <Button
          label={t('connection.connecting.cancel')}
          onPress={onCancel}
          variant="ghost"
          style={styles.cancel}
          testID={`${testID}-cancel`}
        />
      ) : null}
      <Announcer line={step} testID={`${testID}-live`} />
    </View>
  );
}

/** A player at the table: avatar in their colour, shape, name, flag, rating, and "מוכן!" once in the room. */
function PlayerChip({ player: p, testID }: { player: LoadingPlayer; testID: string }) {
  const { t } = useTranslation('game');
  const name = p.isMe ? t('me') : p.name;
  const rating =
    p.rating === null
      ? null
      : p.provisional
        ? t('player:rating.provisionalLabel', {
            label: t('connection.connecting.rating', { rating: Math.round(p.rating) }),
          })
        : t('connection.connecting.rating', { rating: Math.round(p.rating) });
  const state = p.ready ? t('connection.connecting.ready') : t('connection.connecting.joining');
  // In the room: a smile (and a nod as it turns ready).
  const face = useReadyFace(p.ready);
  return (
    <View
      style={styles.chip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={[p.isMe ? name : isolateName(name), rating, state]
        .filter(Boolean)
        .join(t('player:listSep'))}
      testID={testID}
    >
      <Avatar
        avatarId={p.avatarId}
        size="compact"
        colorIndex={p.colorIndex}
        backdrop={color.surface}
        expression={face.expression}
        reaction={face.reaction}
        testID={`${testID}-avatar`}
      />
      <View style={styles.nameRow}>
        <SeatGlyph colorIndex={p.colorIndex} size={space[5]} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Flag country={p.country} size="compact" decorative />
      </View>
      {p.rating !== null ? <Text style={styles.rating}>{Math.round(p.rating)}</Text> : null}
      <Text style={[styles.state, p.ready && styles.ready]} testID={`${testID}-state`}>
        {state}
      </Text>
    </View>
  );
}

/** Rows (and columns) of the small board: 9, in 3 boxes. */
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * The small board of the design, empty: the game's board is on its way (a ranked board is never on the phone
 * before its game, spec §21). Still in every motion setting, so nothing to reduce. Decorative.
 */
function MiniBoard({ testID }: { testID: string }) {
  return (
    <View
      style={styles.mini}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {CELLS.map((r) => (
        <View key={r} style={[styles.miniRow, r % 3 === 2 && r < 8 && styles.miniBoxEnd]}>
          {CELLS.map((c) => (
            <View
              key={c}
              style={[
                styles.miniCell,
                (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 1 && styles.miniCellAlt,
                c % 3 === 2 && c < 8 && styles.miniColEnd,
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** The tip; its best move is the one of this game's type (the boards differ in their givens). */
function TipCard({ tip, gameType, testID }: { tip: LoadingTip; gameType: GameType; testID: string }) {
  const { t } = useTranslation('game');
  const body = t(`connection.connecting.tips.${tip}`, {
    max: formatScore(TOP_MOVE_POINTS[gameType]),
    points: formatScore(LAST_CELL_POINTS),
  });
  const title = t('connection.connecting.tipTitle');
  return (
    <View
      style={styles.tip}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${title}: ${body}`}
      testID={testID}
    >
      <View style={styles.tipHead}>
        <Icon name="star" size={size.icon.inline - space[2]} color={color.accent} />
        <Text style={styles.tipTitle}>{title}</Text>
      </View>
      <Text style={styles.tipBody} testID={`${testID}-text`}>
        {body}
      </Text>
    </View>
  );
}

/** The small board's cells (the design's 108 board: 12 a cell), from the spacing scale. */
const MINI_CELL = space[6];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[10],
    paddingHorizontal: tokens.layout.gutterHome,
    backgroundColor: color.bg,
  },
  column: { alignSelf: 'stretch', alignItems: 'center', gap: space[4] },
  title: { ...text('label'), color: color.textMuted },
  card: {
    alignSelf: 'stretch',
    gap: space[6],
    padding: space[8],
    borderRadius: radius.xxl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  progress: { gap: space[6] },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[4] },
  board: { ...text('h1'), color: color.text, flexShrink: 1 },
  tag: {
    ...text('micro'),
    color: color.accent,
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.accentSubtle,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  step: { ...text('label'), color: color.text, flexShrink: 1, flexGrow: 1 },
  percent: { ...text('scoreSm'), color: color.accent },
  marks: { flexDirection: 'row', gap: space[2] },
  mark: {
    flex: 1,
    height: metrics.dot.size,
    borderRadius: radius.bar,
    backgroundColor: color.border,
  },
  markDone: { backgroundColor: color.textMuted },
  markNow: { backgroundColor: color.accent },
  table: { alignItems: 'center', gap: space[6] },
  players: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space[4],
  },
  chip: { flexBasis: '22%', flexGrow: 1, minWidth: 0, alignItems: 'center', gap: space[2] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  name: { ...text('label'), color: color.text, flexShrink: 1 },
  rating: { ...text('scoreSm'), color: color.text },
  state: { ...text('micro'), color: color.textMuted },
  ready: { color: color.success },
  mini: {
    padding: space[1],
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  miniRow: { flexDirection: 'row' },
  miniBoxEnd: { marginBottom: space[1] },
  miniCell: {
    width: MINI_CELL,
    height: MINI_CELL,
    borderWidth: tokens.border.hairline / 2,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  miniCellAlt: { backgroundColor: color.bg },
  miniColEnd: { marginEnd: space[1] },
  tip: {
    alignSelf: 'stretch',
    gap: space[2],
    padding: space[6],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  tipTitle: { ...text('micro'), color: color.accent },
  tipBody: { ...text('caption'), color: color.textMuted },
  cancel: { alignSelf: 'center' },
});
