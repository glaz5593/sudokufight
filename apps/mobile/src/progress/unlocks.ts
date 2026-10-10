/**
 * Unlocking by level [D17] (spec §3.4, §7.1, §15: "פתיחת אווטרים, הפרעות ותגובות: תשתית ב־V1, תוכן ב־V1.1").
 * Every avatar and every interference has an `unlockLevel`; it is open to a player whose level reached it. In
 * V1 every unlockLevel is 0, so everything is open from the start; V1.1 fills in the table.
 */

/** Everyone starts at level 1 (spec §15): a level not known yet (offline, before the first answer) counts so. */
export const FIRST_LEVEL = 1;

/** Open to a player of `level` (null: not known yet, the first level). */
export function isUnlocked(unlockLevel: number, level: number | null): boolean {
  return (level ?? FIRST_LEVEL) >= unlockLevel;
}
