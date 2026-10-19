import { type AppLevel, botLevel, type BotLevelId, type GateState, type Stars } from '@sudoku-fight/engine';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { normalizeAvatarId } from '../../avatars';
import { Icon, type IconName } from '../../components/Icon';
import { BossBadge } from '../../components/levels/BossBadge';
import { MiniBar } from '../../components/levels/MiniBar';
import { Star, StarRow, STAR_SIZES } from '../../components/levels/StarRow';
import { Avatar, SeatGlyph } from '../../components/player';
import { ltr, withAlpha } from '../../components/player/format';
import { Button } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { KIND_ICON } from './LevelNode';
import {
  bestText,
  botNameOf,
  chapterName,
  goalText,
  kindName,
  type LevelsT,
  scaleRows,
  spotsOf,
  starsOf3,
} from './levelWording';
import type { NodeInfo } from './mapModel';

/**
 * The docked bottom panel of the map (components.md §19.4, D60; the Main board), in place of an opening sheet
 * (sheets over the map were part of the black screen): what is chosen on the map. For a stage: "שלב 37 · …",
 * its chapter (or its bot), the goal in one sentence, the star scale, the bot (avatar with ▲, name and level)
 * when it has one, my best ("★★ · שיא 7.6 ש׳") or "השלב הבא", and the gold button: "המשך · שלב 37" for the
 * current stage, "שחק" for another open one. For a locked stage or a gate: why, and the button goes on with
 * the current stage. Changes are said politely to a screen reader.
 */

export type PanelSelection =
  | {
      kind: 'level';
      level: AppLevel;
      info: NodeInfo;
      /** My stored best measure (LEVEL_METRIC), or null. */
      bestMetric: number | null;
      /** Why it is locked, when it is: the stage before, or the gate in front of its chapter. */
      lockedBy?: { kind: 'previous'; n: number } | { kind: 'gate'; gate: GateState };
    }
  | { kind: 'gate'; chapter: number; gate: GateState };

export interface LevelPanelProps {
  selection: PanelSelection;
  /** The stage to go on with (the button of a locked stage or a gate). */
  current: number;
  onPlay: (n: number) => void;
  bottomInset: number;
}

/** The icon circle's tones (the Main board): neutral, the bot's, gold. */
type Tone = 'neutral' | 'bot' | 'gold';

export function LevelPanel({ selection, current, onPlay, bottomInset }: LevelPanelProps) {
  const { t } = useTranslation('levels');
  return (
    <View
      style={[styles.panel, { paddingBottom: space[8] + bottomInset }]}
      accessibilityLabel={t('panel.label')}
      accessibilityLiveRegion="polite"
      testID="level-panel"
    >
      {selection.kind === 'gate' ? (
        <GateBody selection={selection} t={t} />
      ) : (
        <LevelBody selection={selection} t={t} />
      )}
      <Cta selection={selection} current={current} onPlay={onPlay} t={t} />
    </View>
  );
}

function Cta({
  selection,
  current,
  onPlay,
  t,
}: Pick<LevelPanelProps, 'selection' | 'current' | 'onPlay'> & { t: LevelsT }) {
  const own = selection.kind === 'level' && selection.info.state !== 'locked' ? selection.info.n : null;
  const n = own ?? current;
  const label = own !== null && own !== current ? t('panel.play') : t('panel.continue', { n });
  return (
    <Button
      label={label}
      size="md"
      onPress={() => onPlay(n)}
      accessibilityHint={own !== null && own !== current ? t('stage', { n }) : undefined}
      style={styles.cta}
      testID="level-panel-play"
    />
  );
}

function Head({
  icon,
  tone,
  title,
  sub,
  end,
}: {
  icon: IconName;
  tone: Tone;
  title: string;
  sub: string;
  end?: ReactNode;
}) {
  const tint = tone === 'bot' ? color.players[1]!.ring : tone === 'gold' ? color.accent : color.textMuted;
  const ground = tone === 'bot' ? BOT_GROUND : tone === 'gold' ? color.accentSubtle : color.iconBg.info;
  return (
    <View style={styles.head}>
      <View style={[styles.iconCircle, { backgroundColor: ground }]}>
        <Icon name={icon} size={size.icon.card} color={tint} />
      </View>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1} testID="level-panel-title">
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1} testID="level-panel-sub">
          {sub}
        </Text>
      </View>
      {end}
    </View>
  );
}

