import { GAME_TYPES, type GameType, isBotLevelId } from '@sudoku-fight/engine';
import {
  type GameRoomRuleOverrides,
  isAvatarId,
  isCountryCode,
  normalizeRoomCode,
  parseQueueKey,
  QUEUE_KEYS,
  type QueueKey,
  type RatingEntry,
} from '@sudoku-fight/protocol';

import { DEV_USER_ID, DISPLAY_NAME } from '../../auth';
import {
  defaultFakeId,
  type FakeAccountOptions,
  type FakeClientOptions,
  type FakeClientSummary,
  type FakeMatchSummary,
  type FakeQueueOptions,
} from './client';

/**
 * The command line of scripts/fake-client.ts: arguments in, FakeClientOptions out, and the summary as text.
 * Pure, so it is tested without a process.
 */

export const FAKE_CLIENT_USAGE = `Usage: npm run fake-client -- (--code <code> | --create | --queue <queue>) [options]

  --url <url>              the server (default ws://localhost:2567)
  --code <code>            join the room with this code
  --create                 create a private room and print its code (with --code: use that code)
  --queue <queue>          a ranked game: search in this matchmaking queue (fast-2p ... hard-4p)
  --name <name>            display name, 3-16 letters/digits/_/. (default Fake<number>); with --queue the
                           account's name when it registers one
  --id <id>                dev user id (default fake-<name>); with --queue the uid of the dev token
  --level <1-5>            plays like this bot level (default 3)
  --speed <x>              think x times faster than a person (default 1)
  --no-interfere           never send interferences
  --no-react               never send reactions
  --seed <n>               the random seed (printed in the summary)
  --ping-every <ms>        a ping every this many ms for RTT (default 1000, 0: none)

  with --create:
  --game-type <type>       fast | normal | hard (default fast)
  --players <2-4>          the game starts when this many are in (default 2)
  --grace <s>              grace period after a drop (default 15)
  --rules <json>           other dev rule overrides, e.g. '{"thinkTimeMs":5000}'
  --rated                  a rated room (ranked pool, ratings move, the game is stored): every player
                           joins with --account

  with --code or --create:
  --account                play as an account, by its token (--token, --avatar, --country as with --queue)

  with --queue or --account (an account: registered with POST /v1/users the first time):
  --token <token>          the account's ID token (default dev:<id>, which only a dev server takes)
  --avatar <id>            the new account's avatar, av01-av51 (default av01)
  --country <XX>           the new account's country, ISO code (default IL)
  --keep-searching         after a timeout (60 s), search on without the cap on the range
  --no-show                after "found", never connect to the game room (the match is called off)

  trouble (seconds from the start of the game):
  --drop-after <s>         drop the connection (no goodbye)...
  --drop-for <s>           ...and come back after this long (default 5)
  --drop-in-countdown <s>  (--queue) drop the connection at the 3-2-1 countdown, back after this long
  --leave-after <s>        leave on purpose and never come back
  --surrender-after <s>    surrender

  --json                   print the summary as one JSON line
  --quiet                  no progress lines
  --verbose                every move too
  --help                   this text`;

export interface FakeClientCli {
  options: FakeClientOptions;
  json: boolean;
  quiet: boolean;
}

export type ParsedFakeClientArgs =
  { kind: 'run'; cli: FakeClientCli } | { kind: 'help' } | { kind: 'error'; error: string };

const VALUE_FLAGS = [
  'url',
  'code',
  'name',
  'id',
  'level',
  'speed',
  'seed',
  'ping-every',
  'game-type',
  'players',
  'grace',
  'rules',
  'queue',
  'token',
  'avatar',
  'country',
  'drop-after',
  'drop-for',
  'drop-in-countdown',
  'leave-after',
  'surrender-after',
] as const;
const SWITCHES = [
  'create',
  'rated',
  'account',
  'keep-searching',
  'no-show',
  'no-interfere',
  'no-react',
  'json',
  'quiet',
  'verbose',
  'help',
] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];
type Switch = (typeof SWITCHES)[number];

class ArgError extends Error {}

/** Command-line arguments to options; `random(n)` is an integer in [0, n) for the default name. */
export function parseFakeClientArgs(
  argv: readonly string[],
  random: (n: number) => number,
): ParsedFakeClientArgs {
  try {
    const { values, switches } = split(argv);
    if (switches.has('help')) return { kind: 'help' };
    return { kind: 'run', cli: build(values, switches, random) };
  } catch (error) {
    if (error instanceof ArgError) return { kind: 'error', error: error.message };
    throw error;
  }
}

