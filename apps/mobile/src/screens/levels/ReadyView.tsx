import { type AppLevel, fillRegionOf, levelNumber } from '@sudoku-fight/engine';
import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { MiniRegion, type RegionShape, regionOfScope } from '../../components/levels/MiniRegion';
import { timing } from '../../components/ui/motion';
import { LEVEL_UI } from '../../config/levels';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { BossIntro, bossIntroLabel } from './BossIntro';
import { scopeText } from './hud/FindHud';
import { KIND_ICON } from './LevelNode';
import { ScaleCells } from './LevelPanel';
import {
  botNameOf,
  findPrompt,
  goalText,
  kindName,
  type LevelsT,
  puzzleCountsOf,
  puzzleCountsText,
  raceSpotsText,
  regionName,
} from './levelWording';

/**
 * "מוכן?" (components.md §19.8, no board; D56): before a stage's clock starts, for LEVEL_UI.readyMs (2 s), the
 * kind, the goal and the star scale over the empty stage area. No board yet, so the wait gives no thinking time;
 * then the stage begins (onDone), and its clock with it.
 *
 * [D76] It also says where to look (LEVEL_UI.readyRegion; levels-ui.md §2.4), from the board that will really be
 * played (`played`, the attempt's level: "שוב" moves the rows and relabels the digits [D63]):
 * - Pinpoint in a region: "איפה ה־6?" large, the small map with the region in gold, "בריבוע 5" / "בשורה D";
 *   on the whole board: "איפה ה־6?" alone;
 * - fill the box, the row, the column: the map and "ריבוע 5" / "שורה D" / "עמודה 5";
 * - the race: "5 מקומות, מרוץ מול Pip", never a spot or a digit (no head start on the bot, whose search starts
 *   with the clock, as mine does);
 * - the puzzle: "3 ריבועים זזים · 6 ריבועים קבועים", no map;
 * - the duel, spot the error, the point hunter, the chain: as in 1.0.2.
 * While play.tsx is still reading the attempt (`played` null, usually under a tenth of a second) the words show,
 * and the digit and the map come in once it is known; the wait starts only then.
 *
 * [D77] A boss gets its opening instead (BossIntro), for LEVEL_UI.bossReadyMs (3 s): the same wait, the same
 * fades, the same stand-still in the background.
 *
 * Motion (`level.ready`): a fade in (240 ms) and out at the end; Reduced Motion: 200 ms fades, the same 2 s.
 * `paused` (the app left the foreground, D65): the 2 s stand still and go on from where they were, the fades with
 * them: the fade out is timed by the same running 2 s (never by the frames, which go on while the app is away),
 * so the stage's intro is still there when the player is back.
 */

export interface ReadyViewProps {
  /** The stage as stored (its kind, its goal, its star scale). */
  level: AppLevel;
  /**
   * [D76] The stage as it will be played: the attempt's board (attemptLevel), read by play.tsx before "מוכן?"
   * with the same attempt number it then gives the session, so the two always agree (a failed read: attempt 1
   * for both). Its digit and its region are what "מוכן?" shows. null while that read is still on: the words
   * show, and the wait starts once it is known. Left out: the stored stage is the one played (attempt 1).
   */
  played?: AppLevel | null;
  onDone: () => void;
  /** How long it shows; LEVEL_UI.readyMs by default (a boss: LEVEL_UI.bossReadyMs). */
  durationMs?: number;
  /** The app is in the background: the wait stands still. */
  paused?: boolean;
}

