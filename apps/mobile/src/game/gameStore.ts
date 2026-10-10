import type { BotLevelId, GameType, GameView, HostUpdate } from '@sudoku-fight/engine';
import { create } from 'zustand';

import type { RemoteGameHost } from '../net/remoteGameHost';
import { track } from '../services/analytics';
import { type OnlineRequest, OnlineSession, type OnlineTrack } from './onlineSession';
import type { PracticeRepo } from './practiceRepo';
import { type PracticeDeps, type PracticeSession, startBotPractice, startPractice } from './session';
import { practiceStorageOrNull } from './storage';

/**
 * The game in progress, for the screens (not persisted: a saved game lives in the practice database, a ranked
 * one on the server). The game screen reads `session` (a practice) or `online` (a game on the server, stage 7)
 * here, and goes home when there is neither; there is at most one of them at a time. `view` and `lastUpdate`
 * follow the host; for feedback that must not miss an update (two can land in one render), see useGameEffects.
 */
export interface GameStoreState {
  session: PracticeSession | null;
  /** A game on the server (work plan stage 7): from its connecting and lobby to its results. */
  online: OnlineSession | null;
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
   * "נסה שוב" after a refusal or a lost connection: a new session for the same room (by its code, with the
   * same identity, when it had one), or the same request again. Null without an online session.
   */
  retryOnline(): OnlineSession | null;
  /** "End practice" (spec §6.6), or the surrender of an online game; the session stays for the result. */
  endPractice(): void;
  /** Closes the session (a running practice is saved as interrupted, its bot stops; online: leaves the room). */
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
}

export const defaultGameStoreDeps: GameStoreDeps = { repo: practiceStorageOrNull };

export function createGameStore(deps: GameStoreDeps = defaultGameStoreDeps) {
  return create<GameStoreState>()((set, get) => {
    let unsubscribe: (() => void) | null = null;
    /** Bumped by every start and clear: an older start that finishes late knows it lost. */
    let generation = 0;
    /** Where the last online game's host came from: a retry makes the next one the same way. */
    let lastMakeHost: (() => RemoteGameHost) | null = null;

    const detach = () => {
      unsubscribe?.();
      unsubscribe = null;
      const { session, online } = get();
      session?.close();
      online?.close();
      set({ session: null, online: null, view: null, lastUpdate: null });
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

    const goOnline = (request: OnlineRequest, makeHost?: () => RemoteGameHost): OnlineSession => {
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

    return {
      session: null,
      online: null,
      view: null,
      lastUpdate: null,

      startPractice: ({ gameType }) => start((d) => startPractice({ gameType }, d)),

      startBotPractice: ({ gameType, level }) => start((d) => startBotPractice({ gameType, level }, d)),

      startOnline: (request, makeHost) => goOnline(request, makeHost),

      retryOnline() {
        const online = get().online;
        if (!online) return null;
        const code = online.host.roomCode;
        return goOnline(code ? { kind: 'join', code } : online.request);
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

export const useGameStore = createGameStore();
