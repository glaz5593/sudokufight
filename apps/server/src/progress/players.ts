import { levelFor } from '@sudoku-fight/engine';
import { isCountryCode, normalizeAvatarId, type PublicPlayer } from '@sudoku-fight/protocol';
import { and, inArray, isNull } from 'drizzle-orm';

import type { Db } from '../db';
import { users } from '../db/schema';
import type { ProgressSettings } from './settings';
import { leagueOf, leagueRowsOf, xpOf } from './xp';

/**
 * Players as anyone may see them (spec §14.2, §14.3): name, avatar, country, league and level. Nothing
 * private (no email, no sign-in id), and nobody whose account was deleted.
 */
export async function publicPlayers(
  db: Db,
  userIds: readonly string[],
  settings: ProgressSettings,
): Promise<Map<string, PublicPlayer>> {
  const found = new Map<string, PublicPlayer>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return found;
  const [rows, xpTotals, leagueRows] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarId: users.avatarId,
        country: users.country,
      })
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.deletedAt))),
    xpOf(db, ids),
    leagueRowsOf(db, ids, settings),
  ]);
  for (const u of rows) {
    found.set(u.id, {
      id: u.id,
      displayName: u.displayName,
      avatarId: normalizeAvatarId(u.avatarId),
      country: isCountryCode(u.country) ? u.country : null,
      league: leagueOf(leagueRows.get(u.id) ?? [], settings.rules).league,
      level: levelFor(xpTotals.get(u.id) ?? 0, settings.rules).level,
    });
  }
  return found;
}
