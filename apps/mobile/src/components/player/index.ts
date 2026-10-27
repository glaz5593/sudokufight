/**
 * Player components of direction C (docs/design/components.md §2–§10): avatar, flag, rating, league, the
 * 2-player and compact cards, the lead bar and my lock strip, plus the pure view models that feed them from
 * the engine's GameView.
 */
export { Avatar, type AvatarProps, type GameResultKind } from './Avatar';
export { HitChip, RankBadge, ReconnectPill, VsBadge } from './Badges';
export { CardIconButton, type CardIconButtonProps } from './CardIconButton';
export { CountUpText, type CountUpTextProps } from './CountUpText';
export { Flag, type FlagProps, type FlagSize } from './Flag';
export { InterferenceButton, type InterferenceButtonProps } from './InterferenceButton';
export { LeadBar, type LeadBarProps } from './LeadBar';
export { LeagueBadge, type LeagueBadgeProps } from './LeagueBadge';
export { LockStrip, type LockStripProps } from './LockStrip';
export { PlayerCard, type PlayerCardActions, type PlayerCardProps } from './PlayerCard';
export { PlayerCardCompact, type PlayerCardCompactProps } from './PlayerCardCompact';
export { Rating, type RatingProps, type RatingSize } from './Rating';
export { DeltaLabel, type ScoreDelta, ScoreNumber } from './Score';
export { SeatGlyph, type SeatGlyphProps } from './SeatGlyph';
export { TargetFrame, type TargetFrameProps } from './TargetFrame';
export { TimerRing, type TimerRingProps } from './TimerRing';
export { ActivityLine, MistakesText } from './ActivityLine';

export {
  type Activity,
  barShares,
  type CardModel,
  cardModel,
  cardModels,
  colorIndexFor,
  type HitModel,
  type InterferenceModel,
  type LeadModel,
  leadModel,
  type LeadSegment,
  type LockActivity,
  lockModel,
  type LockStripModel,
  type MistakePips,
  mistakePips,
  type MyActions,
  type Presence,
  sameCard,
  sameCountdown,
  timeLeft,
} from './cardModel';
export { countryName, flagEmoji } from './countryFlag';
export {
  formatScore,
  formatSigned,
  ltr,
  MINUS,
  scoreFormat,
  scoreText,
  secondsOf,
  signedText,
  withDecimal,
} from './format';
export {
  type League,
  leagueFloor,
  leagueFor,
  type LeagueProgress,
  leagueProgress,
  LEAGUE_THRESHOLDS,
  LEAGUES,
  type LeagueThresholds,
  nextLeague,
  playerLeague,
} from './league';
export { AVATAR_SIZES, type AvatarSize, compactCardGap, compactCardWidth, paletteAt } from './metrics';
export { sameData, sameProps, sameStyle } from './sameProps';
export {
  activityPhrase,
  activityWord,
  cardLabel,
  displayName,
  type Gender,
  interferenceLabel,
  leadLabel,
  lockStripLabel,
  mistakesLong,
  mistakesShort,
  pointsText,
  type PlayerT,
} from './wording';
