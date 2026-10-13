import type { GameView, PlayerId } from '@sudoku-fight/engine';
import { useEffect, useMemo, useState } from 'react';

import {
  AVATAR_REACTIONS,
  type AvatarFace,
  type AvatarReactionsConfig,
  type FaceTracker,
  faceTracker,
  liveFaceOf,
  trackAction,
  trackEvents,
} from '../avatars/reactions';
import type { PracticeSession } from './session';

/** What the faces need of a session: its updates, who "me" is, and its clock (the server's, online). */
export type FaceSource = Pick<PracticeSession, 'subscribe' | 'playerId' | 'clock'>;

export type AvatarFaces = Readonly<Partial<Record<PlayerId, AvatarFace>>>;

/**
 * Every player's face in a live game (spec §3.4; the table: avatars/reactions.ts): the session's events, as the
 * host hands them over (a practice's LocalGameHost, or an online game's RemoteGameHost: the same updates), turn
 * into reactions (a correct digit, a mistake, an interference, an emoji, the end), and the view and the time
 * into moods (under an interference, out, asleep). `now` is the screen's tick, in the session's clock: it wakes
 * the sleepy mood and repeats an interference's wobble. Nothing here moves: AvatarArt plays the faces, and with
 * reduced motion only the faces change.
 *
 * Each update is read once, straight from the host (two updates in one render never merge, as in
 * useGameEffects); a reaction that would be over by the time its event arrives is dropped, so nothing plays a
 * backlog. A new session starts afresh.
 */
export function useAvatarFaces(
  session: FaceSource,
  view: GameView,
  now: number,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): AvatarFaces {
  const [state, setState] = useState(() => ({ session, tracker: faceTracker(session.clock.now()) }));
  // Another session (a retry, a new game on the same screen): adjusted while rendering, before it shows.
  let tracker: FaceTracker = state.tracker;
  if (state.session !== session) {
    tracker = faceTracker(session.clock.now());
    setState({ session, tracker });
  }

  useEffect(
    () =>
      session.subscribe((update) => {
        const at = session.clock.now();
        const next = (t: FaceTracker) =>
          update.kind === 'events'
            ? // What came late and would be over already plays nothing.
              trackEvents(t, update.events, config, at)
            : // My action, refused: still an action of mine.
              trackAction(t, session.playerId, at);
        setState((s) => (s.session === session ? { session, tracker: next(s.tracker) } : s));
      }),
    [session, config],
  );

  return useMemo(() => {
    const faces: Partial<Record<PlayerId, AvatarFace>> = {};
    for (const p of view.players) faces[p.id] = liveFaceOf(tracker, p, view, now, config);
    return faces;
  }, [tracker, view, now, config]);
}