function split(argv: readonly string[]): { values: Map<ValueFlag, string>; switches: Set<Switch> } {
  const values = new Map<ValueFlag, string>();
  const switches = new Set<Switch>();
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k]!;
    if (arg === '-h') {
      switches.add('help');
      continue;
    }
    if (!arg.startsWith('--')) throw new ArgError(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const flag = arg.slice(2, eq < 0 ? undefined : eq);
    if ((SWITCHES as readonly string[]).includes(flag)) {
      if (eq >= 0) throw new ArgError(`--${flag} takes no value`);
      switches.add(flag as Switch);
    } else if ((VALUE_FLAGS as readonly string[]).includes(flag)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : argv[++k];
      if (value === undefined || (eq < 0 && value.startsWith('--')))
        throw new ArgError(`--${flag} needs a value`);
      values.set(flag as ValueFlag, value);
    } else {
      throw new ArgError(`unknown option --${flag}`);
    }
  }
  return { values, switches };
}

function build(
  values: Map<ValueFlag, string>,
  switches: Set<Switch>,
  random: (n: number) => number,
): FakeClientCli {
  const create = switches.has('create');
  const queued = values.get('queue');
  for (const flag of ['game-type', 'players', 'grace', 'rules'] as const)
    if (values.has(flag) && !create) throw new ArgError(`--${flag} goes with --create`);
  if (switches.has('rated') && !create) throw new ArgError('--rated goes with --create');
  // A rated room takes accounts only: its creator plays as one.
  const account = switches.has('account') || switches.has('rated');
  if (account && queued !== undefined) throw new ArgError('--queue plays as an account already');
  for (const flag of ['drop-in-countdown', 'keep-searching', 'no-show'] as const)
    if ((values.has(flag as ValueFlag) || switches.has(flag as Switch)) && queued === undefined)
      throw new ArgError(`--${flag} goes with --queue`);
  for (const flag of ['token', 'avatar', 'country'] as const)
    if (values.has(flag) && queued === undefined && !account)
      throw new ArgError(`--${flag} goes with --queue or --account`);
  if (queued !== undefined && (create || values.has('code')))
    throw new ArgError('--queue searches for a ranked game: not with --code or --create');

  const url = values.get('url') ?? 'ws://localhost:2567';
  if (!/^(wss?|https?):\/\/[^/\s]+/.test(url))
    throw new ArgError(`--url: not a ws:// or http:// address: ${url}`);

  const name = values.get('name') ?? `Fake${100 + random(900)}`;
  if (!DISPLAY_NAME.test(name)) throw new ArgError('--name: 3-16 characters, letters, digits, "_" or "."');
  const id = values.get('id') ?? defaultFakeId(name);
  if (!DEV_USER_ID.test(id)) throw new ArgError('--id: 1-64 characters, letters, digits, "_" or "-"');

  let code: string | undefined;
  const typed = values.get('code');
  if (typed !== undefined) {
    const normal = normalizeRoomCode(typed);
    if (normal === null) throw new ArgError(`--code: "${typed}" is not a room code (6 letters and digits)`);
    code = normal;
  } else if (!create && queued === undefined) {
    throw new ArgError(
      'give --code <code> to join a room, --create to make one, or --queue <queue> for a ranked game',
    );
  }

  const level = integer(values, 'level', 1, 5) ?? 3;
  if (!isBotLevelId(level)) throw new ArgError('--level: 1 to 5');
  const speed = number(values, 'speed', 0.001, 1000) ?? 1;
  const pingEveryMs = integer(values, 'ping-every', 0, 60_000) ?? 1000;
  if (pingEveryMs > 0 && pingEveryMs < 100) throw new ArgError('--ping-every: 0, or 100 ms and up');

  const options: FakeClientOptions = {
    url,
    name,
    id,
    level,
    thinkScale: 1 / speed,
    interfere: !switches.has('no-interfere'),
    react: !switches.has('no-react'),
    pingEveryMs,
    verbose: switches.has('verbose'),
  };
  const seed = integer(values, 'seed', 0, 2 ** 31 - 1);
  if (seed !== undefined) options.seed = seed;

  if (create) {
    const gameType = values.get('game-type') ?? 'fast';
    if (!(GAME_TYPES as readonly string[]).includes(gameType))
      throw new ArgError(`--game-type: ${GAME_TYPES.join(' | ')}`);
    const rules = parseRules(values.get('rules'));
    const grace = number(values, 'grace', 0.1, 120);
    if (grace !== undefined) rules.graceMs = Math.round(grace * 1000);
    options.create = {
      gameType: gameType as GameType,
      playerCount: integer(values, 'players', 2, 4) ?? 2,
      ...(code === undefined ? {} : { code }),
      ...(Object.keys(rules).length ? { rules } : {}),
      ...(switches.has('rated') ? { rated: true } : {}),
    };
  } else if (queued !== undefined) {
    options.queue = parseQueue(queued, values, switches);
  } else {
    options.code = code;
  }
  if (account) {
    const { token, avatarId, country } = parseAccount(values);
    options.account = {
      ...(token === undefined ? {} : { token }),
      ...(avatarId === undefined ? {} : { avatarId }),
      ...(country === undefined ? {} : { country }),
    };
  }

  const ms = (flag: ValueFlag) => {
    const s = number(values, flag, 0, 24 * 3600);
    return s === undefined ? undefined : Math.round(s * 1000);
  };
  const trouble = {
    dropAfterMs: ms('drop-after'),
    dropForMs: ms('drop-for'),
    dropInCountdownForMs: ms('drop-in-countdown'),
    leaveAfterMs: ms('leave-after'),
    surrenderAfterMs: ms('surrender-after'),
  };
  if (trouble.dropForMs !== undefined && trouble.dropAfterMs === undefined)
    throw new ArgError('--drop-for goes with --drop-after');
  if (trouble.dropInCountdownForMs !== undefined && switches.has('no-show'))
    throw new ArgError('--drop-in-countdown and --no-show: a no-show never gets to the countdown');
  const set = Object.fromEntries(Object.entries(trouble).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) options.trouble = set;

  return { options, json: switches.has('json'), quiet: switches.has('quiet') };
}

