import type { PlayerId } from '@sudoku-fight/engine';

import type { AvatarIdOrNone } from '../../avatars';
import type { PracticeRepo } from '../../game/practiceRepo';
import { HISTORY_OFFLINE_CODES, type HistoryApi, isHistoryApiError } from '../history/historyApi';
import { buildReplay, type Replay } from './replayModel';

/**
 * Where a replay comes from (spec §13.1): a practice from the phone's own log [D25], a ranked game from the
 * server (GET /v1/games/:id/replay: the full log, solution included, once the game is over, spec §21).
 * `source` says which when the caller knows (the history card, the results of a ranked game); without it the
 * phone is looked at first, then the server.
 */

export type ReplaySourceKind = 'practice' | 'ranked';

export interface ReplayMeta {
  source: ReplaySourceKind;
  /** Players' countries, when known (a ranked game's profiles). */
  countries: Readonly<Partial<Record<PlayerId, string | null>>>;
}

export type ReplayLoad =
  | { kind: 'found'; replay: Replay; meta: ReplayMeta }
  /** No such game here (or on the server, for this player). */
  | { kind: 'missing' }
  /** A ranked game whose end the server is still writing. */
  | { kind: 'notFinished' }
  /** The server can't be reached now. */
  | { kind: 'offline' }
  /** A ranked game needs a sign-in. */
  | { kind: 'signedOut' }
  /** Something could not be read (the practice database, a damaged log). */
  | { kind: 'unavailable' };

export interface ReplaySourceDeps {
  practice: () => Promise<PracticeRepo | null>;
  /** The server's history; null when nobody is signed in. */
  ranked: HistoryApi | null;
  /** My avatar (the profile's), for my own seat in a practice. */
  myAvatar: AvatarIdOrNone;
  myCountry?: string | null;
}

async function fromPhone(id: string, repo: PracticeRepo, deps: ReplaySourceDeps): Promise<ReplayLoad | null> {
  const game = await repo.getGame(id);
  if (!game) return null;
  const events = await repo.loadEvents(id);
  const replay = buildReplay(events, { me: game.playerId, avatars: { [game.playerId]: deps.myAvatar } });
  return {
    kind: 'found',
    replay,
    meta: { source: 'practice', countries: { [game.playerId]: deps.myCountry ?? null } },
  };
}

async function fromServer(id: string, api: HistoryApi | null): Promise<ReplayLoad> {
  if (!api) return { kind: 'signedOut' };
  try {
    const { game, events } = await api.replay(id);
    const me = game.players.find((p) => p.seat === game.mySeat)?.userId ?? null;
    const avatars: Partial<Record<PlayerId, AvatarIdOrNone>> = {};
    const names: Partial<Record<PlayerId, string | null>> = {};
    const countries: Partial<Record<PlayerId, string | null>> = {};
    for (const p of game.players) {
      if (p.userId === null) continue;
      if (p.avatarId !== null) avatars[p.userId] = p.avatarId;
      // A live account shows today's name. A deleted one has none: the server leaves it out of the log too,
      // so the replay says "שחקן".
      if (p.displayName !== null) names[p.userId] = p.displayName;
      countries[p.userId] = p.country;
    }
    return {
      kind: 'found',
      replay: buildReplay(events, { me, avatars, names }),
      meta: { source: 'ranked', countries },
    };
  } catch (error) {
    if (!isHistoryApiError(error)) return { kind: 'unavailable' };
    if (error.code === 'notFound') return { kind: 'missing' };
    if (error.code === 'notFinished') return { kind: 'notFinished' };
    if (error.code === 'signedOut' || error.code === 'unauthorized' || error.code === 'notRegistered')
      return { kind: 'signedOut' };
    if (HISTORY_OFFLINE_CODES.includes(error.code)) return { kind: 'offline' };
    return { kind: 'unavailable' };
  }
}

export async function loadReplay(
  id: string,
  source: ReplaySourceKind | null,
  deps: ReplaySourceDeps,
): Promise<ReplayLoad> {
  try {
    if (source !== 'ranked') {
      const repo = await deps.practice();
      const local = repo ? await fromPhone(id, repo, deps) : null;
      if (local) return local;
      if (source === 'practice') return { kind: repo ? 'missing' : 'unavailable' };
    }
    return await fromServer(id, deps.ranked);
  } catch (error) {
    console.warn('[replay] could not load the game', error);
    return { kind: 'unavailable' };
  }
}
