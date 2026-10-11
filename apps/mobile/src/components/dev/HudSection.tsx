import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { space, tokens } from '../../theme';
import {
  type CardModel,
  cardModel,
  cardModels,
  HitChip,
  LeadBar,
  leadModel,
  LockStrip,
  lockModel,
  paletteAt,
  RankBadge,
  ReconnectPill,
  SeatGlyph,
  TimerRing,
  VsBadge,
} from '../player';
import { Button } from '../ui';
import {
  DS_PROFILES,
  fourPlayerScene,
  NINA,
  type Snapshot,
  threePlayerScene,
  twoPlayerScenes,
} from './fixtures';
import { DsGroup, Specimen, SpecimenRow } from './Primitives';

const cardOf = (s: Snapshot, id: string): CardModel => cardModel(s.view, id, s.mySeat, s.now);

/**
 * The bars and small marks around the board (components.md §3.5, §6, §9, §10): the lead bar for 2 and 3–4
 * players, my lock strip in each state, and the badges (VS, rank, hit chip, reconnect pill, seat glyphs, timer
 * rings). All from engine games.
 */
export function HudSection() {
  const { t } = useTranslation('dev');
  const scenes = useMemo(() => twoPlayerScenes(), []);
  const three = useMemo(() => threePlayerScene(), []);
  const four = useMemo(() => fourPlayerScene(), []);
  const [nudge, setNudge] = useState(0);

  const lead = (s: Snapshot) => {
    const m = leadModel(s.view, s.mySeat);
    const gender = m.leader ? DS_PROFILES[m.leader.playerId]?.gender : undefined;
    return { model: m, gender };
  };
  const leads: { key: string; snapshot: Snapshot }[] = [
    { key: 'meLeading', snapshot: scenes.locking },
    { key: 'opponentLeading', snapshot: scenes.behind },
    { key: 'tie', snapshot: scenes.start },
    { key: 'negative', snapshot: scenes.negative },
    { key: 'three', snapshot: three },
    { key: 'four', snapshot: four },
  ];
  const strips: { key: string; snapshot: Snapshot }[] = [
    { key: 'none', snapshot: scenes.start },
    { key: 'locked', snapshot: scenes.locking },
    { key: 'urgent', snapshot: scenes.urgent },
    { key: 'paused', snapshot: scenes.myLockPaused },
  ];
  const ring = tokens.color.players;
  const hit = cardOf(scenes.hit, NINA).hit;
  const awayActivity = cardOf(scenes.reconnecting, NINA).activity;
  const away = awayActivity.kind === 'reconnecting' ? awayActivity : null;
  const locks = [
    ...cardModels(scenes.locking.view, scenes.locking.mySeat, scenes.locking.now),
    ...cardModels(four.view, four.mySeat, four.now).filter((m) => !m.isMe),
  ];

  return (
    <>
      <DsGroup title={t('hud.lead')}>
        {leads.map(({ key, snapshot }) => {
          const { model, gender } = lead(snapshot);
          return (
            <Specimen key={key} label={t(`hud.leadStates.${key}`)} align="stretch">
              <LeadBar model={model} gender={gender} testID={`lead-${key}`} />
            </Specimen>
          );
        })}
      </DsGroup>

      <DsGroup title={t('hud.strip')}>
        {strips.map(({ key, snapshot }) => (
          <Specimen key={key} label={t(`hud.stripStates.${key}`)} align="stretch">
            <LockStrip
              model={lockModel(snapshot.view, snapshot.now)}
              nudgeKey={key === 'none' ? nudge : undefined}
              testID={`strip-${key}`}
            />
          </Specimen>
        ))}
        <Button
          label={t('hud.nudge')}
          variant="secondary"
          size="modal"
          onPress={() => setNudge((n) => n + 1)}
          testID="nudge"
        />
      </DsGroup>

      <DsGroup title={t('hud.badges')}>
        <SpecimenRow gap={space[10]}>
          <Specimen label={t('hud.vs')}>
            <VsBadge />
          </Specimen>
          {[1, 2, 3, 4].map((place) => (
            <Specimen key={place} label={t('hud.rank', { place })}>
              <RankBadge place={place} />
            </Specimen>
          ))}
        </SpecimenRow>
        <SpecimenRow gap={space[10]}>
          {hit ? (
            <Specimen label={t('hud.hitChip')}>
              <HitChip seconds={hit.secondsLeft} />
            </Specimen>
          ) : null}
          {away ? (
            <>
              <Specimen label={t('hud.reconnect')}>
                <ReconnectPill seconds={away.secondsLeft} />
              </Specimen>
              <Specimen label={t('hud.reconnectCompact')}>
                <ReconnectPill seconds={away.secondsLeft} compact />
              </Specimen>
            </>
          ) : null}
        </SpecimenRow>
        <SpecimenRow gap={space[10]}>
          {ring.map((p, i) => (
            <Specimen key={p.name} label={`${p.name} ${p.shape}`}>
              <SeatGlyph colorIndex={i} size={space[8]} />
            </Specimen>
          ))}
        </SpecimenRow>
        <SpecimenRow gap={space[10]}>
          {/* The activity rings of every lock in the 4-player game: running, and stopped by an interference. */}
          {locks.map((m) =>
            m.activity.kind === 'locking' ? (
              <Specimen
                key={m.playerId}
                label={t(m.activity.paused ? 'hud.timerRingPaused' : 'hud.timerRing', {
                  name: paletteAt(m.colorIndex).name,
                })}
              >
                <TimerRing
                  size={space[8]}
                  tint={paletteAt(m.colorIndex).ring}
                  remainingMs={m.activity.remainingMs}
                  expiresAt={m.activity.expiresAt}
                  totalMs={m.activity.totalMs}
                  seconds={m.activity.secondsLeft}
                />
              </Specimen>
            ) : null,
          )}
        </SpecimenRow>
      </DsGroup>
    </>
  );
}