/** --queue and its options. Any queue key is taken: the server says which queues are open (queueClosed). */
function parseQueue(text: string, values: Map<ValueFlag, string>, switches: Set<Switch>): FakeQueueOptions {
  if (parseQueueKey(text) === null) throw new ArgError(`--queue: one of ${QUEUE_KEYS.join(', ')}`);
  const queue: FakeQueueOptions = { queueKey: text as QueueKey, ...parseAccount(values) };
  if (switches.has('keep-searching')) queue.keepSearching = true;
  if (switches.has('no-show')) queue.noShow = true;
  return queue;
}

/** --token, --avatar and --country: the account of --queue or --account. */
function parseAccount(values: Map<ValueFlag, string>): FakeAccountOptions {
  const account: FakeAccountOptions = {};
  const token = values.get('token');
  if (token !== undefined) {
    if (!/^\S+$/.test(token)) throw new ArgError('--token: an ID token (no spaces)');
    account.token = token;
  }
  const avatar = values.get('avatar');
  if (avatar !== undefined) {
    if (!isAvatarId(avatar)) throw new ArgError('--avatar: av01 to av51 (not av36)');
    account.avatarId = avatar;
  }
  const country = values.get('country')?.toUpperCase();
  if (country !== undefined) {
    if (!isCountryCode(country)) throw new ArgError('--country: a two-letter country code, e.g. IL');
    account.country = country;
  }
  return account;
}

/**
 * The exit code of a finished run: 0 when it ended the way it was asked to (the game is over, it left on
 * purpose, a lonely search timed out without --keep-searching, a --no-show's match was called off), else 1.
 */
export function exitCodeOf(summary: FakeClientSummary, options: FakeClientOptions): 0 | 1 {
  switch (summary.outcome) {
    case 'over':
    case 'left':
    case 'timeout':
      return 0;
    case 'cancelled':
      return options.queue?.noShow ? 0 : 1;
    default:
      return 1;
  }
}

function parseRules(text: string | undefined): GameRoomRuleOverrides {
  if (text === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ArgError('--rules: not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new ArgError('--rules: a JSON object, e.g. \'{"thinkTimeMs":5000}\'');
  // The server checks the keys and the ranges (badOptions).
  return parsed;
}

function number(
  values: Map<ValueFlag, string>,
  flag: ValueFlag,
  min: number,
  max: number,
): number | undefined {
  const text = values.get(flag);
  if (text === undefined) return undefined;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max)
    throw new ArgError(`--${flag}: a number from ${min} to ${max}`);
  return n;
}

