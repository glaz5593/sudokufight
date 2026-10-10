import type { PlayerId } from '@sudoku-fight/engine';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import {
  type CardModel,
  displayName,
  type InterferenceModel,
  PlayerCardCompact,
  type ScoreDelta,
} from '../../components/player';
import { metrics } from '../../components/player/metrics';
import { tokens } from '../../theme';
import type { ArsenalCardProps, Measurable } from './arsenal';
import type { Rect } from './geometry';
import { groupCardWidths } from './model';
import { CardMenuTrigger } from './reactions';

/**
 * The cards of a game of 3–4 players (spec §6.8, components.md §6–§8; Game-3P, Game-4P): one row of compact
 * cards that keeps the board's room, in a fixed order (me first at the start edge, then the others by seat),
 * so an interference target never moves; only each card's place badge (#1–#4) changes. 3 players: 114 each;
 * 4 players: mine 106 and 78 for the others (groupCardWidths).
 *
 * Every card comes from the view (cardModel). Mine has "כניעה" and "תגובות"; every opponent's has a compact ⚡
 * with the cost of my next interference, which opens the arsenal aimed at THAT card (spec §7.3.1): it becomes
 * the one drop zone, framed, and every other card dims (the arsenal's `cardProps`). A player who is out
 * (surrendered or gone, D36) is dimmed with a fixed place, and has no ⚡. A hit on anyone shows on their card
 * (the hit chip, spec §7.4). A long press on an opponent's card opens its menu (mute their reactions, D19).
 *
 * Each card reports where it is (for the score chips and the reactions), and the view around each opponent's
 * card is measured in the window as its drop zone.
 */
export interface GroupHudProps {
  /** In seat order, mine first (seatOrder). */
  cards: CardModel[];
  avatars?: Readonly<Partial<Record<PlayerId, AvatarId>>>;
  countries?: Readonly<Partial<Record<PlayerId, string | null>>>;
  deltas?: Readonly<Partial<Record<PlayerId, ScoreDelta>>>;
  /** "כניעה" on my card: the screen asks first (spec §6.6). */
  onSurrender: () => void;
  /** My card's reactions button (spec §8). */
  onReactions?: () => void;
  reactionsExpanded?: boolean;
  /** ⚡ on an opponent's card when it can be sent: the arsenal aimed at that card (spec §7.3.1). */
  onInterfere?: (playerId: PlayerId) => void;
  /** ⚡ while it can't be sent. */
  onInterfereBlocked?: (playerId: PlayerId, state: InterferenceModel) => void;
  /** Each card's drop-target state while the arsenal is open (useArsenal's `cardProps`). */
  dropOf?: (playerId: PlayerId, name: string) => ArsenalCardProps;
  /** A ref for the view around an opponent's card, measured as its drop zone. */
  cardRef?: (playerId: PlayerId) => (node: Measurable | null) => void;
  /** An opponent card's menu (D19); null for none. */
  menuOf?: (playerId: PlayerId) => { muted: boolean; onOpen: () => void } | null;
  /** A card's rect, in the HUD's own coordinates. */
  onCardLayout?: (playerId: PlayerId, rect: Rect) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ROW_GUTTER = tokens.layout.gutterGame;

export function GroupHud({
  cards,
  avatars,
  countries,
  deltas,
  onSurrender,
  onReactions,
  reactionsExpanded = false,
  onInterfere,
  onInterfereBlocked,
  dropOf,
  cardRef,
  menuOf,
  onCardLayout,
  onLayout,
  style,
  testID = 'group-hud',
}: GroupHudProps) {
  const { width } = useWindowDimensions();
  const widths = groupCardWidths(cards.length, width - 2 * ROW_GUTTER);

  return (
    <View style={[styles.row, style]} onLayout={onLayout} testID={testID}>
      {cards.map((card, i) => (
        <GroupCard
          key={card.playerId}
          card={card}
          width={widths[i]}
          avatarId={avatars?.[card.playerId]}
          country={countries?.[card.playerId]}
          delta={deltas?.[card.playerId] ?? null}
          onSurrender={onSurrender}
          onReactions={onReactions}
          reactionsExpanded={reactionsExpanded}
          onInterfere={onInterfere}
          onInterfereBlocked={onInterfereBlocked}
          dropOf={dropOf}
          cardRef={card.isMe ? undefined : cardRef?.(card.playerId)}
          menu={card.isMe ? null : (menuOf?.(card.playerId) ?? null)}
          onCardLayout={onCardLayout}
          testID={testID}
        />
      ))}
    </View>
  );
}

interface GroupCardProps {
  card: CardModel;
  width: number | undefined;
  avatarId: AvatarId | undefined;
  country: string | null | undefined;
  delta: ScoreDelta | null;
  onSurrender: () => void;
  onReactions?: () => void;
  reactionsExpanded: boolean;
  onInterfere?: (playerId: PlayerId) => void;
  onInterfereBlocked?: (playerId: PlayerId, state: InterferenceModel) => void;
  dropOf?: (playerId: PlayerId, name: string) => ArsenalCardProps;
  cardRef: ((node: Measurable | null) => void) | undefined;
  menu: { muted: boolean; onOpen: () => void } | null;
  onCardLayout?: (playerId: PlayerId, rect: Rect) => void;
  testID: string;
}

/** One card of the row, with the view around it that reports where it is (and, for an opponent, is measured). */
const GroupCard = memo(function GroupCard({
  card,
  width,
  avatarId,
  country,
  delta,
  onSurrender,
  onReactions,
  reactionsExpanded,
  onInterfere,
  onInterfereBlocked,
  dropOf,
  cardRef,
  menu,
  onCardLayout,
  testID,
}: GroupCardProps) {
  const { t } = useTranslation('player');
  const id = card.playerId;
  const name = displayName(card, t);
  const onCardLayoutHere = useCallback(
    (e: LayoutChangeEvent) => onCardLayout?.(id, e.nativeEvent.layout),
    [onCardLayout, id],
  );
  const interfere = useCallback(() => onInterfere?.(id), [onInterfere, id]);
  const blocked = useCallback(
    (state: InterferenceModel) => onInterfereBlocked?.(id, state),
    [onInterfereBlocked, id],
  );
  const view = (
    <PlayerCardCompact
      model={card}
      avatarId={avatarId}
      country={country}
      width={width}
      delta={delta}
      {...(card.isMe
        ? { onSurrender, onReactions, reactionsExpanded }
        : { onInterfere: interfere, onInterfereBlocked: blocked })}
      {...dropOf?.(id, name)}
      testID={card.isMe ? 'card-me' : `card-${id}`}
    />
  );
  return (
    // Not flattened on Android: the arsenal measures the view around an opponent's card in the window.
    <View
      ref={cardRef}
      collapsable={false}
      onLayout={onCardLayoutHere}
      testID={card.isMe ? `${testID}-mine` : `${testID}-${id}`}
    >
      {menu ? (
        <CardMenuTrigger name={name} muted={menu.muted} onOpen={menu.onOpen} testID={`card-menu-${id}`}>
          {view}
        </CardMenuTrigger>
      ) : (
        view
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // The place badges hang 10 dp over the cards' top (components.md §6: top −10).
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: -metrics.rankBadge.top,
  },
});
