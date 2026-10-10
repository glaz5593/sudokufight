import type { PlayerId } from '@sudoku-fight/engine';
import { useCallback } from 'react';
import { type LayoutChangeEvent, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import {
  type CardModel,
  type InterferenceModel,
  PlayerCard,
  type ScoreDelta,
  VsBadge,
} from '../../components/player';
import { tokens } from '../../theme';
import type { ArsenalCardProps, Measurable } from './arsenal';
import type { Rect } from './geometry';
import { CardMenuTrigger } from './reactions';

/**
 * The cards of a 2-player game (spec §6.8, components.md §3.1; Dir-C-Game, Game-Bot): mine at the start of the
 * row (right in Hebrew, left in English), the opponent's mirrored at the end, and the skewed VS between them.
 * The cards come from the view (cardModel), with the scores the screen shows now (held back while a chip
 * flies to them). Each card reports where it is, so chips can land on it and reactions rise from it.
 *
 * The actions of work plan stage 6 (spec §7.3, §8): my card's reactions button opens my picker; ⚡ on the
 * opponent's card opens the arsenal aimed at that card, which then becomes the one drop zone (the arsenal's
 * `cardProps` on both cards: the target framed, the other dimmed). A long press on the opponent's card opens
 * its menu (mute their reactions, D19). What each button can do comes from the view; the HUD only wires it.
 */
export interface DuelHudProps {
  me: CardModel;
  opponent: CardModel;
  myAvatar?: AvatarId | null;
  opponentAvatar?: AvatarId | null;
  myDelta?: ScoreDelta | null;
  opponentDelta?: ScoreDelta | null;
  /** "סיום אימון" (practice) or "כניעה" on my card: the screen asks first (spec §6.6). */
  onSurrender: () => void;
  /** My card's reactions button: opens or closes my picker (spec §8). */
  onReactions?: () => void;
  /** My picker is open. */
  reactionsExpanded?: boolean;
  /** ⚡ on the opponent's card when it can be sent: opens (or closes) the arsenal aimed at it (spec §7.3.1). */
  onInterfere?: () => void;
  /** ⚡ while it can't be sent (short of points says why, §8.1). */
  onInterfereBlocked?: (state: InterferenceModel) => void;
  /** Each card's drop-target state while the arsenal is open (useArsenal's `cardProps`). */
  myDrop?: ArsenalCardProps;
  opponentDrop?: ArsenalCardProps;
  /** The view around the opponent's card, measured in the window as the arsenal's drop zone. */
  opponentRef?: (node: Measurable | null) => void;
  /** The opponent card's menu (D19): whether they are muted, and what opens it (a long press). */
  opponentMenu?: { muted: boolean; onOpen: () => void };
  /** A card's rect, in the HUD's own coordinates. */
  onCardLayout?: (playerId: PlayerId, rect: Rect) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DuelHud({
  me,
  opponent,
  myAvatar,
  opponentAvatar,
  myDelta = null,
  opponentDelta = null,
  onSurrender,
  onReactions,
  reactionsExpanded = false,
  onInterfere,
  onInterfereBlocked,
  myDrop,
  opponentDrop,
  opponentRef,
  opponentMenu,
  onCardLayout,
  onLayout,
  style,
  testID = 'duel-hud',
}: DuelHudProps) {
  const onMine = useCallback(
    (e: LayoutChangeEvent) => onCardLayout?.(me.playerId, e.nativeEvent.layout),
    [onCardLayout, me.playerId],
  );
  const onTheirs = useCallback(
    (e: LayoutChangeEvent) => onCardLayout?.(opponent.playerId, e.nativeEvent.layout),
    [onCardLayout, opponent.playerId],
  );
  const theirName = opponent.name ?? '';

  const theirCard = (
    <PlayerCard
      model={opponent}
      avatarId={opponentAvatar}
      side="end"
      delta={opponentDelta}
      onInterfere={onInterfere}
      onInterfereBlocked={onInterfereBlocked}
      {...opponentDrop}
      testID="card-opponent"
    />
  );

  return (
    <View style={[styles.row, style]} onLayout={onLayout} testID={testID}>
      <View onLayout={onMine} testID={`${testID}-mine`}>
        <PlayerCard
          model={me}
          avatarId={myAvatar}
          side="start"
          delta={myDelta}
          onSurrender={onSurrender}
          onReactions={onReactions}
          reactionsExpanded={reactionsExpanded}
          {...myDrop}
          testID="card-me"
        />
      </View>
      {/* Not flattened on Android: the arsenal measures this view in the window (its drop zone). */}
      <View ref={opponentRef} collapsable={false} onLayout={onTheirs} testID={`${testID}-theirs`}>
        {opponentMenu ? (
          <CardMenuTrigger name={theirName} muted={opponentMenu.muted} onOpen={opponentMenu.onOpen}>
            {theirCard}
          </CardMenuTrigger>
        ) : (
          theirCard
        )}
      </View>
      {/* VS sits between the cards, 10 dp under their top (components.md §3.1: top 58 against the cards' 48). */}
      <View style={styles.vsRow} pointerEvents="none">
        <VsBadge />
      </View>
    </View>
  );
}

const game = tokens.layout.game;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  vsRow: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    paddingTop: game.vsBadge.top - game.playerCard.top,
  },
});
