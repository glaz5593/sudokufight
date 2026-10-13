import type { MyProgress } from '@sudoku-fight/protocol';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarIdOrNone } from '../../avatars';
import { Icon } from '../../components/Icon';
import { Avatar, leagueProgress, ltr } from '../../components/player';
import {
  BottomNav,
  type NavTab,
  RowButton,
  SkeletonCard,
  SkeletonGroup,
  StateView,
} from '../../components/ui';
import type { ProgressStatus } from '../../progress/progressStore';
import { color, radius, size, space, text, tokens } from '../../theme';
import { Chip, SectionLabel } from '../home/parts';
import { groupDigits, xpText, type ProgressT } from '../player/playerCardModel';
import { Note, Panel, ProgressBar } from './parts';
import { interferenceCollection, leagueLadder, levelView, provisionalGames, xpRules } from './progressModel';

/**
 * The "הישגים" tab: achievements and progress (spec §15, §11.3; Progress.dc.html in direction C). My level
 * and the XP to the next one; my league on the ladder of the five, with the way to the next [D38]; how XP is
 * earned; the achievements (the list of 12 waits for Moshe's approval, stage 12: "בקרוב", the empty state of
 * spec §4.1); and the way into the interferences collection. Practice XP still waiting for the server [D41]
 * says so. Daily streaks and missions are V1.1 (spec §15), so they are not here.
 */

export interface ProgressScreenProps {
  /** My progress (saved on the phone, refreshed from the server); null before the first answer. */
  progress: MyProgress | null;
  status: ProgressStatus;
  /** Practice results not sent yet [D41]. */
  pending: number;
  myAvatar: AvatarIdOrNone;
  /** My level for the collection's count (unlockLevel, D17). */
  level: number | null;
  onOpenMyCard?: () => void;
  onOpenInterferences: () => void;
  onRetry: () => void;
  onTab: (tab: NavTab) => void;
  testID?: string;
}

export function ProgressScreen({
  progress,
  status,
  pending,
  myAvatar,
  level,
  onOpenMyCard,
  onOpenInterferences,
  onRetry,
  onTab,
  testID = 'progress',
}: ProgressScreenProps) {
  const { t } = useTranslation('progress');
  const { top } = useSafeAreaInsets();
  const collection = interferenceCollection(level);

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={[text('screenTitle'), styles.strong, styles.grow]}>
            {t('progress.title')}
          </Text>
          {onOpenMyCard ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.myCard')}
              onPress={onOpenMyCard}
              hitSlop={space[2]}
              testID="progress-my-card"
            >
              <Avatar avatarId={myAvatar} size="card" colorIndex={0} backdrop={color.bg} />
            </Pressable>
          ) : null}
        </View>

        {progress && (status === 'offline' || status === 'error') ? (
          <Note retry={{ label: t('common.retry'), onPress: onRetry }} testID="progress-note-offline">
            {t('progress.savedNote')}
          </Note>
        ) : null}
        {pending > 0 ? (
          <View style={styles.pending} testID="progress-pending">
            <Icon name="refresh" size={size.icon.inline} color={color.textMuted} />
            <Text style={[text('caption'), styles.muted, styles.grow]}>
              {t('progress.pending', { count: pending })}
            </Text>
          </View>
        ) : null}

        {progress ? (
          <>
            <LevelPanel progress={progress} />
            <LeaguePanel progress={progress} />
          </>
        ) : status === 'loading' || status === 'idle' ? (
          // Loading.dc.html: the level and league panels hold their place while they load.
          <SkeletonGroup label={t('common.loading')} style={styles.skeleton} testID="progress-loading">
            <SkeletonCard avatar={BADGE} lines={3} bar />
            <SkeletonCard avatar={0} lines={2} bar />
          </SkeletonGroup>
        ) : (
          // Spec §16.3: no connection, or the server failed; a plain explanation and "נסה שוב".
          <StateView
            tone="danger"
            icon={status === 'offline' ? 'wifiOff' : 'alert'}
            title={status === 'offline' ? t('common.offlineTitle') : t('common.errorTitle')}
            body={status === 'offline' ? t('progress.offlineBody') : t('common.errorBody')}
            actions={[
              { label: t('common.retry'), icon: 'refresh', onPress: onRetry, testID: 'progress-retry' },
            ]}
            testID={status === 'offline' ? 'progress-offline' : 'progress-error'}
          />
        )}

        <SectionLabel title={t('progress.howTitle')} />
        <Panel testID="progress-xp-rules">
          {xpRules().map((rule) => (
            <View key={rule.key} style={styles.rule}>
              <Text style={[text('body'), styles.strong, styles.grow]}>{t(`progress.how.${rule.key}`)}</Text>
              <Text style={[text('label'), styles.gold]}>{ltr(t('progress.xpPlus', { xp: rule.xp }))}</Text>
            </View>
          ))}
        </Panel>

        <SectionLabel title={t('achievements.title')} />
        <View style={styles.soon} testID="progress-achievements">
          <View style={styles.soonIcon}>
            <Icon name="trophy" size={size.icon.nav} color={color.textMuted} />
          </View>
          <Chip label={t('achievements.soon')} />
          <Text style={[text('bodyLong'), styles.muted, styles.centered]}>{t('achievements.soonBody')}</Text>
        </View>

        <RowButton
          icon="bolt"
          title={t('interferences.entry')}
          subtitle={t('interferences.entryNote', {
            open: collection.open.length,
            locked: collection.locked.length,
          })}
          onPress={onOpenInterferences}
          testID="progress-interferences"
        />
      </ScrollView>
      <BottomNav active="achievements" onSelect={onTab} testID="nav" />
    </View>
  );
}

