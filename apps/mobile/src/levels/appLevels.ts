import { levelOutcome } from '@sudoku-fight/engine';

import { currentOwner, levelsSync } from '../progress/appProgress';
import { track } from '../services/analytics';
import { chapterGateProps, levelEndProps } from './analyticsProps';
import { type LevelFinish, type LevelsRepo, mistakesOf, type RecordedAttempt } from './levelsRepo';
import { openLevelsStorage } from './levelsStorage';
import { refreshLevels } from './levelsStore';
import { levelXpEstimate } from './levelXp';

/**
 * A level's end, wired to the phone (1.0.2; dev-plan §2ו): the attempt goes into levels.db, the sync is
 * flushed (the server pays the XP from the bests), and the end is reported (`level_end`, and `chapter_gate`
 * at a closed gate). A level is never a practice: nothing here touches practice.db, the practice session, its
 * XP queue or game_start / game_end [D58].
 *
 * `chapter_gate` (plan §5.5): after every end of a level of chapter k once its boss L(10k) was played (this
 * end included), while the gate to chapter k + 1 was still closed; `open` says whether this end opened it
 * (then the gate is kept as opened, and its "פרק חדש נפתח" waits to be shown). So the admin site can count who
 * is stuck after three tries.
 */

/** A level's end as the level session gives it: for the signed-in player. */
export type FinishedAttempt = Omit<LevelFinish, 'owner'>;

export interface LevelFinished extends RecordedAttempt {
  /** The XP the result shows: the phone's estimate (the server pays its own count). */
  xpEstimate: number;
}

export interface LevelFinisherDeps {
  /** Who is signed in now (the Firebase uid); null when nobody is. */
  owner: () => string | null;
  repo: () => Promise<LevelsRepo>;
  /** The levels' sync, flushed after the attempt is stored. */
  sync: () => { flush(): Promise<unknown> };
  track: typeof track;
  now: () => number;
  /** levels.db changed: the screens' numbers again. */
  refresh?: (owner: string) => void;
  log?: (message: string, detail?: unknown) => void;
}

export type LevelFinisher = (finish: FinishedAttempt) => Promise<LevelFinished | null>;

/**
 * The end of each attempt, stored once (the session calls it once). Null when it could not be stored (nobody
 * signed in, levels.db unavailable): the result then shows the end alone; level_end is still reported.
 * Never throws.
 */
export function createLevelFinisher(deps: LevelFinisherDeps): LevelFinisher {
  return async (finish) => {
    const owner = deps.owner();
    let repo: LevelsRepo | null = null;
    let recorded: RecordedAttempt | null = null;
    try {
      if (owner) {
        repo = await deps.repo();
        recorded = await repo.recordAttempt({ ...finish, owner });
      }
    } catch (error) {
      deps.log?.('could not save the level attempt', error);
    }
    if (owner && recorded) void deps.sync().flush();

    const { level } = finish;
    try {
      const outcome = recorded?.outcome ?? levelOutcome(level, finish.end);
      deps.track(
        'level_end',
        levelEndProps(level, outcome, {
          prevBest: recorded?.prevBest ?? 0,
          mistakes: recorded?.mistakes ?? mistakesOf(finish),
          attempt: recorded?.attempt ?? finish.attempt ?? 1,
        }),
      );
    } catch (error) {
      deps.log?.('could not report the level end', error);
    }
    if (!owner || !repo || !recorded) return null;

    const { gate } = recorded;
    if (gate && gate.bossPlayed && !recorded.gateWasOpen) {
      deps.track('chapter_gate', chapterGateProps(gate.chapter + 1, gate.stars, gate.open));
      if (gate.open)
        await repo
          .openGate(owner, gate.chapter + 1, deps.now())
          .catch((error: unknown) => deps.log?.('could not keep the opened gate', error));
    }
    deps.refresh?.(owner);
    return { ...recorded, xpEstimate: levelXpEstimate(recorded) };
  };
}

const log = (message: string, detail?: unknown) => {
  if (__DEV__) console.log(`[levels] ${message}`, ...(detail === undefined ? [] : [detail]));
};

/** The app's: a level's end (levels/levelSession.ts, once per attempt). */
export const levelFinished: LevelFinisher = createLevelFinisher({
  owner: currentOwner,
  repo: openLevelsStorage,
  sync: levelsSync,
  track,
  now: () => Date.now(),
  refresh: (owner) => void refreshLevels({ owner }),
  log,
});

/**
 * The number of the signed-in player's next attempt at a level at its rev now (level_start's `attempt`, and the
 * board of "שוב", D63; a rebuilt level starts again at 1, D73): 1 when nobody is signed in or levels.db is
 * unavailable.
 */
export async function levelAttemptOf(levelId: string, rev: number): Promise<number> {
  const owner = currentOwner();
  if (!owner) return 1;
  try {
    return await (await openLevelsStorage()).attemptOf(owner, levelId, rev);
  } catch (error) {
    log('could not read the attempts', error);
    return 1;
  }
}
