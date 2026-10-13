import { BOT_LEVELS, BOT_PACE, GAME_TYPES, type GameType, THINK_TIME_MS } from '@sudoku-fight/engine';

import { openPracticeRepo } from '../../../game/practiceRepo';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import {
  AVAILABLE_MODES,
  botLevelOfGame,
  botOptions,
  DEFAULT_BOT_LEVEL,
  DEFAULT_RANKED_PLAYERS,
  gameTypeInfos,
  isAvailable,
  isOpenPlayerCount,
  isStartableMode,
  rankedRatingIn,
  lastPlayOf,
  MODE_OPTIONS,
  percentOf,
  playedAtText,
  recentOutcome,
  secondsText,
  thinkSeconds,
} from '../homeModel';
import {
  countGamesPlayed,
  createPracticeStats,
  INTERRUPTED_COUNTS_AS_LOSS,
  winStats,
} from '../practiceStats';
import { SEED_START, seedBotPractices, seedPractices } from '../testing/seed';

describe('the modes (spec §5.1)', () => {
  it('are exactly five: ranked 2 · 3 · 4, solo practice, practice against a bot', () => {
    expect(MODE_OPTIONS.map((o) => [o.key, o.group, o.mode, o.players])).toEqual([
      ['ranked2', 'ranked', 'ranked', 2],
      ['ranked3', 'ranked', 'ranked', 3],
      ['ranked4', 'ranked', 'ranked', 4],
      ['solo', 'practice', 'solo', 1],
      ['bot', 'practice', 'bot', 2],
    ]);
  });

  it('all five are open: the practices, ranked 2 players (stage 9), ranked 3 and 4 players (stage 10)', () => {
    expect(AVAILABLE_MODES).toEqual(['ranked2', 'ranked3', 'ranked4', 'solo', 'bot']);
    expect(MODE_OPTIONS.filter((o) => isAvailable(o.key)).map((o) => o.key)).toEqual([
      'ranked2',
      'ranked3',
      'ranked4',
      'solo',
      'bot',
    ]);
    expect([
      isStartableMode('solo'),
      isStartableMode('bot'),
      isStartableMode('ranked'),
      isStartableMode('x'),
    ]).toEqual([true, true, true, false]);
    expect([1, 2, 3, 4, 5].map(isOpenPlayerCount)).toEqual([false, true, true, true, false]);
    expect(DEFAULT_RANKED_PLAYERS).toBe(2);
  });

  it('a ranked card shows my rating in the key of its queue (RATING_OPTION B or A, spec §11.1)', () => {
    const entry = (key: string, rating: number) => ({
      key,
      rating,
      games: 1,
      provisional: true,
      peak: rating,
    });
    const b = [entry('fast', 1240), entry('normal', 1287), entry('hard', 1200)];
    expect(rankedRatingIn(b, 'normal')?.rating).toBe(1287);
    const a = [entry('normal-2p', 1310), entry('normal-3p', 1190)];
    expect(rankedRatingIn(a, 'normal')?.rating).toBe(1310);
    expect(rankedRatingIn(a, 'normal', 3)?.rating).toBe(1190);
    expect(rankedRatingIn(a, 'fast')).toBeNull();
    expect(rankedRatingIn(null, 'fast')).toBeNull();
  });
});

describe('the bots to choose from (spec §9)', () => {
  it('are the engine’s five levels, with their names and avatars', () => {
    expect(botOptions('normal').map((b) => [b.level, b.name, b.avatar])).toEqual([
      [1, 'Pip', 'hatchling'],
      [2, 'Biscuit', 'fox'],
      [3, 'Mr. Hoot', 'owl'],
      [4, 'Maestro', 'professor'],
      [5, 'Overlord', 'furry-monster'],
    ]);
    expect(botOptions('normal').map((b) => b.mistakeRate)).toEqual(BOT_LEVELS.map((l) => l.mistakeRate));
    expect(botOptions('fast').map((b) => percentOf(b.mistakeRate))).toEqual([15, 9, 5, 2, 1]);
    expect(DEFAULT_BOT_LEVEL).toBe(3);
  });

  it('think as long as the table says for "normal", × 0.67 in fast and × 1.5 in hard', () => {
    const range = (type: GameType) =>
      botOptions(type).map((b) => `${secondsText(b.thinkMs.min)}–${secondsText(b.thinkMs.max)}`);
    expect(range('normal')).toEqual(['8–11', '6–9', '4–7', '3–5', '2–4']);
    expect(range('fast')).toEqual(['5.4–7.4', '4–6', '2.7–4.7', '2–3.4', '1.3–2.7']);
    expect(range('hard')).toEqual(['12–16.5', '9–13.5', '6–10.5', '4.5–7.5', '3–6']);
    for (const type of GAME_TYPES)
      expect(botOptions(type).map((b) => b.thinkMs)).toEqual(
        BOT_LEVELS.map((l) => ({ min: l.thinkMs.min * BOT_PACE[type], max: l.thinkMs.max * BOT_PACE[type] })),
      );
  });

  it('seconds read with one decimal, none for whole ones', () => {
    expect([5360, 8000, 16500, 2680, 49, 0].map(secondsText)).toEqual(['5.4', '8', '16.5', '2.7', '0', '0']);
  });
});

