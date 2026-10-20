import { type AppLevel, botLevel, type BotLevelId, bossTraits, levelNumber } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { normalizeAvatarId } from '../../avatars';
import { AVATAR_REACTIONS, reactionOf } from '../../avatars/reactions';
import { Icon } from '../../components/Icon';
import { Avatar, SeatGlyph } from '../../components/player';
import { LEVEL_MOTION } from '../../config/levels';
import { color, radius, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag } from '../../theme/motion';
import { ScaleCells } from './LevelPanel';
import { bossTraitText, goalText, kindName, type LevelsT } from './levelWording';

/**
 * A boss's opening, in place of "מוכן?" (levels-ui.md §3.2, D77; components.md §19.8): ReadyView shows it for a
 * boss, for LEVEL_UI.bossReadyMs (3 s) instead of readyMs, with the same fades and the same stand-still while the
 * app is away (D65). No board yet, so it gives no thinking time; then the stage begins, and its clock with it.
 * Not a screen of its own: the original §5.3.3's "no screens in between" holds, it is "מוכן?" for a boss.
 *
 * - "שלב בוס!" in gold, large;
 * - the bot's avatar (96, its P2 ring, ▲ by its name) with a 32 dp gold crown over it; a boss with no bot (only
 *   under D72 ב) has a gold medallion with the crown instead;
 * - "שלב 10 · מרוץ מול הבוט", "הבוס: Pip";
 * - "מה קשה יותר": up to two chips, only what the engine's bossTraits(level) says (never worked out here);
 * - the goal and the star scale, as in "מוכן?".
 *
 * Motion (`level.boss.intro`): the crown lands (1.4 → 1 on the `slam` spring, about 530 ms), the avatar smiles
 * (its `ready` reaction), and the chips come in one after another (240 ms each, 120 ms apart) once the crown is
 * down. Reduced Motion: everything is there together with ReadyView's 200 ms fade; the avatar smiles without
 * moving (AvatarArt plays the face only). The same 3 s either way.
 */

export interface BossIntroProps {
  /** The boss stage (its bot, its traits). */
  level: AppLevel;
  /** Reduced Motion (ReadyView decides it once for the whole wait). */
  reduce: boolean;
}

/** The words a screen reader hears for it (ReadyView's live region): "שלב בוס! שלב 10, מרוץ מול הבוט. …". */
export function bossIntroLabel(level: AppLevel, t: LevelsT): string {
  const bot = level.bot ? botLevel(level.bot.level as BotLevelId).name : null;
  const details = [
    bot ? t('boss.versus', { bot }) : null,
    ...bossTraits(level)
      .slice(0, MAX_TRAITS)
      .map((trait) => bossTraitText(trait, t)),
  ]
    .filter((s): s is string => !!s)
    .map((s) => `${s}.`);
  return t('boss.intro.label', {
    n: levelNumber(level.id),
    kind: kindName(level, t),
    details: [...details, goalText(level, t)].join(' '),
  });
}

