/**
 * Spec §3.5 on the real server (Colyseus + Express + an in-memory PGlite, one port), with real SDK clients:
 * - a game that brings two players together after a block (or one made during the game) mutes the blocked
 *   player's reactions for the one who blocked them, and only for them;
 * - a suspended account is refused by matchmaking with `suspended`, and lifting the suspension lets it in; a
 *   game room refuses it with `suspended` too (not `unauthenticated`).
 * The blocks and the suspension go through the HTTP routes, as the app and the admin site send them.
 */
import type { AddressInfo } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import type { GameEvent } from '@sudoku-fight/engine';
import {
  ACCOUNT_PATHS,
  ADMIN_API_PREFIX,
  blockPath,
  devToken,
  GAME_ROOM_NAME,
  gameRoomErrorOf,
  MATCHMAKING_ROOM_NAME,
  type MatchmakingError,
  matchmakingErrorOf,
  type Me,
  MODERATION_PATHS,
  MUTED_REACTION_EMOJI,
  SERVER_MESSAGE_TYPES,
  type ServerMessage,
} from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { quietLog, testConfig, testPuzzles } from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { adminLogin } from '../src/testing/admin';
import { testTokens } from '../src/testing/tokens';

let server: ReturnType<typeof createAppServer>;
let url = '';
let adminCookie = '';

beforeAll(async () => {
  const tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    tokens: tokens.verifier(Date.now),
    game: { puzzles: testPuzzles, log: quietLog(), closeAfterGameMs: 300 },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  adminCookie = (await adminLogin(url)).cookie;
}, 30_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

const close = { connection: 'close' };

async function register(uid: string, displayName: string): Promise<{ token: string; id: string }> {
  const token = devToken(uid);
  const res = await call<Me>(url, 'POST', ACCOUNT_PATHS.users, {
    token,
    body: fighter({ displayName }),
    headers: close,
  });
  expect(res.status).toBe(201);
  return { token, id: res.body.id };
}

const blockOf = (token: string, playerId: string) =>
  call(url, 'POST', MODERATION_PATHS.blocks, { token, body: { playerId }, headers: close });
const unblockOf = (token: string, playerId: string) =>
  call(url, 'DELETE', blockPath(playerId), { token, headers: close });

async function adminAction(path: string): Promise<number> {
  const res = await fetch(`${url}${ADMIN_API_PREFIX}${path}`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json', ...close },
    body: '{}',
  });
  await res.text();
  return res.status;
}

/** An SDK room and the events it got. */
class Seat {
  readonly events: GameEvent[] = [];
  private seq = 0;

  constructor(readonly room: SdkRoom) {
    for (const type of SERVER_MESSAGE_TYPES)
      room.onMessage(type, (m: ServerMessage) => {
        if (m.type === 'events') this.events.push(...m.events);
      });
  }

  react(emoji: string): void {
    this.room.send('react', { type: 'react', emoji, clientSeq: ++this.seq });
  }

  /** The reactions seen so far, as [sender, emoji]. */
  reactions(): [string, string][] {
    return this.events.flatMap((e) =>
      e.type === 'reaction' ? [[e.playerId, e.emoji] as [string, string]] : [],
    );
  }

