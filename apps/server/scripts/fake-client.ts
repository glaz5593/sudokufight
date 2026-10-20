/**
 * A fake player for the game server (work plan, stage 7: "a Node client that plays like a bot"):
 *
 *   npm run server                                              # the dev server, port 2567
 *   npm run fake-client -- --create --name Fake1                # create a room, print its code, wait
 *   npm run fake-client -- --code ABC123 --name Fake2 --level 3 # join it (or join from the app)
 *   npm run fake-client -- --code ABC123 --drop-after 10 --drop-for 5
 *
 * Ranked (stage 9): `--queue fast-2p` signs in with an account (the dev token `dev:<id>`, or `--token`;
 * registered with POST /v1/users the first time), searches in the matchmaking queue, connects to the match's
 * room when found, counts down, plays, and prints the match and the rating before and after (GET /v1/me):
 *
 *   npm run fake-client -- --queue fast-2p --name Ana --speed 20    # window 1
 *   npm run fake-client -- --queue fast-2p --name Ben --speed 20    # window 2: they find each other
 *   npm run fake-client -- --queue hard-2p --keep-searching         # alone: a timeout, then no cap
 *   npm run fake-client -- --queue fast-2p --no-show                # found, never comes: the match is off
 *
 * Playing with friends (1.0.4): `--friends <code>` joins the friends room with that 6-digit code as an account
 * (the dev token `dev:<id>`, or `--token` with a real Firebase ID token on staging): a ticket from
 * POST /v1/rooms/join, then the room; it waits in the lobby until the room's host (a phone) starts the game,
 * then plays. A drop comes back with the reconnection token, or with a new ticket:
 *
 *   npm run fake-client -- --friends 123456 --name Fake3 --token <ID token> --url wss://sudoku-fight-staging.fly.dev
 *   npm run fake-client -- --friends 123456 --name Fake4 --speed 5            # a dev server
 *
 * (from apps/server: `npm run fake-client -- …`; from the root the same, it forwards). It plays like the
 * engine's bot of the level (think times, plausible mistakes, reactions, interferences), solves the puzzle
 * itself from the givens (the server never sends the solution of a running game), measures RTT with ping/pong
 * and prints a summary at the end: score, place, mistakes, RTT p50/p95, and the time to get back in sync after
 * a drop. `--help` lists every option. Exit code 0 when it ended as asked (cli.ts exitCodeOf: the game is
 * over, it left on purpose, a lonely search timed out), 1 otherwise, 2 for bad arguments.
 *
 * Private rooms join with the dev identity ({ devUserId, name }); ranked games and friends rooms with a dev
 * token. They work outside production only, except --queue and --friends with a real Firebase ID token (--token).
 */
import { randomInt } from 'node:crypto';

import { formatFriendCode, gameRoomErrorOf, matchmakingErrorOf } from '@sudoku-fight/protocol';

import {
  exitCodeOf,
  FAKE_CLIENT_USAGE,
  FakeClient,
  formatSummary,
  parseFakeClientArgs,
} from '../src/testing/fakeClient';

/** What a refused friends ticket means (POST /v1/rooms/join, friendsErrorOf in the message). */
const FRIENDS_HINTS: Record<string, string> = {
  notFound: ' (no open room has this code)',
  roomClosed: ' (the room closed)',
  roomFull: ' (4 of 4 seats are taken)',
  gameStarted: ' (its game has started)',
  kicked: ' (the host removed this account from the room)',
  cantJoin: ' (this account blocked a player in the room)',
  notRegistered: ' (the token has no account)',
  unauthorized: ' (the server refused the token: a dev token works on a dev server only)',
  notAvailable: ' (this server has no friends rooms: older than 1.0.4)',
  tooManyRequests: ' (too many tries: wait a few minutes)',
};

function hintFor(text: string, ranked: boolean, friends: boolean): string {
  if (text.includes('ECONNREFUSED') || text.includes('fetch failed'))
    return ' (is the server running? npm run server)';
  if (friends) {
    const code = /\/v1\/rooms\/join: \d+ (\w+)/.exec(text)?.[1];
    return code === undefined ? '' : (FRIENDS_HINTS[code] ?? '');
  }
  if (!ranked)
    return gameRoomErrorOf(text) === 'unauthenticated'
      ? ' (a production server takes accounts only, from stage 8: use a dev server)'
      : '';
  switch (matchmakingErrorOf(text)) {
    case 'unauthenticated':
      return ' (a production server takes Firebase ID tokens only: --token, or a dev server)';
    case 'queueClosed':
      return ' (this server has closed that queue: try another, e.g. fast-2p)';
    case 'alreadyQueued':
      return ' (this account is searching on another connection, or is in a ranked game: use another --id)';
    default:
      return text.includes('401')
        ? ' (the server refused the token: a dev token works on a dev server only)'
        : '';
  }
}

async function main(): Promise<number> {
  const parsed = parseFakeClientArgs(process.argv.slice(2), randomInt);
  if (parsed.kind === 'help') {
    console.log(FAKE_CLIENT_USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`[fake-client] ${parsed.error}\n\n${FAKE_CLIENT_USAGE}`);
    return 2;
  }
  const { options, json, quiet } = parsed.cli;
  const prefix = `[fake ${options.name}]`;
  const say = (line: string) => console.log(`${prefix} ${line}`);
  const ranked = options.queue !== undefined;
  const friends = options.friends !== undefined;

  if (!quiet)
    say(
      `connecting to ${options.url}` +
        (ranked ? ` to search in ${options.queue!.queueKey}` : '') +
        (friends ? ` to join the friends room ${formatFriendCode(options.friends!)}` : ''),
    );
  let client: FakeClient;
  try {
    client = await FakeClient.connect({ ...options, log: quiet ? undefined : say });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const what = ranked ? 'search' : options.create ? 'create a room' : 'join';
    console.error(`${prefix} could not ${what}: ${text}${hintFor(text, ranked, friends)}`);
    return 1;
  }
  // Always printed (also with --quiet): whoever runs it needs the code to join.
  if (options.create)
    console.log(`${prefix} room code ${client.code} (join: npm run fake-client -- --code ${client.code})`);

  // Ctrl+C: leave the room (or the queue) properly and print what there is.
  process.once('SIGINT', () => void client.stop());
  const summary = await client.done;
  if (json) console.log(JSON.stringify(summary));
  else for (const line of formatSummary(summary)) say(line);
  return exitCodeOf(summary, options);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('[fake-client] failed', error);
    process.exit(1);
  },
);
