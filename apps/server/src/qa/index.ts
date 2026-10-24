/**
 * The QA module (docs/handoff/2026-10-23/qa-module/plan.md): a fixed catalog of test tasks
 * (apps/server/data/qa-catalog.json), runs opened from it, the marks on their tasks, and the bugs those found.
 * The admin API's /qa routes (admin/qa.ts) are its only door.
 */
export {
  bundledQaCatalog,
  parseQaCatalog,
  qaCatalogLoader,
  type QaCatalogResult,
  type QaCatalogSource,
  type QaSnapshotTask,
  selectTasks,
} from './catalog';
export { isActiveBug, isBugResult, mayMarkClosedRun, nextBugStatus, QA_AGENT_ACTOR, runTakes } from './rules';
export {
  closeRun,
  type FixInput,
  getRun,
  listBugs,
  listRuns,
  type MarkInput,
  markFixed,
  markResult,
  openRun,
  type OpenRunInput,
  type RunItemsFilter,
} from './store';
