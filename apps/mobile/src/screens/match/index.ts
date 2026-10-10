/**
 * The matchmaking screens of work-plan stage 9 (spec §10; Match-Search, Match-Found, Match-Countdown,
 * Match-Timeout): one screen over the search (net/matchmaking.ts), its views, and their pure model.
 * app/match/index.tsx renders MatchScreen with the game store's search.
 */
export { CountdownView, type CountdownViewProps } from './CountdownView';
export { FoundView, type FoundViewProps } from './FoundView';
export { MatchErrorView, type MatchErrorViewProps } from './MatchErrorView';
export {
  clockText,
  type CountdownStep,
  countdownStep,
  headerOf,
  type MatchHeader,
  type MatchScreenModel,
  matchScreenModel,
  rangeOf,
  type RatingRange,
  type SeatModel,
  seatsOf,
  type SelfModel,
} from './matchModel';
export { MatchScreen, type MatchScreenProps } from './MatchScreen';
export { headerText, rangeText } from './parts';
export { SearchView, type SearchViewProps } from './SearchView';
export { TimeoutView, type TimeoutViewProps } from './TimeoutView';
