import type { PlayerId } from '@sudoku-fight/engine';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { size, space, tokens } from '../../theme';
import {
  type CardModel,
  cardModel,
  cardModels,
  compactCardGap,
  compactCardWidth,
  InterferenceButton,
  type InterferenceModel,
  PlayerCard,
  type PlayerCardProps,
  PlayerCardCompact,
  type ScoreDelta,
  VsBadge,
} from '../player';
import { useToast } from '../ui';
import {
  botScene,
  BOT,
  DS_PROFILES,
  fourPlayerScene,
  fourPlayerSurrenderScene,
  ME,
  NINA,
  scoreChange,
  type Snapshot,
  threePlayerScene,
  twoPlayerScenes,
} from './fixtures';
import { DsGroup, DsNote, Specimen, SpecimenRow, useContentWidth } from './Primitives';

/**
 * Player cards (components.md §3, §7, §8.1; DS-Components "כרטיסי שחקנים ו־HUD"): the 2-player pair as on
 * Dir-C-Game, the opponent's card and mine in every state, the compact cards of 3 and 4 players with rank
 * badges #1–#4, and the interference button's states. Every model comes from an engine game (fixtures.ts).
 */

const card = (s: Snapshot, id: PlayerId): CardModel => cardModel(s.view, id, s.mySeat, s.now);

/** Avatar, country and gender of a player, from the fixtures' profiles. */
const profileProps = (id: PlayerId): Pick<PlayerCardProps, 'avatarId' | 'country' | 'gender'> => {
  const p = DS_PROFILES[id];
  return { avatarId: p?.avatar ?? null, country: p?.country ?? null, gender: p?.gender };
};

export function CardSection() {
  const { t } = useTranslation('dev');
  const content = useContentWidth();
  const scenes = useMemo(() => twoPlayerScenes(), []);
  const bot = useMemo(() => botScene(), []);
  const three = useMemo(() => threePlayerScene(), []);
  const four = useMemo(() => fourPlayerScene(), []);
  const fourOut = useMemo(() => fourPlayerSurrenderScene(), []);
  const [arsenalOpen, setArsenalOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const showToast = useToast((s) => s.show);

  const onBlocked = (state: InterferenceModel) => {
    if (state.kind !== 'points') return;
    showToast({ variant: 'error', message: t('toasts.error', { cost: state.cost }) });
  };

  const pairGap = Math.max(space[4], content - 2 * size.playerCard.width);
  const ninaName = scenes.locking.view.players.find((p) => p.id === NINA)?.name ?? '';

  const gain: ScoreDelta = { id: 'gain', value: scenes.correctDelta, kind: 'gain' };
  const penalty: ScoreDelta = { id: 'penalty', value: scenes.wrongDelta, kind: 'penalty' };
  const cost: ScoreDelta = {
    id: 'cost',
    value: scoreChange(scenes.locking.view, scenes.hit.view, ME),
    kind: 'cost',
  };

  const opponentStates: { key: string; snapshot: Snapshot; props?: Partial<PlayerCardProps> }[] = [
    { key: 'thinking', snapshot: scenes.thinking },
    { key: 'locking', snapshot: scenes.locking },
    { key: 'hit', snapshot: scenes.hit },
    { key: 'paused', snapshot: scenes.frozen },
    { key: 'reconnecting', snapshot: scenes.reconnecting },
    { key: 'left', snapshot: scenes.left },
    { key: 'surrendered', snapshot: scenes.surrendered },
    { key: 'correct', snapshot: scenes.correct, props: { delta: gain, persistentDelta: true } },
    { key: 'unaffordable', snapshot: scenes.start },
    { key: 'expanded', snapshot: scenes.locking, props: { interferenceExpanded: true } },
    {
      key: 'dropTarget',
      snapshot: scenes.locking,
      props: { dropTarget: true, dropLabel: t('cards.dropLabel', { name: ninaName }) },
    },
    {
      key: 'dropHover',
      snapshot: scenes.locking,
      props: { dropTarget: true, dropHover: true, dropLabel: t('cards.dropLabel', { name: ninaName }) },
    },
    { key: 'dimmed', snapshot: scenes.locking, props: { dimmed: true } },
  ];

  const myStates: { key: string; snapshot: Snapshot; props?: Partial<PlayerCardProps> }[] = [
    { key: 'default', snapshot: scenes.locking },
    { key: 'wrong', snapshot: scenes.wrong, props: { delta: penalty, persistentDelta: true } },
    { key: 'sent', snapshot: scenes.hit, props: { delta: cost, persistentDelta: true } },
    { key: 'negative', snapshot: scenes.negative },
    { key: 'cooldown', snapshot: scenes.reacted },
    { key: 'reactionsOpen', snapshot: scenes.locking, props: { reactionsExpanded: true } },
    { key: 'selfReconnecting', snapshot: scenes.frozen },
    { key: 'practice', snapshot: bot },
  ];

  return (
    <>
      <DsGroup title={t('cards.pair')}>
        <View style={[styles.pair, { gap: pairGap }]} testID="card-pair">
          <PlayerCard
            model={card(scenes.locking, ME)}
            {...profileProps(ME)}
            reactionsExpanded={reactionsOpen}
            onReactions={() => setReactionsOpen((o) => !o)}
            testID="pair-me"
          />
          <PlayerCard
            model={card(scenes.locking, NINA)}
            {...profileProps(NINA)}
            interferenceExpanded={arsenalOpen}
            onInterfere={() => setArsenalOpen((o) => !o)}
            onInterfereBlocked={onBlocked}
            testID="pair-opponent"
          />
          <View style={styles.vs} pointerEvents="none">
            <VsBadge />
          </View>
        </View>
        <DsNote>{t('cards.pairNote')}</DsNote>
      </DsGroup>

      <DsGroup title={t('cards.opponent')}>
        <SpecimenRow gap={pairGap}>
          {opponentStates.map(({ key, snapshot, props }) => (
            <Specimen key={key} label={t(`cards.states.${key}`)}>
              <PlayerCard
                model={card(snapshot, NINA)}
                {...profileProps(NINA)}
                onInterfere={() => undefined}
                onInterfereBlocked={onBlocked}
                {...props}
                testID={`opponent-${key}`}
              />
            </Specimen>
          ))}
          <Specimen label={t('cards.states.bot')}>
            <PlayerCard model={card(bot, BOT)} {...profileProps(BOT)} testID="opponent-bot" />
          </Specimen>
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('cards.mine')}>
        <SpecimenRow gap={pairGap}>
          {myStates.map(({ key, snapshot, props }) => (
            <Specimen key={key} label={t(`cards.states.${key}`)}>
              <PlayerCard
                model={card(snapshot, ME)}
                {...profileProps(ME)}
                onSurrender={() => undefined}
                onReactions={() => undefined}
                {...props}
                testID={`mine-${key}`}
              />
            </Specimen>
          ))}
        </SpecimenRow>
      </DsGroup>

      <CompactCards title={t('cards.compact3')} snapshot={three} onBlocked={onBlocked} />
      <CompactCards title={t('cards.compact4')} snapshot={four} onBlocked={onBlocked} />
      <CompactCards
        title={t('cards.compact4Out')}
        snapshot={fourOut}
        onBlocked={onBlocked}
        gain={{ playerId: fourOut.mover, value: fourOut.change }}
      />

      <DsGroup title={t('cards.interference')}>
        <DsNote>{t('cards.interferenceNote')}</DsNote>
        <InterferenceStates scenes={scenes} name={ninaName} />
      </DsGroup>
    </>
  );
}

