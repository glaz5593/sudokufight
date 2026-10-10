import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { space, tokens } from '../../theme';
import {
  AVATAR_SIZES,
  type AvatarSize,
  Avatar,
  Flag,
  type FlagSize,
  type GameResultKind,
  LEAGUE_THRESHOLDS,
  LeagueBadge,
  LEAGUES,
  Rating,
  type RatingSize,
} from '../player';
import { BOT, DS_PLAYERS, DS_PROFILES, ME, NINA } from './fixtures';
import { DsGroup, DsNote, Specimen, SpecimenRow } from './Primitives';

/**
 * Avatars, flags, ratings and leagues (components.md §2, §4, §5; DS-Components "אווטארים"): every avatar
 * size in the four seat colours and the neutral frame, the badges on it, flags at their four sizes, the rating
 * at its four sizes, and the league badge for each tier in both variants.
 */

const SIZES = Object.keys(AVATAR_SIZES) as AvatarSize[];
const SEATS = tokens.color.players.map((_, i) => i);
const FLAG_SIZES: readonly FlagSize[] = ['home', 'game', 'compact', 'sheet'];
const COUNTRIES = ['IL', 'DE', 'JP', 'BR', 'US'] as const;
const RATING_SIZES: readonly RatingSize[] = ['home', 'list', 'card', 'compact'];
const RESULTS: readonly GameResultKind[] = ['win', 'loss', 'draw'];

/** A rating inside each league (§5.2): the lower edge of the tier plus a little. */
const LEAGUE_RATINGS = {
  bronze: LEAGUE_THRESHOLDS.silver - 51,
  silver: LEAGUE_THRESHOLDS.silver + 50,
  gold: LEAGUE_THRESHOLDS.gold + 37,
  diamond: LEAGUE_THRESHOLDS.diamond + 50,
  legend: LEAGUE_THRESHOLDS.legend + 50,
} as const;

const ME_AVATAR = DS_PROFILES[ME]!.avatar;
const NINA_AVATAR = DS_PROFILES[NINA]!.avatar;

export function AvatarSection() {
  const { t } = useTranslation('dev');
  return (
    <>
      {SIZES.map((s) => (
        <DsGroup key={s} title={t('avatars.size', { size: s, px: AVATAR_SIZES[s].frame })}>
          <SpecimenRow>
            {SEATS.map((i) => (
              <Specimen key={i} label={tokens.color.players[i]!.name}>
                <Avatar avatarId={ME_AVATAR} size={s} colorIndex={i} />
              </Specimen>
            ))}
            <Specimen label={t('avatars.neutral')}>
              <Avatar avatarId={NINA_AVATAR} size={s} colorIndex={null} />
            </Specimen>
          </SpecimenRow>
        </DsGroup>
      ))}

      <DsGroup title={t('avatars.badges')}>
        <SpecimenRow gap={space[10]}>
          <Specimen label={t('avatars.online')}>
            <Avatar avatarId={ME_AVATAR} size="card" colorIndex={0} presence="online" />
          </Specimen>
          <Specimen label={t('avatars.reconnecting')}>
            <Avatar avatarId={NINA_AVATAR} size="card" colorIndex={1} presence="reconnecting" inactive />
          </Specimen>
          <Specimen label={t('avatars.left')}>
            <Avatar avatarId={NINA_AVATAR} size="card" colorIndex={1} presence="left" inactive />
          </Specimen>
          <Specimen label={t('avatars.bot')}>
            <Avatar avatarId={DS_PROFILES[BOT]!.avatar} size="card" colorIndex={1} presence="online" bot />
          </Specimen>
          <Specimen label={t('avatars.empty')}>
            <Avatar avatarId={null} size="card" colorIndex={2} />
          </Specimen>
          <Specimen label={t('avatars.labelled')}>
            <Avatar avatarId={ME_AVATAR} size="home" colorIndex={0} label={DS_PLAYERS[ME]?.name} />
          </Specimen>
        </SpecimenRow>
        <SpecimenRow gap={space[10]}>
          {RESULTS.map((r) => (
            <Specimen key={r} label={t(`avatars.result.${r}`)}>
              <Avatar avatarId={NINA_AVATAR} size="list" result={r} />
            </Specimen>
          ))}
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('identity.flags')}>
        <SpecimenRow>
          {FLAG_SIZES.map((s) => (
            <Specimen key={s} label={t('identity.flagSize', { size: s })}>
              <Flag country="IL" size={s} />
            </Specimen>
          ))}
        </SpecimenRow>
        <SpecimenRow>
          {COUNTRIES.map((c) => (
            <Specimen key={c} label={c}>
              <Flag country={c} size="home" />
            </Specimen>
          ))}
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('identity.ratings')}>
        <SpecimenRow gap={space[10]}>
          {RATING_SIZES.map((s) => (
            <Specimen key={s} label={t('identity.ratingSize', { size: s })}>
              <Rating
                value={1287}
                size={s}
                label={s === 'home' ? t('identity.ratingKey') : undefined}
                showLabel={s === 'home'}
              />
            </Specimen>
          ))}
          <Specimen label={t('identity.provisional')}>
            <Rating value={1200} size="list" provisional />
          </Specimen>
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('identity.leagues')}>
        <DsNote>{t('identity.leaguesNote')}</DsNote>
        {LEAGUES.map((tier) => (
          <View key={tier} style={styles.league} testID={`league-row-${tier}`}>
            <LeagueBadge rating={LEAGUE_RATINGS[tier]} level={14} variant="text" />
            <LeagueBadge rating={LEAGUE_RATINGS[tier]} level={14} variant="icon" />
          </View>
        ))}
      </DsGroup>
    </>
  );
}

const styles = StyleSheet.create({
  league: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
});