function LevelBody({ selection, t }: { selection: Extract<PanelSelection, { kind: 'level' }>; t: LevelsT }) {
  const { level, info, bestMetric, lockedBy } = selection;
  const bot = botNameOf(level);
  if (info.state === 'locked') {
    let reason: string;
    if (lockedBy?.kind === 'gate')
      reason = t('panel.lockedGate', {
        chapter: level.chapter,
        prev: level.chapter - 1,
        need: lockedBy.gate.need,
        stars: lockedBy.gate.stars,
      });
    else reason = t('panel.lockedPrev', { n: lockedBy?.kind === 'previous' ? lockedBy.n : info.n - 1 });
    return (
      <>
        <Head
          icon="lock"
          tone="neutral"
          title={t('panel.lockedTitle', { n: info.n })}
          sub={t('panel.lockedSub', { chapter: level.chapter, kind: kindName(level, t) })}
        />
        <View style={styles.goalRow}>
          <Icon name="lock" size={space[7]} color={color.textMuted} />
          <Text style={[styles.goal, styles.strong]} testID="level-panel-goal">
            {reason}
          </Text>
        </View>
        <ScaleCells level={level} t={t} />
      </>
    );
  }
  const sub = level.boss
    ? t('panel.subBoss', { chapter: level.chapter, bot: bot ?? t('boss.name') })
    : bot
      ? t('panel.subBot', { chapter: level.chapter, bot })
      : t('panel.sub', { chapter: level.chapter, name: chapterName(level.chapter, t) });
  const played = info.state === 'played' || (info.state === 'current' && info.stars > 0);
  const end =
    info.state === 'current' && !played ? (
      <View style={styles.nextChip} testID="level-panel-next">
        <Text style={styles.nextText}>{t('panel.next')}</Text>
      </View>
    ) : played ? (
      <Best level={level} stars={info.stars} metric={bestMetric} t={t} />
    ) : undefined;
  return (
    <>
      <Head
        icon={level.boss ? 'crown' : KIND_ICON[level.kind]}
        tone={level.boss ? 'gold' : bot ? 'bot' : 'neutral'}
        title={t('panel.title', { n: info.n, kind: kindName(level, t) })}
        sub={sub}
        end={end}
      />
      {level.boss ? <BossBadge /> : null}
      <Text style={styles.goal} testID="level-panel-goal">
        {goalText(level, t)}
      </Text>
      <ScaleCells level={level} t={t} />
      {level.bot ? <BotLine level={level} /> : null}
    </>
  );
}

/** My best: the stars and the measure ("★★ · שיא 7.6 ש׳"). */
function Best({
  level,
  stars,
  metric,
  t,
}: {
  level: AppLevel;
  stars: Stars;
  metric: number | null;
  t: LevelsT;
}) {
  const words = metric === null ? null : bestText(level, metric, t);
  return (
    <View
      style={styles.best}
      accessible
      accessibilityLabel={
        words
          ? t('panel.bestLabel', { stars: starsOf3(stars, t), metric: words })
          : t('panel.bestStars', { stars: starsOf3(stars, t) })
      }
      testID="level-panel-best"
    >
      <StarRow stars={stars} size={STAR_SIZES.panel} label={null} testID="level-panel-best-stars" />
      {words ? (
        <Text style={styles.bestText} numberOfLines={1}>
          {t('panel.best', { metric: words })}
        </Text>
      ) : null}
    </View>
  );
}

/** The bot of a stage against one: its avatar with ▲, its name and level ("Pip · רמה 1 · טירון"). */
function BotLine({ level }: { level: AppLevel }) {
  const { t } = useTranslation('levels');
  const { t: th } = useTranslation('home');
  if (!level.bot) return null;
  const bot = botLevel(level.bot.level as BotLevelId);
  const line = t('panel.bot', {
    name: bot.name,
    level: bot.level,
    title: th(`botSelect.levels.${bot.level}.title`),
  });
  return (
    <View style={styles.botLine} accessible accessibilityLabel={line} testID="level-panel-bot">
      <Avatar avatarId={normalizeAvatarId(bot.avatar)} size="cell" colorIndex={1} bot />
      <SeatGlyph colorIndex={1} size={space[6]} />
      <Text style={styles.botText} numberOfLines={1}>
        {line}
      </Text>
    </View>
  );
}

