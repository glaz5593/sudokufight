/**
 * @sudoku-fight/engine — the game's rules as pure TypeScript (spec §17).
 * No UI, no network, no system clock: the same code runs on the server and on the phone.
 */
export const ENGINE_VERSION = '0.3.0';

export * from './gameType';
export * from './util/clock';
export * from './util/random';
export * from './util/scheduler';
export * from './sudoku';
export * from './rating';
export * from './progress';
export * from './game';
export * from './bot';
// Staged practice: spec, stars, progress and transform only (levels/builder/ is Node-only, never exported).
export * from './levels';
