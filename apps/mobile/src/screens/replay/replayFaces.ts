import type { GameView, PlayerId } from '@sudoku-fight/engine';
import { useEffect, useMemo, useState } from 'react';

import {
  AVATAR_REACTIONS,
  type AvatarFace,
  type AvatarReactionsConfig,
  cuesOf,
  moodOf,
  reactionOf,
  strongestCues,
} from '../../avatars/reactions';
import type { Replay } from './replayModel';

export type ReplayFaces = Readonly<Partial<Record<PlayerId, AvatarFace>>>;

/**
 * The players' faces at a step of the replay (spec §13, §3.4; the table: avatars/reactions.ts): each one's mood
 * in the step's picture (`view`: under an interference, out, the end), and, with `play`, the reaction to what
 * they did in the step (the strongest, when a step holds more than one: a last move and the end). Only the step
 * on screen reacts, so a jump never plays the steps it skipped; a step's streak counts the moves before it.
 * Pure. Nobody falls asleep in a replay.
 */
export function replayFaces(
  replay: Pick<Replay, 'steps' | 'events'>,
  index: number,
  view: Pick<GameView, 'players' | 'status' | 'result'>,
  play: boolean,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): ReplayFaces {
  const step = replay.steps[index];
  let strongest: ReturnType<typeof strongestCues> = {};
  if (play && step) {
    const { runs } = cuesOf(replay.events.slice(0, step.from), {}, config);
    strongest = strongestCues(cuesOf(replay.events.slice(step.from, step.to + 1), runs, config).cues, config);
  }
  const faces: Partial<Record<PlayerId, AvatarFace>> = {};
  for (const p of view.players) {
    const s = strongest[p.id];
    faces[p.id] = {
      expression: moodOf(p, view, false, config),
      reaction: s ? reactionOf(s.def, `step${index}:${s.cue.seq}:${s.cue.cue}`) : null,
    };
  }
  return faces;
}

/**
 * replayFaces for the step on screen, whose reactions play once the replay stays on it for
 * `replaySettleMs`: "שלב הבא" plays each step, and a drag along the timeline plays only where it stops, never a
 * backlog of the steps it passed. Meanwhile the moods show.
 */
export function useReplayFaces(
  replay: Pick<Replay, 'steps' | 'events'>,
  index: number,
  view: Pick<GameView, 'players' | 'status' | 'result'>,
  config: AvatarReactionsConfig = AVATAR_REACTIONS,
): ReplayFaces {
  const [settled, setSettled] = useState<number | null>(null);
  const wait = config.replaySettleMs;
  useEffect(() => {
    const id = setTimeout(() => setSettled(index), wait);
    return () => clearTimeout(id);
  }, [index, wait]);
  const play = settled === index;
  return useMemo(() => replayFaces(replay, index, view, play, config), [replay, index, view, play, config]);
}
