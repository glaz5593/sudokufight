import { useEffect, useMemo, useState } from 'react';

import { type AvatarFace, AVATAR_REACTIONS, type AvatarReactionsConfig, readyFaceOf } from './reactions';

/**
 * The avatars' faces outside a game (./reactions.ts has the table). AvatarArt never plays the reaction of its
 * first render, so a reaction meant for a screen's entrance must come a little after it: useAfter.
 */

/** False until `ms` after the first render (and after each change of `ms`), then true. */
export function useAfter(ms: number): boolean {
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setDone(ms), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return done === ms;
}

/**
 * A player before a game (the VS, the room's loading): calm until ready, then the `ready` mood (a smile); each
 * turn to ready while the avatar is on screen plays the `ready` reaction (a smile and a nod). Ready from the
 * start: the mood only.
 */
export function useReadyFace(ready: boolean, config: AvatarReactionsConfig = AVATAR_REACTIONS): AvatarFace {
  const [{ was, times }, setSeen] = useState({ was: ready, times: 0 });
  // Adjusted while rendering, the moment `ready` changes.
  if (ready !== was) setSeen({ was: ready, times: ready ? times + 1 : times });
  return useMemo(() => readyFaceOf(ready, times, config), [ready, times, config]);
}
