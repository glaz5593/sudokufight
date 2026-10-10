import { cellName, formatScoreLine } from '@sudoku-fight/engine';

import type { PracticeSession } from '../../../game/session';
import { loadPracticeResults, resultsModel, sessionResultsModel } from '../resultsModel';
import {
  completedPractice,
  endedPractice,
  interruptedPractice,
  move,
  savedPractice,
} from '../testing/practiceGames';

const noSession = (): PracticeSession | null => null;

describe('resultsModel', () => {
  it('a practice ended with "סיום אימון": my numbers, the move of the game and its calculation', async () => {
    const game = await endedPractice();
    const saved = (await game.repo.getGame(game.session.id))!;
    const view = game.session.getView();
    const me = view.players[0]!;
    const model = resultsModel(saved);

    expect(model).toMatchObject({
      gameId: game.session.id,
      mode: 'solo',
      gameType: 'fast',
      end: 'ended',
      score: me.score,
      mistakes: 1,
      correct: 2,
      durationMs: 10_000,
      avgThinkMs: 2_500,
      saved: true,
    });
    const best = me.bestMove!;
    expect(model.bestMove).toEqual({
      cell: cellName(best.cell),
      digit: best.digit,
      points: best.points,
      line: formatScoreLine(best.breakdown),
    });
    expect(model.bestMove!.line).toMatch(/^points = 9 − \d \+ \(9 − \d\) \/ 2 = [\d.]+$/);
  });

  it('a full board is "completed"', async () => {
    const game = await completedPractice();
    const model = resultsModel((await game.repo.getGame(game.session.id))!);
    expect(model.end).toBe('completed');
    expect(model.correct).toBe(game.cells.length);
    expect(model.mistakes).toBe(0);
    expect(model.avgThinkMs).toBe(1_000);
  });

  it('an interrupted practice: its row’s numbers, and the best move and think time from its saved log', async () => {
    const game = await interruptedPractice();
    const saved = (await game.repo.getGame(game.session.id))!;
    expect(saved.status).toBe('interrupted');
    expect(saved.result).toBeNull();
    const events = await game.repo.loadEvents(game.session.id);
    const model = resultsModel(saved, events);
    expect(model).toMatchObject({ end: 'interrupted', correct: 1, mistakes: 1, avgThinkMs: 2_500 });
    expect(model.score).toBe(saved.score);
    expect(model.durationMs).toBe(saved.durationMs);
    expect(model.bestMove?.cell).toBe(cellName(game.cells[0]!));

    // Without its log, the numbers still come from the row.
    expect(resultsModel(saved)).toMatchObject({
      end: 'interrupted',
      correct: 1,
      bestMove: null,
      avgThinkMs: null,
    });
  });

  it('a practice without a correct move has no move of the game and no think time', async () => {
    const game = await savedPractice();
    game.session.endPractice();
    await game.session.flush();
    const model = resultsModel((await game.repo.getGame(game.session.id))!);
    expect(model).toMatchObject({ score: 0, correct: 0, bestMove: null, avgThinkMs: null });
  });

  it('sessionResultsModel: the same results from the session, marked unsaved; none while it runs', async () => {
    const game = await savedPractice();
    move(game, game.cells[0]!, 2_000);
    expect(sessionResultsModel(game.session)).toBeNull();
    game.session.endPractice();
    expect(sessionResultsModel(game.session)).toMatchObject({
      gameId: game.session.id,
      end: 'ended',
      correct: 1,
      avgThinkMs: 2_000,
      saved: false,
    });
  });
});

describe('loadPracticeResults', () => {
  it('waits for the session that just ended to reach the disk, then reads it', async () => {
    const game = await savedPractice();
    move(game, game.cells[0]!, 2_000);
    game.session.endPractice(); // the finish is still on its way to the database
    const loaded = await loadPracticeResults(game.session.id, {
      repo: async () => game.repo,
      session: () => game.session,
    });
    expect(loaded).toMatchObject({ kind: 'found', model: { end: 'ended', correct: 1, saved: true } });
  });

  it('reads a saved game with no session around (after an app restart)', async () => {
    const game = await interruptedPractice();
    const loaded = await loadPracticeResults(game.session.id, {
      repo: async () => game.repo,
      session: noSession,
    });
    expect(loaded).toMatchObject({ kind: 'found', model: { end: 'interrupted', correct: 1 } });
  });

  it('a game that is not on the phone is missing; without a database it is unavailable', async () => {
    const game = await savedPractice();
    expect(await loadPracticeResults('nope', { repo: async () => game.repo, session: noSession })).toEqual({
      kind: 'missing',
    });
    expect(await loadPracticeResults('nope', { repo: async () => null, session: noSession })).toEqual({
      kind: 'unavailable',
    });
    game.session.close();
  });

  it('without a database, the session that just ended still shows its results', async () => {
    const game = await savedPractice();
    game.session.endPractice();
    const loaded = await loadPracticeResults(game.session.id, {
      repo: async () => null,
      session: () => game.session,
    });
    expect(loaded).toMatchObject({ kind: 'found', model: { end: 'ended', saved: false } });
  });

  it('a failing read falls back to the session, or reports the database unavailable', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const game = await savedPractice();
    game.session.endPractice();
    const failing = { repo: async () => Promise.reject(new Error('disk on fire')) };
    expect(
      await loadPracticeResults(game.session.id, { ...failing, session: () => game.session }),
    ).toMatchObject({ kind: 'found', model: { saved: false } });
    expect(await loadPracticeResults(game.session.id, { ...failing, session: noSession })).toEqual({
      kind: 'unavailable',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
