import type { BotLevelId, GameType, GameView, HostUpdate } from '@sudoku-fight/engine';
import { type MatchPlayer, type QueuePlayerCount, queueKey } from '@sudoku-fight/protocol';
import { create } from 'zustand';

import { MatchmakingClient, type MatchmakingClientDeps } from '../net/matchmaking';
import type { RemoteGameHost } from '../net/remoteGameHost';
import { practiceFinished } from '../progress/appProgress';
import { track } from '../services/analytics';
import { type OnlineProfiles, type OnlineRequest, OnlineSession, type OnlineTrack } from './onlineSession';
import type { PracticeRepo } from './practiceRepo';
import { type PracticeDeps, type PracticeSession, startBotPractice, startPractice } from './session';
import { practiceStorageOrNull } from './storage';

/** A ranked search (stage 9): a game type and a number of players, that is one queue (spec §10). */
export interface RankedRequest {
  gameType: GameType;
  players: QueuePlayerCount;
}

/** What a ranked search needs: net/matchmakingDevice.ts on the phone, fakes in tests. */
export interface RankedDeps extends Omit<MatchmakingClientDeps<OnlineSession>, 'enter'> {
  /** The match's room: a RemoteGameHost that has joined nothing yet. */
  makeHost: () => RemoteGameHost;
}

/** A ranked search whose match's room is an OnlineSession. */
export type RankedSearch = MatchmakingClient<OnlineSession>;

/**
 * The game in progress, for the screens (not persisted: a saved game lives in the practice database, a ranked
 * one on the server). The game screen reads `session` (a practice) or `online` (a game on the server, stage 7)
 * here, and goes home when there is neither; there is at most one of them at a time. `view` and `lastUpdate`
 * follow the host; for feedback that must not miss an update (two can land in one render), see useGameEffects.
 *
 * A ranked game (stage 9) starts as a search: `match`, the matchmaking client the match screens follow. At
 * "found" its match's room (an OnlineSession) becomes `online`, so the game is followed before its snapshot
 * comes at GO; if the match falls through, `online` goes back to null and the search goes on.
 */
export interface GameStoreState {
  session: PracticeSession | null;
  /** A game on the server (work plan stage 7): from its connecting and lobby to its results. */
  online: OnlineSession | null;
  /** A ranked search (stage 9): from searching to GO; its match's room is `online` from "found". */
  match: RankedSearch | null;
  /** The host's picture after the latest update (null before an online game has one). */
  view: GameView | null;
  lastUpdate: HostUpdate | null;
  /**
   * Closes any game in progress and starts a practice. Resolves with the new session, or null when another
   * start or a clear() came in meanwhile (the newer call wins).
   */
  startPractice(options: { gameType: GameType }): Promise<PracticeSession | null>;
  /** The same, for a practice against the bot of `level` (spec §9). */
  startBotPractice(options: { gameType: GameType; level: BotLevelId }): Promise<PracticeSession | null>;
  /**
   * Closes any game in progress and goes online: creates a private room or joins one by its code, with a host
   * from `makeHost` (the phone's: net/device.ts deviceHost; the store's deps by default). Returns at once; the
   * session's `online` says how the joining goes (connecting, the lobby, a refusal), and the game screen
   * shows it.
   */
  startOnline(request: OnlineRequest, makeHost?: () => RemoteGameHost): OnlineSession;
  /**
   * Closes any game in progress and searches for a ranked game (stage 9) in the queue of `request`, with the
   * deps from `makeDeps` (the phone's: net/matchmakingDevice.ts; the store's deps, or the last ones, by
   * default). Returns the search at once; its `info` says how it goes, and the match screens show it.
   */
  startRanked(request: RankedRequest, makeDeps?: () => RankedDeps): RankedSearch;
  /**
   * "נסה שוב" after a refusal or a lost connection: a new session for the same room (by its code, with the
   * same identity, when it had one), or the same request again. Null without an online session.
   */
  retryOnline(): OnlineSession | null;
  /** "End practice" (spec §6.6), or the surrender of an online game; the session stays for the result. */
  endPractice(): void;
  /**
   * Closes the session (a running practice is saved as interrupted, its bot stops; online: leaves the room;
   * a search: leaves the queue).
   */
  clear(): void;
}

export interface GameStoreDeps {
  /** The practice database, or null to play without saving. */
  repo(): Promise<PracticeRepo | null>;
  /** Clock, scheduler, pool … for tests. */
  session?: Omit<PracticeDeps, 'repo'>;
  /**
   * A new RemoteGameHost for an online game, when startOnline is not given one (tests). The phone's comes from
   * the caller (net/device.ts deviceHost), so the store does not load the SDK for practice.
   */
  onlineHost?: () => RemoteGameHost;
  /** Analytics of online games (game_start, game_end); the app's by default. */
  onlineTrack?: OnlineTrack;
  /** A ranked search's deps, when startRanked is not given them (tests). */
  ranked?: () => RankedDeps;
}

/**
 * The phone's: the practice database, and each finished practice's XP queued for the server [D41]
 * (progress/appProgress.ts; nothing is queued while nobody is signed in).
 */
export const defaultGameStoreDeps: GameStoreDeps = {
  repo: practiceStorageOrNull,
  session: { onFinish: practiceFinished },
};

