import type { InterferenceKind, PlayerId } from '@sudoku-fight/engine';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { InterferenceModel } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { cue } from '../../../services/feedback';
import type { Rect } from '../geometry';
import { isolate } from './wording';

/** Anything that can say where it is in the window: a React Native View. */
export interface Measurable {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

/** The picker's props of a player card (PlayerCard's own props, components.md §3.4). */
export interface ArsenalCardProps {
  /** This card is the target: the picker was opened from its "הפרעה" button [D45]. */
  targeted: boolean;
  /** Another card is the target: this one dims to 40 %. */
  dimmed: boolean;
  /** Its "הפרעה" button shows "expanded" (and its label becomes "סגירת חלון ההפרעות"). */
  interferenceExpanded: boolean;
}

export interface UseArsenalOptions {
  /**
   * A kind was tapped in the picker: launch it at the card the picker was opened from (original §17), once per
   * opening. The screen calls `host.interfere(targetId, kind)`.
   */
  onLaunch: (targetId: PlayerId, kind: InterferenceKind) => void;
}

/**
 * The interference picker's state, for the screen and for <ArsenalOverlay> [D45: two taps, no drag]: which
 * opponent's "הפרעה" button opened it (the one target). The screen spreads `cardProps(id)` on every card,
 * attaches `cardRef(id)` to the view around each opponent's card (so the scrim's hole can be measured), opens
 * it from the button (`toggle`), and renders <ArsenalOverlay arsenal={…} />. The second tap, on a kind in the
 * picker, is `launch(kind)`. This keeps the state and plays the cues of motion.md §7–§8.
 */
export interface ArsenalController {
  /** The opponent whose button opened the picker; null while it is closed. */
  targetId: PlayerId | null;
  /** "הפרעה" on `targetId`'s card: opens the picker aimed at that card (cue `arsenalOpen`). */
  open: (targetId: PlayerId) => void;
  close: () => void;
  /** "הפרעה" again on the card it is open from closes it (the button reads "סגירת חלון ההפרעות" then). */
  toggle: (targetId: PlayerId) => void;
  /**
   * "הפרעה" while it can't be used (components.md §8.1): a short toast with the reason and a light haptic.
   * Short of points: "אין מספיק נקודות להפרעה הבאה (8 נק׳)"; the target busy: "NinaVolt כבר תחת הפרעה. אפשר שוב
   * בעוד 2 שניות"; the game not running: "אי אפשר להפריע כרגע". `name` is the target's display name.
   */
  blocked: (state: InterferenceModel, name: string) => void;
  /**
   * The second tap: launches `kind` at the card the picker was opened from and closes it (cue `launch`). Once
   * per opening: the target is cleared at once, so a quick double tap sends one. False when it was closed.
   */
  launch: (kind: InterferenceKind) => boolean;
  /** A ref for the view around a player's card (needs `collapsable={false}` on Android). */
  cardRef: (playerId: PlayerId) => (node: Measurable | null) => void;
  /** The picker's props of a player's card. */
  cardProps: (playerId: PlayerId) => ArsenalCardProps;
  /** Where a player's card is in the window (nothing happens if it is not mounted). */
  measureCard: (playerId: PlayerId, done: (rect: Rect) => void) => void;
}

export function useArsenal({ onLaunch }: UseArsenalOptions): ArsenalController {
  const { t } = useTranslation('game');
  const [targetId, setTargetId] = useState<PlayerId | null>(null);
  // The latest target and callback, for the handlers (they run outside render). The target is also cleared
  // here at once on a launch, before React renders again.
  const latest = useRef(targetId);
  const launchRef = useRef(onLaunch);
  useLayoutEffect(() => {
    latest.current = targetId;
    launchRef.current = onLaunch;
  });

  const nodes = useRef(new Map<PlayerId, Measurable>());
  const refs = useRef(new Map<PlayerId, (node: Measurable | null) => void>());

  const open = useCallback((id: PlayerId) => {
    cue('arsenalOpen');
    latest.current = id;
    setTargetId(id);
  }, []);
  const close = useCallback(() => {
    latest.current = null;
    setTargetId(null);
  }, []);
  const toggle = useCallback((id: PlayerId) => (latest.current === id ? close() : open(id)), [open, close]);
  const blocked = useCallback(
    (s: InterferenceModel, name: string) => {
      const toast = useToast.getState();
      switch (s.kind) {
        case 'points':
          cue('nudge');
          toast.show({ variant: 'error', message: t('arsenal.notEnough', { cost: s.cost }) });
          return;
        case 'busy':
          cue('nudge');
          toast.show({
            variant: 'warning',
            message: t('arsenal.busyToast', { count: s.secondsLeft, name: isolate(name) }),
          });
          return;
        case 'notRunning':
          cue('nudge');
          toast.show({ variant: 'info', message: t('arsenal.notNow') });
          return;
        default:
          // Disconnected or out: the button is hidden, nothing to say.
          return;
      }
    },
    [t],
  );
  const launch = useCallback((kind: InterferenceKind) => {
    const id = latest.current;
    if (id === null) return false;
    // Closed right away, so a second tap before the screen updates can't launch again.
    latest.current = null;
    setTargetId(null);
    cue('launch');
    launchRef.current(id, kind);
    return true;
  }, []);

  const cardRef = useCallback((playerId: PlayerId) => {
    let ref = refs.current.get(playerId);
    if (!ref) {
      ref = (node: Measurable | null) => {
        if (node) nodes.current.set(playerId, node);
        else nodes.current.delete(playerId);
      };
      refs.current.set(playerId, ref);
    }
    return ref;
  }, []);
  const measureCard = useCallback((playerId: PlayerId, done: (rect: Rect) => void) => {
    nodes.current.get(playerId)?.measureInWindow((x, y, width, height) => {
      // An unmounted or flattened view measures as nothing: keep the hole it had.
      if (width > 0 && height > 0) done({ x, y, width, height });
    });
  }, []);

  const cardProps = useCallback(
    (playerId: PlayerId): ArsenalCardProps => {
      const target = targetId === playerId;
      return { targeted: target, dimmed: targetId !== null && !target, interferenceExpanded: target };
    },
    [targetId],
  );

  return useMemo(
    () => ({ targetId, open, close, toggle, blocked, launch, cardRef, cardProps, measureCard }),
    [targetId, open, close, toggle, blocked, launch, cardRef, cardProps, measureCard],
  );
}
