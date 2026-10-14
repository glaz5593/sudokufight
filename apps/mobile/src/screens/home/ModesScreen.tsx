import type { GameType } from '@sudoku-fight/engine';
import type { RatingEntry } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSuspended } from '../../api/me';
import type { AvatarIdOrNone } from '../../avatars';
import { useAuth } from '../../auth/authStore';
import { Icon } from '../../components/Icon';
import { Avatar, SeatGlyph } from '../../components/player';
import { useConnectivityWatch } from '../../net/connectivity';
import { cue } from '../../services/feedback';
import { useProfile } from '../../state/profile';
import { color, radius, size, space, text, tokens } from '../../theme';
import { Announcer } from '../game/connection/Announcer';
import { isolateName } from '../game/hit/hitModel';
import {
  DEFAULT_GAME_TYPE,
  isAvailable,
  isOpenPlayerCount,
  MODE_GROUPS,
  MODE_OPTIONS,
  type ModeGroup,
  type ModeOption,
  rankedRatingIn,
} from './homeModel';
import { goBack } from './navigation';
import { OfflineActions, OfflineBanner } from './OfflineBanner';
import { Chip, GUTTER, ScreenHeader, SectionLabel } from './parts';

/**
 * "משחק חדש" (spec §5.1, the Modes board in direction C): exactly five options, ranked 2 · 3 · 4 and the two
 * practices. The practices open the game type (a bot practice goes on to the bot selection); a ranked table
 * (2 players since stage 9, 3 and 4 since stage 10) opens the game type of a ranked game, then the search,
 * and shows my rating in that type, in its queue's rating key (spec §11.1: `normal`, or `normal-3p` under
 * RATING_OPTION A). An option this build has not opened (homeModel AVAILABLE_MODES) says "בקרוב".
 *
 * No connection (spec §16.1; the Offline board): the app asks the server (GET /health, net/connectivity.ts)
 * when the screen opens. Without an answer the ranked cards are dimmed with "דורש חיבור", the banner "אין
 * חיבור לאינטרנט" shows, the practices say "זמין אופליין", and the bottom offers "עבור לאימון" and "בדוק
 * שוב" ("עדיין אין חיבור · ניסיון 2" after another miss); meanwhile it checks again in the background, and
 * the ranked cards come back with the connection.
 *
 * A suspended account (spec §3.5): the ranked cards are dimmed with "החשבון מושעה", and the group's note says why.
 */
export function ModesScreen() {
  const { t } = useTranslation('home');
  const { top, bottom } = useSafeAreaInsets();
  const avatarId = useProfile((s) => s.avatarId);
  const lastPlay = useProfile((s) => s.lastPlay);
  const ratings = useAuth((s) => s.me?.ratings ?? null);
  // Who is playing, at the end of the header (the Modes board): the account's name, else the phone's.
  const accountName = useAuth((s) => s.me?.displayName ?? null);
  const localName = useProfile((s) => s.name);
  const myName = accountName ?? localName;
  const connectivity = useConnectivityWatch();
  const offline = connectivity.status === 'offline';
  const suspended = useAuth((s) => isSuspended(s.me));
  const announcement = useConnectionLine(offline);
  const rankedType: GameType = lastPlay?.mode === 'ranked' ? lastPlay.gameType : DEFAULT_GAME_TYPE;

  const open = (option: ModeOption) => {
    if (!isAvailable(option.key) || ((offline || suspended) && option.group === 'ranked')) return;
    cue('toggle');
    const gameType = lastPlay?.mode === option.mode ? lastPlay.gameType : undefined;
    const params: Record<string, string> = { mode: option.mode };
    if (gameType) params.gameType = gameType;
    if (option.mode === 'ranked') params.players = String(option.players);
    router.push({ pathname: '/game-type', params });
  };

  const practice = () => {
    cue('primaryPress');
    router.push({ pathname: '/game-type', params: { mode: 'solo' } });
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader
        title={t('modes.title')}
        onBack={goBack}
        end={<Me name={myName} avatarId={avatarId} />}
        style={styles.header}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: (offline ? 0 : bottom) + space[12] }]}
      >
        {offline ? <OfflineBanner checking={connectivity.checking} /> : null}
        {MODE_GROUPS.map((group) => (
          <Group
            key={group}
            group={group}
            avatarId={avatarId}
            offline={offline}
            suspended={suspended}
            ratings={group === 'ranked' ? ratings : null}
            rankedType={rankedType}
            onOpen={open}
          />
        ))}
        {offline ? null : <Text style={styles.footnote}>{t('modes.footnote')}</Text>}
      </ScrollView>
      {offline ? (
        <OfflineActions
          checking={connectivity.checking}
          failures={connectivity.failures}
          onPractice={practice}
          onCheck={() => void connectivity.check()}
          bottom={bottom}
        />
      ) : null}
      <Announcer line={announcement} testID="modes-live" />
    </View>
  );
}