/**
 * The star scale in three cells, ★★★ first (the Main board's "כמה כוכבים אפשר לקבל"): "עד 5 ש׳", "4–5
 * מקומות", "פער 15 ומעלה". "מוכן?" shows the same.
 */
export function ScaleCells({
  level,
  t,
  testID = 'level-scale',
}: {
  level: AppLevel;
  t: LevelsT;
  testID?: string;
}) {
  const rows = scaleRows(level.stars, t, spotsOf(level));
  return (
    <View style={styles.scale} accessibilityRole="list" accessibilityLabel={t('scale.label')} testID={testID}>
      {rows.map((r, i) => (
        <View
          key={r.stars}
          style={[styles.cell, i > 0 && styles.cellDivided]}
          accessible
          accessibilityLabel={r.label}
          testID={`${testID}-${r.stars}`}
        >
          <View style={styles.cellStars}>
            {Array.from({ length: r.stars }, (_, k) => (
              <Star key={k} filled size={STAR_SIZES.chip} />
            ))}
          </View>
          <Text style={styles.cellText} numberOfLines={1}>
            {r.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

function GateBody({ selection, t }: { selection: Extract<PanelSelection, { kind: 'gate' }>; t: LevelsT }) {
  const { chapter, gate } = selection;
  const first = (chapter - 1) * 10 + 1;
  const values = { n: chapter, prev: chapter - 1, stars: gate.stars, need: gate.need };
  const have = Math.min(gate.need, gate.stars);
  return (
    <>
      <Head
        icon={gate.open ? 'unlock' : 'lock'}
        tone="neutral"
        title={t(gate.open ? 'panel.gateTitleOpen' : 'panel.gateTitleClosed', { n: chapter })}
        sub={t('panel.gateSub', { name: chapterName(chapter, t), range: ltr(`${first}–${first + 9}`) })}
      />
      <View style={styles.goalRow}>
        {gate.open ? null : <Icon name="lock" size={space[7]} color={color.textMuted} />}
        <Text style={[styles.goal, !gate.open && styles.strong]} testID="level-panel-goal">
          {gate.open
            ? t('panel.gateOpenBody', values)
            : t('gateSheet.missing', { ...values, missing: Math.max(0, gate.need - gate.stars) })}
        </Text>
      </View>
      <View
        style={styles.gateBar}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('panel.gateBar', { stars: have, need: gate.need })}
      >
        <View style={styles.flex}>
          <MiniBar share={have / gate.need} height={GATE_BAR} />
        </View>
        <Star filled size={STAR_SIZES.panel} />
        <Text style={styles.gateCount}>{ltr(t('gate.count', { stars: have, need: gate.need }))}</Text>
      </View>
    </>
  );
}

const ICON_CIRCLE = 40;
/** The bot's tone: its P2 ring at 16 %, as the icon backgrounds of the theme. */
const BOT_GROUND = withAlpha(color.players[1]!.ring, 0.16);
const NEXT_CHIP = 22;
const SCALE_HEIGHT = 44;
const GATE_BAR = 6;

const styles = StyleSheet.create({
  panel: {
    gap: space[4],
    paddingTop: space[6],
    paddingHorizontal: tokens.layout.gutterGame,
    backgroundColor: color.surface,
    borderTopWidth: tokens.border.hairline,
    borderColor: color.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[6], minHeight: ICON_CIRCLE },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  title: { ...text('playerName'), color: color.text },
  sub: { ...text('caption'), color: color.textMuted },
  nextChip: {
    height: NEXT_CHIP,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    justifyContent: 'center',
  },
  nextText: { ...text('badge'), color: color.accent },
  best: { alignItems: 'flex-end', gap: space[3] },
  bestText: { ...text('micro'), color: color.textMuted },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  goal: { ...text('body'), color: color.textMuted, flexShrink: 1 },
  strong: { color: color.text },
  scale: {
    flexDirection: 'row',
    height: SCALE_HEIGHT,
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
    overflow: 'hidden',
  },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: space[2] },
  cellDivided: { borderStartWidth: tokens.border.hairline, borderColor: color.border },
  cellStars: { flexDirection: 'row', gap: space[1] },
  cellText: { ...text('label'), color: color.text },
  botLine: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  botText: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  gateBar: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.touch },
  flex: { flex: 1 },
  gateCount: { ...text('scoreDelta'), color: color.text },
  cta: { marginTop: space[2] },
});
