import type { GameMode, GameType } from '@sudoku-fight/engine';
import type { QueuePlayerCount } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Button, useToast } from '../../components/ui';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { DEFAULT_RANKED_PLAYERS, type GameTypeInfo, gameTypeInfos, thinkSeconds } from './homeModel';
import { goBack } from './navigation';
import { GUTTER, ScreenHeader } from './parts';
import { startAndOpen, startRankedAndOpen } from './startGame';

export interface GameTypeScreenProps {
  mode: GameMode;
  /** Preselected: the route's `gameType`, or the default. */
  initialGameType: GameType;
  /** Ranked (stage 9): the table's size, which with the type makes the matchmaking queue. */
  players?: QueuePlayerCount;
}

/**
 * "סוג משחק" (spec §5.2, the GameType board in direction C): fast, normal or hard, each with its board
 * difficulty, its lock time (from the rules, D2) and an estimated duration. For a solo practice "התחל אימון"
 * starts the game and the game screen replaces this one, so "back" from the game never lands here. For a
 * practice against a bot it opens the bot selection with the chosen type (spec §4.2: GameType → BotSelect).
 * For a ranked game (stage 9) "מצא יריב" searches the queue of this type and table size (spec §4.2:
 * GameType → Matchmaking search); "back" from the search comes here. At a table of 3–4 (stage 10) it says
 * "מצא יריבים", and that the game starts when the table is full (spec §10).
 */
export function GameTypeScreen({
  mode,
  initialGameType,
  players = DEFAULT_RANKED_PLAYERS,
}: GameTypeScreenProps) {
  const { t } = useTranslation('home');
  const { top, bottom } = useSafeAreaInsets();
  const [selected, setSelected] = useState<GameType>(initialGameType);
  const [starting, setStarting] = useState(false);
  const infos = gameTypeInfos(mode);
  const typeName = t(`gameTypes.${selected}.name`);
  // The words of this mode: a ranked table of 3–4 looks for opponents, not one (stage 10).
  const words = mode === 'ranked' && players > 2 ? 'rankedGroup' : mode;

  const select = (type: GameType) => {
    if (type === selected || starting) return;
    cue('toggle');
    setSelected(type);
  };

  const start = async () => {
    if (starting) return;
    cue('primaryPress');
    if (mode === 'bot') {
      router.push({ pathname: '/bot-select', params: { gameType: selected } });
      return;
    }
    if (mode === 'ranked') {
      startRankedAndOpen({ gameType: selected, players }, 'push');
      return;
    }
    setStarting(true);
    const ok = await startAndOpen({ mode, gameType: selected }, 'replace');
    setStarting(false);
    if (!ok) useToast.getState().show({ variant: 'error', message: t('start.failed') });
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader
        title={t('gameType.title')}
        subtitle={mode === 'ranked' ? t(`modes.ranked${players}.label`) : t(`modes.${mode}.name`)}
        onBack={goBack}
        style={styles.header}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('gameType.title')} style={styles.list}>
          {infos.map((info) => (
            <TypeCard
              key={info.gameType}
              info={info}
              checked={info.gameType === selected}
              onPress={() => select(info.gameType)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t(`gameType.note.${words}`)}</Text>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: bottom + space[8] }]}>
        <Button
          label={t(`gameType.start.${words}`)}
          size="lg"
          loading={starting}
          onPress={() => void start()}
          accessibilityHint={t(
            mode === 'bot'
              ? 'gameType.botHint'
              : mode === 'ranked'
                ? `gameType.${words}Hint`
                : 'gameType.startHint',
            { type: typeName },
          )}
          testID="start"
        />
      </View>
    </View>
  );
}

function TypeCard({ info, checked, onPress }: { info: GameTypeInfo; checked: boolean; onPress: () => void }) {
  const { t } = useTranslation('home');
  const type = info.gameType;
  const seconds = thinkSeconds(info);
  const [from, to] = info.durationMin;
  const name = t(`gameTypes.${type}.name`);
  const difficulty = t(`gameTypes.${type}.difficulty`);
  const facts = [
    { key: 'lock', label: t('gameType.lockTime'), value: t('gameType.seconds', { seconds }) },
    { key: 'board', label: t('gameType.board'), value: difficulty },
    {
      key: 'duration',
      label: t('gameType.duration'),
      value: t('gameType.minutes', { range: ltr(`${from}–${to}`) }),
    },
  ];
  const label = t('gameType.cardLabel', {
    name,
    technique: t(`gameTypes.${type}.technique`),
    seconds: t('player:seconds', { count: seconds }),
    difficulty,
    from,
    to,
  });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        checked && styles.cardChecked,
        pressed && !checked && styles.cardPressed,
      ]}
      testID={`type-${type}`}
    >
      <View style={styles.cardTop}>
        <View style={styles.names}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.technique}>{t(`gameTypes.${type}.technique`)}</Text>
        </View>
        <View style={[styles.radio, checked && styles.radioChecked]}>
          {checked ? <Icon name="check" size={size.icon.inline} color={color.onAccent} /> : null}
        </View>
      </View>
      <View style={styles.facts}>
        {facts.map((f) => (
          <View key={f.key} style={styles.fact}>
            <Text style={styles.factLabel} numberOfLines={1}>
              {f.label}
            </Text>
            <Text style={styles.factValue} numberOfLines={1}>
              {f.value}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/** The radio mark at the end of a card (GameType board): 24 round. */
const RADIO = 24;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: {
    paddingHorizontal: GUTTER.screen,
    paddingTop: space[6],
    paddingBottom: space[10],
    gap: space[8],
  },
  list: { gap: space[6] },
  card: {
    padding: space[8],
    gap: space[7],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  cardChecked: { borderColor: color.accent, backgroundColor: color.surface },
  cardPressed: { backgroundColor: color.surface },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space[6] },
  names: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  name: { ...text('h1'), color: color.text },
  technique: { ...text('caption'), color: color.textMuted },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: RADIO / 2,
    borderWidth: tokens.border.avatarFrame,
    borderColor: color.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: { borderColor: color.accent, backgroundColor: color.accent },
  facts: { flexDirection: 'row', gap: space[6] },
  fact: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[3] },
  factLabel: { ...text('micro'), color: color.textMuted },
  factValue: { ...text('status'), color: color.text },
  note: { ...text('bodyLong'), color: color.textMuted },
  footer: {
    paddingHorizontal: GUTTER.screen,
    paddingTop: space[6],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
});