/**
 * Me, at the end of the header (the Modes board): my name (isolated, in its own direction) and my avatar in P1's
 * frame. Read as the name; the avatar next to it is decorative.
 */
function Me({ name, avatarId }: { name: string | null; avatarId: AvatarIdOrNone }) {
  return (
    <View style={styles.me} testID="modes-me">
      {name ? (
        <Text style={styles.meName} numberOfLines={1}>
          {isolateName(name)}
        </Text>
      ) : null}
      <Avatar avatarId={avatarId} size="compact" colorIndex={0} testID="modes-me-avatar" />
    </View>
  );
}

/** What a screen reader hears as the connection goes: "no connection", then "back online". */
function useConnectionLine(offline: boolean): string | null {
  const { t } = useTranslation('match');
  const [wasOffline, setWasOffline] = useState(false);
  // Derived during render (no extra effect pass): once offline, a return is worth saying.
  if (offline && !wasOffline) setWasOffline(true);
  return offline ? t('offline.title') : wasOffline ? t('offline.back') : null;
}

interface CardContext {
  avatarId: AvatarIdOrNone;
  offline: boolean;
  /** The account is suspended (spec §3.5): no ranked games. */
  suspended: boolean;
  /** My ratings (the account's), for the open ranked cards: each shows its own queue's. */
  ratings: readonly RatingEntry[] | null;
  rankedType: GameType;
}

function Group({
  group,
  onOpen,
  ...context
}: CardContext & { group: ModeGroup; onOpen: (option: ModeOption) => void }) {
  const { t } = useTranslation('home');
  const { t: tm } = useTranslation('match');
  const options = MODE_OPTIONS.filter((o) => o.group === group);
  // The Modes board: the 2-player card across the width, then 3 and 4 side by side.
  const [wide, ...pair] = group === 'ranked' ? options : [];
  const note =
    context.suspended && group === 'ranked'
      ? t('moderation:suspended.chip')
      : !context.offline
        ? t(`modes.groups.${group}.note`)
        : group === 'ranked'
          ? tm('offline.rankedNote')
          : tm('offline.practiceNote');
  const card = (o: ModeOption, compact = false) => (
    <ModeCard key={o.key} option={o} onPress={() => onOpen(o)} compact={compact} {...context} />
  );
  return (
    <View style={styles.group}>
      <SectionLabel
        icon={group === 'ranked' ? (context.offline ? 'lock' : 'trophy') : 'target'}
        title={t(`modes.groups.${group}.title`)}
        note={note}
      />
      {wide ? (
        <>
          {card(wide)}
          <View style={styles.pair}>{pair.map((o) => card(o, true))}</View>
        </>
      ) : (
        options.map((o) => card(o))
      )}
    </View>
  );
}

