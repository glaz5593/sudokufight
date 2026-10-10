import type { InterferenceKind, PlayerId } from '@sudoku-fight/engine';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { InterferenceModel } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { cue } from '../../../services/feedback';
import type { Rect } from '../geometry';
import { dropLabel } from './wording';

/** Anything that can say where it is in the window: a React Native View. */
export interface Measurable {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

/** The drop-target props of a player card (PlayerCard's own props, components.md §3.4). */
export interface ArsenalCardProps {
  /** This card is the drop zone: the arsenal was opened from its ⚡. */
  dropTarget: boolean;
  /** The finger is over it, mid-drag. */
  dropHover: boolean;
  /** Another card is the drop zone: this one dims to 40 %. */
  dimmed: boolean;
  /** The drop zone's accessible hint ("שחרר כאן: שיגור זיקוקים אל NinaVolt"). */
  dropLabel?: string;
  /** Its ⚡ shows "expanded" (and its label becomes "סגירת ארסנל ההפרעות"). */
  interferenceExpanded: boolean;
}

export interface UseArsenalOptions {
  /**
   * A token was dropped on the drop zone: launch it. Called once per drop, with the card the arsenal was
   * opened from (spec §7.3.4); the screen calls `host.interfere(targetId, kind)`.
   */
  onLaunch: (targetId: PlayerId, kind: InterferenceKind) => void;
}

/**
 * The arsenal's state, for the screen and for <ArsenalOverlay> (spec §7.3): which opponent's ⚡ opened it (the
 * one drop zone), which token is being dragged and whether the finger is over the zone. The screen spreads
 * `cardProps(id, name)` on every PlayerCard, attaches `cardRef(id)` to the view around each opponent's card
 * (so the zone can be measured), opens it from ⚡ (`toggle`), and renders <ArsenalOverlay arsenal={…} />.
 * The overlay drives the drag; this only keeps the state and plays the cues of motion.md §7–§8.
 */
export interface ArsenalController {
  /** The opponent whose ⚡ opened the arsenal; null while it is closed. */
  targetId: PlayerId | null;
  /** The token in the finger (from lift until the ghost has landed or returned). */
  dragKind: InterferenceKind | null;
  /** The finger is over the drop zone. */
  hover: boolean;
  /** ⚡ on `targetId`'s card: opens the arsenal aimed at that card (cue `arsenalOpen`). */
  open: (targetId: PlayerId) => void;
  close: () => void;
  /** ⚡ again on the card it is open from closes it (the button reads "סגירת ארסנל ההפרעות" then). */
  toggle: (targetId: PlayerId) => void;
  /**
   * ⚡ while it can't be used (components.md §8.1): short of points it says why ("אין מספיק נקודות להפרעה
   * הבאה (8 נק׳)") with a light haptic; the other states are silent.
   */
  blocked: (state: InterferenceModel) => void;
  /** A ref for the view around a player's card (needs `collapsable={false}` on Android). */
  cardRef: (playerId: PlayerId) => (node: Measurable | null) => void;
  /** The drop-target props of a player's card; `name` is the target's display name. */
  cardProps: (playerId: PlayerId, name: string) => ArsenalCardProps;

  // ---- for <ArsenalOverlay> ----
  /** Where a player's card is in the window (nothing happens if it is not mounted). */
  measureCard: (playerId: PlayerId, done: (rect: Rect) => void) => void;
  /** A token left its slot (cue: the whoosh and a light haptic). */
  lift: (kind: InterferenceKind) => void;
  /** The finger entered or left the drop zone (cue `dropZoneEnter` on each entry). */
  setHover: (inside: boolean) => void;
  /** The finger let go: inside the zone it launches (once) and the arsenal closes; elsewhere nothing. */
  release: (kind: InterferenceKind, launch: boolean) => void;
  /** The ghost has landed or gone back: the drag is over. */
  settle: () => void;
}

interface State {
  targetId: PlayerId | null;
  dragKind: InterferenceKind | null;
  hover: boolean;
}

const CLOSED: State = { targetId: null, dragKind: null, hover: false };

export function useArsenal({ onLaunch }: UseArsenalOptions): ArsenalController {
  const { t } = useTranslation('game');
  const [state, setState] = useState<State>(CLOSED);
  // The latest state and callback, for the handlers (they run outside render).
  const latest = useRef(state);
  const launchRef = useRef(onLaunch);
  useLayoutEffect(() => {
    latest.current = state;
    launchRef.current = onLaunch;
  });

  // Kept in step with each call (not with renders), so an entry buzzes once however the calls batch.
  const hovering = useRef(false);
  const nodes = useRef(new Map<PlayerId, Measurable>());
  const refs = useRef(new Map<PlayerId, (node: Measurable | null) => void>());

  const open = useCallback((targetId: PlayerId) => {
    cue('arsenalOpen');
    hovering.current = false;
    setState({ targetId, dragKind: null, hover: false });
  }, []);
  // Closing ends a drag too: the token's slot leaves with the tray, so its gesture may never end (only a
  // launch closes it with a token still landing, through `release`).
  const close = useCallback(() => {
    hovering.current = false;
    setState(CLOSED);
  }, []);
  const toggle = useCallback(
    (targetId: PlayerId) => (latest.current.targetId === targetId ? close() : open(targetId)),
    [open, close],
  );
  const blocked = useCallback(
    (s: InterferenceModel) => {
      if (s.kind !== 'points') return;
      cue('nudge');
      useToast.getState().show({ variant: 'error', message: t('arsenal.notEnough', { cost: s.cost }) });
    },
    [t],
  );

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
      // An unmounted or flattened view measures as nothing: keep the zone it had.
      if (width > 0 && height > 0) done({ x, y, width, height });
    });
  }, []);

  const lift = useCallback((kind: InterferenceKind) => {
    cue('tokenLift');
    setState((s) => ({ ...s, dragKind: kind, hover: false }));
  }, []);
  const setHover = useCallback((inside: boolean) => {
    if (inside && !hovering.current) cue('dropZoneEnter');
    hovering.current = inside;
    setState((s) => (s.hover === inside ? s : { ...s, hover: inside }));
  }, []);
  const release = useCallback((kind: InterferenceKind, launch: boolean) => {
    hovering.current = false;
    const targetId = latest.current.targetId;
    if (!launch || targetId === null) {
      setState((s) => ({ ...s, hover: false }));
      return;
    }
    cue('launch');
    // Closed right away, so a second drop can't reach the same zone; the ghost still lands (dragKind).
    latest.current = { ...latest.current, targetId: null, hover: false };
    setState((s) => ({ ...s, targetId: null, hover: false }));
    launchRef.current(targetId, kind);
  }, []);
  const settle = useCallback(() => setState((s) => ({ ...s, dragKind: null, hover: false })), []);

  const cardProps = useCallback(
    (playerId: PlayerId, name: string): ArsenalCardProps => {
      const target = state.targetId === playerId;
      return {
        dropTarget: target,
        dropHover: target && state.hover,
        dimmed: state.targetId !== null && !target,
        dropLabel: target ? dropLabel(state.dragKind, name, t) : undefined,
        interferenceExpanded: target,
      };
    },
    [state, t],
  );

  return useMemo(
    () => ({
      targetId: state.targetId,
      dragKind: state.dragKind,
      hover: state.hover,
      open,
      close,
      toggle,
      blocked,
      cardRef,
      cardProps,
      measureCard,
      lift,
      setHover,
      release,
      settle,
    }),
    [state, open, close, toggle, blocked, cardRef, cardProps, measureCard, lift, setHover, release, settle],
  );
}
