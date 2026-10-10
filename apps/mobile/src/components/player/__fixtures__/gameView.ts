import {
  type GameView,
  INTERFERENCE_KINDS,
  parseCellName,
  type PlayerView,
  REACTIONS,
} from '@sudoku-fight/engine';

/** Test data for the player components: GameViews shaped like the engine's, around Dir-C-Game. */

export const NOW = 100_000;
export const A8 = parseCellName('A8');
export const F8 = parseCellName('F8');

export function player(o: Partial<PlayerView> & Pick<PlayerView, 'id' | 'seat'>): PlayerView {
  return {
    name: o.id,
    isBot: false,
    rating: 1300,
    status: 'active',
    connected: true,
    graceEndsAt: null,
    score: 0,
    mistakes: 0,
    correct: 0,
    place: 1,
    isLeader: false,
    lock: null,
    hitBy: null,
    immuneUntil: 0,
    bestMove: null,
    ...o,
  };
}

/** Me (MosheG, seat 0, 55 points, 1 mistake, holding F8 with 7 s left) and NinaVolt (seat 1, 39.5, on A8). */
export function twoPlayerView(o: Partial<GameView> = {}): GameView {
  const players = [
    player({
      id: 'moshe',
      seat: 0,
      name: 'MosheG',
      rating: 1287,
      score: 55,
      mistakes: 1,
      place: 1,
      isLeader: true,
      lock: { cell: F8, expiresAt: NOW + 6200, remainingMs: 6200 },
    }),
    player({
      id: 'nina',
      seat: 1,
      name: 'NinaVolt',
      rating: 1305,
      score: 39.5,
      place: 2,
      lock: { cell: A8, expiresAt: NOW + 9000, remainingMs: 9000 },
    }),
  ];
  return {
    gameId: 'g1',
    mode: 'ranked',
    gameType: 'normal',
    status: 'running',
    seq: 10,
    startedAt: 0,
    pausedAt: null,
    rules: {
      turnModel: 'simultaneous',
      thinkTimeMs: 12000,
      interferenceMs: 5000,
      interferences: true,
      interferenceKinds: INTERFERENCE_KINDS,
      reactions: REACTIONS,
      reactionCooldownMs: 2000,
    },
    grid: new Array<number>(81).fill(0),
    givens: new Array<boolean>(81).fill(false),
    owner: new Array<number | null>(81).fill(null),
    wrong: Array.from({ length: 81 }, () => []),
    players,
    turn: null,
    me: 'moshe',
    keypad: { remaining: new Array<number>(9).fill(9), disabled: [], enabled: true },
    cooldowns: [],
    interference: { nextCost: 2, missingPoints: 0, targets: [{ playerId: 'nina', blockedBy: null }] },
    reactionReadyAt: 0,
    result: null,
    solution: null,
    ...o,
  };
}

/** Four players as in Game-4P: me (seat 0, 3rd), NinaVolt (4th), Santi.R (2nd), Aiko_M (1st, leader). */
export function fourPlayerView(o: Partial<GameView> = {}): GameView {
  const base = twoPlayerView();
  return {
    ...base,
    players: [
      player({ id: 'moshe', seat: 0, name: 'MosheG', rating: 1287, score: 30.5, mistakes: 1, place: 3 }),
      player({ id: 'nina', seat: 1, name: 'NinaVolt', rating: 1305, score: 2.5, mistakes: 2, place: 4 }),
      player({ id: 'santi', seat: 2, name: 'Santi.R', rating: 1271, score: 36.5, place: 2 }),
      player({
        id: 'aiko',
        seat: 3,
        name: 'Aiko_M',
        rating: 1318,
        score: 39,
        place: 1,
        isLeader: true,
        lock: { cell: parseCellName('D4'), expiresAt: NOW + 8000, remainingMs: 8000 },
      }),
    ],
    interference: {
      nextCost: 4,
      missingPoints: 0,
      targets: [
        { playerId: 'nina', blockedBy: null },
        { playerId: 'santi', blockedBy: null },
        { playerId: 'aiko', blockedBy: null },
      ],
    },
    ...o,
  };
}

/** Replace one player of a view. */
export function withPlayer(view: GameView, id: string, o: Partial<PlayerView>): GameView {
  return { ...view, players: view.players.map((p) => (p.id === id ? { ...p, ...o } : p)) };
}
