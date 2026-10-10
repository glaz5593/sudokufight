/**
 * A fake player for the game server (work plan, stage 7: "a Node client that plays like a bot"):
 *
 *   npm run server                                              # the dev server, port 2567
 *   npm run fake-client -- --create --name Fake1                # create a room, print its code, wait
 *   npm run fake-client -- --code ABC123 --name Fake2 --level 3 # join it (or join from the app)
 *   npm run fake-client -- --code ABC123 --drop-after 10 --drop-for 5
 *
 * (from apps/server: `npm run fake-client -- …`; from the root the same, it forwards). It plays like the
 * engine's bot of the level (think times, plausible mistakes, reactions, interferences), solves the puzzle
 * itself from the givens (the server never sends the solution of a running game), measures RTT with ping/pong
 * and prints a summary at the end: score, place, mistakes, RTT p50/p95, and the time to get back in sync after
 * a drop. `--help` lists every option. Exit code 0 when the game ended (or it left on purpose), 1 otherwise,
 * 2 for bad arguments.
 *
 * Outside production only: it joins with the dev identity ({ devUserId, name }) until stage 8 brings accounts.
 */
import { randomInt } from 'node:crypto';

import { gameRoomErrorOf } from '@sudoku-fight/protocol';

import { FAKE_CLIENT_USAGE, FakeClient, formatSummary, parseFakeClientArgs } from '../src/testing/fakeClient';

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

  if (!quiet) say(`connecting to ${options.url}`);
  let client: FakeClient;
  try {
    client = await FakeClient.connect({ ...options, log: quiet ? undefined : say });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const hint =
      gameRoomErrorOf(text) === 'unauthenticated'
        ? ' (a production server takes accounts only, from stage 8: use a dev server)'
        : text.includes('ECONNREFUSED') || text.includes('fetch failed')
          ? ' (is the server running? npm run server)'
          : '';
    console.error(`${prefix} could not ${options.create ? 'create a room' : 'join'}: ${text}${hint}`);
    return 1;
  }
  // Always printed (also with --quiet): whoever runs it needs the code to join.
  if (options.create)
    console.log(`${prefix} room code ${client.code} (join: npm run fake-client -- --code ${client.code})`);

  // Ctrl+C: leave the room properly and print what there is.
  process.once('SIGINT', () => void client.stop());
  const summary = await client.done;
  if (json) console.log(JSON.stringify(summary));
  else for (const line of formatSummary(summary)) say(line);
  return summary.outcome === 'over' || summary.outcome === 'left' ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error('[fake-client] failed', error);
    process.exit(1);
  },
);