  async until(check: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no ${what}`);
  }
}

function clientWith(token: string): Client {
  const client = new Client(url);
  client.auth.token = token;
  return client;
}

/** Two accounts in a private room, the game started, reactions without a cooldown. */
async function game(a: string, b: string): Promise<[Seat, Seat]> {
  const first = new Seat(
    await clientWith(a).create(GAME_ROOM_NAME, { private: true, rules: { reactionCooldownMs: 0 } }),
  );
  const second = new Seat(await clientWith(b).joinById(first.room.roomId, {}));
  await first.until(() => first.events.some((e) => e.type === 'gameStarted'), 'gameStarted');
  await second.until(() => second.events.some((e) => e.type === 'gameStarted'), 'gameStarted');
  return [first, second];
}

describe('blocks mute reactions in a game (spec §3.5)', () => {
  it('a block during the game: the blocked one’s reactions reach the blocker muted, until the unblock', async () => {
    const ana = await register('mute_ana', 'Mute_Ana');
    const ben = await register('mute_ben', 'Mute_Ben');
    const [anaSeat, benSeat] = await game(ana.token, ben.token);

    expect((await blockOf(ana.token, ben.id)).status).toBe(201);
    benSeat.react('😂');
    anaSeat.react('🔥');
    await anaSeat.until(() => anaSeat.reactions().length === 2, 'two reactions');
    await benSeat.until(() => benSeat.reactions().length === 2, 'two reactions');
    // Ana doesn't see Ben's (the event is there, without the emoji); Ben sees both, and Ana's own are hers.
    expect(anaSeat.reactions()).toEqual([
      [ben.id, MUTED_REACTION_EMOJI],
      [ana.id, '🔥'],
    ]);
    expect(benSeat.reactions()).toEqual([
      [ben.id, '😂'],
      [ana.id, '🔥'],
    ]);
    // The sequence stays whole for the muted one too.
    const seqs = anaSeat.events.map((e) => e.seq);
    expect(seqs).toEqual(benSeat.events.map((e) => e.seq));

    expect((await unblockOf(ana.token, ben.id)).status).toBe(204);
    benSeat.react('😎');
    await anaSeat.until(() => anaSeat.reactions().length === 3, 'a third reaction');
    expect(anaSeat.reactions()[2]).toEqual([ben.id, '😎']);
    await Promise.all([anaSeat.room.leave(), benSeat.room.leave()]);
  });

  it('a block from before the game is known from its start; the other way round mutes nothing', async () => {
    const cy = await register('mute_cy', 'Mute_Cy');
    const dee = await register('mute_dee', 'Mute_Dee');
    expect((await blockOf(dee.token, cy.id)).status).toBe(201);
    const [cySeat, deeSeat] = await game(cy.token, dee.token);
    cySeat.react('👀');
    deeSeat.react('😱');
    await deeSeat.until(() => deeSeat.reactions().length === 2, 'two reactions');
    await cySeat.until(() => cySeat.reactions().length === 2, 'two reactions');
    expect(deeSeat.reactions()).toEqual([
      [cy.id, MUTED_REACTION_EMOJI],
      [dee.id, '😱'],
    ]);
    expect(cySeat.reactions()).toEqual([
      [cy.id, '👀'],
      [dee.id, '😱'],
    ]);
    await Promise.all([cySeat.room.leave(), deeSeat.room.leave()]);
  });
});

describe('a suspended account and ranked games (spec §3.5)', () => {
  async function refusalOf(token: string): Promise<MatchmakingError | null | 'joined'> {
    try {
      const room = await clientWith(token).joinOrCreate(MATCHMAKING_ROOM_NAME, { queueKey: 'fast-2p' });
      await room.leave();
      return 'joined';
    } catch (e) {
      return matchmakingErrorOf((e as Error).message);
    }
  }

  it('matchmaking refuses it with `suspended`; lifting the suspension lets it search again', async () => {
    const eve = await register('susp_eve', 'Susp_Eve');
    expect(await adminAction(`/users/${eve.id}/suspend`)).toBe(200);
    // The SDK warns about the refused connection's close, and about the `searching` nobody listens to here.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await refusalOf(eve.token)).toBe('suspended');
      const me = await call<Me>(url, 'GET', ACCOUNT_PATHS.me, { token: eve.token, headers: close });
      expect(me.body.suspended).toBe(true);
      expect(await adminAction(`/users/${eve.id}/unsuspend`)).toBe(200);
      expect(await refusalOf(eve.token)).toBe('joined');
    } finally {
      warn.mockRestore();
    }
  });

  it('a game room refuses it with `suspended` (a match found just before, a game rejoined after)', async () => {
    const fay = await register('susp_fay', 'Susp_Fay');
    expect(await adminAction(`/users/${fay.id}/suspend`)).toBe(200);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const refusal = await clientWith(fay.token)
        .create(GAME_ROOM_NAME, { private: true })
        .then(
          async (room) => {
            await room.leave();
            return 'joined';
          },
          (e: Error) => gameRoomErrorOf(e.message),
        );
      expect(refusal).toBe('suspended');
    } finally {
      warn.mockRestore();
    }
  });
});