function CompactCards({
  title,
  snapshot,
  onBlocked,
  gain,
}: {
  title: string;
  snapshot: Snapshot;
  onBlocked: (state: InterferenceModel) => void;
  /** A move that just scored: its card floats the gain ("+2.5"). */
  gain?: { playerId: PlayerId; value: number };
}) {
  const models = useMemo(() => cardModels(snapshot.view, snapshot.mySeat, snapshot.now), [snapshot]);
  const n = models.length;
  return (
    <DsGroup title={title}>
      {/* Seat order, never re-sorted (spec §6.8); me first, at the start edge. */}
      <View style={[styles.compactRow, { gap: compactCardGap(n) }]} testID={`compact-${n}`}>
        {models.map((m) => (
          <PlayerCardCompact
            key={m.playerId}
            model={m}
            {...profileProps(m.playerId)}
            width={compactCardWidth(n, m.isMe)}
            delta={gain?.playerId === m.playerId ? { id: 'gain', value: gain.value, kind: 'gain' } : null}
            persistentDelta
            onSurrender={() => undefined}
            onReactions={() => undefined}
            onInterfere={() => undefined}
            onInterfereBlocked={onBlocked}
          />
        ))}
      </View>
    </DsGroup>
  );
}

function InterferenceStates({ scenes, name }: { scenes: ReturnType<typeof twoPlayerScenes>; name: string }) {
  const { t } = useTranslation('dev');
  const state = (s: Snapshot): InterferenceModel | null => card(s, NINA).interference;
  const rows: { key: string; state: InterferenceModel | null; expanded?: boolean }[] = [
    { key: 'available', state: state(scenes.locking) },
    { key: 'expanded', state: state(scenes.locking), expanded: true },
    { key: 'unaffordable', state: state(scenes.start) },
    { key: 'busy', state: state(scenes.hit) },
    { key: 'notRunning', state: state(scenes.waiting) },
  ];
  return (
    <>
      <SpecimenRow>
        {rows.map((r) =>
          r.state ? (
            <Specimen key={r.key} label={t(`cards.interferenceStates.${r.key}`)}>
              <InterferenceButton
                name={name}
                state={r.state}
                expanded={r.expanded}
                onPress={() => undefined}
              />
            </Specimen>
          ) : null,
        )}
      </SpecimenRow>
      <SpecimenRow>
        {rows.map((r) =>
          r.state ? (
            <Specimen key={r.key} label={t(`cards.interferenceStates.${r.key}`)} width={COMPACT_CARD}>
              <View style={styles.compactStrip}>
                <InterferenceButton
                  name={name}
                  state={r.state}
                  expanded={r.expanded}
                  compact
                  onPress={() => undefined}
                />
              </View>
            </Specimen>
          ) : null,
        )}
      </SpecimenRow>
    </>
  );
}

/** The compact strip button as it sits in a 4-player opponent card. */
const COMPACT_CARD = compactCardWidth(4, false);

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', alignItems: 'flex-start' },
  vs: {
    position: 'absolute',
    top: tokens.layout.game.vsBadge.top - tokens.layout.game.playerCard.top,
    start: 0,
    end: 0,
    alignItems: 'center',
  },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: space[6] },
  compactStrip: { alignSelf: 'stretch', paddingHorizontal: space[2] },
});