export function createGameStore(deps: GameStoreDeps = defaultGameStoreDeps) {
  return create<GameStoreState>()((set, get) => {
    let unsubscribe: (() => void) | null = null;
    let unsubscribeMatch: (() => void) | null = null;
    /** Bumped by every start and clear: an older start that finishes late knows it lost. */
    let generation = 0;
    /** Where the last online game's host came from: a retry makes the next one the same way. */
    let lastMakeHost: (() => RemoteGameHost) | null = null;
    /** Where the last ranked search's deps came from: "search again" makes the next one the same way. */
    let lastMakeRanked: (() => RankedDeps) | null = null;

    const detach = () => {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribeMatch?.();
      unsubscribeMatch = null;
      const { session, online, match } = get();
      session?.close();
      match?.close();
      online?.close();
      set({ session: null, online: null, match: null, view: null, lastUpdate: null });
    };

    /** Closes the game in progress, opens a new one with `open`, and follows it, unless a newer call came. */
    const start = async (
      open: (deps: PracticeDeps) => Promise<PracticeSession>,
    ): Promise<PracticeSession | null> => {
      const mine = ++generation;
      detach();
      const repo = await deps.repo();
      if (mine !== generation) return null;
      const session = await open({ ...deps.session, repo });
      if (mine !== generation) {
        session.close();
        return null;
      }
      unsubscribe = session.subscribe((update) => set({ view: update.view, lastUpdate: update }));
      set({ session, view: session.getView(), lastUpdate: null });
      return session;
    };

    const goOnline = (
      request: OnlineRequest,
      makeHost?: () => RemoteGameHost,
      profiles: OnlineProfiles | null = null,
    ): OnlineSession => {
      const make = makeHost ?? deps.onlineHost ?? lastMakeHost;
      if (!make) throw new Error('startOnline needs a host: pass net/device deviceHost');
      lastMakeHost = make;
      generation++;
      detach();
      const host = make();
      const online = new OnlineSession({
        host,
        request,
        track: deps.onlineTrack ?? track,
        profiles,
        onError: (error) => {
          // A session let go of meanwhile (a retry, a practice) has nothing to report.
          if (__DEV__ && get().online === online)
            console.log(`[online] could not get into the room: ${error.supportCode}`);
        },
      });
      // The first picture comes with the snapshot, as an update; a closed host keeps its last one.
      unsubscribe = online.subscribe((update) => set({ view: update.view, lastUpdate: update }));
      set({ online, view: null, lastUpdate: null });
      return online;
    };

    /** Follows a search's match's room as `online`: in at "found", out if the match falls through. */
    const followMatch = (match: RankedSearch) => {
      if (get().match !== match) return;
      const entry = match.entry;
      if (entry === get().online) return;
      unsubscribe?.();
      unsubscribe = null;
      if (!entry) {
        set({ online: null, view: null, lastUpdate: null });
        return;
      }
      unsubscribe = entry.subscribe((update) => set({ view: update.view, lastUpdate: update }));
      set({ online: entry, view: entry.hasGame ? entry.getView() : null, lastUpdate: null });
    };

    const goRanked = (request: RankedRequest, makeDeps?: () => RankedDeps): RankedSearch => {
      const make = makeDeps ?? deps.ranked ?? lastMakeRanked;
      if (!make)
        throw new Error('startRanked needs its deps: pass net/matchmakingDevice deviceMatchmakingDeps');
      lastMakeRanked = make;
      generation++;
      detach();
      const { makeHost, ...rest } = make();
      // "נסה שוב" in the match's game (retryOnline) rejoins its room with a host made the same way.
      lastMakeHost = makeHost;
      const queue = queueKey(request.gameType, request.players);
      const onlineTrack = deps.onlineTrack ?? track;
      const match: RankedSearch = new MatchmakingClient<OnlineSession>(queue, {
        ...rest,
        enter: (found) =>
          new OnlineSession({
            host: makeHost(),
            request: {
              kind: 'match',
              queueKey: queue,
              matchId: found.matchId,
              reservation: found.reservation,
            },
            track: onlineTrack,
            profiles: profilesOf(found.players),
          }),
      });
      unsubscribeMatch = match.subscribe(() => followMatch(match));
      set({ match });
      void match.start();
      return match;
    };

    return {
      session: null,
      online: null,
      match: null,
      view: null,
      lastUpdate: null,

      startPractice: ({ gameType }) => start((d) => startPractice({ gameType }, d)),

      startBotPractice: ({ gameType, level }) => start((d) => startBotPractice({ gameType, level }, d)),

      startOnline: (request, makeHost) => goOnline(request, makeHost),

      startRanked: (request, makeDeps) => goRanked(request, makeDeps),

      retryOnline() {
        const online = get().online;
        if (!online) return null;
        const code = online.host.roomCode;
        // Back in by its code, with the players' avatars as the match had them.
        if (code) return goOnline({ kind: 'join', code }, undefined, online.profiles);
        // A match's reservation is good once: without the room's code there is nothing to go back to.
        return online.request.kind === 'match' ? null : goOnline(online.request);
      },

      endPractice() {
        const { session, online } = get();
        (online ?? session)?.endPractice();
      },

      clear() {
        generation++;
        detach();
      },
    };
  });
}

/** The matched players' avatars and countries (the VS's), for the game screen and the results. */
export const profilesOf = (players: readonly MatchPlayer[]): OnlineProfiles =>
  Object.fromEntries(players.map((p) => [p.id, { avatarId: p.avatarId, country: p.country }]));

export const useGameStore = createGameStore();
