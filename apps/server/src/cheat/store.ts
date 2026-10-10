import type { Db } from '../db';
import { cheatFlags } from '../db/schema';

export interface NewCheatFlag {
  userId: string;
  gameId: string;
  reason: string;
  value: number;
}

/**
 * Writes flags for review (spec §21). One per game, player and reason (a unique index): writing a game's
 * flags again adds nothing.
 */
export async function insertCheatFlags(db: Db, flags: readonly NewCheatFlag[], at: Date): Promise<void> {
  if (flags.length === 0) return;
  await db
    .insert(cheatFlags)
    .values(flags.map((f) => ({ ...f, createdAt: at })))
    .onConflictDoNothing();
}
