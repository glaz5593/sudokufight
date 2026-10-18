import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  I18nManager,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Icon } from '../../components/Icon';
import { displayName, ltr, paletteAt, SeatGlyph, signedText } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import type { KeyMoments, PlayerExplanation, ReplayPlayer, TimelineDot } from './replayModel';

/**
 * The pieces of the replay screen (spec §13; Replay.dc.html): a player's explanation card, the timeline with
 * its dots, the step buttons and the key-moment chips. They draw what the replay model worked out; nothing is
 * decided here.
 */

/** "אני" for me, the name for anyone else (bots by their own name). */
export function useWho() {
  const { t } = useTranslation('replay');
  const { t: tp } = useTranslation('player');
  return (p: Pick<ReplayPlayer, 'name' | 'isBot' | 'isMe'> | undefined): string =>
    p === undefined ? t('unknown') : p.isMe ? t('me') : displayName(p, tp);
}

// ---------------------------------------------------------------------------------------------------------
// A player's explanation (spec §13.2)

const STATUS_COLOR = {
  choosing: color.info,
  released: color.textMuted,
  correct: color.success,
  wrong: color.danger,
} as const;

export function ExplanationCard({
  player,
  explanation: x,
  testID,
}: {
  player: ReplayPlayer;
  explanation: PlayerExplanation;
  testID?: string;
}) {
  const { t } = useTranslation('replay');
  const who = useWho()(player);
  const palette = paletteAt(player.colorIndex);
  const border = x.live ? { borderColor: palette.ring, borderWidth: tokens.border.focus } : null;

  if (x.status === 'none') {
    const title = player.isMe ? t('explain.noneMe') : t('explain.none', { name: who });
    return (
      <View
        style={[styles.card, border]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('explain.labelNone', { name: title, text: t('explain.noneBody') })}
        testID={testID}
      >
        <Head player={player} name={who} />
        <Text style={[text('label'), styles.strong]}>{title}</Text>
        <Text style={[text('caption'), styles.muted]}>{t('explain.noneBody')}</Text>
      </View>
    );
  }

  const statusWord =
    x.status === 'released' && x.releaseReason
      ? t(`explain.released.${x.releaseReason}`)
      : t(`explain.status.${x.status}`);
  const chip =
    x.status === 'correct' && x.points !== null
      ? `${statusWord} ${signedText(x.points)}`
      : x.status === 'wrong' && x.penalty !== null
        ? `${statusWord} ${signedText(-x.penalty)}`
        : statusWord;
  const move = ltr(t('explain.move', { cell: x.cellName, digit: x.answer ?? '?' }));
  const body = x.text ?? t('explain.noLogic', { cell: x.cellName, digit: x.answer ?? '?' });
  const why = x.wrongText ? t('explain.why', { digit: x.played, text: x.wrongText }) : null;
  const label = [
    t('explain.label', {
      name: who,
      status: chip,
      move,
      technique: x.techniqueName ?? '',
      text: body,
    }),
    x.status === 'wrong' ? t('explain.played', { digit: x.played, answer: x.answer }) : null,
    why,
    x.scoreLine ? `${t('explain.scoreLine')}: ${ltr(x.scoreLine)}` : null,
    x.penaltyLine ? `${t('explain.penaltyLine')}: ${ltr(x.penaltyLine)}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View
      style={[styles.card, border]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <Head player={player} name={who}>
        <View style={[styles.chip, { borderColor: STATUS_COLOR[x.status] }]}>
          <Text
            style={[text('badge'), { color: STATUS_COLOR[x.status] }]}
            testID={testID && `${testID}-status`}
          >
            {chip}
          </Text>
        </View>
      </Head>
      <View style={styles.moveRow}>
        <Text style={[text('cellRef'), styles.strong]} testID={testID && `${testID}-move`}>
          {move}
        </Text>
        {x.techniqueName ? (
          <Text
            style={[text('caption'), styles.accent]}
            numberOfLines={1}
            testID={testID && `${testID}-technique`}
          >
            {x.techniqueName}
          </Text>
        ) : null}
      </View>
      {x.status === 'wrong' ? (
        <Text style={[text('caption'), styles.danger]}>
          {t('explain.played', { digit: x.played, answer: x.answer })}
        </Text>
      ) : null}
      <Text style={[text('body'), styles.strong]} testID={testID && `${testID}-text`}>
        {body}
      </Text>
      {why ? <Text style={[text('caption'), styles.muted]}>{why}</Text> : null}
      {x.scoreLine ? (
        <View style={styles.formula}>
          <Text style={[text('micro'), styles.muted]}>{t('explain.scoreLine')}</Text>
          <Text style={[text('label'), styles.strong, styles.ltr]} testID={testID && `${testID}-score`}>
            {ltr(x.scoreLine)}
          </Text>
        </View>
      ) : null}
      {x.penaltyLine ? (
        <View style={styles.formula}>
          <Text style={[text('micro'), styles.muted]}>{t('explain.penaltyLine')}</Text>
          <Text style={[text('label'), styles.strong, styles.ltr]} testID={testID && `${testID}-penalty`}>
            {ltr(x.penaltyLine)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Head({ player, name, children }: { player: ReplayPlayer; name: string; children?: ReactNode }) {
  return (
    <View style={styles.head}>
      <SeatGlyph colorIndex={player.colorIndex} size={size.icon.inline} />
      <Text style={[text('playerName'), styles.strong, styles.name]} numberOfLines={1}>
        {name}
      </Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------
// The timeline (spec §13.1: dots in the players' colours for right, wrong and interference)

export interface TimelineProps {
  total: number;
  /** 0-based. */
  index: number;
  dots: readonly TimelineDot[];
  /** "שלב 7 מתוך 94, 1:12" for screen readers. */
  valueText: string;
  onSeek: (index: number) => void;
  testID?: string;
}

const DOT = { correct: space[5], wrong: space[5], interference: space[6] } as const;
const TRACK = space[2];
const THUMB = space[8];

/**
 * A bar from the first step to the last, in reading order (from the right in Hebrew). A tap or a drag picks
 * a step; for screen readers it is an adjustable control (swipe up / down for the next / previous step).
 */
export function Timeline({
  total,
  index,
  dots,
  valueText,
  onSeek,
  testID = 'replay-timeline',
}: TimelineProps) {
  const { t } = useTranslation('replay');
  const [width, setWidth] = useState(0);
  const fractionOf = (i: number) => (total <= 1 ? 0 : i / (total - 1));

  const seekAt = (e: GestureResponderEvent) => {
    if (width <= 0 || total <= 1) return;
    const x = Math.max(0, Math.min(width, e.nativeEvent.locationX));
    const f = I18nManager.isRTL ? 1 - x / width : x / width;
    const next = Math.round(f * (total - 1));
    if (next !== index) onSeek(next);
  };
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') onSeek(Math.min(total - 1, index + 1));
    if (e.nativeEvent.actionName === 'decrement') onSeek(Math.max(0, index - 1));
  };

  return (
    <View
      style={styles.timeline}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={seekAt}
      onResponderMove={seekAt}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={t('nav.timeline')}
      accessibilityHint={t('nav.timelineHint')}
      accessibilityValue={{ min: 1, max: total, now: index + 1, text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      testID={testID}
    >
      <View style={styles.track} pointerEvents="none" />
      <View
        style={[styles.fill, { width: `${fractionOf(index) * 100}%` }]}
        pointerEvents="none"
        testID={`${testID}-fill`}
      />
      {dots.map((d) => {
        const dot = DOT[d.kind];
        const palette = paletteAt(d.colorIndex);
        return (
          <View
            key={d.step}
            pointerEvents="none"
            style={[
              styles.dot,
              {
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                marginStart: -dot / 2,
                start: `${fractionOf(d.step) * 100}%`,
                backgroundColor: palette.ring,
                borderColor:
                  d.kind === 'correct' ? color.success : d.kind === 'wrong' ? color.danger : color.bg,
                opacity: d.step <= index ? 1 : 0.4,
              },
            ]}
            testID={`${testID}-dot-${d.kind}`}
          />
        );
      })}
      <View
        pointerEvents="none"
        style={[styles.thumb, { start: `${fractionOf(index) * 100}%` }]}
        testID={`${testID}-thumb`}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------
// The step buttons (spec §13.1: "◀ שלב קודם | שלב הבא ▶")

export function StepButton({
  direction,
  disabled,
  onPress,
  testID,
}: {
  direction: 'prev' | 'next';
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { t } = useTranslation('replay');
  const label = direction === 'prev' ? t('nav.prev') : t('nav.next');
  const icon = (
    <View style={direction === 'prev' ? styles.flip : null}>
      <Icon name="chevronForward" size={size.icon.card} color={disabled ? color.textFaint : color.text} />
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && !disabled ? styles.pressed : null]}
      testID={testID}
    >
      {direction === 'prev' ? icon : null}
      <Text style={[text('button'), disabled ? styles.faint : styles.strong]} numberOfLines={1}>
        {label}
      </Text>
      {direction === 'next' ? icon : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Key moments (spec §13.1: best move, mistakes, interferences, the turning point)

export type MomentKind = 'bestMove' | 'mistakes' | 'interferences' | 'turningPoint';

export function MomentChips({
  moments,
  onJump,
}: {
  moments: KeyMoments;
  onJump: (kind: MomentKind) => void;
}) {
  const { t } = useTranslation('replay');
  const chips: { kind: MomentKind; label: string }[] = [];
  if (moments.bestMove !== null) chips.push({ kind: 'bestMove', label: t('moments.bestMove') });
  if (moments.mistakes.length)
    chips.push({ kind: 'mistakes', label: t('moments.mistakes', { count: moments.mistakes.length }) });
  if (moments.interferences.length)
    chips.push({
      kind: 'interferences',
      label: t('moments.interferences', { count: moments.interferences.length }),
    });
  if (moments.turningPoint !== null) chips.push({ kind: 'turningPoint', label: t('moments.turningPoint') });
  if (!chips.length) return null;
  return (
    <View style={styles.moments} testID="replay-moments">
      <Text style={[text('label'), styles.muted]} accessibilityRole="header">
        {t('moments.title')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c.kind}
            accessibilityRole="button"
            accessibilityLabel={c.label}
            accessibilityHint={t('moments.hint')}
            onPress={() => onJump(c.kind)}
            style={({ pressed }) => [styles.momentChip, pressed ? styles.pressed : null]}
            testID={`replay-moment-${c.kind}`}
          >
            <Text style={[text('buttonSm'), styles.strong]} numberOfLines={1}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[3],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  name: { flex: 1, minWidth: 0 },
  chip: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
  },
  moveRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[5], flexWrap: 'wrap' },
  formula: { gap: space[1] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  faint: { color: color.textFaint },
  accent: { color: color.accent },
  danger: { color: color.danger },
  ltr: { writingDirection: 'ltr' },
  flip: { transform: [{ scaleX: -1 }] },
  timeline: { height: size.touch, justifyContent: 'center' },
  track: {
    position: 'absolute',
    start: 0,
    end: 0,
    height: TRACK,
    borderRadius: radius.bar,
    backgroundColor: color.surface2,
  },
  fill: {
    position: 'absolute',
    start: 0,
    height: TRACK,
    borderRadius: radius.bar,
    backgroundColor: color.accent,
  },
  dot: { position: 'absolute', borderWidth: tokens.border.hairline },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginStart: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: color.text,
    borderWidth: tokens.border.focus,
    borderColor: color.accent,
  },
  stepButton: {
    flex: 1,
    minHeight: size.buttonMd,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  pressed: { backgroundColor: color.pressedOverlay },
  moments: { gap: space[3] },
  chips: { gap: space[4], paddingEnd: space[4] },
  momentChip: {
    minHeight: size.touch,
    justifyContent: 'center',
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
});
