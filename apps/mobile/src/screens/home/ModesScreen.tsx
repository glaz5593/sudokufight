import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AvatarId } from '../../assets/avatars';
import { Icon } from '../../components/Icon';
import { Avatar, SeatGlyph } from '../../components/player';
import { cue } from '../../services/feedback';
import { useProfile } from '../../state/profile';
import { color, radius, size, space, text, tokens } from '../../theme';
import { isAvailable, MODE_GROUPS, MODE_OPTIONS, type ModeGroup, type ModeOption } from './homeModel';
import { goBack } from './navigation';
import { Chip, GUTTER, ScreenHeader, SectionLabel } from './parts';

/**
 * "משחק חדש" (spec §5.1, the Modes board in direction C): exactly five options, ranked 2 · 3 · 4 and the two
 * practices. Both practices are playable in this build: each opens the game type (a bot practice goes on to the
 * bot selection). The ranked ones show "בקרוב" and do nothing until work-plan stage 9.
 */
export function ModesScreen() {
  const { t } = useTranslation('home');
  const { top, bottom } = useSafeAreaInsets();
  const avatarId = useProfile((s) => s.avatarId);
  const lastPlay = useProfile((s) => s.lastPlay);

  const open = (option: ModeOption) => {
    if (!isAvailable(option.key)) return;
    cue('toggle');
    const gameType = lastPlay?.mode === option.mode ? lastPlay.gameType : undefined;
    router.push({
      pathname: '/game-type',
      params: gameType ? { mode: option.mode, gameType } : { mode: option.mode },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader title={t('modes.title')} onBack={goBack} style={styles.header} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}>
        {MODE_GROUPS.map((group) => (
          <Group key={group} group={group} avatarId={avatarId} onOpen={open} />
        ))}
        <Text style={styles.footnote}>{t('modes.footnote')}</Text>
      </ScrollView>
    </View>
  );
}

function Group({
  group,
  avatarId,
  onOpen,
}: {
  group: ModeGroup;
  avatarId: AvatarId;
  onOpen: (option: ModeOption) => void;
}) {
  const { t } = useTranslation('home');
  const options = MODE_OPTIONS.filter((o) => o.group === group);
  // The Modes board: the 2-player card across the width, then 3 and 4 side by side.
  const [wide, ...pair] = group === 'ranked' ? options : [];
  return (
    <View style={styles.group}>
      <SectionLabel
        icon={group === 'ranked' ? 'trophy' : 'target'}
        title={t(`modes.groups.${group}.title`)}
        note={t(`modes.groups.${group}.note`)}
      />
      {wide ? (
        <>
          <ModeCard option={wide} avatarId={avatarId} onPress={() => onOpen(wide)} />
          <View style={styles.pair}>
            {pair.map((o) => (
              <ModeCard key={o.key} option={o} avatarId={avatarId} onPress={() => onOpen(o)} compact />
            ))}
          </View>
        </>
      ) : (
        options.map((o) => <ModeCard key={o.key} option={o} avatarId={avatarId} onPress={() => onOpen(o)} />)
      )}
    </View>
  );
}

function ModeCard({
  option,
  avatarId,
  onPress,
  compact = false,
}: {
  option: ModeOption;
  avatarId: AvatarId;
  onPress: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation('home');
  const available = isAvailable(option.key);
  const title = t(`modes.${option.key}.title`);
  const tagline = t(`modes.${option.key}.tagline`);
  const chips =
    option.group === 'ranked'
      ? [t('modes.chips.rated')]
      : [t('modes.chips.unrated'), t('modes.chips.offline')];
  const label = [t(`modes.${option.key}.label`), tagline, ...chips, available ? null : t('modes.soon')]
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
          {available ? null : <Chip label={t('modes.soon')} testID={`soon-${option.key}`} />}
          {chips.map((c) => (
            <Chip key={c} label={c} />
          ))}
        </View>
      </View>
      {available && !compact ? (
        <Icon name="chevronForward" size={size.icon.chevron} color={color.iconFaint} />
      ) : null}
    </Pressable>
  );
}

/** The picture at the start of a card: the seats of a ranked table, my avatar, or the bot. */
function Leading({ option, avatarId }: { option: ModeOption; avatarId: AvatarId }) {
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
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
});