function integer(
  values: Map<ValueFlag, string>,
  flag: ValueFlag,
  min: number,
  max: number,
): number | undefined {
  const n = number(values, flag, min, max);
  if (n !== undefined && !Number.isInteger(n))
    throw new ArgError(`--${flag}: a whole number from ${min} to ${max}`);
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// The summary as text

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const rated = (r: RatingEntry) =>
  `${r.rating} (${plural(r.games, 'game')}${r.provisional ? ', provisional' : ''})`;

/** A ranked run: the search, the match, and the rating as the result gave it and as the server stored it. */
function matchLines(m: FakeMatchSummary): string[] {
  const lines: string[] = [];
  const ranges = m.ranges.length
    ? `range ±${m.ranges[0]}${m.ranges.length > 1 ? ` to ±${m.ranges.at(-1)}` : ''}`
    : 'no range';
  const searched = m.searchedMs === null ? '' : ` after ${(m.searchedMs / 1000).toFixed(1)} s`;
  const timeouts = m.timeouts ? `, ${plural(m.timeouts, 'timeout')}` : '';
  const vs = m.opponents
    .map((p) => `${p.name} (${p.rating}${p.provisional ? ', provisional' : ''})`)
    .join(', ');
  if (m.matchId !== null && m.cancelled === null) {
    lines.push(
      `match ${m.queueKey}: vs ${vs}${searched}, ${ranges}${timeouts}${m.rematch ? ', a rematch' : ''}`,
    );
  } else {
    lines.push(`search ${m.queueKey}: no game${searched}, ${ranges}${timeouts}`);
  }
  if (m.cancelled !== null) lines.push(`the match vs ${vs} was called off (${m.cancelled})`);
  if (m.rating !== null) {
    const r = m.rating;
    lines.push(
      `rating ${r.key} by the result: ${r.before} -> ${r.after} (${signed(r.delta)}` +
        `${r.provisional ? ', provisional: K doubled' : ''})`,
    );
  }
  const account = m.registered ? 'registered now' : 'signed in';
  if (m.ratingBefore !== null) {
    const after = m.ratingAfter === null ? '' : `; stored after the game: ${rated(m.ratingAfter)}`;
    lines.push(`account ${account}: ${m.ratingBefore.key} ${rated(m.ratingBefore)}${after}`);
  }
  return lines;
}

/** The end of a run, a few lines for the terminal. */
export function formatSummary(s: FakeClientSummary): string[] {
  const lines: string[] = s.match ? matchLines(s.match) : [];
  if (s.place !== null) {
    lines.push(
      `result: place ${s.place} of ${s.players} (${s.endReason}), score ${s.score}, ` +
        `${s.correct} correct, ${plural(s.mistakes ?? 0, 'mistake')}${s.status === 'active' ? '' : `, ${s.status}`}`,
    );
  } else if (s.score !== null) {
    lines.push(
      `no result (${s.outcome}): last seen with score ${s.score}, ${plural(s.mistakes ?? 0, 'mistake')}`,
    );
  }
  if (s.ranking) {
    // A ranked game's players are users.id: by name, as "found" showed them.
    const names = new Map<string, string>(
      s.match
        ? [[s.playerId, s.name], ...s.match.opponents.map((p): [string, string] => [p.id, p.name])]
        : [],
    );
    const who = (id: string) => names.get(id) ?? id;
    lines.push(
      `ranking: ${s.ranking.map((r) => `${r.place}. ${who(r.playerId)} ${r.score} (${r.status})`).join(', ')}`,
    );
  }
  const { rtt, actions } = s;
  lines.push(
    rtt.count
      ? `RTT: p50 ${rtt.p50Ms} ms, p95 ${rtt.p95Ms} ms, max ${rtt.maxMs} ms (${plural(rtt.count, 'ping')}; ` +
          `target p95 <= 150 ms)`
      : 'RTT: no pongs',
  );
  if (actions.count || s.actionsLost)
    lines.push(
      `actions answered: p50 ${actions.p50Ms} ms, p95 ${actions.p95Ms} ms, max ${actions.maxMs} ms ` +
        `(${plural(actions.count, 'action')}, ${s.actionsLost} lost)`,
    );
  if (s.clockOffsetMs !== null) lines.push(`clock offset (server - here): ${s.clockOffsetMs} ms`);
  s.resyncs.forEach((r, k) =>
    lines.push(
      `return ${k + 1} (${r.via}): down ${(r.downMs / 1000).toFixed(1)} s, reconnected in ` +
        `${Math.round(r.reconnectMs)} ms, in sync in ${Math.round(r.syncMs)} ms (target <= 2000 ms)`,
    ),
  );
  if (s.solutionMatches !== null)
    lines.push(
      s.solutionMatches
        ? `solution: worked out from the givens in ${s.solveMs} ms, the same as the server's`
        : 'solution: NOT the same as the server revealed',
    );
  const rejected = Object.entries(s.rejected).map(([reason, n]) => `${reason} ${n}`);
  if (rejected.length) lines.push(`refused: ${rejected.join(', ')}`);
  if (s.seqGaps || s.leaks)
    lines.push(`PROBLEM: ${s.seqGaps} seq gaps, ${s.leaks} snapshots with the solution`);
  lines.push(
    `outcome: ${s.outcome}${s.error ? ` (${s.error})` : ''}; ${s.code ? `room ${s.code}, ` : ''}` +
      `level ${s.level}, seed ${s.seed}`,
  );
  return lines;
}
