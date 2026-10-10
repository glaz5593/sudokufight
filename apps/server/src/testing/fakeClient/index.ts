/**
 * The fake client (work plan, stage 7): a Node player over the network that plays like the engine's bots.
 * scripts/fake-client.ts runs it from the command line; test/realtime.e2e.test.ts plays games with it.
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
  FakeClient,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeClientTrouble,
  type FakeClientUpdate,
  type FakeOutcome,
  type FakeResync,
} from './client';
export {
  FAKE_CLIENT_USAGE,
  type FakeClientCli,
  formatSummary,
  type ParsedFakeClientArgs,
  parseFakeClientArgs,
} from './cli';
export { GameMirror } from './mirror';
export { type SolvedPuzzle, solveGivens, withSolution } from './solve';
export { ActionTracker, answers, ClockSync, Pacer } from './stats';
