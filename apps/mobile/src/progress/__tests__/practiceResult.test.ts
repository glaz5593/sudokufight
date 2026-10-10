import { ManualClock, ManualScheduler, type RankEntry } from '@sudoku-fight/engine';

import { openPracticeRepo } from '../../game/practiceRepo';
import { type PracticeFinish, startPractice } from '../../game/session';
import { smallPool } from '../../game/testing/practice';
import { memoryDb } from '../../game/testing/sqlJsDb';
import { type FinishedPractice, practiceResultOf } from '../practiceResult';

/** What a finished practice earns XP with [D41] (spec §15): mode, outcome and my correct moves. */

const rank = (playerId: string, place: number, correct: number): RankEntry => ({
  playerId,
  seat: playerId === 'me' ? 0 : 1,
  place,
  score: 10,
  mistakes: 0,
  correct,
  status: 'active',
});

const game = (over: Partial<FinishedPractice>): FinishedPractice => ({
  id: 'practice-1',
  mode: 'bot',
  gameType: 'normal',
  playerId: 'me',
  result: { reason: 'boardComplete', ranking: [rank('me', 1, 30), rank('bot', 2, 20)] },
  endedAt: 5_000.7,
  ...over,
});

describe('practiceResultOf', () => {
  it('against a bot: a win, with my correct moves', () => {
    expect(practiceResultOf(game({}))).toEqual({
      id: 'practice-1',
      mode: 'bot',
      gameType: 'normal',
      outcome: 'win',
      correct: 30,
      endedAt: 5000,
    });
  });

  it('against a bot: a loss, and a tie (first together)', () => {
    const lost = game({
      result: { reason: 'boardComplete', ranking: [rank('bot', 1, 40), rank('me', 2, 12)] },
    });
    expect(practiceResultOf(lost)).toMatchObject({ outcome: 'loss', correct: 12 });
    const tie = game({
      result: { reason: 'boardComplete', ranking: [rank('me', 1, 20), rank('bot', 1, 20)] },
    });
    expect(practiceResultOf(tie)?.outcome).toBe('tie');
  });

  it('solo: the board done, or ended before it', () => {
    const done = game({ mode: 'solo', result: { reason: 'boardComplete', ranking: [rank('me', 1, 50)] } });
    expect(practiceResultOf(done)).toMatchObject({ mode: 'solo', outcome: 'completed', correct: 50 });
    const ended = game({ mode: 'solo', result: { reason: 'practiceEnded', ranking: [rank('me', 1, 3)] } });
    expect(practiceResultOf(ended)?.outcome).toBe('ended');
  });

  it('a ranked game is not a practice: none', () => {
    expect(practiceResultOf(game({ mode: 'ranked' }))).toBeNull();
  });
});

describe('the session reports a practice’s end (once)', () => {
  it('"סיום אימון" ends the game and reports it with its result', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const finished: PracticeFinish[] = [];
    const session = await startPractice(
      { gameType: 'fast' },
      {
        repo: await openPracticeRepo(await memoryDb()),
        clock,
        scheduler: new ManualScheduler(clock),
        pool: smallPool(3),
        seed: 7,
        track: () => undefined,
        onFinish: (end) => finished.push(end),
      },
    );
    session.endPractice();
    session.endPractice();
    await session.flush();
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ id: session.id, mode: 'solo', gameType: 'fast', playerId: 'me' });
    expect(practiceResultOf(finished[0]!)).toMatchObject({ id: session.id, outcome: 'ended', correct: 0 });
    session.close();
  });

  it('an error in the report is reported, never thrown at the game', async () => {
    const clock = new ManualClock(1_700_000_000_000);
    const errors: string[] = [];
    const session = await startPractice(
      { gameType: 'fast' },
      {
        repo: null,
        clock,
        scheduler: new ManualScheduler(clock),
        pool: smallPool(3),
        seed: 7,
        track: () => undefined,
        onError: (what) => errors.push(what),
        onFinish: () => {
          throw new Error('boom');
        },
      },
    );
    expect(() => session.endPractice()).not.toThrow();
    expect(errors).toEqual(['could not report the end of the game']);
    session.close();
  });
});
