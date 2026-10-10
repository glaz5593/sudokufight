import { cellName } from '@sudoku-fight/engine';

import { BOT, ME } from '../../game/testing/duel';
import { loadPracticeResults, resultsModel, sessionResultsModel } from '../resultsModel';
import {
  endedDuel,
  interruptedDuel,
  lostDuel,
  type SavedDuel,
  tiedRecord,
  wonDuel,
} from '../testing/duelGames';

/** Read as the results route reads it after a restart: from the database, no session around. */
async function load(game: SavedDuel) {
  const loaded = await loadPracticeResults(game.id, { repo: async () => game.repo, session: () => null });
  if (loaded.kind !== 'found') throw new Error(`not found: ${loaded.kind}`);
  return loaded.model;
}

const botRow = {
  playerId: BOT.id,
  name: 'Mr. Hoot',
  avatar: 'av49',
  isBot: true,
  colorIndex: 1,
  left: false,
};

describe('resultsModel against a bot (spec §12)', () => {
  it('a win: first alone; the bot’s row from the saved game; the awards with their winners', async () => {
    const game = await wonDuel();
    const result = game.host.getView().result!;
    const model = await load(game);
    expect(model).toMatchObject({
      mode: 'bot',
      players: 2,
      end: 'completed',
      outcome: 'win',
      place: 1,
      mistakes: 1,
      correct: game.cells.length,
      opponents: [{ ...botRow, score: 0, mistakes: 0, place: 2 }],
    });
    expect(model.awards.map((a) => a.kind)).toEqual(result.awards.map((a) => a.kind));
    expect(model.awards.find((a) => a.kind === 'bestMove')).toEqual({
      kind: 'bestMove',
      winners: [{ playerId: ME, name: null, mine: true }],
      value: result.awards.find((a) => a.kind === 'bestMove')!.value,
    });
    // Fewest mistakes goes to the bot (0 against my 1).
    expect(model.awards.find((a) => a.kind === 'fewestMistakes')?.winners).toEqual([
      { playerId: BOT.id, name: 'Mr. Hoot', mine: false },
    ]);
  });

  it('a loss: the bot filled the board', async () => {
    const game = await lostDuel();
    const model = await load(game);
    const bot = game.host.getView().players[1]!;
    expect(model).toMatchObject({ outcome: 'loss', place: 2, end: 'completed', correct: 1 });
    expect(model.opponents).toEqual([{ ...botRow, score: bot.score, mistakes: 0, place: 1 }]);
    expect(model.bestMove?.cell).toBe(cellName(game.cells[0]!));
  });

  it('"סיום אימון" against a bot ends it as a loss (spec §6.6); no rating moves', async () => {
    const game = await endedDuel();
    const model = await load(game);
    expect(model).toMatchObject({ outcome: 'loss', place: 2, end: 'ended', correct: 1, avgThinkMs: 2_000 });
    expect(game.host.getView().result?.ratingChanges).toEqual([]);
  });

  it('a tie: both at place 1', async () => {
    const game = await wonDuel();
    const saved = (await game.repo.getGame(game.id))!;
    const events = await game.repo.loadEvents(game.id);
    const model = resultsModel(tiedRecord(saved, BOT.id), events);
    expect(model).toMatchObject({ outcome: 'tie', place: 1, awards: [] });
    expect(model.opponents[0]).toMatchObject({ ...botRow, place: 1, score: model.score });
  });

  it('an interrupted game: no outcome, the bot’s numbers as the log left them', async () => {
    const game = await interruptedDuel();
    const model = await load(game);
    const bot = game.host.state.players[1]!;
    expect(model).toMatchObject({ end: 'interrupted', outcome: null, place: null, players: 2, awards: [] });
    expect(model.opponents).toEqual([{ ...botRow, score: bot.score, mistakes: 0, place: null }]);
  });

  it('without its log, the bot is still named by its id (bot-<level>)', async () => {
    const game = await wonDuel();
    const model = resultsModel((await game.repo.getGame(game.id))!);
    expect(model.opponents[0]).toMatchObject({
      playerId: 'bot-3',
      name: 'Mr. Hoot',
      avatar: 'av49',
      isBot: true,
    });
  });

  it('from the session, when nothing was saved', async () => {
    const game = await wonDuel();
    const session = {
      ...game.session,
      mode: 'bot' as const,
      gameType: 'fast' as const,
      puzzleId: game.puzzle.id,
      seed: 1,
      botLevel: 3 as const,
      events: game.host.events,
      flush: async () => undefined,
    };
    expect(sessionResultsModel(session)).toMatchObject({
      outcome: 'win',
      saved: false,
      opponents: [{ ...botRow, score: 0 }],
    });
  });
});