export function BossIntro({ level, reduce }: BossIntroProps) {
  const { t } = useTranslation('levels');
  const n = levelNumber(level.id);
  const bot = level.bot ? botLevel(level.bot.level as BotLevelId) : null;
  // At most two, and only the engine's: a boss's board is the same tier as stages 7–9, so no "harder board".
  const traits = bossTraits(level).slice(0, MAX_TRAITS);

  // The crown lands, then the chips come in one by one (one clock in ms for all of them, chipProgress); under
  // Reduced Motion all is there at once.
  const span = chipsSpanMs(traits.length);
  const crownScale = useSharedValue(reduce ? 1 : LEVEL_MOTION.bossCrownFrom);
  const chipClock = useSharedValue(reduce ? span : 0);
  useEffect(() => {
    if (reduce) {
      crownScale.set(1);
      chipClock.set(span);
      return;
    }
    crownScale.set(withSpring(1, { ...motion.spring.slam, reduceMotion: reduceMotionFlag(false) }));
    chipClock.set(
      withDelay(
        LEVEL_MOTION.bossCrownMs,
        withTiming(span, { duration: span, easing: Easing.linear, reduceMotion: reduceMotionFlag(false) }),
        reduceMotionFlag(false),
      ),
    );
  }, [reduce, crownScale, chipClock, span]);
  const crownStyle = useAnimatedStyle(() => ({ transform: [{ scale: crownScale.get() }] }));

  // The avatar smiles as the boss shows up (its `ready` reaction; AvatarArt keeps it still under Reduced Motion).
  const smile = AVATAR_REACTIONS.on.ready;
  const reaction = smile ? reactionOf(smile, `boss-${level.id}`) : null;

  return (
    <View style={styles.intro} testID="boss-intro">
      <Text style={styles.title} testID="boss-intro-title">
        {t('boss.intro.title')}
      </Text>

      <View style={styles.hero}>
        {bot ? (
          <Avatar
            avatarId={normalizeAvatarId(bot.avatar)}
            size="profile"
            colorIndex={1}
            bot
            expression="smile"
            reaction={reaction}
            testID="boss-intro-avatar"
          />
        ) : (
          <View style={styles.medallion} testID="boss-intro-medallion">
            <Icon name="crown" size={MEDALLION_CROWN} color={color.accent} />
          </View>
        )}
        {bot ? (
          <Animated.View style={[styles.crownRow, crownStyle]} testID="boss-intro-crown">
            <View style={styles.crown}>
              <Icon name="crown" size={CROWN} color={color.accent} />
            </View>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.who}>
        <Text style={styles.sub} numberOfLines={1} testID="boss-intro-sub">
          {t('boss.intro.sub', { n, kind: kindName(level, t) })}
        </Text>
        {bot ? (
          <View style={styles.versus} testID="boss-intro-versus">
            <SeatGlyph colorIndex={1} size={GLYPH} />
            <Text style={styles.versusText} numberOfLines={1}>
              {t('boss.versus', { bot: bot.name })}
            </Text>
          </View>
        ) : null}
      </View>

      {traits.length > 0 ? (
        <View style={styles.harder}>
          <Text style={styles.harderTitle}>{t('boss.intro.harder')}</Text>
          <View style={styles.chips}>
            {traits.map((trait, i) => (
              <TraitChip
                key={trait.key}
                index={i}
                clock={chipClock}
                label={bossTraitText(trait, t)}
                testID={`boss-trait-${trait.key}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Text style={styles.goal}>{goalText(level, t)}</Text>
      <View style={styles.scale}>
        <ScaleCells level={level} t={t} testID="level-ready-scale" />
      </View>
    </View>
  );
}

/**
 * One "what's harder" chip: it comes in LEVEL_MOTION.bossChipStaggerMs after the one before, over bossChipMs,
 * rising 6 dp as it fades in. `clock`: the chips' shared clock, in ms since the first one started.
 */
function TraitChip({
  index,
  clock,
  label,
  testID,
}: {
  index: number;
  clock: SharedValue<number>;
  label: string;
  testID: string;
}) {
  const style = useAnimatedStyle(() => {
    const at = chipProgress(clock.get(), index);
    return { opacity: at, transform: [{ translateY: (1 - at) * CHIP_RISE }] };
  });
  return (
    <Animated.View style={[styles.chip, style]} testID={testID}>
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

/** The chips' clock runs this long: the last one starts (count − 1) × stagger in, and takes bossChipMs. */
export function chipsSpanMs(count: number): number {
  return count === 0 ? 0 : (count - 1) * LEVEL_MOTION.bossChipStaggerMs + LEVEL_MOTION.bossChipMs;
}

/** Chip `index`'s share in, 0 → 1, at `ms` on the chips' clock. */
export function chipProgress(ms: number, index: number): number {
  'worklet';
  const start = index * LEVEL_MOTION.bossChipStaggerMs;
  return Math.min(1, Math.max(0, (ms - start) / LEVEL_MOTION.bossChipMs));
}

/** Never more than two chips (bossTraits says so too). */
const MAX_TRAITS = 2;
/** levels-ui.md §3.2: the avatar 96 (Avatar's `profile`), the crown 32 over it. */
const CROWN = 32;
const MEDALLION = 96;
const MEDALLION_CROWN = 48;
const GLYPH = 12;
const CHIP_RISE = 6;
const CHIP_HEIGHT = 28;

const styles = StyleSheet.create({
  intro: { alignItems: 'center', gap: space[8] },
  title: { ...text('screenTitle'), color: color.accent, textAlign: 'center' },
  hero: { alignItems: 'center', marginTop: space[6] },
  crownRow: { position: 'absolute', top: -(CROWN * 0.75), start: 0, end: 0, alignItems: 'center' },
  crown: {
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    backgroundColor: color.bg,
  },
  medallion: {
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: MEDALLION / 2,
    borderWidth: tokens.border.focus,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  who: { alignItems: 'center', gap: space[3] },
  sub: { ...text('h1'), color: color.text, textAlign: 'center' },
  versus: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  versusText: { ...text('label'), color: color.players[1].ring },
  harder: { alignItems: 'center', gap: space[4] },
  harderTitle: { ...text('caption'), color: color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[4] },
  chip: {
    height: CHIP_HEIGHT,
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    justifyContent: 'center',
  },
  chipText: { ...text('label'), color: color.accent },
  goal: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  scale: { alignSelf: 'stretch' },
});
