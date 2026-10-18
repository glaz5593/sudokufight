import {
  type Action,
  applyAction,
  type CellIndex,
  createGame,
  type Digit,
  type GameConfig,
  type GameEvent,
  type GameState,
  REACTIONS,
  type RejectReason,
  type Rng,
} from '@sudoku-fight/engine';

import { between, chance, intBetween, pick } from './random';

/**
 * Plays one ranked game through the real engine (createGame / applyAction), with scripted players that know
 * the solution but err now and then: every event is the engine's own, so the log replays exactly.
 *
 * Each player alternates "pick a free cell" and "place a digit" on their own clock; the loop always moves the
 * player whose next step comes first, so actions reach the engine in time order, as on the server. Now and
 * then a player reacts, interferes, lets a lock time out, surrenders or drops out (abandons after the grace
 * period). Refused actions are fine: the player just tries again a moment later.
 */

interface Bot {
  id: string;
  accuracy: number;
  thinkMin: number;
  thinkMax: number;
  next: number;
  cell: CellIndex | null;
}

export interface PlayedGame {
  events: GameEvent[];
  state: GameState;
}

const MAX_STEPS = 20_000;

export function playRankedGame(rng: Rng, config: GameConfig, start: number): PlayedGame {
  const created = createGame(config, start - intBetween(rng, 2000, 5000));
  let state = created.state;
  const events = [...created.events];
  // Whole milliseconds, as the server's clock gives them (game_events.t_ms is a bigint).
  const act = (action: Action, t: number): RejectReason | undefined => {
    const r = applyAction(state, action, t);
    state = r.state;
    events.push(...r.events);
    return r.rejected;
  };
  act({ type: 'start' }, start);

  const bots: Bot[] = config.players.map((p) => {
    const thinkMin = between(rng, 1500, 3500);
    return {
      id: p.id,
      accuracy: between(rng, 0.8, 0.97),
      thinkMin,
      thinkMax: thinkMin + between(rng, 1500, 4000),
      next: start + intBetween(rng, 400, 2500),
      cell: null,
    };
  });
  const empty = [...config.puzzle.givens].filter((c) => c === '0').length;
  const quitter = chance(rng, 0.07)
    ? { bot: pick(rng, bots), atShare: between(rng, 0.25, 0.75), surrender: chance(rng, 0.6) }
    : null;

  const inGame = (b: Bot) => {
    const p = state.players.find((s) => s.id === b.id);
    return p !== undefined && p.status === 'active' && p.connected;
  };

  for (let step = 0; state.status !== 'over'; step++) {
    if (step > MAX_STEPS) throw new Error(`sample game ${config.id} did not finish`);
    const ready = bots.filter(inGame);
    if (ready.length === 0) throw new Error(`sample game ${config.id}: nobody left to play`);
    const bot = ready.reduce((a, b) => (b.next < a.next ? b : a));
    const t = bot.next;

    if (quitter?.bot === bot && bot.cell === null) {
      const filled = state.grid.filter((v, i) => v !== 0 && config.puzzle.givens[i] === '0').length;
      if (filled >= quitter.atShare * empty) {
        act({ type: quitter.surrender ? 'surrender' : 'disconnect', playerId: bot.id }, t);
        continue;
      }
    }

    if (bot.cell === null) {
      if (chance(rng, 0.02)) act({ type: 'react', playerId: bot.id, emoji: pick(rng, REACTIONS) }, t);
      const others = bots.filter((b) => b !== bot && inGame(b));
      // Only the kinds the game allows [D47] (all of them under the default rules).
      const kinds = state.config.rules.interferenceKinds;
      if (others.length > 0 && kinds.length > 0 && chance(rng, 0.03)) {
        act(
          {
            type: 'interfere',
            playerId: bot.id,
            targetId: pick(rng, others).id,
            kind: pick(rng, kinds),
          },
          t,
        );
      }
      const free = state.grid
        .map((v, i) => (v === 0 && !state.locks.some((l) => l.cell === i) ? i : -1))
        .filter((i) => i >= 0);
      const cell = free.length > 0 ? pick(rng, free) : null;
      if (cell === null || act({ type: 'select', playerId: bot.id, cell }, t) !== undefined) {
        bot.next = t + intBetween(rng, 200, 800);
        continue;
      }
      bot.cell = cell;
      // Now and then the lock runs out before a digit.
      const timeout = chance(rng, 0.03) ? state.config.rules.thinkTimeMs + 400 : null;
      bot.next = t + (timeout ?? Math.round(between(rng, bot.thinkMin, bot.thinkMax)));
      continue;
    }

    const cell = bot.cell;
    bot.cell = null;
    const right = Number(config.puzzle.solution[cell]) as Digit;
    const digit = chance(rng, bot.accuracy) ? right : (wrongDigit(rng, state, cell, right) ?? right);
    const refused = act({ type: 'place', playerId: bot.id, cell, digit }, t);
    // 'noLock': the lock ran out meanwhile. Anything else: give the cell back.
    if (refused !== undefined && refused !== 'noLock') act({ type: 'release', playerId: bot.id }, t);
    bot.next = t + intBetween(rng, 300, 2000);
  }
  return { events, state };
}

/** A wrong digit the engine accepts as a try: not tried in this cell yet, and not all nine on the board. */
function wrongDigit(rng: Rng, state: GameState, cell: CellIndex, right: Digit): Digit | null {
  const tried = new Set(state.wrong[cell]?.map((w) => w.digit));
  const options: Digit[] = [];
  for (let d = 1; d <= 9; d++) {
    if (d === right || tried.has(d as Digit)) continue;
    if (state.grid.filter((v) => v === d).length >= 9) continue;
    options.push(d as Digit);
  }
  return options.length > 0 ? pick(rng, options) : null;
}
