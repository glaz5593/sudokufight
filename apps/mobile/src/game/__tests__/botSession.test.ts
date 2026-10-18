import {
  BOT_CONFIG,
  BOT_LEVELS,
  BOT_PACE,
  botPlayer,
  createRng,
  defaultRules,
  type GameEvent,
  type LocalGameHost,
  ManualClock,
  ManualScheduler,
  replay,
  toView,
} from '@sudoku-fight/engine';

import { cardModel } from '../../components/player';
import { allOfflinePuzzles } from '../offlinePool';
import { outcomeOf } from '../outcome';
import { openPracticeRepo, type PracticeRepo } from '../practiceRepo';
import {
  BOT_SEED_SALT,
  botSeedOf,
  ME,
  type PracticeDeps,
  type PracticeSession,
  startBotPractice,
  startPractice,
} from '../session';
import { playMyMove, solvedBy } from '../testing/botPractice';
import { smallPool } from '../testing/practice';
import { memoryDb } from '../testing/sqlJsDb';

/**
 * Work plan stage 5: a practice against the engine's bot on the phone (spec §5.1, §9). The bot runs on the
 * session's clock and scheduler (manual here), with dice from the game's seed, and the whole game is saved
 * like a solo practice [D25], with the opponent and the outcome.
 */

interface Rig {
  repo: PracticeRepo;
  clock: ManualClock;
  scheduler: ManualScheduler;
  track: jest.Mock;
  errors: [string, unknown][];
  deps: PracticeDeps;
}

async function rig(seed = 7): Promise<Rig> {
  const repo = await openPracticeRepo(await memoryDb());
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const track = jest.fn();
  const errors: [string, unknown][] = [];
  const deps: PracticeDeps = {
    repo,
    clock,
    scheduler,
    pool: smallPool(5),
    seed,
    track,
    onError: (what, error) => errors.push([what, error]),
  };
  return { repo, clock, scheduler, track, errors, deps };
}

const BOT5 = botPlayer(5);
const local = (s: PracticeSession) => s.host as unknown as LocalGameHost;
const puzzleOf = (s: PracticeSession) => allOfflinePuzzles().find((p) => p.id === s.puzzleId)!;
const plain = (events: readonly GameEvent[]) => JSON.parse(JSON.stringify(events)) as GameEvent[];

/**
 * Me against the bot: every `everyMs` I take the first free cell and place its answer, while the bot plays on
 * the same clock, until the game is over (or `maxMs` of game time passed).
 */
function playToTheEnd(r: Rig, s: PracticeSession, everyMs = 2_500, maxMs = 3_600_000): void {
  const puzzle = puzzleOf(s);
  const until = r.clock.now() + maxMs;
  while (s.getView().status !== 'over' && r.clock.now() < until) {
    r.scheduler.advance(everyMs);
    playMyMove(s, puzzle);
  }
}

