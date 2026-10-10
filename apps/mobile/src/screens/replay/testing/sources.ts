/* Test-only: games saved where the replay and the history read them (the phone's database, a fake server). */
import { botPlayer, type PlayerInfo } from '@sudoku-fight/engine';
import type { HistoryGame, HistoryPage, ReplayAnswer } from '@sudoku-fight/protocol';

import { openPracticeRepo, type PracticeRepo } from '../../../game/practiceRepo';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import { type HistoryApi, HistoryApiError, type HistoryApiErrorCode } from '../../history/historyApi';
import { configOf, Table } from './games';

/** A practice database in memory. */
export const memoryRepo = async (): Promise<PracticeRepo> => openPracticeRepo(await memoryDb());

/** Saves a game played on a Table as the practice session saves it: the row, the whole log, the end. */
export async function savePractice(repo: PracticeRepo, table: Table, me = 'me'): Promise<void> {
  const config = table.config;
  await repo.createGame({
    id: config.id,
    mode: config.mode,
    gameType: config.gameType,
    puzzleId: config.puzzle.id,
    playerId: me,
    seed: config.seed ?? null,
    startedAt: table.log[0]!.t,
    opponents: config.players.filter((p) => p.id !== me),
  });
  await repo.appendEvents(config.id, table.log);
  const state = table.state;
  if (state.result) await repo.finishGame(config.id, { result: state.result, endedAt: state.endedAt ?? 0 });
}

/** Two rated players on the server (users `me` and `nina`); `me` wins. */
export function rankedDuel(id = 'ranked-1', at?: number): Table {
  const players: PlayerInfo[] = [
    { id: 'me', name: 'Moshe', rating: 1287, ratedGames: 12 },
    { id: 'nina', name: 'NinaVolt', rating: 1305, ratedGames: 12 },
  ];
  const table = new Table(configOf('ranked', players, { id }), at);
  let k = 0;
  while (table.state.status === 'running') {
    table.move(k % 4 === 3 ? 'nina' : 'me', table.empty()[0]!, 1_000);
    k++;
  }
  return table;
}

/** A practice against the level-3 bot, played to the end: I take two cells of every three, and win. */
export function botDuelTable(id = 'bot-1', at?: number): Table {
  const bot = botPlayer(3);
  const table = new Table(configOf('bot', [{ id: 'me', name: 'Moshe' }, bot], { id }), at);
  let k = 0;
  while (table.state.status === 'running') {
    table.move(k % 3 === 2 ? bot.id : 'me', table.empty()[0]!, 1_000);
    k++;
  }
  return table;
}

/** The server's record of a finished game played on a Table, seen from `me`'s seat. */
export function historyGameOf(table: Table, me = 'me'): HistoryGame {
  const result = table.state.result;
  const config = table.config;
  return {
    id: config.id,
    mode: config.mode,
    gameType: config.gameType,
    playerCount: config.players.length,
    startedAt: table.state.startedAt ?? table.log[0]!.t,
    endedAt: table.state.endedAt,
    endReason: result?.reason ?? null,
    mySeat: config.players.findIndex((p) => p.id === me),
    players: config.players.map((p, seat) => {
      const rank = result?.ranking.find((r) => r.playerId === p.id);
      const change = result?.ratingChanges.find((c) => c.playerId === p.id);
      return {
        seat,
        userId: p.isBot ? null : p.id,
        displayName: p.name ?? null,
        avatarId: seat === 0 ? 'av07' : 'av12',
        country: seat === 0 ? 'IL' : 'DE',
        score: rank?.score ?? null,
        mistakes: rank?.mistakes ?? null,
        place: rank?.place ?? null,
        status: rank?.status ?? 'active',
        ratingKey: change ? config.gameType : null,
        ratingBefore: change?.before ?? null,
        ratingAfter: change?.after ?? null,
      };
    }),
  };
}

/** A server that knows these games (newest first), in pages of `pageSize`; or fails with `failWith`. */
export function fakeHistoryApi(
  tables: readonly Table[],
  { pageSize = 20, failWith }: { pageSize?: number; failWith?: HistoryApiErrorCode } = {},
): HistoryApi & { calls: string[] } {
  const calls: string[] = [];
  const games = tables.map((t) => historyGameOf(t)).sort((a, b) => b.startedAt - a.startedAt);
  return {
    calls,
    async myGames(cursor) {
      calls.push(`games:${cursor ?? ''}`);
      if (failWith) throw new HistoryApiError(failWith);
      const from = cursor === null ? 0 : Number(cursor);
      const page: HistoryPage = {
        games: games.slice(from, from + pageSize),
        nextCursor: from + pageSize < games.length ? String(from + pageSize) : null,
      };
      return page;
    },
    async replay(gameId) {
      calls.push(`replay:${gameId}`);
      if (failWith) throw new HistoryApiError(failWith);
      const table = tables.find((t) => t.config.id === gameId);
      if (!table) throw new HistoryApiError('notFound', 404);
      const answer: ReplayAnswer = {
        game: historyGameOf(table),
        events: JSON.parse(JSON.stringify(table.log)),
      };
      return answer;
    },
  };
}
