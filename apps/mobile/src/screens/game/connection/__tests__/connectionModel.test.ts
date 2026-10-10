import type { GameView } from '@sudoku-fight/engine';

import {
  blocksInput,
  connectionModel,
  type ConnectionModel,
  type ConnectionStatus,
  DEFAULT_GRACE_MS,
  graceShare,
  holdsResults,
  type LobbyInfo,
  lobbyOf,
  SYNCED_HOLD_MS,
} from '../connectionModel';
import { AIKO, AIKO_INFO, ME, MOSHE_INFO, NINA, NINA_INFO, rankedGame, T0 } from '../testing/games';

const ONLINE: ConnectionStatus = { kind: 'online' };
const GRACE = 15_000;

/** A view with the rules the model reads changed (e.g. the 'turns' model, D1). */
const withTurns = (view: GameView): GameView => ({ ...view, rules: { ...view.rules, turnModel: 'turns' } });

const lobby = (over: Partial<LobbyInfo> = {}): LobbyInfo => ({
  code: 'ABC234',
  gameType: 'normal',
  playerCount: 2,
  players: [{ id: ME, name: 'MosheG' }],
  playerId: ME,
  ...over,
});

describe('connectionModel: before the game (no view)', () => {
  it('shows the connecting steps, from the server by default', () => {
    expect(connectionModel(null, { kind: 'connecting' }, T0)).toEqual({ kind: 'connecting', step: 'server' });
    expect(connectionModel(null, { kind: 'connecting', step: 'room' }, T0)).toEqual({
      kind: 'connecting',
      step: 'room',
    });
  });

  it('waits for the first snapshot once connected (online or resyncing)', () => {
    expect(connectionModel(null, ONLINE, T0)).toEqual({ kind: 'connecting', step: 'sync' });
    expect(connectionModel(null, { kind: 'resyncing' }, T0)).toEqual({ kind: 'connecting', step: 'sync' });
  });

  it('joins again from the start after a drop in the lobby (the seat was freed)', () => {
    expect(connectionModel(null, { kind: 'reconnecting', attempt: 2, lostAt: T0 }, T0)).toEqual({
      kind: 'connecting',
      step: 'server',
    });
  });

  it("shows a dev room's lobby with its seats", () => {
    const model = connectionModel(null, { kind: 'lobby', lobby: lobby() }, T0);
    expect(model).toEqual({
      kind: 'lobby',
      code: 'ABC234',
      gameType: 'normal',
      playerCount: 2,
      seats: [
        { seat: 0, colorIndex: 0, player: { id: ME, name: 'MosheG', isMe: true } },
        { seat: 1, colorIndex: 1, player: null },
      ],
      waitingFor: 1,
    });
  });

  it('shows a connection error before the game too', () => {
    expect(connectionModel(null, { kind: 'failed', failure: 'offline', code: 'NO_NETWORK' }, T0)).toEqual({
      kind: 'error',
      failure: 'offline',
      code: 'NO_NETWORK',
      attempts: 1,
      retrying: false,
      refusal: null,
    });
  });
});

describe('lobbyOf', () => {
  it('colours me P1 wherever I sit, and the others by seat order', () => {
    const model = lobbyOf(
      lobby({
        playerCount: 4,
        players: [
          { id: NINA, name: 'NinaVolt' },
          { id: ME, name: 'MosheG' },
          { id: AIKO, name: 'Aiko_M' },
        ],
      }),
    );
    expect(
      model.seats.map((s) => [s.seat, s.colorIndex, s.player?.id ?? null, s.player?.isMe ?? null]),
    ).toEqual([
      [0, 1, NINA, false],
      [1, 0, ME, true],
      [2, 2, AIKO, false],
      [3, 3, null, null],
    ]);
    expect(model.waitingFor).toBe(1);
  });

  it('waits for nobody once every seat is taken', () => {
    const model = lobbyOf(
      lobby({
        players: [
          { id: ME, name: 'MosheG' },
          { id: NINA, name: 'NinaVolt' },
        ],
      }),
    );
    expect(model.waitingFor).toBe(0);
    expect(model.seats.every((s) => s.player)).toBe(true);
  });

  it('keeps seat order without me (a spectator) and never shows fewer seats than players', () => {
    const model = lobbyOf(
      lobby({ playerCount: 2, playerId: 'someone', players: [{ id: NINA, name: 'NinaVolt' }] }),
    );
    expect(model.seats.map((s) => s.colorIndex)).toEqual([0, 1]);
    const crowded = lobbyOf(
      lobby({
        playerCount: 2,
        players: [
          { id: ME, name: 'MosheG' },
          { id: NINA, name: 'NinaVolt' },
          { id: AIKO, name: 'Aiko_M' },
        ],
      }),
    );
    expect(crowded.seats).toHaveLength(3);
    expect(crowded.waitingFor).toBe(0);
  });
});