export function ReadyView({ level, played, onDone, durationMs, paused = false }: ReadyViewProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const { top } = useSafeAreaInsets();
  const done = useEffectEvent(onDone);
  // The board to be played: `level` itself unless play.tsx gave the attempt's; null while it reads it.
  const board = played === undefined ? level : played;
  const waiting = board === null;

  // The wait, kept across a pause: what is left. The fade out is timed from it too, so it ends with the wait.
  const left = useRef(durationMs ?? (level.boss ? LEVEL_UI.bossReadyMs : LEVEL_UI.readyMs));
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (paused) return;
    const fade = reduce ? motion.duration.reducedFade : motion.duration.stateChange;
    // In (back to full after a pause).
    opacity.set(withTiming(1, timing(fade, 'standard', reduce)));
    // The words show while the attempt is read; the wait starts once it is known.
    if (waiting) return;
    const started = Date.now();
    const remaining = left.current;
    const out = Math.min(fade, remaining);
    // Out over the wait's last `fade` ms.
    const fadeOut = setTimeout(
      () => opacity.set(withTiming(0, timing(out, 'exit', reduce))),
      remaining - out,
    );
    const timer = setTimeout(() => {
      left.current = 0;
      done();
    }, remaining);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(timer);
      // Stands still with the wait: no fade runs on while the app is away.
      cancelAnimation(opacity);
      left.current = Math.max(0, remaining - (Date.now() - started));
    };
  }, [paused, waiting, reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const n = levelNumber(level.id);
  const kind = kindName(level, t);
  const goal = goalText(level, t);
  const where = LEVEL_UI.readyRegion && !level.boss ? readyWhere(level, board, t) : null;
  const label = level.boss
    ? bossIntroLabel(level, t)
    : t('ready.label', { n, kind, goal: where?.spoken ? `${where.spoken} ${goal}` : goal });

  return (
    <View style={[styles.screen, { paddingTop: top + space[12] }]} testID="level-ready">
      <Animated.View
        style={[styles.content, style]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={label}
        testID="level-ready-content"
      >
        {level.boss ? (
          <BossIntro level={level} reduce={reduce} />
        ) : (
          <>
            <Text style={styles.title}>{t('ready.title')}</Text>
            <View style={styles.kind}>
              <View style={styles.icon}>
                <Icon name={KIND_ICON[level.kind]} size={size.icon.nav} color={color.text} />
              </View>
              <Text style={styles.stage} numberOfLines={1}>
                {t('panel.title', { n, kind })}
              </Text>
            </View>
            {where ? <Where where={where} reduce={reduce} /> : null}
            <Text style={styles.goal}>{goal}</Text>
            <View style={styles.scale}>
              <ScaleCells level={level} t={t} testID="level-ready-scale" />
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

/** What "מוכן?" says about where to look (levels-ui.md §2.4); `pending` while the attempt is read. */
export interface ReadyWhere {
  /** "איפה ה־6?", large. */
  prompt: string | null;
  /** The region to light on the small map (MiniRegion), and its caption ("בריבוע 5", "שורה D"). */
  region: RegionShape | null;
  caption: string | null;
  /** One line instead: the race's "5 מקומות, מרוץ מול Pip", the puzzle's counts. */
  line: string | null;
  /** For the screen reader's label, before the goal: "איפה ה־6? בריבוע 5." */
  spoken: string | null;
  /** The attempt is still being read: the digit and the map are not known yet. */
  pending: boolean;
}

const sentence = (...parts: (string | null)[]): string => `${parts.filter(Boolean).join(' ')}.`;

/**
 * The "where" of a stage before it starts, per kind, from `board` (the attempt's level; null while it is read).
 * Pure; null for the kinds that show nothing more than in 1.0.2.
 */
export function readyWhere(level: AppLevel, board: AppLevel | null, t: LevelsT): ReadyWhere | null {
  const none = { prompt: null, region: null, caption: null, line: null, spoken: null, pending: false };
  switch (level.kind) {
    case 'find': {
      if (board?.kind !== 'find') return { ...none, pending: true };
      const { digit, scope } = board.targets.target;
      const prompt = findPrompt(digit, t);
      const caption = scopeText(scope, t);
      if (scope.kind === 'board') return { ...none, prompt, spoken: sentence(prompt, caption) };
      return {
        ...none,
        prompt,
        region: regionOfScope(scope),
        caption,
        spoken: sentence(prompt, caption),
      };
    }
    case 'fillBox':
    case 'fillRow':
    case 'fillCol': {
      const fill = board ? fillRegionOf(board) : null;
      if (!fill) return { ...none, pending: true };
      const caption = regionName(fill, t);
      return { ...none, region: { unit: fill.unit, index: fill.index }, caption, spoken: sentence(caption) };
    }
    case 'findDuel':
      // The goal already says the spots and the bot: the line is for the eye only.
      return { ...none, line: raceSpotsText(level.targets.spots.length, botNameOf(level) ?? '', t) };
    case 'puzzle': {
      const counts = puzzleCountsOf(level);
      if (!counts) return null;
      const line = puzzleCountsText(counts.moving, counts.fixed, t);
      return { ...none, line, spoken: sentence(line) };
    }
    default:
      return null;
  }
}

/**
 * The "where" block; while the attempt is read it keeps its place empty, then fades in what it learnt. The map
 * is part of "מוכן?"'s one spoken label (the content is one element), so it is drawn decorative here.
 */
function Where({ where, reduce }: { where: ReadyWhere; reduce: boolean }) {
  const shown = useSharedValue(where.pending ? 0 : 1);
  useEffect(() => {
    if (where.pending) return;
    shown.set(withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [where.pending, reduce, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return (
    <Animated.View style={[styles.where, style]} testID="level-ready-where">
      {where.prompt ? (
        <Text style={styles.prompt} testID="level-ready-prompt">
          {where.prompt}
        </Text>
      ) : null}
      {where.region ? (
        <View style={styles.map} testID="level-ready-region">
          <MiniRegion region={where.region} size={size.miniRegion.ready} testID="level-ready-map" />
          {where.caption ? (
            <Text style={styles.caption} testID="level-ready-caption">
              {where.caption}
            </Text>
          ) : null}
        </View>
      ) : null}
      {where.line ? (
        <Text style={styles.line} testID="level-ready-line">
          {where.line}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const ICON = 56;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: tokens.layout.gutterGame, backgroundColor: color.bg },
  content: { alignItems: 'center', gap: space[8] },
  title: { ...text('screenTitle'), color: color.accent, textAlign: 'center' },
  kind: { alignItems: 'center', gap: space[4] },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { ...text('h1'), color: color.text, textAlign: 'center' },
  where: { alignItems: 'center', gap: space[5], minHeight: space[12] },
  prompt: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  map: { alignItems: 'center', gap: space[3] },
  caption: { ...text('rowTitle'), color: color.accent, textAlign: 'center' },
  line: { ...text('rowTitle'), color: color.text, textAlign: 'center' },
  goal: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  scale: { alignSelf: 'stretch' },
});