describe('the game types (spec §5.2)', () => {
  it('take the lock time from the rules and carry the spec estimate', () => {
    const infos = gameTypeInfos('solo');
    expect(infos.map((i) => i.gameType)).toEqual([...GAME_TYPES]);
    expect(infos.map((i) => i.thinkTimeMs)).toEqual(GAME_TYPES.map((t) => THINK_TIME_MS[t]));
    expect(infos.map(thinkSeconds)).toEqual([8, 12, 18]);
    expect(infos.map((i) => i.durationMin)).toEqual([
      [4, 6],
      [6, 9],
      [9, 14],
    ]);
  });
});

describe('a saved practice in the recent list', () => {
  it('reads as completed, ended, interrupted or still playing', () => {
    expect(recentOutcome({ status: 'finished', endReason: 'boardComplete' })).toBe('completed');
    expect(recentOutcome({ status: 'finished', endReason: 'practiceEnded' })).toBe('ended');
    expect(recentOutcome({ status: 'interrupted', endReason: null })).toBe('interrupted');
    expect(recentOutcome({ status: 'playing', endReason: null })).toBe('playing');
  });

  it('against a bot: won, lost or tied once finished; interrupted or playing as any game', () => {
    expect(recentOutcome({ status: 'finished', endReason: 'boardComplete', outcome: 'win' })).toBe('win');
    expect(recentOutcome({ status: 'finished', endReason: 'lastPlayerStanding', outcome: 'loss' })).toBe(
      'loss',
    );
    expect(recentOutcome({ status: 'finished', endReason: 'boardComplete', outcome: 'tie' })).toBe('tie');
    expect(recentOutcome({ status: 'interrupted', endReason: null, outcome: null })).toBe('interrupted');
    expect(recentOutcome({ status: 'finished', endReason: 'boardComplete', outcome: null })).toBe(
      'completed',
    );
  });

  it('knows the bot of a saved game by its id', () => {
    const bot = (id: string, isBot = true) => ({ opponents: [{ id, name: null, isBot }] });
    expect(botLevelOfGame(bot('bot-4'))).toBe(4);
    expect(botLevelOfGame(bot('bot-4', false))).toBeNull();
    expect(botLevelOfGame(bot('bot-9'))).toBeNull();
    expect(botLevelOfGame({ opponents: [] })).toBeNull();
    expect(botLevelOfGame({})).toBeNull();
  });

  it('"עוד סיבוב" repeats the remembered setting, else the newest game, and only what can start', () => {
    const recent = [{ mode: 'solo' as const, gameType: 'hard' as const }];
    expect(lastPlayOf({ mode: 'solo', gameType: 'fast' }, recent)).toEqual({
      mode: 'solo',
      gameType: 'fast',
    });
    expect(lastPlayOf(null, recent)).toEqual({ mode: 'solo', gameType: 'hard' });
    expect(lastPlayOf(null, [])).toBeNull();
  });

  it('"עוד סיבוב" after a ranked game searches the same queue, while its table is open (stages 9–10)', () => {
    const recent = [{ mode: 'solo' as const, gameType: 'hard' as const }];
    expect(lastPlayOf({ mode: 'ranked', gameType: 'fast', players: 2 }, recent)).toEqual({
      mode: 'ranked',
      gameType: 'fast',
      players: 2,
    });
    // A setting saved before the player count was kept: 2 players.
    expect(lastPlayOf({ mode: 'ranked', gameType: 'hard' }, recent)).toEqual({
      mode: 'ranked',
      gameType: 'hard',
      players: 2,
    });
    // 3 and 4 players too (stage 10); a table this build does not have is no "עוד סיבוב".
    expect(lastPlayOf({ mode: 'ranked', gameType: 'fast', players: 4 }, recent)).toEqual({
      mode: 'ranked',
      gameType: 'fast',
      players: 4,
    });
    expect(lastPlayOf({ mode: 'ranked', gameType: 'fast', players: 5 as unknown as 4 }, recent)).toBeNull();
  });

  it('"עוד סיבוב" against a bot comes with the level: the one played, the last chosen, or the default', () => {
    const botGame = {
      mode: 'bot' as const,
      gameType: 'normal' as const,
      opponents: [{ id: 'bot-2', name: 'Biscuit', isBot: true }],
    };
    expect(lastPlayOf({ mode: 'bot', gameType: 'fast', botLevel: 5 }, [botGame], 1)).toEqual({
      mode: 'bot',
      gameType: 'fast',
      botLevel: 5,
    });
    expect(lastPlayOf(null, [botGame], 1)).toEqual({ mode: 'bot', gameType: 'normal', botLevel: 2 });
    expect(lastPlayOf({ mode: 'bot', gameType: 'hard' }, [], 4)).toEqual({
      mode: 'bot',
      gameType: 'hard',
      botLevel: 4,
    });
    expect(lastPlayOf({ mode: 'bot', gameType: 'hard' }, [])).toEqual({
      mode: 'bot',
      gameType: 'hard',
      botLevel: DEFAULT_BOT_LEVEL,
    });
    // A solo setting never carries a level.
    expect(lastPlayOf({ mode: 'solo', gameType: 'hard', botLevel: 3 }, [])).toEqual({
      mode: 'solo',
      gameType: 'hard',
    });
  });

  it('shows when it was played in the app language', () => {
    const at = Date.UTC(2026, 9, 9, 11, 32);
    expect(playedAtText(at, 'en')).toBe(
      new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(at),
    );
    expect(playedAtText(at, 'he')).toMatch(/\d/);
  });
});