function LevelPanel({ progress: p }: { progress: MyProgress }) {
  const { t } = useTranslation('progress');
  const tp = t as ProgressT;
  const view = levelView(p);
  const xp = xpText(view.into, view.total, tp);
  return (
    <Panel testID="progress-level">
      <View style={styles.levelRow}>
        <View
          style={styles.levelBadge}
          accessible
          accessibilityLabel={t('common.level', { level: view.level })}
        >
          <Text style={[text('scoreXL'), styles.gold]}>{view.level}</Text>
          <Text style={[text('micro'), styles.muted]}>{t('progress.levelWord')}</Text>
        </View>
        <View style={styles.grow}>
          <Text style={[text('label'), styles.muted]}>{t('progress.xpTitle')}</Text>
          <Text style={[text('h1'), styles.strong]} testID="progress-xp">
            {xp}
          </Text>
          <Text style={[text('caption'), styles.muted]} testID="progress-to-go">
            {t('progress.toGo', {
              xp: ltr(t('progress.xpValue', { xp: groupDigits(view.toGo) })),
              level: view.nextLevel,
            })}
          </Text>
        </View>
      </View>
      <ProgressBar
        share={view.share}
        label={t('common.xpToNext', { xp, level: view.nextLevel })}
        testID="progress-level-bar"
      />
    </Panel>
  );
}

function LeaguePanel({ progress: p }: { progress: MyProgress }) {
  const { t } = useTranslation('progress');
  const ladder = leagueLadder(p.league);
  const step = p.leagueRating === null ? null : leagueProgress(p.leagueRating);
  const line =
    p.league === null || step === null
      ? t('common.provisionalNote', { games: provisionalGames() })
      : step.next && step.toNext !== null
        ? t('league.general', {
            rating: Math.round(p.leagueRating!),
            next: t('league.toNext', { points: step.toNext, league: t(`player:league.${step.next}`) }),
          })
        : t('league.generalTop', { rating: Math.round(p.leagueRating!) });
  const name =
    p.league === null
      ? t('common.provisional')
      : t('player:league.name', { league: t(`player:league.${p.league}`) });
  return (
    <>
      <SectionLabel title={t('league.title')} />
      <Panel testID="progress-league">
        <View accessible accessibilityLabel={`${name}${t('player:listSep')}${line}`}>
          <Text style={[text('rowTitle'), { color: p.league ? color.league[p.league] : color.text }]}>
            {name}
          </Text>
          <Text style={[text('caption'), styles.muted]} testID="progress-league-line">
            {line}
          </Text>
        </View>
        {step && p.league ? (
          <ProgressBar share={step.share} fill={color.league[p.league]} testID="progress-league-bar" />
        ) : null}
        <View style={styles.ladder} accessibilityRole="list" accessibilityLabel={t('league.ladder')}>
          {ladder.map((s) => (
            <View
              key={s.league}
              style={[styles.ladderStep, s.current && { borderColor: color.league[s.league] }]}
              accessible
              accessibilityLabel={t('league.step', {
                league: t(`player:league.${s.league}`),
                floor: s.floor,
              })}
              accessibilityState={{ selected: s.current }}
              testID={`progress-league-${s.league}${s.current ? '-current' : ''}`}
            >
              <View
                style={[
                  styles.ladderDot,
                  { backgroundColor: s.reached ? color.league[s.league] : color.progress.track },
                ]}
              />
              <Text style={[text('micro'), s.reached ? styles.strong : styles.muted]} numberOfLines={1}>
                {t(`player:league.${s.league}`)}
              </Text>
              <Text style={[text('micro'), styles.muted]}>{ltr(`${s.floor}+`)}</Text>
            </View>
          ))}
        </View>
      </Panel>
    </>
  );
}

const BADGE = size.touch * 2;
const DOT = space[6];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: {
    paddingHorizontal: tokens.layout.gutterGame,
    paddingTop: space[8],
    paddingBottom: space[12],
    gap: space[8],
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  skeleton: { gap: space[8] },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface2,
  },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  levelBadge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: tokens.border.avatarFrame,
    borderColor: color.accent,
    backgroundColor: color.surface2,
  },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: size.touch },
  ladder: { flexDirection: 'row', gap: space[2] },
  ladderStep: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[4],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  ladderDot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  soon: {
    alignItems: 'center',
    gap: space[6],
    padding: space[10],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  soonIcon: {
    width: size.touch + space[6],
    height: size.touch + space[6],
    borderRadius: radius.xl,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1, minWidth: 0 },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  gold: { color: color.accent },
  centered: { textAlign: 'center' },
});
