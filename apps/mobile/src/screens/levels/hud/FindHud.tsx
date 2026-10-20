import {
  type AppLevel,
  type Digit,
  type FindScope,
  type LevelView,
  levelNumber,
  ROW_LETTERS,
} from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { BossBand } from '../../../components/levels/BossBadge';
import { LevelTile } from '../../../components/levels/LevelTile';
import { StarsBar } from '../../../components/levels/StarsBar';
import { secondsOf, signedText } from '../../../components/player/format';
import { TimerRing } from '../../../components/player/TimerRing';
import { IconButton } from '../../../components/ui';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { secondsText } from '../../home/homeModel';
import { findSub, kindName, type LevelsT } from '../levelWording';

/**
 * A find stage's HUD (components.md §19.7, the Lv-Find board): over the board, the stage's header (its number,
 * its kind and chapter, the boss's mark, the X) and the star scale of its 20 s; under the board, in the place
 * of the keypad, the target: the big digit inside a ring that drains the stage's time, "הקש איפה ה־6 חייב
 * להיות", where (its area), the time so far, and the tap's two rules. Every number comes from the engine's view
 * (GameView.level); this file only draws it.
 */

/** "בריבוע 5", "בשורה D", "בעמודה 3", "בכל הלוח" (a scope is 0-based; the board says 1–9 and A–I). */
export function scopeText(scope: FindScope, t: LevelsT): string {
  switch (scope.kind) {
    case 'box':
      return t('hud.scope.box', { n: scope.index + 1 });
    case 'row':
      return t('hud.scope.row', { row: ROW_LETTERS[scope.index] ?? '' });
    case 'col':
      return t('hud.scope.col', { n: scope.index + 1 });
    case 'board':
      return t('hud.scope.board');
  }
}

/**
 * The stage's clock at `now`: from the engine's deadline while it runs (the view is read on each update, the
 * clock moves between them), as the view gives it while it stands still (frozen, over).
 */
export function levelClock(view: LevelView, now: number): { elapsedMs: number; remainingMs: number } {
  const limit = view.limitMs;
  if (view.endsAt === null || limit === null)
    return { elapsedMs: view.elapsedMs, remainingMs: view.remainingMs ?? 0 };
  const remainingMs = Math.max(0, Math.min(limit, view.endsAt - now));
  return { elapsedMs: limit - remainingMs, remainingMs };
}

export interface StageHeaderProps {
  level: AppLevel;
  /** The line under the title; by default "{kind} · פרק {chapter}". */
  sub?: string;
  /** The X: "לצאת מהשלב?". Absent: no X (a picture of the stage). */
  onExit?: () => void;
  /** Beside the X (a fill-box's clock). */
  end?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * "שלב 8" over "פאזל · פרק 3" (find: "איפה ה־6? · פרק 1", its `sub`), and the X at the end (Lv-Find, Lv-Box). A
 * boss stage (levels-ui.md §3.2, D77) has the boss band over it, "👑 בוס · פרק 3" (BossBand, in place of 1.0.2's
 * small chip; testID `stage-boss`), and its tile with the crown (LevelTile's boss state; no arena corners here:
 * the band says it, and the board has its own, BossFrame). All static.
 */
export function StageHeader({ level, sub, onExit, end, style }: StageHeaderProps) {
  const { t } = useTranslation('levels');
  const n = levelNumber(level.id) ?? 0;
  const row = (
    <View style={[styles.header, level.boss ? null : style]} testID="stage-header">
      {level.boss ? (
        <LevelTile n={n} size={TILE} state="current" boss arena={false} testID="stage-tile" />
      ) : null}
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1} testID="stage-title">
          {t('stage', { n })}
        </Text>
        <Text style={styles.sub} numberOfLines={1} testID="stage-sub">
          {sub ?? t('hud.sub', { kind: kindName(level, t), chapter: level.chapter })}
        </Text>
      </View>
      {end}
      {onExit ? (
        <IconButton
          icon="close"
          iconSize="header"
          accessibilityLabel={t('exit.button')}
          onPress={onExit}
          testID="stage-exit"
        />
      ) : null}
    </View>
  );
  if (!level.boss) return row;
  return (
    <View style={[styles.bossHeader, style]}>
      <BossBand chapter={level.chapter} testID="stage-boss" />
      {row}
    </View>
  );
}

export interface FindHudProps {
  /** The stage as played (its board is the attempt's). */
  level: AppLevel;
  /** GameView.level of the tap engine. */
  view: LevelView;
  /** The stage's time now. */
  now: number;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Over the board: the header and the star scale, 0–20 s, filling with the stage's clock (left to right). The
 * header's line asks "איפה ה־6? · פרק 1" with the digit of the board being played (the view's), never the stored
 * stage's [D79]: "שוב" relabels the digits [D63].
 */
export function FindHud({ level, view, now, onExit, style }: FindHudProps) {
  const { t } = useTranslation('levels');
  const { elapsedMs } = levelClock(view, now);
  const digit = view.find?.digit ?? null;
  const sub = level.kind === 'find' && digit !== null ? findSub(digit, level.chapter, t) : undefined;
  return (
    <View style={[styles.hud, style]} testID="find-hud">
      <StageHeader level={level} sub={sub} onExit={onExit} />
      <StarsBar rule={view.marks} value={elapsedMs} max={view.limitMs ?? undefined} />
      <Text style={styles.one}>{t('hud.find.one')}</Text>
    </View>
  );
}

