import type { GameView, PlayerId } from '@sudoku-fight/engine';
import { useCallback, useMemo, useState } from 'react';

import {
  pickerModel,
  type PickerModel,
  pickerReducer,
  pickerShown,
  type ReactionPlan,
  reactionPlan,
} from './model';
import { useMutedPlayers, useReactionMutes } from './muteStore';

/**
 * Everything the game screen needs to send and mute reactions (spec §8, D19), in one hook: my picker (open
 * from my card's reactions button, closed by a pick), the opponent card menu, and who is muted in this game.
 * Sending goes through `onReact` (host.react); the view decides when I may react again.
 *
 * Wiring (GameScreen / DuelHud): my PlayerCard gets `onReactions={togglePicker}`, `reactionsExpanded=
 * {pickerOpen}` and the card model's own `reactionReady` (no withActionsOff for it); the opponent's card goes
 * inside <CardMenuTrigger onOpen={() => openMenu(id)}>; <ReactionPicker> and <CardMenu> are drawn over the
 * screen with the cards' measured rects; each reaction event goes through `plan(e)`, and the floats through
 * <ReactionLayer muted={muted}>.
 */
export interface UseReactionsOptions {
  view: GameView;
  /** In the game clock (the view's time), as for the card models. */
  now: number;
  /** Sends a reaction: host.react(emoji). */
  onReact: (emoji: string) => void;
}

export interface Reactions {
  model: PickerModel;
  pickerOpen: boolean;
  togglePicker(): void;
  closePicker(): void;
  /** Sends `emoji` when it can go now, and closes the picker. */
  pick(emoji: string): void;
  /** Whose card menu is open. */
  menuFor: PlayerId | null;
  openMenu(playerId: PlayerId): void;
  closeMenu(): void;
  /** The players I muted in this game. */
  muted: readonly PlayerId[];
  isMuted(playerId: PlayerId): boolean;
  /** Returns whether the player is muted now. */
  toggleMute(playerId: PlayerId): boolean;
  /** What an arriving reaction does here: null for a muted sender (nothing shown, played or said). */
  plan(e: { playerId: PlayerId; emoji: string; byMe: boolean }): ReactionPlan | null;
}

export function useReactions({ view, now, onReact }: UseReactionsOptions): Reactions {
  const model = useMemo(() => pickerModel(view, now), [view, now]);
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<PlayerId | null>(null);
  const gameId = view.gameId;
  const muted = useMutedPlayers(gameId);
  const toggle = useReactionMutes((s) => s.toggle);

  const togglePicker = useCallback(() => {
    setMenuFor(null);
    setOpen((o) => pickerReducer(o, 'toggle', model));
  }, [model]);
  const closePicker = useCallback(() => setOpen(false), []);
  const pick = useCallback(
    (emoji: string) => {
      const item = model.items.find((i) => i.emoji === emoji);
      if (item && !item.disabled) onReact(emoji);
      setOpen((o) => pickerReducer(o, 'pick', model));
    },
    [model, onReact],
  );
  const openMenu = useCallback((playerId: PlayerId) => {
    setOpen(false);
    setMenuFor(playerId);
  }, []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const isMuted = useCallback((playerId: PlayerId) => muted.includes(playerId), [muted]);
  const toggleMute = useCallback((playerId: PlayerId) => toggle(gameId, playerId), [toggle, gameId]);
  const plan = useCallback(
    (e: { playerId: PlayerId; emoji: string; byMe: boolean }) => reactionPlan(e, muted),
    [muted],
  );

  return {
    model,
    pickerOpen: pickerShown(open, model),
    togglePicker,
    closePicker,
    pick,
    menuFor,
    openMenu,
    closeMenu,
    muted,
    isMuted,
    toggleMute,
    plan,
  };
}