describe('a practice against a bot (spec §9)', () => {
  it('sets the table: me in seat 0, the engine’s bot in seat 1, the rules of mode "bot", the game seed', async () => {
    const r = await rig();
    const s = await startBotPractice(
      { gameType: 'normal', level: 3 },
      { ...r.deps, pool: smallPool(3, 'normal') },
    );
    const created = s.events[0]!;
    if (created.type !== 'gameCreated') throw new Error('first event');
    expect(created.config).toMatchObject({
      mode: 'bot',
      gameType: 'normal',
      players: [{ id: ME }, { id: 'bot-3', name: 'Mr. Hoot', isBot: true }],
      rules: defaultRules('bot', 'normal'),
      seed: 7,
    });
    // [D44] The player knows it is a bot: no interferences, either way.
    expect(created.config.rules.interferences).toBe(false);
    expect(s.getView().interference).toBeNull();
    // So the bot's card has no "הפרעה" button.
    expect(cardModel(s.getView(), 'bot-3', 0, r.clock.now()).interference).toBeNull();
    expect(s).toMatchObject({ mode: 'bot', gameType: 'normal', botLevel: 3, playerId: ME, seed: 7 });
    expect(r.track).toHaveBeenCalledWith('game_start', { mode: 'bot', type: 'normal', players: 2 });
    await s.flush();
    expect(await r.repo.getGame(s.id)).toMatchObject({
      mode: 'bot',
      playerId: ME,
      status: 'playing',
      opponents: [{ id: 'bot-3', name: 'Mr. Hoot', isBot: true }],
    });
    // The puzzle comes from the same local history as a solo practice (spec §20).
    expect(await r.repo.playHistory('normal')).toEqual([{ puzzleId: s.puzzleId, playedAt: created.t }]);
    s.close();
  });

  it('a solo practice has no bot', async () => {
    const r = await rig();
    const s = await startPractice({ gameType: 'fast' }, r.deps);
    expect(s.botLevel).toBeNull();
    r.scheduler.advance(60_000);
    expect(s.events.filter((e) => 'playerId' in e && e.playerId !== ME)).toEqual([]);
    s.close();
  });

  it('the bot plays on its own, on the session’s clock: it locks and fills cells as time goes by', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 1 }, r.deps);
    expect(solvedBy(s.events, 'bot-1')).toEqual([]);
    r.scheduler.advance(120_000);
    const locks = s.events.filter((e) => e.type === 'cellLocked' && e.playerId === 'bot-1');
    expect(locks.length).toBeGreaterThan(3);
    expect(solvedBy(s.events, 'bot-1').length + s.getView().players[1]!.mistakes).toBeGreaterThan(2);
    // Pip: an ordinary move takes 15–25 s, the easiest (a last gap) × 0.8; most of it hesitating before the lock.
    const easiest = Math.min(...Object.values(BOT_CONFIG.difficulty.technique));
    const quickest = BOT_LEVELS[0]!.thinkMs.min * BOT_PACE.fast * easiest;
    expect(locks[0]!.t - s.events[0]!.t).toBeGreaterThanOrEqual(quickest * (1 - BOT_CONFIG.solveShare.max));
    s.close();
  });

  it('a whole game against Overlord, the test playing me: saved with the outcome, and the log replays to the same result', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 5 }, r.deps);
    playToTheEnd(r, s);

    const view = s.getView();
    expect(view.status).toBe('over');
    const result = view.result!;
    expect(result.reason).toBe('boardComplete');
    // Both of us filled cells.
    const mine = solvedBy(s.events, ME);
    const its = solvedBy(s.events, BOT5.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(its.length).toBeGreaterThan(0);
    const outcome = outcomeOf(result, ME)!;
    expect(outcome).toMatch(/^(win|loss|tie)$/);
    const me = result.ranking.find((x) => x.playerId === ME)!;
    expect(r.track).toHaveBeenLastCalledWith('game_end', {
      mode: 'bot',
      result: outcome,
      score: me.score,
      mistakes: me.mistakes,
      durationSec: Math.round(result.durationMs / 1000),
    });

    // The bot left the table with the game: nothing more is scheduled, and time changes nothing.
    expect(r.scheduler.pending).toBe(0);
    const count = s.events.length;
    r.scheduler.advance(60_000);
    expect(s.events).toHaveLength(count);

    await s.flush();
    expect(r.errors).toEqual([]);
    const saved = await r.repo.loadEvents(s.id);
    expect(saved).toEqual(plain(s.events));
    const final = replay(saved).at(-1)!;
    expect(final).toEqual(local(s).state);
    expect(final.result).toEqual(result);
    expect(toView(final, ME, r.clock.now())).toEqual(view);
    expect(await r.repo.getGame(s.id)).toMatchObject({
      status: 'finished',
      mode: 'bot',
      playerId: ME,
      score: me.score,
      mistakes: me.mistakes,
      correct: mine.length,
      place: me.place,
      outcome,
      opponents: [{ id: BOT5.id, name: 'Overlord', isBot: true }],
      result,
    });
    s.close();
  });

  it('left alone, the bot fills the board: a loss, saved and tracked', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 5 }, r.deps);
    while (s.getView().status !== 'over' && r.clock.now() < 1_700_000_000_000 + 3_600_000)
      r.scheduler.advance(5_000);
    const result = s.getView().result!;
    expect(result.reason).toBe('boardComplete');
    expect(outcomeOf(result, ME)).toBe('loss');
    expect(r.track).toHaveBeenLastCalledWith(
      'game_end',
      expect.objectContaining({ mode: 'bot', result: 'loss' }),
    );
    await s.flush();
    expect(await r.repo.getGame(s.id)).toMatchObject({
      status: 'finished',
      place: 2,
      outcome: 'loss',
      score: 0,
    });
    s.close();
  });

  it('the same seed and the same moves make the same game: the bot’s dice come from the game’s seed', async () => {
    const logs: GameEvent[][] = [];
    for (let k = 0; k < 2; k++) {
      const r = await rig(11);
      const s = await startBotPractice({ gameType: 'fast', level: 3 }, r.deps);
      for (let i = 0; i < 12; i++) {
        r.scheduler.advance(2_000);
        playMyMove(s, puzzleOf(s));
      }
      logs.push(plain(s.events));
      s.close();
    }
    expect(logs[0]).toEqual(logs[1]);
    expect(solvedBy(logs[0]!, 'bot-3').length).toBeGreaterThan(0);

    // Not the puzzle's stream: the seed, xor-ed with a constant.
    expect(botSeedOf(11)).toBe((11 ^ BOT_SEED_SALT) >>> 0);
    expect(botSeedOf(11)).not.toBe(11);
    expect(createRng(botSeedOf(11)).next()).not.toBe(createRng(11).next());
  });

  it('closing mid-game: the bot stops for good, and the game is saved as interrupted, with its bot', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 5 }, r.deps);
    for (let i = 0; i < 8; i++) {
      r.scheduler.advance(2_000);
      playMyMove(s, puzzleOf(s));
    }
    expect(solvedBy(s.events, BOT5.id).length).toBeGreaterThan(0);
    const count = s.events.length;
    s.close();
    expect(r.scheduler.pending).toBe(0);
    r.scheduler.advance(120_000);
    expect(s.events).toHaveLength(count);
    s.close(); // twice: nothing more

    await s.flush();
    expect(r.errors).toEqual([]);
    const row = await r.repo.getGame(s.id);
    const state = replay(await r.repo.loadEvents(s.id)).at(-1)!;
    expect(row).toMatchObject({
      status: 'interrupted',
      place: null,
      outcome: null,
      result: null,
      opponents: [{ id: BOT5.id }],
      score: state.players[0]!.score,
    });
    expect(state.status).toBe('running');
  });

  it('"סיום אימון" against a bot is a surrender (spec §6.6): the bot wins, saved as my loss', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 2 }, r.deps);
    r.scheduler.advance(30_000);
    s.endPractice();
    const view = s.getView();
    expect(view.status).toBe('over');
    expect(outcomeOf(view.result!, ME)).toBe('loss');
    expect(r.scheduler.pending).toBe(0);
    expect(r.track).toHaveBeenLastCalledWith('game_end', expect.objectContaining({ result: 'loss' }));
    await s.flush();
    expect(await r.repo.getGame(s.id)).toMatchObject({ status: 'finished', outcome: 'loss', place: 2 });
    s.endPractice(); // over already: nothing
    s.close();
  });

  it('plays without a database too', async () => {
    const r = await rig();
    const s = await startBotPractice({ gameType: 'fast', level: 5 }, { ...r.deps, repo: null });
    playToTheEnd(r, s);
    expect(s.getView().status).toBe('over');
    await s.flush();
    expect(r.errors).toEqual([]);
    s.close();
  });
});
