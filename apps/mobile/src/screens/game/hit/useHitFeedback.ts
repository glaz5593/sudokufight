import type { Clock } from '@sudoku-fight/engine';
import { useEffect, useEffectEvent, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { elapsedOf } from '../../../components/interference/hitClock';
import { cue, type FeedbackCue } from '../../../services/feedback';
import { hitCue } from '../model';
import { type HitInfo, hitKeyOf, rumbleOf } from './hitModel';

/** Where the hit layer's spoken lines go: a function (e.g. the screen's live region), or nowhere. */
export type HitAnnounce = ((line: string) => void) | false | undefined;

export interface HitFeedbackOptions {
  /** The hit while it is on; null otherwise. */
  hit: HitInfo | null;
  clock: Clock;
  reduce: boolean;
  /** Play the start cue and the rumble (motion.md §7). */
  feedback: boolean;
  /** Undefined: the screen reader's own announcement (AccessibilityInfo). */
  announce: HitAnnounce;
  /** Said when the hit starts: what happened and how long it lasts. */
  startLine: string;
  /** Said when it ends. */
  endLine: string;
}

/** A rumble knock this late is dropped: its moment has passed (the phone was busy or the app away). */
const KNOCK_LATE_MS = 250;

function say(announce: HitAnnounce, line: string) {
  if (announce === false || !line) return;
  if (announce) announce(line);
  else AccessibilityInfo.announceForAccessibility(line);
}

/**
 * What a hit sounds and feels like, and what a screen reader hears (motion.md §5 "Interference on me", §7):
 *
 * - At its start, once: the kind's cue (`hitFireworks` / `hitCats` / `hitWarp`: its sound and a Warning
 *   haptic), and "NinaVolt שלח/ה לך זיקוקים! נותרו 5 שניות, הטיימר שלך עצור".
 * - While it lasts: the kind's rumble (fireworks: a knock per burst; cats: one per cat; warp: one per wave).
 *   Not with reduced motion ("only the start Warning"), also when it is turned on mid-hit; not while the
 *   game is frozen; and a knock that comes late (the app was in the background) or after the end is
 *   dropped, so coming back never plays a burst of them at once.
 * - When it ends (its deadline passed, or the view dropped it): "ההפרעה נגמרה, הטיימר שלך ממשיך". A hit that
 *   follows another with no frame between them ends the first one before it starts.
 *
 * Leaving the screen in the middle stops the rumble and says nothing.
 */
export function useHitFeedback({
  hit,
  clock,
  reduce,
  feedback,
  announce,
  startLine,
  endLine,
}: HitFeedbackOptions) {
  const key = hit ? hitKeyOf(hit) : null;
  const last = useRef<string | null>(null);

  /** One knock of the rumble, due `at` ms into the hit: played only if it still belongs there now. */
  const onKnock = useEffectEvent((at: number, knock: FeedbackCue) => {
    if (!hit || reduce || hit.endsAt === null) return;
    const elapsed = elapsedOf(hit, clock.now());
    if (elapsed >= hit.totalMs || elapsed - at > KNOCK_LATE_MS) return;
    cue(knock);
  });

  /** Cue, announcement and rumble of a hit that starts; returns what stops its rumble. */
  const onStart = useEffectEvent((): (() => void) => {
    if (!hit) return () => {};
    if (feedback) cue(hitCue(hit.kind));
    say(announce, startLine);
    if (!feedback || reduce) return () => {};
    const { times, cue: knock } = rumbleOf(hit.kind, hit.totalMs);
    const from = elapsedOf(hit, clock.now());
    const timers = times
      .filter((at) => at > from)
      .map((at) => setTimeout(() => onKnock(at, knock), at - from));
    return () => timers.forEach(clearTimeout);
  });

  const onEnd = useEffectEvent(() => say(announce, endLine));

  // A hit ended (not the screen going away): say so. Before the next one starts, when one follows another.
  useEffect(() => {
    const previous = last.current;
    last.current = key;
    if (previous !== null && previous !== key) onEnd();
  }, [key]);

  // A hit starts: its cue and rumble. The rumble stops when it ends, or when the screen goes.
  useEffect(() => {
    if (key === null) return;
    return onStart();
  }, [key]);
}
