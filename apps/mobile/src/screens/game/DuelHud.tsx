import type { PlayerId } from '@sudoku-fight/engine';
import { useCallback } from 'react';
import { type LayoutChangeEvent, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import type { AvatarFace, AvatarIdOrNone } from '../../avatars';
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
 * The actions of work plan stage 6 (spec §7.3, §8): my card's reactions button opens my picker; "הפרעה" on the
 * opponent's card opens the interference picker aimed at that card [D45] (the arsenal's `cardProps` on both
 * cards: the target framed with "יעד", the other dimmed). Against a bot there is no "הפרעה" [D44]: the view
 * has no interferences, so the card has no button. A long press on the opponent's card opens its menu (mute
 * their reactions, D19). What each button can do comes from the view; the HUD only wires it.
 */
export interface DuelHudProps {
  me: CardModel;
  opponent: CardModel;
  myAvatar?: AvatarIdOrNone | null;
  opponentAvatar?: AvatarIdOrNone | null;
  /** The avatars' faces (game/useAvatarFaces): moods and reactions to the game. */
  myFace?: AvatarFace | null;
  opponentFace?: AvatarFace | null;
  /** The flags (spec §6.8), when the game knows the countries (a ranked match's profiles); ISO alpha-2. */
  myCountry?: string | null;
  opponentCountry?: string | null;
  myDelta?: ScoreDelta | null;
  opponentDelta?: ScoreDelta | null;
  /** A bot opponent's level under its name (Game-Bot), drawn and said; null for anyone else. */
  opponentBotLevel?: { text: string; label: string } | null;
  /** "סיום אימון" (practice) or "כניעה" on my card: the screen asks first (spec §6.6). */
  onSurrender: () => void;
  /** My card's reactions button: opens or closes my picker (spec §8). */
  onReactions?: () => void;
  /** My picker is open. */
  reactionsExpanded?: boolean;
  /** "הפרעה" on the opponent's card when it can be sent: opens (or closes) the picker aimed at it [D45]. */
  onInterfere?: () => void;
  /** "הפרעה" while it can't be sent: the screen says why (§8.1). */
  onInterfereBlocked?: (state: InterferenceModel) => void;
  /** Each card's target state while the interference picker is open (useArsenal's `cardProps`). */
  myTarget?: ArsenalCardProps;
  opponentTarget?: ArsenalCardProps;
  /** The view around the opponent's card, measured in the window for the picker's scrim hole. */
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
  myFace = null,
  opponentFace = null,
  myCountry = null,
  opponentCountry = null,
  myDelta = null,
  opponentDelta = null,
  opponentBotLevel = null,
  onSurrender,
  onReactions,
  reactionsExpanded = false,
  onInterfere,
  onInterfereBlocked,
  myTarget,
  opponentTarget,
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
      face={opponentFace}
      country={opponentCountry}
      side="end"
      delta={opponentDelta}
      botLevel={opponentBotLevel}
      onInterfere={onInterfere}
      onInterfereBlocked={onInterfereBlocked}
      {...opponentTarget}
      testID="card-opponent"
    />
  );

  return (
    <View style={[styles.row, style]} onLayout={onLayout} testID={testID}>
      <View onLayout={onMine} testID={`${testID}-mine`}>
        <PlayerCard
          model={me}
          avatarId={myAvatar}
          face={myFace}
          country={myCountry}
          side="start"
          delta={myDelta}
          onSurrender={onSurrender}
          onReactions={onReactions}
          reactionsExpanded={reactionsExpanded}
          {...myTarget}
          testID="card-me"
        />
      </View>
      {/* Not flattened on Android: the picker measures this view in the window (its scrim's hole). */}
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
