/** The results of a practice, alone or against a bot (work plan stages 4–5), or of an online game (stage 7), spec §12. */
export {
  type AwardResult,
  type BestMoveModel,
  type GameEnd,
  loadOnlineResults,
  loadPracticeResults,
  type OpponentResult,
  type Outcome,
  type PracticeEnd,
  type RankedEnd,
  type RankingRow,
  type RatingResult,
  type ResultsLoad,
  resultsModel,
  type ResultsModel,
  type ResultsSession,
  type ResultsSource,
  sessionResultsModel,
} from './resultsModel';
export { ResultsScreen, type ResultsScreenProps } from './ResultsScreen';
export { AwardsSection, OpponentsSection, RankingSection, RatingSection } from './ResultsVersus';