export interface FindTargetPanelProps {
  view: LevelView;
  /** The stage's time now. */
  now: number;
  /** The time a wrong tap costs (FindRules.penaltyMs): the rule's chip. */
  penaltyMs: number;
  /** The "‎+5 ש׳" of my last wrong tap, while it shows (its id replays it). */
  penalty?: { id: number; ms: number } | null;
  style?: StyleProp<ViewStyle>;
}

/** Under the board, where the keypad would be: the target, its ring of time, and the two rules of a tap. */
export function FindTargetPanel({ view, now, penaltyMs, penalty = null, style }: FindTargetPanelProps) {
  const { t } = useTranslation('levels');
  const find = view.find;
  const digit = find?.digit ?? null;
  const scope = find?.scope ? scopeText(find.scope, t) : '';
  const limit = view.limitMs ?? 0;
  const { elapsedMs, remainingMs: left } = levelClock(view, now);
  const ringLabel = t('hud.find.ringLabel', { s: secondsOf(left) });
  return (
    <View style={[styles.panelWrap, style]}>
      <View
        style={styles.panel}
        accessible
        accessibilityLabel={t('hud.find.targetLabel', { digit: digit ?? '', scope, left: ringLabel })}
        testID="find-target"
      >
        <View style={styles.ringBox}>
          <TimerRing
            size={RING}
            tint={color.players[0].ring}
            remainingMs={left}
            expiresAt={view.endsAt}
            totalMs={limit}
            testID="find-ring"
          />
          <View style={styles.digitBox}>
            <Text style={styles.digit} testID="find-digit">
              {digit ?? ''}
            </Text>
          </View>
        </View>
        <View style={styles.words}>
          <Text style={styles.tap} numberOfLines={2} testID="find-tap">
            {digit === null ? '' : t('hud.find.tap', { digit })}
          </Text>
          {/* [D75] The region's words ("בריבוע 5", "בשורה D") stand out; the rest stays a muted note. */}
          <Text style={styles.where} numberOfLines={2} testID="find-where">
            <Trans
              t={t}
              i18nKey="hud.find.where"
              values={{ scope }}
              components={{ scope: <Text style={styles.scope} testID="find-scope" /> }}
            />
          </Text>
        </View>
        <View style={styles.elapsed}>
          <Text style={styles.elapsedValue} testID="find-elapsed">
            {secondsText(elapsedMs)}
          </Text>
          <Text style={styles.elapsedUnit}>{t('hud.find.elapsed')}</Text>
        </View>
        {penalty ? <PenaltyChip key={penalty.id} ms={penalty.ms} t={t} style={styles.penalty} /> : null}
      </View>
      <View style={styles.rules}>
        <Text style={styles.rule}>{t('hud.find.wrongRule', { penalty: signedText(penaltyMs / 1000) })}</Text>
        <Text style={styles.rule}>{t('hud.find.twoWrongRule')}</Text>
      </View>
    </View>
  );
}

/** "‎+5 ש׳": a wrong tap's cost, in red (the number an LTR isolate, signedText). */
export function PenaltyChip({
  ms,
  t,
  style,
  testID = 'penalty-chip',
}: {
  ms: number;
  t: TFunction<'levels'>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.chip, style]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.chipText} testID={testID}>
        {t('hud.penalty', { s: signedText(ms / 1000) })}
      </Text>
    </View>
  );
}

/** The big digit of a target (Lv-Find: the 46 dp box inside the 64 dp ring). */
export function BigDigit({ digit }: { digit: Digit }) {
  return (
    <View style={styles.digitBox}>
      <Text style={styles.digit}>{digit}</Text>
    </View>
  );
}

const RING = 64;
const DIGIT_BOX = 46;
/** A boss's tile in the header: the new-game row's 44. */
const TILE = 44;

const styles = StyleSheet.create({
  hud: { gap: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[6], minHeight: size.header },
  bossHeader: { gap: space[4] },
  titles: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  title: { ...text('h1'), color: color.text },
  sub: { ...text('label'), color: color.textMuted },
  one: { ...text('label'), color: color.text },
  panelWrap: { gap: space[4] },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[7],
    minHeight: 96,
    paddingHorizontal: space[8],
    borderRadius: radius.xl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  ringBox: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  digitBox: {
    position: 'absolute',
    width: DIGIT_BOX,
    height: DIGIT_BOX,
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { ...text('scoreXL'), color: color.board.cell, writingDirection: 'ltr' },
  words: { flex: 1, minWidth: 0, gap: space[2], alignItems: 'flex-start' },
  tap: { ...text('rowTitle'), color: color.text },
  where: { ...text('label'), color: color.textMuted },
  scope: { ...text('rowTitle'), color: color.text },
  elapsed: { alignItems: 'center', gap: space[3] },
  elapsedValue: { ...text('scoreCompact'), color: color.players[0].ring },
  elapsedUnit: { ...text('caption'), color: color.textMuted },
  penalty: { position: 'absolute', top: -space[5], end: space[8] },
  chip: {
    height: 22,
    paddingHorizontal: space[4],
    borderRadius: radius.xs,
    backgroundColor: color.dangerSubtle,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    justifyContent: 'center',
  },
  chipText: { ...text('badge'), color: color.danger },
  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  rule: {
    ...text('badge'),
    color: color.textMuted,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
});
