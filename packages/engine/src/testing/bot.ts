/* Test-only helpers for bot tests: a LocalGameHost with a bot attached, on a manual clock. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eligibleCells, plausibleWrongDigits } from '../bot/brain';
import { attachBot, type BotHandle, type BotTrace } from '../bot/runner';
import { type BotConfig, type BotLevelId, botPlayer } from '../bot/levels';
import { LocalGameHost } from '../game/host';
import { defaultRules, type Rules } from '../game/rules';
import type { GameConfig, GameEvent, GameEventType } from '../game/types';
import type { GameType } from '../gameType';
import type { BankFile } from '../sudoku/bank';
import type { Digit } from '../sudoku/board';
import { ManualClock } from '../util/clock';
import { createRng } from '../util/random';
import { ManualScheduler } from '../util/scheduler';
import { PUZZLE } from './game';

export const HUMAN = 'me';

type Puzzle = { id: string; givens: string; solution: string };

let bankCache: BankFile | undefined;
/** The offline bank (packages/engine/data/puzzles.json): `count` puzzles of a game type. */
export function bankPuzzles(gameType: GameType, count: number): Puzzle[] {
  bankCache ??= JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'data', 'puzzles.json'), 'utf8'),
  ) as BankFile;
  return bankCache.puzzles
    .filter((p) => p.gameType === gameType)
    .slice(0, count)
    .map(({ id, givens, solution }) => ({ id, givens, solution }));
}

export interface BotGameOptions {
  level: BotLevelId;
  gameType?: GameType;
  puzzle?: Puzzle;
  seed?: number;
  config?: Partial<BotConfig>;
  rules?: Partial<Rules>;
  /** The human sits in seat 0 by default. */
  botFirst?: boolean;
  autoStart?: boolean;
  at?: number;
}

export interface BotGame {
  clock: ManualClock;
  scheduler: ManualScheduler;
  host: LocalGameHost;
  bot: BotHandle;
  botId: string;
  traces: BotTrace[];
  config: GameConfig;
}

export function botGame(o: BotGameOptions): BotGame {
  const gameType = o.gameType ?? 'fast';
  const clock = new ManualClock(o.at ?? 0);
  const scheduler = new ManualScheduler(clock);
  const bot = botPlayer(o.level);
  const human = { id: HUMAN, name: 'Me' };
  const config: GameConfig = {
    id: `bot-game-${o.seed ?? 1}`,
    mode: 'bot',
    gameType,
    puzzle: o.puzzle ?? PUZZLE,
    players: o.botFirst ? [bot, human] : [human, bot],
    rules: defaultRules('bot', gameType, o.rules),
    seed: o.seed ?? 1,
  };
  const host = new LocalGameHost({ config, playerId: HUMAN, clock, scheduler, autoStart: o.autoStart });
  const traces: BotTrace[] = [];
  const handle = attachBot(host, {
    botId: bot.id,
    level: o.level,
    clock,
    scheduler,
    rng: createRng(o.seed ?? 1),
    config: o.config,
    onTrace: (t) => traces.push(t),
  });
  return { clock, scheduler, host, bot: handle, botId: bot.id, traces, config };
}

/** Moves time on in steps until the game is over (or `maxMs` passed); returns the time it took. */
export function runUntilOver(
  g: Pick<BotGame, 'scheduler' | 'host' | 'clock'>,
  maxMs = 2 * 3600_000,
  step = 5000,
): number {
  const start = g.clock.now();
  while (g.host.state.status !== 'over' && g.clock.now() - start < maxMs) g.scheduler.advance(step);
  return g.clock.now() - start;
}

/**
 * A human who, every `everyMs`, locks the first free cell and enters its digit `placeMs` later; every
 * `missEvery`-th digit is a plausible wrong one. `id` is the human's player id (HUMAN by default).
 */
export function scriptHuman(
  g: Pick<BotGame, 'scheduler' | 'host' | 'clock'>,
  { everyMs = 6000, placeMs = 2000, missEvery = 0, startAt = 1000, id = HUMAN } = {},
): void {
  let moves = 0;
  const { host, scheduler, clock } = g;
  const solution = (cell: number) => Number(host.state.config.puzzle.solution[cell]) as Digit;
  const step = () => {
    const s = host.state;
    if (s.status === 'over') return;
    const cell = eligibleCells(s, id, clock.now())[0];
    if (s.status === 'running' && !s.locks.some((l) => l.playerId === id) && cell !== undefined) {
      host.dispatch({ type: 'select', playerId: id, cell });
      scheduler.setTimeout(() => {
        const st = host.state;
        if (st.status !== 'running' || !st.locks.some((l) => l.playerId === id && l.cell === cell)) return;
        moves++;
        const wrong = missEvery && moves % missEvery === 0 ? plausibleWrongDigits(st, cell)[0] : undefined;
        host.dispatch({ type: 'place', playerId: id, cell, digit: wrong ?? solution(cell) });
      }, placeMs);
    }
    scheduler.setTimeout(step, everyMs);
  };
  scheduler.setTimeout(step, startAt);
}

/** Events of one type, optionally by one player. */
export function eventsOf<T extends GameEventType>(
  events: readonly GameEvent[],
  type: T,
  playerId?: string,
): Extract<GameEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<GameEvent, { type: T }> =>
      e.type === type && (playerId === undefined || ('playerId' in e && e.playerId === playerId)),
  );
}

/** A level table with one row changed. */
export function withLevel(
  levels: BotConfig['levels'],
  level: BotLevelId,
  change: Partial<BotConfig['levels'][number]>,
): BotConfig['levels'] {
  return levels.map((l) => (l.level === level ? { ...l, ...change } : l));
}