function ModeCard({
  option,
  avatarId,
  offline,
  suspended,
  ratings,
  rankedType,
  onPress,
  compact = false,
}: CardContext & { option: ModeOption; onPress: () => void; compact?: boolean }) {
  const { t } = useTranslation('home');
  const { t: tm } = useTranslation('match');
  const ranked = option.group === 'ranked';
  const built = isAvailable(option.key);
  // Spec §3.5: a suspended account plays no ranked game (it says so over "no connection": it lasts longer).
  const barred = ranked && suspended && built;
  // Spec §16.1: no connection, no ranked game (practice works offline).
  const needsConnection = ranked && offline && built && !barred;
  const available = built && !needsConnection && !barred;
  const title = t(`modes.${option.key}.title`);
  const tagline = t(`modes.${option.key}.tagline`);
  const typeName = t(`gameTypes.${rankedType}.name`);
  const shownRating =
    ranked && available && isOpenPlayerCount(option.players)
      ? rankedRatingIn(ratings, rankedType, option.players)
      : null;
  const chips = ranked
    ? [
        shownRating
          ? `${tm('modes.rating', { rating: shownRating.rating })}${t('player:sep')}${typeName}`
          : t('modes.chips.rated'),
      ]
    : [t('modes.chips.unrated'), offline ? tm('offline.availableOffline') : t('modes.chips.offline')];
  const label = [
    t(`modes.${option.key}.label`),
    tagline,
    ...(shownRating ? [tm('modes.ratingLabel', { rating: shownRating.rating, type: typeName })] : chips),
    barred
      ? t('moderation:suspended.chipLabel')
      : needsConnection
        ? tm('offline.needsConnectionLabel')
        : built
          ? null
          : t('modes.soon'),
  ]
    .filter(Boolean)
    .join(t('player:listSep'));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        compact ? styles.cardCompact : styles.cardRow,
        available ? styles.cardAvailable : styles.cardSoon,
        (needsConnection || barred) && styles.cardOffline,
        pressed && styles.cardPressed,
      ]}
      testID={`mode-${option.key}`}
    >
      <Leading option={option} avatarId={avatarId} />
      <View style={[styles.texts, compact && styles.textsCompact]}>
        <Text style={[styles.title, !available && styles.titleSoon]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.tagline} numberOfLines={compact ? 2 : 1}>
          {tagline}
        </Text>
        <View style={styles.chips}>
          {barred ? (
            <OfflineChip label={t('moderation:suspended.chip')} testID={`suspended-${option.key}`} />
          ) : needsConnection ? (
            <OfflineChip label={tm('offline.needsConnection')} testID={`offline-${option.key}`} />
          ) : built ? null : (
            <Chip label={t('modes.soon')} testID={`soon-${option.key}`} />
          )}
          {chips.map((c) => (
            <Chip key={c} label={c} testID={shownRating ? `rating-${option.key}` : undefined} />
          ))}
        </View>
      </View>
      {available && !compact ? (
        <Icon name="chevronForward" size={size.icon.chevron} color={color.iconFaint} />
      ) : null}
    </Pressable>
  );
}

/** "דורש חיבור" with the lock (the Offline board); "החשבון מושעה" the same way. */
function OfflineChip({ label, testID }: { label: string; testID?: string }) {
  return (
    <View style={styles.offlineChip} testID={testID}>
      <Icon name="lock" size={space[7]} color={color.textMuted} />
      <Text style={styles.offlineChipText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The picture at the start of a card: the seats of a ranked table, my avatar, or the bot. */
function Leading({ option, avatarId }: { option: ModeOption; avatarId: AvatarIdOrNone }) {
  if (option.mode === 'solo') return <Avatar avatarId={avatarId} size="card" colorIndex={0} />;
  return (
    <View style={styles.leadBox}>
      {option.mode === 'bot' ? (
        <Icon name="bot" size={size.icon.header} color={color.textMuted} />
      ) : (
        <View style={styles.seats}>
          {Array.from({ length: option.players }, (_, seat) => (
            <SeatGlyph key={seat} colorIndex={seat} size={SEAT_GLYPH} />
          ))}
        </View>
      )}
    </View>
  );
}

/** The seat shapes on a ranked card: four fit in the 44 box. */
const SEAT_GLYPH = 9;
/** The Modes board's chips (22). */
const CHIP_HEIGHT = 22;
/** Offline: the ranked cards stay readable but plainly out of reach. */
const OFFLINE_CARD_OPACITY = 0.6;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  me: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexShrink: 1, minWidth: 0 },
  meName: { ...text('label'), color: color.textMuted, flexShrink: 1 },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6], gap: space[10] },
  group: { gap: space[6] },
  pair: { flexDirection: 'row', gap: space[6] },
  card: {
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    padding: space[8],
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[7], minHeight: size.listRow },
  cardCompact: { flex: 1, minWidth: 0, gap: space[6] },
  cardAvailable: { backgroundColor: color.surface },
  cardSoon: { backgroundColor: color.bg },
  cardOffline: { borderStyle: 'dashed', opacity: OFFLINE_CARD_OPACITY },
  cardPressed: { backgroundColor: color.surface2 },
  leadBox: {
    width: size.touch,
    height: size.touch,
    borderRadius: radius.button,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space[1],
    maxWidth: size.touch - space[6],
  },
  texts: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  textsCompact: { flex: 0 },
  title: { ...text('h1'), color: color.text },
  titleSoon: { color: color.textMuted },
  tagline: { ...text('caption'), color: color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[3] },
  footnote: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  offlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: CHIP_HEIGHT,
    paddingHorizontal: space[4],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  offlineChipText: { ...text('micro'), color: color.textMuted },
});
