import { botLevel, type BotLevelId, type GameView, isBotLevelId, type PlayerId } from '@sudoku-fight/engine';

import { type AvatarIdOrNone, NO_AVATAR_ID, normalizeAvatarId } from '../../avatars';

/**
 * Who a player is on this phone's screens: the name and the avatar on their card, on their locks and in the
 * results. The engine's view only knows the name a player came with (PlayerInfo.name) and whether it is a
 * bot; a bot's avatar comes from its level (the engine's BOT_LEVELS, spec §9), which its id carries (`bot-3`,
 * as the engine's botPlayer() names it). Nothing here decides anything about the game.
 */
export interface PlayerIdentity {
  /** Null: the screen's own word for it ("אני", "שחקן"). */
  name: string | null;
  avatar: AvatarIdOrNone;
  isBot: boolean;
  /** 1–5 for a bot of the engine's levels; null otherwise. */
  botLevel: BotLevelId | null;
}

const BOT_ID = /^bot-(\d)$/;

/** The level of a bot by its id (`bot-<level>`, as the engine's botPlayer() names it); null for anyone else. */
export function botLevelOf(playerId: PlayerId): BotLevelId | null {
  const level = Number(BOT_ID.exec(playerId)?.[1]);
  return isBotLevelId(level) ? level : null;
}

/** A player as a game's config or view describes them. */
export interface PlayerLike {
  id: PlayerId;
  name?: string | null;
  isBot?: boolean;
}

export function playerIdentity(player: PlayerLike): PlayerIdentity {
  // An id shaped like a bot's is only a bot's when the game does not say otherwise.
  const level = player.isBot === false ? null : botLevelOf(player.id);
  const bot = level === null ? null : botLevel(level);
  return {
    name: player.name ?? bot?.name ?? null,
    avatar: bot ? normalizeAvatarId(bot.avatar) : NO_AVATAR_ID,
    isBot: player.isBot ?? level !== null,
    botLevel: level,
  };
}

/** A player of a game's view; the empty identity for an id the view does not have. */
export function identityOf(view: Pick<GameView, 'players'>, playerId: PlayerId): PlayerIdentity {
  const p = view.players.find((x) => x.id === playerId);
  return playerIdentity(p ? { id: p.id, name: p.name, isBot: p.isBot } : { id: playerId });
}
