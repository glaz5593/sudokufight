import { type AppLevel, botLevel, type BotLevelId } from '@sudoku-fight/engine';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { normalizeAvatarId } from '../../avatars';
import { shake } from '../../components/board/animation';
import { Icon, type IconName } from '../../components/Icon';
import { LevelTile } from '../../components/levels/LevelTile';
import { StarRow, STAR_SIZES } from '../../components/levels/StarRow';
import { Avatar } from '../../components/player';
import { curve } from '../../components/ui/motion';
import { LEVEL_UI } from '../../config/levels';
import { color, radius, space } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { kindLabel, type LevelsT, starsOf3 } from './levelWording';
import type { NodeInfo } from './mapModel';

/**
 * A stage on the map (components.md §19.2; the Main board): one button, the tile (LevelTile) with its 3 stars
 * of 11 under it. Played: the stars it got in gold. Current: the gold ring, pulsing (`level.node.current`: the
 * map's only loop, still under Reduced Motion), and my P1 pin. Locked: dark, a lock badge, no stars; a tap shakes
 * it once (`level.node.locked`; Reduced Motion: the lock badge's border lights up instead) and the map says why.
 * A boss is 68 with a crown, the arena's gold corners (LevelTile; never the current node's ring) and its bot's
 * avatar, from chapter 1 (every boss is a bot fight since 1.0.3, D72; a boss with no bot, only under D72 ב, has
 * none). No kind icon (D60), unless LEVEL_UI.nodeKindIcon is turned on.
 *
 * Its label says it all: "שלב 5, מיקום מדויק, שני כוכבים מתוך שלושה", "שלב 12, נעול".
 */

export interface LevelNodeProps {
  info: NodeInfo;
  /** The stage's data (its kind, its bot); missing while the data is not there (the label then has no kind). */
  level: AppLevel | undefined;
  selected: boolean;
  /** Bumped by the map on each tap on this locked node: the shake (or the flash) plays again. */
  shakeKey: number;
  onPress: (info: NodeInfo) => void;
}

/** The kinds' icons (the panel's, and a node's when LEVEL_UI.nodeKindIcon is on). */
export const KIND_ICON: Record<AppLevel['kind'], IconName> = {
  find: 'target',
  findDuel: 'bot',
  fillBox: 'gridBox',
  duel: 'swords',
  spotError: 'search',
  pointHunter: 'leaderboard',
  chain: 'links',
  // 1.0.3 (levels-ui.md §5): the row and the column lit in a 3 × 3 grid, and the puzzle's swapped boxes (Icon.tsx).
  fillRow: 'gridRow',
  fillCol: 'gridCol',
  puzzle: 'puzzle',
};

/** The label of a node (pure; the map's tests read it). */
export function nodeLabel(info: NodeInfo, level: AppLevel | undefined, t: LevelsT): string {
  if (info.state === 'locked') return t('node.locked', { n: info.n });
  const plain = level ? kindLabel(level, t) : '';
  const kind = info.boss ? t('boss.label', { kind: plain }) : plain;
  if (info.state === 'current') return t('node.current', { n: info.n, kind });
  if (info.state === 'open') return t('node.open', { n: info.n, kind });
  return t('node.played', { n: info.n, kind, stars: starsOf3(info.stars, t) });
}

/** The current node's ring (0 0 0 2px bg, 0 0 0 4px accent) and its pulsing band (out to 9). */
const RING = { gap: 2, width: 2, band: 5 } as const;
/** Reduced Motion: the locked badge's border lights for this long instead of the shake. */
const FLASH_MS = motion.duration.wrongShake;

