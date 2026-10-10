import type { TelemetryBatch, TelemetryResponse } from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';

import type { Db } from '../db';
import { appEvents, installs } from '../db/schema';

/**
 * Stores a checked batch in one transaction (spec §27.2):
 * - the install: created on its first batch; first_seen only moves back, last_seen only forward. Event
 *   times count, clamped to the server's clock (a phone set to next week doesn't make it "seen" next week).
 *   Platform and version come from the newest batch, so a late batch from an old queue can't roll them back.
 * - the events: an id already stored (a retry) is skipped and counted as a duplicate.
 * - `userId`: the account of a verified token sent with the batch (never from the body), or null. It goes on
 *   the batch's new events and on the install; an anonymous batch leaves the install's account as it was.
 */
export async function storeBatch(
  db: Db,
  batch: TelemetryBatch,
  now: number,
  userId: string | null = null,
): Promise<TelemetryResponse> {
  const times = batch.events.map((e) => Math.min(e.t, now));
  const firstSeen = new Date(Math.min(...times));
  const lastSeen = new Date(Math.max(...times));
  const tServer = new Date(now);

  const unique = new Map(batch.events.map((e) => [e.id, e]));
  const rows = [...unique.values()].map((e) => ({
    id: e.id,
    installId: batch.installId,
    userId,
    name: e.name,
    props: e.props,
    tClient: new Date(e.t),
    tServer,
  }));

  return db.transaction(async (tx) => {
    const newer = sql`excluded.last_seen >= ${installs.lastSeen}`;
    await tx
      .insert(installs)
      .values({
        id: batch.installId,
        platform: batch.platform,
        appVersion: batch.appVersion,
        firstSeen,
        lastSeen,
        userId,
      })
      .onConflictDoUpdate({
        target: installs.id,
        set: {
          firstSeen: sql`least(${installs.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${installs.lastSeen}, excluded.last_seen)`,
          platform: sql`case when ${newer} then excluded.platform else ${installs.platform} end`,
          appVersion: sql`case when ${newer} then excluded.app_version else ${installs.appVersion} end`,
          userId: sql`coalesce(excluded.user_id, ${installs.userId})`,
        },
      });
    const stored = await tx
      .insert(appEvents)
      .values(rows)
      .onConflictDoNothing({ target: appEvents.id })
      .returning({ id: appEvents.id });
    return { accepted: stored.length, duplicates: batch.events.length - stored.length };
  });
}
