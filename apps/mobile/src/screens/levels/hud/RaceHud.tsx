import type { AppLevel, GameView, PlayerView } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { AvatarIdOrNone } from '../../../avatars';
import { type SpotOwner, StarsBar } from '../../../components/levels/StarsBar';
import { Avatar, SeatGlyph } from '../../../components/player';
import { secondsOf } from '../../../components/player/format';
import { IconButton } from '../../../components/ui';
import { timing } from '../../../components/ui/motion';
import { color, radius, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import { identityOf } from '../../game/identity';
import { levelClock, scopeText, StageHeader } from './FindHud';

/**
 * The race's HUD (components.md §19.7, the Lv-Race board; plan §2.2): the header, two cards (me in P1 with ●,
 * the bot in P2 with ▲, never by colour alone) with the spots each took, the bot's "מחפש…" and its 😂 when it
 * laughs at my wrong tap; the five spots as pips in their taker's colour and shape (StarsBar's count); the task
 * line "מקום 4 מתוך 5 · מצא את ה־4 בריבוע 9" and "עוד 13 ש׳". My reactions button only with LEVEL_UI.reactions
 * (D62: off). Everything comes from the tap engine's view.
 *
 * Motion: the bot's avatar hops when it takes a spot (`level.bot.hop`, full motion only; Reduced Motion: it stays,
 * and the pip and the live region say it).
 */

export interface RaceHudProps {
  /** The stage as played. */
  level: AppLevel;
  view: GameView;
  /** The stage's time now. */
  now: number;
  myAvatar: AvatarIdOrNone;
  /** The bot's reaction on its card while it shows (its id replays it). */
  botReaction?: { id: number; emoji: string } | null;
  /** A new id: the bot took a spot (its hop). */
  botHop?: number | null;
  onExit?: () => void;
  /** My reactions button (only when LEVEL_UI.reactions is on). */
  onReactions?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Who took each spot, as the pips draw it. */
export function spotOwners(view: GameView): SpotOwner[] {
  return (view.level?.find?.spots ?? []).map((s) =>
    s.state === 'won' ? (s.playerId === view.me ? 'me' : 'bot') : null,
  );
}

export function RaceHud({
  level,
  view,
  now,
  myAvatar,
  botReaction = null,
  botHop = null,
  onExit,
  onReactions,
  style,
}: RaceHudProps) {
  const { t } = useTranslation('levels');
  const lv = view.level;
  const find = lv?.find;
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const bot = view.players.find((p) => p.id !== view.me) ?? null;
  const total = find?.spots.length ?? 0;
  const spots = spotOwners(view);
  const remaining = lv ? levelClock(lv, now).remainingMs : 0;
  const scope = find?.scope ? scopeText(find.scope, t) : '';
  const open = find?.spots[find.spotIndex]?.state === 'open';
  const sub = t('hud.subRace', {
    kind: t('kinds.findDuel.name'),
    spots: total,
    chapter: level.chapter,
  });
  return (
    <View style={[styles.hud, style]} testID="race-hud">
      <StageHeader level={level} sub={sub} onExit={onExit} />
      <View style={styles.cards}>
        {me ? <MeCard player={me} avatar={myAvatar} onReactions={onReactions} /> : null}
        <Text style={styles.vs} accessibilityElementsHidden importantForAccessibility="no">
          VS
        </Text>
        {bot ? (
          <BotCard player={bot} view={view} searching={open} reaction={botReaction} hop={botHop} />
        ) : null}
      </View>
      <StarsBar rule={level.stars} value={me?.score ?? 0} spots={spots} />
      <View style={styles.taskRow}>
        <Text style={styles.task} numberOfLines={1} testID="race-task">
          {find?.digit != null
            ? t('hud.race.task', { n: (find.spotIndex ?? 0) + 1, total, digit: find.digit, scope })
            : ''}
        </Text>
        <Text
          style={styles.left}
          accessibilityRole="timer"
          accessibilityLabel={t('hud.clockLabel', {
            s: secondsOf(remaining),
            limit: secondsOf(lv?.limitMs ?? 0),
          })}
          testID="race-left"
        >
          {t('hud.race.left', { s: secondsOf(remaining) })}
        </Text>
      </View>
    </View>
  );
}

function MeCard({
  player,
  avatar,
  onReactions,
}: {
  player: PlayerView;
  avatar: AvatarIdOrNone;
  onReactions?: () => void;
}) {
  const { t } = useTranslation('levels');
  const name = t('hud.me');
  const spots = t('hud.race.spots', { count: player.score });
  return (
    <View style={[styles.card, styles.cardMe]} testID="race-me">
      <View
        style={styles.who}
        accessible
        accessibilityLabel={t('hud.race.meLabel', { name, spots })}
        testID="race-me-who"
      >
        <Avatar avatarId={avatar} size="compact" colorIndex={0} />
        <View style={styles.nameRow}>
          <SeatGlyph colorIndex={0} size={GLYPH} />
          <Text style={[styles.name, { color: color.players[0].ring }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
      <Text style={styles.count} testID="race-me-spots">
        {player.score}
      </Text>
      {onReactions ? (
        <IconButton
          icon="reactions"
          accessibilityLabel={t('hud.reactions')}
          onPress={onReactions}
          testID="race-reactions"
        />
      ) : null}
    </View>
  );
}

function BotCard({
  player,
  view,
  searching,
  reaction,
  hop,
}: {
  player: PlayerView;
  view: GameView;
  searching: boolean;
  reaction: { id: number; emoji: string } | null;
  hop: number | null;
}) {
  const { t } = useTranslation('levels');
  const { t: tHome } = useTranslation('home');
  const reduce = useReduceMotion();
  const who = identityOf(view, player.id);
  const name = who.name ?? player.name ?? '';
  const level = who.botLevel;
  const title = level ? tHome(`botSelect.levels.${level}.title`) : '';
  const spots = t('hud.race.spots', { count: player.score });

  // The bot's hop as it takes a spot (full motion only).
  const lift = useSharedValue(0);
  useEffect(() => {
    if (hop === null || reduce) return;
    lift.set(
      withSequence(
        withTiming(-HOP, timing(motion.duration.tapFeedbackMax, 'standard', reduce)),
        withTiming(0, timing(motion.duration.stateChange, 'standard', reduce)),
      ),
    );
  }, [hop, reduce, lift]);
  const hopStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));

  return (
    <View style={[styles.card, styles.cardBot]} testID="race-bot">
      <View
        style={styles.who}
        accessible
        accessibilityLabel={t('hud.race.botLabel', { name, n: level ?? '', title, spots })}
        testID="race-bot-who"
      >
        <Animated.View style={hopStyle} testID="race-bot-avatar">
          <Avatar avatarId={who.avatar} size="compact" colorIndex={1} bot />
        </Animated.View>
        <View style={styles.nameRow}>
          <SeatGlyph colorIndex={1} size={GLYPH} />
          <Text style={[styles.name, { color: color.players[1].ring }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        {level ? (
          <Text style={styles.tag} numberOfLines={1}>
            {t('hud.race.botTag', { n: level, title })}
          </Text>
        ) : null}
      </View>
      <View style={styles.botState}>
        {reaction ? (
          <Text key={reaction.id} style={styles.reaction} testID="race-bot-reaction">
            {reaction.emoji}
          </Text>
        ) : searching ? (
          <Text style={styles.searching} testID="race-bot-searching">
            {t('hud.race.searching')}
          </Text>
        ) : null}
        <Text style={styles.count} testID="race-bot-spots">
          {player.score}
        </Text>
      </View>
    </View>
  );
}

const GLYPH = 10;
const HOP = 6;

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  cards: { flexDirection: 'row', alignItems: 'stretch', gap: space[4] },
  card: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    backgroundColor: color.surface,
  },
  cardMe: { borderColor: color.players[0].ring },
  cardBot: { borderColor: color.players[1].ring },
  who: { flex: 1, minWidth: 0, gap: space[2], alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { ...text('playerName'), flexShrink: 1 },
  tag: { ...text('caption'), color: color.textMuted },
  vs: { ...text('vsBadge'), color: color.textMuted, alignSelf: 'center' },
  botState: { alignItems: 'flex-end', gap: space[2] },
  searching: { ...text('caption'), color: color.textMuted },
  reaction: { ...text('h1') },
  count: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  task: { ...text('rowTitle'), color: color.text, flex: 1, minWidth: 0 },
  left: { ...text('label'), color: color.textMuted },
});
