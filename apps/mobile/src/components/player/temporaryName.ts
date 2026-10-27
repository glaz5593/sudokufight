import type { TFunction } from 'i18next';

/**
 * The temporary name an admin gives a player whose name was reset (spec §3.5; apps/server/src/moderation/admin.ts
 * temporaryName): "שחקן" and five digits, stored in Hebrew on the server, in the games' logs too. The app shows
 * it in the viewer's language (localization plan 0יב, D113): player:temporaryName, "Player12345" in English.
 * A test keeps the pattern equal to the server's.
 *
 * Where a stored name is shown: the player components (wording.ts displayName, leadLabel), the leaderboard, a
 * player's card, the results' awards and "בחר שם חדש". The live screens (a room's seats, the lobby, a hit) do not
 * need it: until the player picks a new name the app keeps them on "בחר שם חדש", practice and the settings
 * (auth/redirect.ts), so they meet nobody.
 */
export const TEMPORARY_NAME_PREFIX = 'שחקן';
const TEMPORARY_NAME = new RegExp(`^${TEMPORARY_NAME_PREFIX}(\\d{5})$`);

/** The five digits of a temporary name, or null for any other name. */
export const temporaryNameDigits = (name: string): string | null => TEMPORARY_NAME.exec(name)?.[1] ?? null;

/**
 * A player's name as the viewer reads it: a temporary name in the viewer's language, any other as it is. Any
 * namespace's t() will do (the key carries its namespace).
 */
export function shownName(name: string, t: TFunction): string {
  const digits = temporaryNameDigits(name);
  return digits === null ? name : t('player:temporaryName', { digits });
}
