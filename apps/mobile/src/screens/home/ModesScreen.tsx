import { type GameType, maxLevel } from '@sudoku-fight/engine';
import type { RatingEntry } from '@sudoku-fight/protocol';
import { router, useFocusEffect } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSuspended } from '../../api/me';
import type { AvatarIdOrNone } from '../../avatars';
import { useAuth } from '../../auth/authStore';
import { Icon, type IconName } from '../../components/Icon';
import { LevelTile } from '../../components/levels/LevelTile';
import { Avatar, paletteAt, SeatGlyph } from '../../components/player';
import { Button, type ButtonSize } from '../../components/ui/Button';
import { FRIENDS_UI } from '../../config/friends';
import type { LevelsSummary } from '../../levels/levelsRepo';
import { refreshLevels, useLevelsSummary } from '../../levels/levelsStore';
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
  MODE_OPTIONS,
  type ModeGroup,
  type ModeOption,
  modesSections,
  rankedRatingIn,
} from './homeModel';
import { goBack } from './navigation';
import { OfflineActions, OfflineBanner } from './OfflineBanner';
import { Chip, GUTTER, ScreenHeader, SectionLabel } from './parts';

/**
 * "משחק חדש" (spec §5.1, the Modes board in direction C): six options, ranked 2 · 3 · 4, then practice against a
 * bot, solo practice ("אימון לבד · לוח מלא") and staged practice ("אימון בשלבים", D48; Modes-Levels). Each is a
 * row of its own, compact enough that the six fit on a 360 × 780 phone without scrolling (Moshe's device test,
 * 15.10.2026; the budget is in ModesAndGameType.test). Staged practice opens its map (/levels); its row shows a
 * stage tile, "שלב 14 · ★ 29" from levels.db (never the stages' data file), or "300 שלבים קצרים" for a new
 * player. The other practices open the game type (a bot practice goes on to the bot selection); a ranked table
 * (2 players since stage 9, 3 and 4 since stage 10) opens the game type of a ranked game, then the search. An
 * option this build has not opened (homeModel AVAILABLE_MODES) says "בקרוב".
 *
 * Playing with friends (1.0.4, friends-room.md §2, D80a, Moshe's yes of 2026-10-20): two buttons, "צור חדר" |
 * "הצטרף עם קוד". Since Moshe's device test of 2026-10-23 [D100] they are pinned under the list, always in view
 * without scrolling, and drawn as the app's own buttons (FriendsFooter: the primary and the secondary, as every
 * other bottom of a screen); FRIENDS_UI.modesPlacement 'list' puts back 1.0.4's group "עם חברים" between the
 * ranked tables and the practices (FriendsGroup). Either way, a ranked row no longer shows my rating ("דירוג
 * 1287 · מהיר": the next screen does; FRIENDS_UI.rankedChip brings it back, in its queue's rating key, spec
 * §11.1) and the footnote goes; the budget test keeps it all on a 360 × 780 phone, in Hebrew and English.
 *
 * No connection (spec §16.1; the Offline board): the app asks the server (GET /health, net/connectivity.ts)
 * when the screen opens. Without an answer the ranked cards are dimmed with "דורש חיבור", the banner "אין
 * חיבור לאינטרנט" shows, the practices say "זמין אופליין", and the bottom offers "עבור לאימון" and "בדוק
 * שוב" ("עדיין אין חיבור · ניסיון 2" after another miss), in the friends footer's place (a room needs the
 * connection, and the banner says so); meanwhile it checks again in the background, and the ranked cards and
 * the friends buttons come back with the connection.
 *
 * A suspended account (spec §3.5): the ranked cards are dimmed with "החשבון מושעה", and the friends buttons are
 * disabled, with the same words over them (or, in the list, as the group's note).
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
  // Staged practice's row: my progress from levels.db, read again each time the screen is shown.
  const levels = useLevelsSummary();
  useFocusEffect(
    useCallback(() => {
      void refreshLevels();
    }, []),
  );

  const open = (option: ModeOption) => {
    if (!isAvailable(option.key) || ((offline || suspended) && option.group === 'ranked')) return;
    cue('toggle');
    if (option.mode === null) {
      router.push('/levels');
      return;
    }
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

  // Playing with friends (1.0.4, D80a): the room opens at once, with my last game type [D82]; or the code's six
  // boxes. Where the buttons sit is a setting [D100]: under the list (offline, the offline bottom is there
  // instead), or a group in it.
  const friends = FRIENDS_UI.modesGroup ? FRIENDS_UI.modesPlacement : null;
  const friendsFooter = friends === 'footer' && !offline;
  const createRoom = () => {
    if (offline || suspended) return;
    cue('primaryPress');
    router.push({ pathname: '/friends/room', params: { create: '1' } });
  };
  const joinRoom = () => {
    if (offline || suspended) return;
    cue('toggle');
    router.push('/friends/join');
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
        testID="modes-scroll"
        contentContainerStyle={[
          styles.content,
          // Over a bottom of the screen's own (the friends footer, or offline's), which takes the inset.
          { paddingBottom: (offline || friendsFooter ? 0 : bottom) + CONTENT_BOTTOM },
        ]}
      >
        {offline ? <OfflineBanner checking={connectivity.checking} /> : null}
        {modesSections(friends === 'list').map((group) =>
          group === 'friends' ? (
            <FriendsGroup
              key={group}
              offline={offline}
              suspended={suspended}
              onCreate={createRoom}
              onJoin={joinRoom}
            />
          ) : (
            <Group
              key={group}
              group={group}
              avatarId={avatarId}
              offline={offline}
              suspended={suspended}
              ratings={group === 'ranked' ? ratings : null}
              rankedType={rankedType}
              levels={levels}
              onOpen={open}
            />
          ),
        )}
        {/* The friends buttons take the footnote's place, in the list or under it (friends-room.md §2: it
            repeats the rows' chips). */}
        {offline || friends !== null ? null : <Text style={styles.footnote}>{t('modes.footnote')}</Text>}
      </ScrollView>
      {offline ? (
        <OfflineActions
          checking={connectivity.checking}
          failures={connectivity.failures}
          onPractice={practice}
          onCheck={() => void connectivity.check()}
          bottom={bottom}
        />
      ) : friendsFooter ? (
        <FriendsFooter suspended={suspended} onCreate={createRoom} onJoin={joinRoom} bottom={bottom} />
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
  /** Staged practice: my stages played, stars and current stage (levels.db), or none yet. */
  levels: LevelsSummary | null;
}

/** A chip of a row: its words, and for staged practice a gold star and a number after them. */
interface ChipSpec {
  label: string;
  /** What it says in the card's label, when it is not its words ("שלב 14 · 29 כוכבים"). */
  spoken?: string;
  icon?: IconName;
  value?: string;
  testID?: string;
}

function Group({
  group,
  onOpen,
  ...context
}: CardContext & { group: ModeGroup; onOpen: (option: ModeOption) => void }) {
  const { t } = useTranslation('home');
  const { t: tm } = useTranslation('match');
  // Every option is a row of its own, ranked 3 and 4 too; the rows are compact so a sixth type fits (Moshe's
  // device test, 15.10.2026).
  const options = MODE_OPTIONS.filter((o) => o.group === group);
  const note =
    context.suspended && group === 'ranked'
      ? t('moderation:suspended.chip')
      : !context.offline
        ? t(`modes.groups.${group}.note`)
        : group === 'ranked'
          ? tm('offline.rankedNote')
          : tm('offline.practiceNote');
  return (
    <View style={styles.group} testID={`modes-group-${group}`}>
      <SectionLabel
        icon={group === 'ranked' ? (context.offline ? 'lock' : 'trophy') : 'target'}
        title={t(`modes.groups.${group}.title`)}
        note={note}
      />
      {options.map((o) => (
        <ModeCard key={o.key} option={o} onPress={() => onOpen(o)} {...context} />
      ))}
    </View>
  );
}

/**
 * The friends buttons pinned under the list [D100] (Moshe's device test of 2026-10-23: in the middle of the
 * screen, drawn unlike any other button, they looked odd): the bottom every screen with an action has (the
 * hairline rule, the screen's ground, the gutters, the inset under it; as GameType's and OfflineActions), with
 * two of the app's buttons side by side, each half the row: "צור חדר" the one primary (the room opens at once)
 * and first in reading order, on the right in Hebrew; "הצטרף עם קוד" the secondary (most friends come in by a
 * link). Their size is the pair's, 'modal' (48: ConfirmModal's dialog, the room's "שתף קישור" | "העתק קוד"):
 * at 'lg' or 'md' the primary's words are too large for half of a 360 dp row. No caption: the buttons say what
 * they do, and the rows above keep their room. Not shown without a connection (the offline bottom is there).
 * A suspended account (spec §3.5): both disabled, "החשבון מושעה" over them, and each label says why.
 */
function FriendsFooter({
  suspended,
  onCreate,
  onJoin,
  bottom,
}: {
  suspended: boolean;
  onCreate: () => void;
  onJoin: () => void;
  /** The bottom safe area. */
  bottom: number;
}) {
  const { t } = useTranslation('home');
  const why = suspended ? t('moderation:suspended.chipLabel') : null;
  const spoken = (label: string) => (why ? [label, why].join(t('player:listSep')) : label);
  const create = t('modes.friends.create');
  const join = t('modes.friends.join');
  return (
    <View style={[styles.footer, { paddingBottom: bottom + space[8] }]} testID="modes-group-friends">
      {suspended ? (
        <View style={styles.footerNote} testID="suspended-friends">
          <Icon name="lock" size={space[7]} color={color.textMuted} />
          <Text style={styles.offlineChipText} numberOfLines={1}>
            {t('moderation:suspended.chip')}
          </Text>
        </View>
      ) : null}
      <View style={styles.footerRow}>
        <Button
          label={create}
          size={FOOTER_BUTTON}
          disabled={suspended}
          onPress={onCreate}
          accessibilityLabel={spoken(create)}
          accessibilityHint={suspended ? undefined : t('modes.friends.createHint')}
          style={styles.half}
          testID="modes-friends-create"
        />
        <Button
          label={join}
          variant="secondary"
          size={FOOTER_BUTTON}
          disabled={suspended}
          onPress={onJoin}
          accessibilityLabel={spoken(join)}
          accessibilityHint={suspended ? undefined : t('modes.friends.joinHint')}
          style={styles.half}
          testID="modes-friends-join"
        />
      </View>
    </View>
  );
}

/**
 * "עם חברים" in the list (1.0.4, D80a; friends-room.md §2; FRIENDS_UI.modesPlacement 'list'): one row of two
 * buttons between the ranked tables and the practices: "צור חדר" (the room opens at once, the accent's) and
 * "הצטרף עם קוד" (the quieter one: most friends come in by a link). Its name is D80b's (FRIENDS_UI.groupName).
 * No connection, or a suspended account: dimmed, as the ranked rows, with the same note.
 */
function FriendsGroup({
  offline,
  suspended,
  onCreate,
  onJoin,
}: {
  offline: boolean;
  suspended: boolean;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const { t } = useTranslation('home');
  const { t: tm } = useTranslation('match');
  const note = suspended
    ? t('moderation:suspended.chip')
    : offline
      ? tm('offline.rankedNote')
      : t('modes.groups.friends.note');
  const why = suspended
    ? t('moderation:suspended.chipLabel')
    : offline
      ? tm('offline.needsConnectionLabel')
      : null;
  return (
    <View style={styles.group} testID="modes-group-friends">
      <SectionLabel
        icon={offline ? 'lock' : 'share'}
        title={t(
          FRIENDS_UI.groupName === 'moshe' ? 'modes.groups.friends.titleMoshe' : 'modes.groups.friends.title',
        )}
        note={note}
      />
      <View style={styles.friendsRow}>
        <FriendsButton
          label={t('modes.friends.create')}
          hint={t('modes.friends.createHint')}
          why={why}
          primary
          onPress={onCreate}
          testID="modes-friends-create"
        />
        <FriendsButton
          label={t('modes.friends.join')}
          hint={t('modes.friends.joinHint')}
          why={why}
          onPress={onJoin}
          testID="modes-friends-join"
        />
      </View>
    </View>
  );
}

function FriendsButton({
  label,
  hint,
  why,
  primary = false,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  /** Why it is out of reach (no connection, suspended); null when it is not. */
  why: string | null;
  primary?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation('home');
  const disabled = why !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={why ? [label, why].join(t('player:listSep')) : label}
      accessibilityHint={disabled ? undefined : hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.friendsButton,
        primary && styles.friendsPrimary,
        disabled && styles.cardOffline,
        pressed && styles.cardPressed,
      ]}
      testID={testID}
    >
      <Text style={[styles.friendsLabel, primary && styles.friendsLabelPrimary]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ModeCard({
  option,
  avatarId,
  offline,
  suspended,
  ratings,
  rankedType,
  levels,
  onPress,
}: CardContext & { option: ModeOption; onPress: () => void }) {
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
  // A new player (nothing played yet, or no account): the stages there are, and no progress chip.
  const fresh = option.key === 'levels' && (levels === null || levels.played === 0);
  const tagline = fresh
    ? t('modes.levels.taglineNew', { total: maxLevel() })
    : t(`modes.${option.key}.tagline`);
  const typeName = t(`gameTypes.${rankedType}.name`);
  // [D80a] The ranked rows say no rating since 1.0.4 (two lines each; my rating is on the next screen and
  // Home's card): FRIENDS_UI.rankedChip brings back "דירוג 1287 · מהיר".
  const shownRating =
    ranked && available && FRIENDS_UI.rankedChip && isOpenPlayerCount(option.players)
      ? rankedRatingIn(ratings, rankedType, option.players)
      : null;
  const chips = chipsOf(option, { offline, fresh, levels, shownRating, typeName, t, tm });
  const tag = barred || needsConnection || !built;
  const label = [
    t(`modes.${option.key}.label`),
    tagline,
    ...(shownRating
      ? [tm('modes.ratingLabel', { rating: shownRating.rating, type: typeName })]
      : chips.map((c) => c.spoken ?? c.label)),
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
        available ? styles.cardAvailable : styles.cardSoon,
        (needsConnection || barred) && styles.cardOffline,
        pressed && styles.cardPressed,
      ]}
      testID={`mode-${option.key}`}
    >
      <Leading option={option} avatarId={avatarId} stage={levels?.current ?? 1} />
      <View style={styles.texts}>
        <Text style={[styles.title, !available && styles.titleSoon]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.tagline} numberOfLines={1}>
          {tagline}
        </Text>
        {chips.length > 0 || tag ? (
          <View style={styles.chips}>
            {barred ? (
              <OfflineChip label={t('moderation:suspended.chip')} testID={`suspended-${option.key}`} />
            ) : needsConnection ? (
              <OfflineChip label={tm('offline.needsConnection')} testID={`offline-${option.key}`} />
            ) : built ? null : (
              <Chip label={t('modes.soon')} testID={`soon-${option.key}`} />
            )}
            {chips.map((c) => (
              <Chip
                key={c.label}
                label={c.label}
                icon={c.icon}
                iconColor={color.star.filled}
                iconFilled
                value={c.value}
                testID={c.testID}
              />
            ))}
          </View>
        ) : null}
      </View>
      {available ? <Icon name="chevronForward" size={size.icon.chevron} color={color.iconFaint} /> : null}
    </Pressable>
  );
}

/**
 * A row's chips: none on a ranked table since 1.0.4 [D80a] (FRIENDS_UI.rankedChip: its rating, or "דירוג"); a practice's "ללא דירוג" and "עובד גם בלי אינטרנט";
 * staged practice's "עובד גם בלי אינטרנט" (no "ללא דירוג": stages never had one), and after its first stage its
 * progress, "שלב 14 · ★ 29", beside the short "גם אופליין".
 */
function chipsOf(
  option: ModeOption,
  {
    offline,
    fresh,
    levels,
    shownRating,
    typeName,
    t,
    tm,
  }: {
    offline: boolean;
    fresh: boolean;
    levels: LevelsSummary | null;
    shownRating: RatingEntry | null;
    typeName: string;
    t: TFunction<'home'>;
    tm: TFunction<'match'>;
  },
): ChipSpec[] {
  const worksWords = offline ? tm('offline.availableOffline') : t('modes.chips.offline');
  const works = { label: worksWords };
  if (option.group === 'ranked') {
    if (!FRIENDS_UI.rankedChip) return [];
    return [
      shownRating
        ? {
            label: `${tm('modes.rating', { rating: shownRating.rating })}${t('player:sep')}${typeName}`,
            testID: `rating-${option.key}`,
          }
        : { label: t('modes.chips.rated') },
    ];
  }
  if (option.key !== 'levels') return [{ label: t('modes.chips.unrated') }, works];
  if (fresh || !levels) return [works];
  // Beside "שלב 300 · ★ 900" the long words do not fit the row's one chip line on a 360 dp phone
  // (modesChipWidth.test): the chip says it short, the card's label in full.
  return [
    {
      label: t('modes.levels.chip', { stage: levels.current }),
      spoken: t('modes.levels.chipLabel', { stage: levels.current, count: levels.stars }),
      icon: 'star',
      value: String(levels.stars),
      testID: 'levels-progress-chip',
    },
    { label: t('modes.levels.offline'), spoken: worksWords },
  ];
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

/**
 * The picture at the start of a card: the seats of a ranked table, my avatar, the bot, or (staged practice) a
 * stage tile with my current stage's number (Modes-Levels; decorative, the card's label says it).
 */
function Leading({
  option,
  avatarId,
  stage,
}: {
  option: ModeOption;
  avatarId: AvatarIdOrNone;
  stage: number;
}) {
  if (option.key === 'levels') {
    return <LevelTile n={stage} size={size.touch} state="played" testID="mode-levels-lead" />;
  }
  if (option.mode === 'solo') {
    return <Avatar avatarId={avatarId} size="card" colorIndex={0} testID="mode-solo-avatar" />;
  }
  if (option.mode === 'bot') return <BotLead />;
  return (
    <View style={styles.leadBox}>
      <View style={styles.seats}>
        {Array.from({ length: option.players }, (_, seat) => (
          <SeatGlyph key={seat} colorIndex={seat} size={SEAT_GLYPH} />
        ))}
      </View>
    </View>
  );
}

/**
 * The bot practice's picture (Moshe's device test, 15.10.2026: the old one was not clear enough): the robot in
 * the opponent's colour, in a frame the size of my avatar's on the solo card, as the Modes board drew it.
 * Decorative: the card's label says what it is, and its shape tells it apart from the avatar without colour.
 */
function BotLead() {
  return (
    <View
      style={styles.botLead}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="mode-bot-lead"
    >
      <Icon name="bot" size={BOT_GLYPH} color={BOT_PALETTE.ring} />
    </View>
  );
}

/** The seat shapes on a ranked card: four fit in the 44 box. */
const SEAT_GLYPH = 9;
/**
 * The bot is my one opponent, so this phone shows it in P2 (theme paletteForSeat): its frame and its robot, as
 * the Modes board drew them.
 */
const BOT_COLOR_INDEX = 1;
const BOT_PALETTE = paletteAt(BOT_COLOR_INDEX);
/** The robot in the bot's frame: the Modes board's 26 in a 40 box, scaled to the 44 frame (no token). */
const BOT_GLYPH = 28;
/** Under the last row: above the navigation bar's inset, or above the screen's own bottom (it takes the inset). */
const CONTENT_BOTTOM = space[8];
/** The friends footer's two buttons, side by side: the pair's size (see FriendsFooter). */
const FOOTER_BUTTON: ButtonSize = 'modal';
/** The Modes board's chips (22). */
const CHIP_HEIGHT = 22;
/** Offline: the ranked cards stay readable but plainly out of reach. */
const OFFLINE_CARD_OPACITY = 0.6;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  me: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexShrink: 1, minWidth: 0 },
  meName: { ...text('label'), color: color.textMuted, flexShrink: 1 },
  // Compact (Moshe's device test, 15.10.2026): six rows and the footnote fit on a 360 × 780 phone.
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[4], gap: space[8] },
  group: { gap: space[4] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.listRow,
    paddingVertical: space[3],
    paddingHorizontal: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
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
  botLead: {
    width: size.avatar.card.frame,
    height: size.avatar.card.frame,
    borderRadius: size.avatar.card.frameRadius,
    borderWidth: size.avatar.card.border,
    borderColor: BOT_PALETTE.ring,
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
  // The title's and the tagline's line heights already space them; the chips sit 2 under the tagline.
  texts: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  title: { ...text('sheetTitle'), color: color.text },
  titleSoon: { color: color.textMuted },
  tagline: { ...text('caption'), color: color.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[1] },
  footnote: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  // The friends footer [D100]: as GameType's bottom and OfflineActions (its inset added where it is drawn).
  footer: {
    paddingHorizontal: GUTTER.screen,
    paddingTop: space[6],
    gap: space[3],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  footerNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  footerRow: { flexDirection: 'row', gap: space[6] },
  half: { flex: 1 },
  // "עם חברים" in the list ('list'): two buttons a row, each half of it, a touch target high (the whole group
  // fits the 360 × 780 budget of ModesAndGameType.test).
  friendsRow: { flexDirection: 'row', gap: space[6] },
  friendsButton: {
    flex: 1,
    minHeight: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  friendsPrimary: { borderColor: color.accent },
  friendsLabel: { ...text('button'), color: color.text },
  friendsLabelPrimary: { color: color.accent },
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
