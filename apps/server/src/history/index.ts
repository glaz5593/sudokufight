/** Game history and replays for the app (work plan stage 11; spec §13, §14.1). */
export {
  createHistoryRouter,
  DEFAULT_HISTORY_LIMITS,
  type HistoryLimits,
  type HistoryRouterDeps,
} from './router';
export { eventOf, listUserGames, readReplay, type ReplayRead } from './store';