function LevelNodeBase({ info, level, selected, shakeKey, onPress }: LevelNodeProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const { n, state, boss } = info;
  const tile = boss ? 68 : 56;
  const locked = state === 'locked';

  // The locked tap: one shake of this node only, or (Reduced Motion) the badge's flash until FLASH_MS later.
  const x = useSharedValue(0);
  const [flashed, setFlashed] = useState(shakeKey);
  const flash = reduce && shakeKey !== flashed;
  const seen = useRef(shakeKey);
  useEffect(() => {
    if (shakeKey === seen.current) return;
    seen.current = shakeKey;
    if (reduce) {
      const timer = setTimeout(() => setFlashed(shakeKey), FLASH_MS);
      return () => clearTimeout(timer);
    }
    x.set(0);
    x.set(shake());
  }, [shakeKey, reduce, x]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const bot = boss && level?.bot ? botLevel(level.bot.level as BotLevelId) : null;
  const kindIcon = LEVEL_UI.nodeKindIcon && level && !locked ? KIND_ICON[level.kind] : null;

  return (
    <Animated.View style={shakeStyle} testID={`node-${n}-shake`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={nodeLabel(info, level, t)}
        accessibilityState={{ selected }}
        onPress={() => onPress(info)}
        style={[styles.button, { width: tile, height: tile + STARS_ROW }]}
        testID={`node-${n}`}
      >
        {({ pressed }) => (
          <>
            <View style={pressed ? styles.pressed : undefined}>
              {state === 'current' ? (
                <CurrentRing tile={tile} reduce={reduce} testID={`node-${n}-ring`} />
              ) : selected ? (
                <View
                  style={[styles.ring, ringBox(tile), styles.selectedRing]}
                  testID={`node-${n}-selected`}
                />
              ) : null}
              <LevelTile
                n={n}
                size={tile}
                state={state === 'locked' ? 'locked' : state === 'current' ? 'current' : 'played'}
                boss={boss}
                flash={flash}
                testID={`node-${n}-tile`}
              />
              {bot ? (
                <View style={[styles.bot, { top: tile - BOT_FROM_BOTTOM }]} testID={`node-${n}-bot`}>
                  <Avatar avatarId={normalizeAvatarId(bot.avatar)} size="cell" colorIndex={1} bot />
                </View>
              ) : null}
              {kindIcon ? (
                <View style={styles.kind} testID={`node-${n}-kind`}>
                  <Icon name={kindIcon} size={KIND_ICON_SIZE} color={color.textMuted} />
                </View>
              ) : null}
            </View>
            <View style={[styles.stars, locked && styles.hidden]}>
              <StarRow
                stars={locked ? 0 : info.stars}
                size={STAR_SIZES.chip}
                label={null}
                gap={STAR_GAP}
                testID={`node-${n}-stars`}
              />
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export const LevelNode = memo(LevelNodeBase);

/** The gold ring of "you are here", and its band pulsing 0 ↔ 1 over 1600 ms (static under Reduced Motion). */
function CurrentRing({ tile, reduce, testID }: { tile: number; reduce: boolean; testID: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(pulse);
      pulse.set(0);
      return;
    }
    pulse.set(
      withRepeat(
        withTiming(1, {
          duration: motion.loop.lockPulse / 2,
          easing: curve('loop'),
          reduceMotion: reduceMotionFlag(false),
        }),
        -1,
        true,
        undefined,
        reduceMotionFlag(false),
      ),
    );
    return () => cancelAnimation(pulse);
  }, [reduce, pulse]);
  const bandStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <>
      {reduce ? null : (
        <Animated.View
          style={[styles.ring, bandBox(tile), styles.band, bandStyle]}
          testID={`${testID}-band`}
        />
      )}
      <View style={[styles.ring, ringBox(tile), styles.currentRing]} testID={testID} />
    </>
  );
}

const ringOut = RING.gap + RING.width;
const ringBox = (tile: number) => ({
  top: -ringOut,
  start: -ringOut,
  width: tile + 2 * ringOut,
  height: tile + 2 * ringOut,
  borderRadius: radius.md + ringOut,
  borderWidth: RING.width,
});
const bandOut = ringOut + RING.band;
const bandBox = (tile: number) => ({
  top: -bandOut,
  start: -bandOut,
  width: tile + 2 * bandOut,
  height: tile + 2 * bandOut,
  borderRadius: radius.md + bandOut,
  borderWidth: RING.band,
});

/** The stars under the tile: 4 below it, 12 high (STAR_SIZES.chip with its line). */
const STARS_ROW = 16;
const STAR_GAP = space[1];
/** The boss's bot at the bottom-start corner (the Main board: 50 down a 68 tile, 8 out). */
const BOT_FROM_BOTTOM = 18;
const KIND_ICON_SIZE = 14;

const styles = StyleSheet.create({
  button: { alignItems: 'center' },
  pressed: { transform: [{ scale: 0.96 }] },
  ring: { position: 'absolute' },
  currentRing: { borderColor: color.accent },
  selectedRing: { borderColor: color.text },
  band: { borderColor: color.star.pulse },
  stars: { height: STARS_ROW - space[2], marginTop: space[2], justifyContent: 'center' },
  hidden: { opacity: 0 },
  bot: { position: 'absolute', start: -space[4] },
  kind: { position: 'absolute', bottom: space[1], end: space[1] },
});