describe('the numbers of the home card', () => {
  it('count every saved practice, of every game type', async () => {
    const repo = await openPracticeRepo(await memoryDb());
    expect(await countGamesPlayed(repo)).toBe(0);
    await seedPractices(repo);
    expect(await countGamesPlayed(repo)).toBe(2);

    const useStats = createPracticeStats(async () => repo);
    expect(useStats.getState().gamesPlayed).toBeNull();
    await useStats.getState().refresh();
    expect(useStats.getState().gamesPlayed).toBe(2);
  });

  it('are unknown without a database, or when it fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const none = createPracticeStats(async () => null);
    await none.getState().refresh();
    expect(none.getState()).toMatchObject({ gamesPlayed: null, winRate: null, streak: null });

    const failing = createPracticeStats(() => Promise.reject(new Error('locked')));
    await failing.getState().refresh();
    expect(failing.getState()).toMatchObject({ gamesPlayed: null, winRate: null, streak: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('win rate and streak come from the bot games: solo practices have no winner', async () => {
    const repo = await openPracticeRepo(await memoryDb());
    const useStats = createPracticeStats(async () => repo);
    await seedPractices(repo);
    await useStats.getState().refresh();
    expect(useStats.getState()).toMatchObject({ gamesPlayed: 2, winRate: null, streak: null });

    const { won, lost, interrupted } = await seedBotPractices(repo, SEED_START + 3_600_000);
    expect((await repo.getGame(won))?.outcome).toBe('win');
    expect((await repo.getGame(lost))?.outcome).toBe('loss');
    expect((await repo.getGame(interrupted))?.status).toBe('interrupted');
    await useStats.getState().refresh();
    // Won, then lost (the newest decided game), then interrupted (it counts for nothing).
    expect(useStats.getState()).toMatchObject({ gamesPlayed: 5, winRate: 0.5, streak: 0 });
  });
});

describe('win rate and streak [D28: a win streak]', () => {
  type Row = Parameters<typeof winStats>[0][number];
  let t = 0;
  const finished = (outcome: 'win' | 'loss' | 'tie'): Row => ({
    status: 'finished',
    outcome,
    startedAt: ++t,
  });
  const interrupted = (): Row => ({ status: 'interrupted', outcome: null, startedAt: ++t });
  const playing = (): Row => ({ status: 'playing', outcome: null, startedAt: ++t });
  /** Rows given oldest first; the function takes them in any order. */
  const stats = (...rows: Row[]) => winStats([...rows].reverse());

  beforeEach(() => {
    t = 0;
  });

  it('nothing decided: no win rate, no streak', () => {
    expect(winStats([])).toEqual({ decided: 0, wins: 0, winRate: null, streak: null });
    expect(stats(interrupted(), playing())).toEqual({ decided: 0, wins: 0, winRate: null, streak: null });
  });

  it('the win rate is wins out of the decided games; a tie is decided, not a win', () => {
    expect(stats(finished('win'), finished('loss'), finished('tie'), finished('win'))).toMatchObject({
      decided: 4,
      wins: 2,
      winRate: 0.5,
    });
    expect(stats(finished('loss'))).toMatchObject({ winRate: 0, streak: 0 });
  });

  it('the streak counts wins back from the newest decided game; a loss or a tie ends it', () => {
    expect(stats(finished('loss'), finished('win'), finished('win'), finished('win')).streak).toBe(3);
    expect(stats(finished('win'), finished('win'), finished('tie')).streak).toBe(0);
    expect(stats(finished('win'), finished('loss'), finished('win')).streak).toBe(1);
    expect(stats(finished('win'), finished('win')).streak).toBe(2);
  });

  it('an interrupted or running game counts for nothing by default; as a loss when set so', () => {
    const rows = [finished('win'), finished('win'), interrupted(), playing()];
    expect(stats(...rows)).toEqual({ decided: 2, wins: 2, winRate: 1, streak: 2 });
    expect(INTERRUPTED_COUNTS_AS_LOSS).toBe(false);
    expect(winStats([...rows].reverse(), { interruptedIsLoss: true })).toEqual({
      decided: 3,
      wins: 2,
      winRate: 2 / 3,
      streak: 0,
    });
  });

  it('takes the games newest first by their start, whatever order they come in', () => {
    const rows = [finished('loss'), finished('win'), finished('win')];
    expect(winStats(rows).streak).toBe(2);
    expect(winStats([rows[2]!, rows[0]!, rows[1]!]).streak).toBe(2);
  });
});
