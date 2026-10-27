import type { AppLevel, GameView } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import type { AvatarIdOrNone } from '../../../avatars';
import { BossCrown } from '../../../components/levels/BossBadge';
import { StarsBar } from '../../../components/levels/StarsBar';
import { Avatar, formatScore, SeatGlyph, signedText } from '../../../components/player';
import { secondsOf } from '../../../components/player/format';
import { IconButton } from '../../../components/ui';
import { Text } from '../../../components/ui/Text';
import { decimalSeparator } from '../../../i18n/compose';
import { color, radius, space, text, tokens } from '../../../theme';
import { identityOf } from '../../game/identity';
import { clockText } from './BoxHud';
import { levelClock, StageHeader } from './FindHud';
import { RaceTo30 } from './RaceTo30';

/**
 * The duel stage's HUD (components.md §19.7, the Lv-Sprint board; plan §2.4): the header (the X, the boss's
 * mark), my card and the bot's with their scores out of the target (● P1, ▲ P2), "מרוץ ל־30" (RaceTo30), the
 * stage's clock (it ends at the target or at 30 s), and the lead meter "פער ‎+10.5" with its marks at ★★ (8)
 * and ★★★ (15), the number an LTR isolate (signedText). No interference button: a stage has none [D49]; my
 * reactions only with LEVEL_UI.reactions (D62: off). The game screen's lock strip, board and keypad stay.
 *
 * A boss (levels-ui.md §3.2, D77): the header's boss band (StageHeader) and a 16 dp crown on the bot's avatar
 * (BossCrown, static), its label "Pip, הבוס".
 */

export interface DuelLevelHudProps {
  /** The stage as played (a duel, or its boss). */
  level: AppLevel;
  view: GameView;
  now: number;
  myAvatar: AvatarIdOrNone;
  onExit?: () => void;
  /** My reactions button: only with LEVEL_UI.reactions (D62: off). */
  onReactions?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function DuelLevelHud({ level, view, now, myAvatar, onExit, onReactions, style }: DuelLevelHudProps) {
  const { t } = useTranslation('levels');
  const decimal = decimalSeparator(t);
  const lv = view.level;
  const me = view.players.find((p) => p.id === view.me) ?? null;
  const bot = view.players.find((p) => p.id !== view.me) ?? null;
  const progress = lv?.progress?.kind === 'score' ? lv.progress : null;
  const target = progress?.target ?? (level.kind === 'duel' ? level.targets.endAtScore : 30);
  const mine = progress?.mine ?? me?.score ?? 0;
  const theirs = progress?.opponent ?? bot?.score ?? 0;
  const gap = mine - theirs;
  const who = bot ? identityOf(view, bot.id) : null;
  const botName = who?.name ?? bot?.name ?? '';
  const botLabelName = level.boss ? t('boss.botLabel', { name: botName }) : botName;
  const myName = t('hud.me');
  const left = lv ? levelClock(lv, now).remainingMs : 0;
  const marks = lv?.marks ?? level.stars;
  const two = marks.by === 'gap' ? marks.two : 0;
  const three = marks.by === 'gap' ? marks.three : 0;
  return (
    <View style={[styles.hud, style]} testID="duel-hud">
      <StageHeader
        level={level}
        onExit={onExit}
        end={
          onReactions ? (
            <IconButton
              icon="reactions"
              accessibilityLabel={t('hud.reactions')}
              onPress={onReactions}
              testID="duel-reactions"
            />
          ) : null
        }
      />
      <View style={styles.cards}>
        <ScoreCard
          name={myName}
          avatar={myAvatar}
          colorIndex={0}
          score={mine}
          target={target}
          label={t('hud.duel.meLabel', {
            name: myName,
            score: formatScore(mine, decimal),
            target,
            count: target,
          })}
          testID="duel-me"
        />
        <View style={styles.middle}>
          <Text
            style={styles.clock}
            accessibilityRole="timer"
            accessibilityLabel={t('hud.duel.finishLabel', { target, s: secondsOf(left) })}
            testID="duel-clock"
          >
            {clockText(left)}
          </Text>
        </View>
        <ScoreCard
          name={botName}
          avatar={who?.avatar ?? null}
          colorIndex={1}
          score={theirs}
          target={target}
          bot
          crown={level.boss}
          label={t('hud.duel.botLabel', {
            name: botLabelName,
            n: who?.botLevel ?? '',
            score: formatScore(theirs, decimal),
            target,
            count: target,
          })}
          testID="duel-bot"
        />
      </View>
      <RaceTo30
        mine={mine}
        theirs={theirs}
        target={target}
        myName={myName}
        botName={botName}
        botLevel={who?.botLevel ?? null}
      />
      <View
        style={styles.gap}
        accessible
        accessibilityLabel={t('hud.duel.gapLabel', { gap: signedText(gap, decimal), two, three })}
        testID="duel-gap"
      >
        <Text style={styles.gapText} testID="duel-gap-text">
          {t('hud.duel.gap', { gap: signedText(gap, decimal) })}
        </Text>
        <View style={styles.gapBar}>
          <StarsBar rule={marks} value={Math.max(0, gap)} testID="duel-gap-bar" />
        </View>
      </View>
    </View>
  );
}

function ScoreCard({
  name,
  avatar,
  colorIndex,
  score,
  target,
  bot = false,
  crown = false,
  label,
  testID,
}: {
  name: string;
  avatar: AvatarIdOrNone | null;
  colorIndex: number;
  score: number;
  target: number;
  bot?: boolean;
  /** A boss's bot: the crown on its avatar. */
  crown?: boolean;
  label: string;
  testID: string;
}) {
  const { t } = useTranslation('levels');
  const p = color.players[colorIndex]!;
  const decimal = decimalSeparator(t);
  return (
    <View
      style={[styles.card, { borderColor: p.ring }]}
      accessible
      accessibilityLabel={label}
      testID={testID}
    >
      <View>
        <Avatar avatarId={avatar} size="compact" colorIndex={colorIndex} bot={bot} />
        {crown ? <BossCrown testID={`${testID}-crown`} /> : null}
      </View>
      <View style={styles.cardText}>
        <View style={styles.nameRow}>
          <SeatGlyph colorIndex={colorIndex} size={GLYPH} />
          <Text style={[styles.name, { color: p.ring }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View style={styles.scoreRow}>
          <Text style={styles.score} testID={`${testID}-score`}>
            {formatScore(score, decimal)}
          </Text>
          <Text style={styles.of}>{t('hud.duel.of', { target })}</Text>
        </View>
      </View>
    </View>
  );
}

const GLYPH = 10;

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
  cardText: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  name: { ...text('playerName'), flexShrink: 1 },
  // Scores are Latin numbers: "15/30" reads left to right in Hebrew too.
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', direction: 'ltr' },
  score: { ...text('scoreCompact'), color: color.text },
  of: { ...text('caption'), color: color.textMuted },
  middle: { alignItems: 'center', justifyContent: 'center' },
  clock: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  gap: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  gapText: { ...text('rowTitle'), color: color.text },
  gapBar: { flex: 1, minWidth: 0 },
});
