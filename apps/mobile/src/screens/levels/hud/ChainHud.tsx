import {
  type AppLevel,
  type CellIndex,
  formatNotYet,
  type GameView,
  LEVEL_PENALTY_MS,
} from '@sudoku-fight/engine';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { boardGeometry, cellRect } from '../../../components/board/geometry';
import { Icon } from '../../../components/Icon';
import { StarsBar } from '../../../components/levels/StarsBar';
import { secondsOf, signedText } from '../../../components/player/format';
import { timing } from '../../../components/ui/motion';
import { useToast } from '../../../components/ui/toastStore';
import { color, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import { secondsText } from '../../home/homeModel';
import { levelClock, StageHeader } from './FindHud';
import { type StageStore, stageStore, useViewChanges, viewerOf } from './PointHunterHud';
import { FLASH_CHIP_SLOT, FlashPenaltyChip, kindTipShown, TipCard } from './SpotErrorHud';

/**
 * The chain's HUD (components.md §19.6, the Idea-3 board; plan Idea-3): the stage's header; the goal, "בכל רגע
 * רק משבצת אחת בלוח פתירה. מצא אותה ומלא, והיא תפתח את הבאה.", and, muted, what costs 5 s; the links (filled in
 * P1, the current one outlined in P1, the rest empty) with "צעד 3 מתוך 4"; the stage's clock with the
 * "‎+5 ש׳" of a penalty beside it; and the star meter of its time. The keypad and "ביטול בחירה" stay the game
 * screen's. The view says how many steps are done, never which cell is next (the engine's LevelProgressView),
 * and nothing here marks it.
 *
 * The tip card in the kind's first LEVEL_UI.tipLevels stages [D64]: "בכל צעד יש בדיוק משבצת אחת שאפשר להוכיח.
 * אם אתה בטוח בספרה, זו המשבצת.", which the player can close.
 *
 * A right digit off the chain [D64, waiting for Moshe]: with LEVEL_RULES.chainNotYet 'accept' (the original
 * §14, the default) the engine places it with its points, as in a game, and nothing more is said. With 'penalty' it costs
 * 5 s and is not placed: the cell flashes red (ChainOverlay, over the board), the "‎+5 ש׳" chip shows, and a
 * toast says "עוד אי אפשר לדעת מה נכנס ב־A9" (the engine's formatNotYet, the cell an LTR isolate). The game
 * screen hears no event of it: the HUD reads it off two views (my time penalty grew, my mistakes did not), and
 * hands the flash to the overlay through the stage's store.
 *
 * Motion: a link fills from its start over 240 ms (`level.chain.link`), at once with Reduced Motion; the red
 * flash fades from 55 % over 550 ms, with Reduced Motion a 2 dp red frame for 300 ms (`level.miss.flash`).
 */

/** A time penalty between two views: how much, where my lock was, and whether it was a "not yet" [D64]. */
export interface ChainPenalty {
  id: string;
  ms: number;
  /** The penalty came with no mistake: the engine's "not yet" (chainNotYet 'penalty'). */
  notYet: boolean;
  /** My locked cell (the lock stays after either). */
  cell: CellIndex | null;
}

/** My time penalty between two views of the same game, or null when it did not grow. */
export function chainPenaltyBetween(prev: GameView, next: GameView): ChainPenalty | null {
  if (prev.gameId !== next.gameId) return null;
  const ms = (next.level?.penaltyMs ?? 0) - (prev.level?.penaltyMs ?? 0);
  if (ms <= 0) return null;
  const me = viewerOf(next);
  const was = viewerOf(prev);
  return {
    id: `${next.seq}`,
    ms,
    notYet: !!me && !!was && me.mistakes === was.mistakes,
    cell: me?.lock?.cell ?? was?.lock?.cell ?? null,
  };
}

interface ChainMarks {
  gameId: string | null;
  /** The last penalty's "‎+5 ש׳" (its id plays it again). */
  penalty: { id: string; ms: number } | null;
  /** The last "not yet": its cell flashes red. */
  flash: { id: string; cell: CellIndex } | null;
}

const chainStore = (level: AppLevel) =>
  stageStore<ChainMarks>(level, 'chain', () => ({ gameId: null, penalty: null, flash: null }));

/** Takes a new view into the stage's store; the penalty it brought, if any. */
function record(store: StageStore<ChainMarks>, prev: GameView | null, next: GameView): ChainPenalty | null {
  // A new screen (its first view) or a new game starts the store over.
  const fresh = prev === null || store.getState().gameId !== next.gameId;
  const penalty = prev && !fresh ? chainPenaltyBetween(prev, next) : null;
  if (fresh) store.setState({ gameId: next.gameId, penalty: null, flash: null });
  if (!penalty) return null;
  store.setState({
    penalty: { id: penalty.id, ms: penalty.ms },
    ...(penalty.notYet && penalty.cell !== null ? { flash: { id: penalty.id, cell: penalty.cell } } : null),
  });
  return penalty;
}

export interface ChainHudProps {
  /** The stage as played (a chain). */
  level: AppLevel;
  view: GameView;
  /** The game's time now. */
  now: number;
  /** What a right digit off the chain does (LEVEL_RULES.chainNotYet) [D64]: the muted line says its cost. */
  notYet: 'accept' | 'penalty';
  /** The tip card: the kind's first LEVEL_UI.tipLevels stages by default (kindTipShown). */
  tip?: boolean;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ChainHud({ level, view, now, notYet, tip, onExit, style }: ChainHudProps) {
  const { t, i18n } = useTranslation('levels');
  const lang = i18n.language === 'en' ? 'en' : 'he';
  // The tip card, until the player closes it.
  const [tipOpen, setTipOpen] = useState(() => tip ?? kindTipShown('chain', level));
  const useMarks = chainStore(level);
  useViewChanges(view, (prev, next) => {
    const p = record(useMarks, prev, next);
    if (!p?.notYet || p.cell === null) return;
    useToast.getState().show({
      variant: 'error',
      message: t('hud.chain.notYet', {
        text: formatNotYet(p.cell, [], lang),
        penalty: signedText(p.ms / 1000),
      }),
    });
  });
  const penalty = useMarks((s) => (s.gameId === view.gameId ? s.penalty : null));

  const lv = view.level;
  const progress = lv?.progress?.kind === 'chain' ? lv.progress : null;
  const total = progress?.total ?? (level.kind === 'chain' ? level.targets.cells.length : 0);
  const done = Math.min(total, progress?.done ?? 0);
  const step = Math.min(done + 1, total);
  const { elapsedMs } = lv ? levelClock(lv, now) : { elapsedMs: 0 };
  const limit = lv?.limitMs ?? 0;
  const cost = signedText(LEVEL_PENALTY_MS / 1000);
  return (
    <View style={[styles.hud, style]} testID="chain-hud">
      <StageHeader level={level} onExit={onExit} />
      <View style={styles.goal}>
        <Text style={styles.goalText} testID="chain-goal">
          {t('hud.chain.goal')}
        </Text>
        <Text style={styles.note} testID="chain-note">
          {notYet === 'penalty'
            ? t('hud.chain.notePenalty', { penalty: cost })
            : t('hud.chain.noteAccept', { penalty: cost })}
        </Text>
      </View>
      {tipOpen ? (
        <TipCard
          title={t('hud.chain.tipTitle')}
          tip={t('hud.chain.tip')}
          icon="links"
          closeLabel={t('hud.chain.tipClose')}
          onClose={() => setTipOpen(false)}
          testID="chain-tip"
        />
      ) : null}
      <View style={styles.row}>
        <View
          style={styles.progress}
          accessible
          accessibilityLabel={t('hud.chain.stepLabel', { n: step, total })}
          testID="chain-progress"
        >
          <ChainLinks done={done} total={total} running={view.status !== 'over'} />
          <Text style={styles.step} testID="chain-step">
            {t('hud.chain.step', { n: step, total })}
          </Text>
        </View>
        <View style={styles.time}>
          {penalty ? <FlashPenaltyChip key={penalty.id} ms={penalty.ms} style={FLASH_CHIP_SLOT} /> : null}
          <View
            style={styles.clock}
            accessible
            accessibilityRole="timer"
            accessibilityLabel={t('hud.chain.timeLabel', {
              s: secondsOf(elapsedMs),
              limit: secondsOf(limit),
            })}
            testID="chain-clock"
          >
            <Text style={styles.clockWord}>{t('hud.chain.time')}</Text>
            <Text style={styles.clockValue} testID="chain-clock-value">
              {secondsText(elapsedMs)}
            </Text>
            <Text style={styles.clockWord}>{t('units.seconds')}</Text>
          </View>
        </View>
      </View>
      {lv ? <StarsBar rule={lv.marks} value={elapsedMs} max={lv.limitMs ?? undefined} /> : null}
    </View>
  );
}

type LinkState = 'done' | 'now' | 'todo';

/** The chain's links, from the start side: done (P1, a check), the current one (P1 outline), the rest. */
function ChainLinks({ done, total, running }: { done: number; total: number; running: boolean }) {
  return (
    <View
      style={styles.links}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="chain-links"
    >
      {Array.from({ length: total }, (_, i) => (
        <Link key={i} index={i} state={i < done ? 'done' : i === done && running ? 'now' : 'todo'} />
      ))}
    </View>
  );
}

function Link({ index, state }: { index: number; state: LinkState }) {
  const reduce = useReduceMotion();
  const filled = state === 'done' ? 1 : 0;
  const fill = useSharedValue(filled);
  useEffect(() => {
    fill.set(reduce ? filled : withTiming(filled, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [filled, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  return (
    <View style={styles.linkRow}>
      {index > 0 ? (
        <View style={[styles.joint, { backgroundColor: state === 'todo' ? color.border : P1.ring }]} />
      ) : null}
      <View style={[styles.link, LINK_STYLE[state]]} testID={`chain-link-${index}-${state}`}>
        <Animated.View style={[styles.linkFill, fillStyle]} testID={`chain-link-${index}-fill`} />
        {state === 'done' ? <Icon name="check" size={LINK_ICON} color={P1.onRing} strokeWidth={3} /> : null}
      </View>
    </View>
  );
}

export interface ChainOverlayProps {
  /** The stage as played (its store: what the HUD saw). */
  level: AppLevel;
  /** The board's side. */
  width: number;
}

/** Over the board: the red flash of the last "not yet" on its cell [D64]. Decorative (the toast says it). */
export function ChainOverlay({ level, width }: ChainOverlayProps) {
  const useMarks = chainStore(level);
  const flash = useMarks((s) => s.flash);
  if (!flash) return null;
  return <NotYetFlash key={flash.id} cell={flash.cell} width={width} />;
}

function NotYetFlash({ cell, width }: { cell: CellIndex; width: number }) {
  const reduce = useReduceMotion();
  const r = cellRect(boardGeometry(width), cell);
  const opacity = useSharedValue(1);
  useEffect(() => {
    const out = timing(reduce ? 0 : motion.duration.wrongFlash, 'standard', reduce);
    opacity.set(reduce ? withDelay(motion.duration.wrongShake, withTiming(0, out)) : withTiming(0, out));
  }, [opacity, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.flash,
        { left: r.x, top: r.y, width: r.width, height: r.height },
        reduce ? styles.flashFrame : styles.flashFill,
        style,
      ]}
      testID={reduce ? 'chain-not-yet-frame' : 'chain-not-yet-fill'}
    />
  );
}

/** components.md §19.6: the links 20 with a 12 check, joined by 8 × 2 bars. */
const LINK = 20;
const LINK_ICON = 12;
const JOINT = 8;

const P1 = color.players[0]!;

const LINK_STYLE: Record<LinkState, ViewStyle> = {
  done: { borderColor: P1.ring, backgroundColor: color.surface2 },
  now: { borderColor: P1.ring, borderWidth: tokens.border.focus, backgroundColor: 'transparent' },
  todo: { borderColor: color.border, backgroundColor: color.surface2 },
};

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  goal: { gap: space[2], alignItems: 'flex-start' },
  goalText: { ...text('status'), color: color.text },
  note: { ...text('caption'), color: color.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  links: { flexDirection: 'row', alignItems: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  joint: { width: JOINT, height: tokens.border.focus },
  link: {
    width: LINK,
    height: LINK,
    borderRadius: LINK / 2,
    borderWidth: tokens.border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  linkFill: { position: 'absolute', top: 0, bottom: 0, start: 0, backgroundColor: P1.ring },
  step: { ...text('status'), color: color.text },
  time: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  clock: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  clockWord: { ...text('status'), color: color.textMuted },
  clockValue: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  flash: { position: 'absolute' },
  flashFill: { backgroundColor: color.board.wrongFlash },
  flashFrame: { borderWidth: tokens.border.focus, borderColor: color.danger },
});
