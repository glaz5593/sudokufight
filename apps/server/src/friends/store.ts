import type { RatingOption } from '@sudoku-fight/engine';
import { isCountryCode, NO_AVATAR_ID, normalizeAvatarId, ratingKeysFor } from '@sudoku-fight/protocol';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { ratings, users } from '../db/schema';
import { blocksAmong } from '../moderation/store';
import type { LobbyMember } from './lobby';
import type { FriendsStore } from './service';

/**
 * What the friends service reads from the database: a player's card in the lobby (avatar, flag and general
 * rating, all public already on the leaderboards: friends-room.md §7.6) and the blocks among the players
 * (spec §3.5, [D85c]).
 *
 * The general rating is the leaderboard's 'general' row (progress/leaderboard.ts): the best rating among the
 * keys of the server's RATING_OPTION in which the player has a rated game; null before any.
 */
export function dbFriendsStore(db: Db | (() => Db), ratingOption: RatingOption): FriendsStore {
  const database = typeof db === 'function' ? db : () => db;
  const keys = ratingKeysFor(ratingOption);
  return {
    async member(userId, name): Promise<LobbyMember> {
      const [user] = await database()
        .select({ avatarId: users.avatarId, country: users.country })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      const [best] = await database()
        .select({ rating: ratings.rating })
        .from(ratings)
        .where(and(eq(ratings.userId, userId), inArray(ratings.ratingKey, keys), gt(ratings.games, 0)))
        .orderBy(desc(ratings.rating), desc(ratings.games), ratings.ratingKey)
        .limit(1);
      return {
        id: userId,
        name,
        avatarId: user === undefined ? NO_AVATAR_ID : normalizeAvatarId(user.avatarId),
        country: user !== undefined && isCountryCode(user.country) ? user.country : null,
        rating: best === undefined ? null : Math.round(best.rating),
      };
    },

    blocksAmong: (userIds) => blocksAmong(database(), userIds),
  };
}