describe('connectionModel: a running game', () => {
  it('shows nothing while everyone is connected', () => {
    const game = rankedGame();
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('shows the error with what the host knows of its tries', () => {
    const game = rankedGame();
    const status: ConnectionStatus = {
      kind: 'failed',
      failure: 'refused',
      code: 'gameStarted',
      attempts: 3,
      retrying: true,
      refusal: 'gameStarted',
    };
    expect(connectionModel(game.view(), status, game.now())).toEqual({
      kind: 'error',
      failure: 'refused',
      code: 'gameStarted',
      attempts: 3,
      retrying: true,
      refusal: 'gameStarted',
    });
  });

  it('counts at least one attempt', () => {
    const model = connectionModel(
      null,
      { kind: 'failed', failure: 'unreachable', code: '504', attempts: 0 },
      T0,
    );
    expect(model).toMatchObject({ kind: 'error', attempts: 1 });
  });
});

describe('connectionModel: my connection (Self-Reconnecting)', () => {
  it('is lost while the host reconnects, counting the grace from when it noticed', () => {
    const game = rankedGame();
    const lostAt = game.now();
    const model = connectionModel(game.view(), { kind: 'reconnecting', attempt: 2, lostAt }, lostAt + 4200);
    expect(model).toEqual({
      kind: 'selfReconnecting',
      phase: 'lost',
      attempt: 2,
      secondsLeft: 11, // 10.8 s, rounded up as every timer is
      remainingMs: 10_800,
      graceMs: GRACE,
      syncItems: ['board', 'score', 'locks', 'timers'],
    });
  });

  it("prefers the host's own deadline, and never goes below 0", () => {
    const game = rankedGame();
    const status: ConnectionStatus = { kind: 'reconnecting', attempt: 1, lostAt: T0, graceEndsAt: T0 + 9000 };
    expect(connectionModel(game.view(), status, T0 + 1000)).toMatchObject({
      secondsLeft: 8,
      remainingMs: 8000,
    });
    expect(connectionModel(game.view(), status, T0 + 20_000)).toMatchObject({
      secondsLeft: 0,
      remainingMs: 0,
    });
  });

  it("uses the game's own grace when given (a dev room's override)", () => {
    const game = rankedGame();
    const model = connectionModel(game.view(), { kind: 'reconnecting', attempt: 1, lostAt: T0 }, T0, {
      graceMs: 5000,
    });
    expect(model).toMatchObject({ secondsLeft: 5, remainingMs: 5000, graceMs: 5000 });
  });

  it('counts attempts from 1', () => {
    const game = rankedGame();
    const model = connectionModel(game.view(), { kind: 'reconnecting', attempt: 0, lostAt: T0 }, T0);
    expect(model).toMatchObject({ attempt: 1 });
  });

  it('is lost, without a count or a known deadline, while joining again by code', () => {
    const game = rankedGame();
    expect(connectionModel(game.view(), { kind: 'connecting', step: 'room' }, T0)).toMatchObject({
      kind: 'selfReconnecting',
      phase: 'lost',
      attempt: null,
      secondsLeft: null,
      remainingMs: null,
    });
  });

  it('syncs once the socket is back, until the snapshot shows me connected', () => {
    const game = rankedGame();
    expect(connectionModel(game.view(), { kind: 'resyncing' }, T0)).toMatchObject({
      kind: 'selfReconnecting',
      phase: 'syncing',
      secondsLeft: null,
    });
    // The reconnection's snapshot comes before the engine's 'reconnect': I am still away in it.
    game.disconnect(ME);
    expect(connectionModel(game.view(), ONLINE, game.now())).toMatchObject({
      kind: 'selfReconnecting',
      phase: 'syncing',
    });
    game.reconnect(ME);
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('shows the synced banner for a moment after the snapshot, then nothing', () => {
    const game = rankedGame();
    const status: ConnectionStatus = { kind: 'online', resyncedAt: T0 };
    expect(connectionModel(game.view(), status, T0)).toMatchObject({
      kind: 'selfReconnecting',
      phase: 'synced',
    });
    expect(connectionModel(game.view(), status, T0 + SYNCED_HOLD_MS - 1)).toMatchObject({ phase: 'synced' });
    expect(connectionModel(game.view(), status, T0 + SYNCED_HOLD_MS)).toEqual({ kind: 'none' });
    expect(connectionModel(game.view(), status, T0 - 1)).toEqual({ kind: 'none' });
    expect(connectionModel(game.view(), status, T0 + 100, { syncedHoldMs: 50 })).toEqual({ kind: 'none' });
    expect(connectionModel(game.view(), { kind: 'online', resyncedAt: null }, T0)).toEqual({ kind: 'none' });
  });

  it("names the turn rather than the locks in the 'turns' model (D1)", () => {
    const game = rankedGame();
    const model = connectionModel(withTurns(game.view()), { kind: 'resyncing' }, T0);
    expect(model).toMatchObject({ syncItems: ['board', 'score', 'turn', 'timers'] });
  });

  it('stops counting once I am out of the game (3–4 players)', () => {
    const game = rankedGame([MOSHE_INFO, NINA_INFO, AIKO_INFO]);
    game.surrender(ME);
    const model = connectionModel(game.view(), { kind: 'reconnecting', attempt: 1, lostAt: T0 }, T0 + 1000);
    expect(model).toMatchObject({
      kind: 'selfReconnecting',
      phase: 'lost',
      secondsLeft: null,
      remainingMs: null,
    });
  });

  it('comes before a frozen opponent: my own view is stale meanwhile', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    const model = connectionModel(game.view(), { kind: 'reconnecting', attempt: 1, lostAt: T0 }, T0);
    expect(model.kind).toBe('selfReconnecting');
  });
});

describe('connectionModel: a disconnected opponent (Opponent-Reconnecting)', () => {
  it("freezes a 2-player game: the opponent's countdown from graceEndsAt, in the server's time", () => {
    const game = rankedGame();
    game.disconnect(NINA);
    expect(game.view().status).toBe('paused');
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({
      kind: 'opponentReconnecting',
      playerId: NINA,
      name: 'NinaVolt',
      colorIndex: 1,
      secondsLeft: 15,
      remainingMs: GRACE,
      graceMs: GRACE,
      expired: false,
    });
    expect(connectionModel(game.view(), ONLINE, game.now() + 3500)).toMatchObject({
      secondsLeft: 12,
      remainingMs: 11_500,
      expired: false,
    });
  });

  it('expires at graceEndsAt while the server has not called it yet', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    expect(connectionModel(game.view(), ONLINE, game.now() + GRACE)).toMatchObject({
      secondsLeft: 0,
      remainingMs: 0,
      expired: true,
    });
  });

  it('goes away when the opponent is back', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    game.advance(5000);
    game.reconnect(NINA);
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('does not freeze a game of 3 (the cards show it)', () => {
    const game = rankedGame([MOSHE_INFO, NINA_INFO, AIKO_INFO]);
    game.disconnect(NINA);
    expect(game.view().status).toBe('running');
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('freezes a game of 3 once only two are left in it, for the one who is away', () => {
    const game = rankedGame([MOSHE_INFO, NINA_INFO, AIKO_INFO]);
    game.surrender(AIKO);
    game.disconnect(NINA);
    expect(connectionModel(game.view(), ONLINE, game.now())).toMatchObject({
      kind: 'opponentReconnecting',
      playerId: NINA,
      colorIndex: 1,
    });
  });

  it('shows nothing for a frozen game without anyone away (defensive)', () => {
    const game = rankedGame();
    const view: GameView = { ...game.view(), status: 'paused' };
    expect(connectionModel(view, ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('takes the place of the synced banner', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    const model = connectionModel(game.view(), { kind: 'online', resyncedAt: game.now() }, game.now());
    expect(model.kind).toBe('opponentReconnecting');
  });
});

describe('connectionModel: the game is over', () => {
  it('shows "the opponent left" when a 2-player game is won by abandonment', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    game.advance(GRACE);
    const view = game.view();
    expect(view.status).toBe('over');
    const model = connectionModel(view, ONLINE, game.now());
    expect(model).toEqual({
      kind: 'opponentLeft',
      playerId: NINA,
      name: 'NinaVolt',
      colorIndex: 1,
      me: { id: ME, name: 'MosheG', score: 0 },
      opponentScore: 0,
      ratingDelta: view.result!.ratingChanges.find((c) => c.playerId === ME)!.delta,
      gameType: view.gameType,
      graceSeconds: 15,
    });
    expect((model as Extract<ConnectionModel, { kind: 'opponentLeft' }>).ratingDelta).toBeGreaterThan(0);
  });

  it('shows it whatever the socket does now (the result is known)', () => {
    const game = rankedGame();
    game.disconnect(NINA);
    game.advance(GRACE);
    const failed: ConnectionStatus = { kind: 'failed', failure: 'lost', code: '4000' };
    expect(connectionModel(game.view(), failed, game.now()).kind).toBe('opponentLeft');
    expect(
      connectionModel(game.view(), { kind: 'reconnecting', attempt: 1, lostAt: T0 }, game.now()).kind,
    ).toBe('opponentLeft');
  });

  it('has no rating change in an unrated game, and says the grace that ran out', () => {
    const game = rankedGame([
      { id: ME, name: 'MosheG' },
      { id: NINA, name: 'NinaVolt' },
    ]);
    game.disconnect(NINA);
    game.advance(GRACE);
    expect(connectionModel(game.view(), ONLINE, game.now(), { graceMs: GRACE })).toMatchObject({
      kind: 'opponentLeft',
      ratingDelta: null,
      graceSeconds: 15,
    });
  });

  it('goes straight to the results when the opponent surrendered', () => {
    const game = rankedGame();
    game.surrender(NINA);
    expect(game.view().status).toBe('over');
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('goes straight to the results when I am the one who did not come back', () => {
    const game = rankedGame();
    game.disconnect(ME);
    game.advance(GRACE);
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });

  it('goes straight to the results in a game of 3, even won by abandonment', () => {
    const game = rankedGame([MOSHE_INFO, NINA_INFO, AIKO_INFO]);
    game.surrender(AIKO);
    game.disconnect(NINA);
    game.advance(GRACE);
    expect(game.view().status).toBe('over');
    expect(connectionModel(game.view(), ONLINE, game.now())).toEqual({ kind: 'none' });
  });
});

/** "selfReconnecting (lost)", "error"… */
const label = (m: ConnectionModel): string =>
  m.kind === 'selfReconnecting' ? `${m.kind} (${m.phase})` : m.kind;

describe('what the screen does around the model', () => {
  const kinds: [ConnectionModel, boolean, boolean][] = [
    [{ kind: 'none' }, false, false],
    [{ kind: 'connecting', step: 'server' }, true, false],
    [lobbyOf(lobby()), true, false],
    [
      {
        kind: 'selfReconnecting',
        phase: 'lost',
        attempt: 1,
        secondsLeft: 9,
        remainingMs: 9000,
        graceMs: GRACE,
        syncItems: [],
      },
      true,
      false,
    ],
    [
      {
        kind: 'selfReconnecting',
        phase: 'syncing',
        attempt: null,
        secondsLeft: null,
        remainingMs: null,
        graceMs: GRACE,
        syncItems: [],
      },
      true,
      false,
    ],
    [
      {
        kind: 'selfReconnecting',
        phase: 'synced',
        attempt: null,
        secondsLeft: null,
        remainingMs: null,
        graceMs: GRACE,
        syncItems: [],
      },
      false,
      false,
    ],
    [
      {
        kind: 'opponentReconnecting',
        playerId: NINA,
        name: null,
        colorIndex: 1,
        secondsLeft: 3,
        remainingMs: 3000,
        graceMs: GRACE,
        expired: false,
      },
      true,
      false,
    ],
    [
      {
        kind: 'opponentLeft',
        playerId: NINA,
        name: null,
        colorIndex: 1,
        me: { id: ME, name: null, score: 0 },
        opponentScore: 0,
        ratingDelta: null,
        gameType: 'fast',
        graceSeconds: 15,
      },
      true,
      true,
    ],
    [
      { kind: 'error', failure: 'unreachable', code: '504', attempts: 1, retrying: false, refusal: null },
      true,
      false,
    ],
  ];

  it.each(kinds.map(([model, blocks, holds]) => [label(model), model, blocks, holds] as const))(
    '%s blocks input: %s, holds the results: %s',
    (_, model, blocks, holds) => {
      expect(blocksInput(model)).toBe(blocks);
      expect(holdsResults(model)).toBe(holds);
    },
  );

  it('gives the share of the grace left, within 0–1', () => {
    expect(graceShare(7500, GRACE)).toBe(0.5);
    expect(graceShare(20_000, GRACE)).toBe(1);
    expect(graceShare(-5, GRACE)).toBe(0);
    expect(graceShare(100, 0)).toBe(0);
  });

  it('defaults to the 15-second grace of D4', () => {
    expect(DEFAULT_GRACE_MS).toBe(15_000);
  });
});
