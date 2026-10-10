/**
 * The fake client (work plan, stage 7): a Node player over the network that plays like the engine's bots,
 * in private rooms or (stage 9) ranked games through matchmaking. scripts/fake-client.ts runs it from the
 * command line; test/realtime.e2e.test.ts, test/ranked.e2e.test.ts and test/fourPlayers.e2e.test.ts play
 * games with it.
 */
export {
  FakeBrain,
  type FakeBrainOptions,
  type FakeBrainStop,
  type FakeBrainTrace,
  scaledBotConfig,
} from './brain';
export {
  defaultFakeId,
  type FakeAccountOptions,
  FakeClient,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeClientTrouble,
  type FakeClientUpdate,
  type FakeMatchSummary,
  type FakeOutcome,
  type FakeQueueOptions,
  type FakeRatingChange,
  type FakeResync,
  queueRatingOf,
} from './client';
export {
  exitCodeOf,
  FAKE_CLIENT_USAGE,
  type FakeClientCli,
  formatSummary,
  type ParsedFakeClientArgs,
  parseFakeClientArgs,
} from './cli';
export { GameMirror } from './mirror';
export { type SolvedPuzzle, solveGivens, withSolution } from './solve';
export { ActionTracker, answers, ClockSync, Pacer } from './stats';
