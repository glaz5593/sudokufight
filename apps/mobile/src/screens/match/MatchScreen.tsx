import type { Clock } from '@sudoku-fight/engine';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import { systemClock } from '../../game/clock';
import { useNow } from '../../game/useNow';
import type { MatchEntry, MatchmakingClient, MatchPhase } from '../../net/matchmaking';
import { cue } from '../../services/feedback';
import { color } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { CountdownView } from './CountdownView';
import { FoundView } from './FoundView';
import { MatchErrorView } from './MatchErrorView';
import { headerOf, matchScreenModel, seatsOf } from './matchModel';
import { SearchView } from './SearchView';
import { TimeoutView } from './TimeoutView';

export interface MatchScreenProps {
  /** The search (the game store's `match`). */
  match: MatchmakingClient<MatchEntry>;
  /** Me, as my avatar shows while searching. */
  self: { name: string | null; avatarId: AvatarId };
  /** The board is here: open the game (it replaces this screen). */
  onPlay: () => void;
  /** The search was called off ("ביטול חיפוש", Android back): back where it was started. */
  onLeave: () => void;
  /** Timeout → "שחק מול בוט בינתיים". */
  onBot: () => void;
  /** A failure → "עבור לאימון". */
  onPractice: () => void;
  /** "חזרה לבית". */
  onHome: () => void;
  /** The phone's clock (tests). */
  clock?: Clock;
}

/** Phases with something counting on screen: the search time, the countdown. */
const TICKING: readonly MatchPhase[] = ['connecting', 'searching', 'countdown', 'started'];
/** Phases from which the player can still leave (no cancelling after "found" [D32]). */
const LEAVABLE: readonly MatchPhase[] = ['connecting', 'searching', 'timeout', 'failed', 'cancelled'];

/**
 * The matchmaking flow (work plan stage 9, spec §10, §4.2: Search → Found → 3-2-1 → Game, Search → 60 s →
 * Timeout): one screen whose views follow the search (net/matchmaking.ts through matchModel), each fading
 * in as the one before it goes (motion.md `flow.fade`). The views hold no logic: cancelling, "keep
 * searching", retrying and leaving are the client's. Sounds and haptics as motion.md §7–§8: a chime when
 * found, a beat on 3 · 2 · 1, and GO. Android's back button cancels a search, and does nothing from "found"
 * on (leaving then would be abandonment [D32]). Leaving the screen while still searching cancels it.
 */
export function MatchScreen({
  match,
  self,
  onPlay,
  onLeave,
  onBot,
  onPractice,
  onHome,
  clock = systemClock,
}: MatchScreenProps) {
  const subscribe = useCallback((listener: () => void) => match.subscribe(listener), [match]);
  const info = useSyncExternalStore(subscribe, () => match.info);
  const reduce = useReduceMotion();
  const counting = info.phase === 'countdown' || info.phase === 'started';
  const now = useNow(counting ? 100 : 250, { enabled: TICKING.includes(info.phase), clock });
  const model = matchScreenModel(info, self, now);

  /** Left (or about to): the screen's own end is not reported twice. */
  const left = useRef(false);
  const leave = useCallback((then: () => void) => {
    if (left.current) return;
    left.current = true;
    then();
  }, []);

  useEffect(() => {
    if (model.kind === 'play') leave(onPlay);
    else if (model.kind === 'cancelled') leave(onLeave);
  }, [model.kind, leave, onPlay, onLeave]);

  // motion.md §7–§8: found, then 3 · 2 · 1 and GO.
  const beat = model.kind === 'countdown' ? `countdown-${model.step}` : model.kind;
  const lastBeat = useRef<string | null>(null);
  useEffect(() => {
    if (beat === lastBeat.current) return;
    lastBeat.current = beat;
    if (beat === 'found') cue('matchFound');
    else if (beat === 'countdown-go') cue('go');
    else if (beat.startsWith('countdown-')) cue('countdownBeat');
  }, [beat]);

  const cancel = useCallback(() => {
    match.cancel();
    leave(onLeave);
  }, [match, leave, onLeave]);

  // Android back: cancels a search; from "found" on there is no way out but abandonment [D32].
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (LEAVABLE.includes(match.info.phase)) cancel();
      return true;
    });
    return () => sub.remove();
  }, [match, cancel]);

  // Leaving the screen while searching (any way) leaves the queue. A beat later, so a remount at once (React's
  // strict mode in development) is not taken for leaving.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) match.cancel();
      }, 0);
    };
  }, [match]);

  switch (model.kind) {
    case 'search':
      return <SearchView key="search" model={model} reduce={reduce} onCancel={cancel} />;
    case 'timeout':
      return (
        <TimeoutView
          key="timeout"
          model={model}
          reduce={reduce}
          onKeepSearching={() => match.keepSearching()}
          onBot={() => {
            match.cancel();
            leave(onBot);
          }}
          onHome={() => {
            match.cancel();
            leave(onHome);
          }}
        />
      );
    case 'found':
      return <FoundView key="found" model={model} reduce={reduce} />;
    case 'countdown':
      return <CountdownView key="countdown" model={model} reduce={reduce} />;
    case 'failed':
      return (
        <MatchErrorView
          key="failed"
          model={model}
          reduce={reduce}
          onRetry={() => void match.retry()}
          onPractice={() => leave(onPractice)}
          onHome={() => leave(onHome)}
        />
      );
    case 'play': {
      // GO! stays on screen while the game screen takes over.
      const seats = seatsOf(info).map((s) => ({ ...s, ready: true }));
      return (
        <CountdownView
          key="countdown"
          model={{ kind: 'countdown', header: headerOf(info.queueKey), seats, step: 'go', remainingMs: 0 }}
          reduce={reduce}
        />
      );
    }
    case 'cancelled':
      return <View style={styles.blank} />;
  }
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: color.bg },
});
