import type { TelemetryEvent } from '@sudoku-fight/protocol';

/**
 * The events waiting on the phone to be sent (spec §27.1), oldest first, in memory. Pure: no React Native or
 * Expo imports. The sender reads the oldest (peek) and removes them once the server answers (ack, or drop
 * when the server refused them); storage.ts keeps a copy on disk, written from takeChanges().
 *
 * - Each id is queued once: an event already queued is not added again.
 * - At most `cap` events: past it, the oldest go (a phone offline for weeks keeps the newest).
 */

/** About a megabyte of events at ~200 bytes each. */
export const QUEUE_CAP = 5_000;

/** What changed since the last write to disk. */
export interface QueueChanges {
  /** Events to write, oldest first. */
  added: TelemetryEvent[];
  /** Ids to delete from disk. */
  removed: string[];
}

/**
 * Where the queue is kept between runs: storage.ts (SQLite on the phone). Declared here, with the changes it
 * writes, so the client needs nothing from expo-sqlite.
 */
export interface TelemetryStore {
  /** The queued events, oldest first. Rows that are no longer valid events are deleted. */
  load(): Promise<TelemetryEvent[]>;
  /** Writes one set of changes, in one transaction: all of it or nothing. */
  save(changes: QueueChanges): Promise<void>;
}

export class TelemetryQueue {
  /** Map keeps insertion order: the first entry is the oldest event. */
  private events = new Map<string, TelemetryEvent>();
  /** Queued, not yet on disk. */
  private unsavedAdds = new Map<string, TelemetryEvent>();
  /** On disk, no longer queued. */
  private readonly unsavedRemoves = new Set<string>();

  constructor(readonly cap: number = QUEUE_CAP) {}

  get size(): number {
    return this.events.size;
  }

  has(id: string): boolean {
    return this.events.has(id);
  }

  /** Adds `event` as the newest. False when its id is already queued. */
  append(event: TelemetryEvent): boolean {
    if (this.events.has(event.id)) return false;
    this.events.set(event.id, event);
    this.unsavedAdds.set(event.id, event);
    this.enforceCap();
    return true;
  }

  /**
   * Events read back from disk (already saved there), oldest first. They are older than anything appended
   * in this run, so they go in front of it.
   */
  restore(saved: readonly TelemetryEvent[]): void {
    const merged = new Map<string, TelemetryEvent>();
    for (const event of saved) {
      // Already removed in this run: it stays removed (its delete is pending).
      if (merged.has(event.id) || this.unsavedRemoves.has(event.id)) continue;
      merged.set(event.id, event);
      this.unsavedAdds.delete(event.id); // on disk already
    }
    for (const [id, event] of this.events) if (!merged.has(id)) merged.set(id, event);
    this.events = merged;
    this.enforceCap();
  }

  /** The oldest `max` events, oldest first. They stay queued until ack or drop. */
  peek(max: number): TelemetryEvent[] {
    const out: TelemetryEvent[] = [];
    for (const event of this.events.values()) {
      if (out.length >= max) break;
      out.push(event);
    }
    return out;
  }

  /** The server has them: removes them. Returns how many were queued. */
  ack(ids: Iterable<string>): number {
    return this.remove(ids);
  }

  /** Can't be sent (the server refused them, or they are malformed): removes them. Returns how many were queued. */
  drop(ids: Iterable<string>): number {
    return this.remove(ids);
  }

  get hasUnsavedChanges(): boolean {
    return this.unsavedAdds.size > 0 || this.unsavedRemoves.size > 0;
  }

  /** What changed since the last call (null: nothing), for one write to disk. Clears it. */
  takeChanges(): QueueChanges | null {
    if (!this.hasUnsavedChanges) return null;
    const changes = { added: [...this.unsavedAdds.values()], removed: [...this.unsavedRemoves] };
    this.unsavedAdds.clear();
    this.unsavedRemoves.clear();
    return changes;
  }

  /** The write of `changes` failed: they are unsaved again (as far as they still apply). */
  returnChanges(changes: QueueChanges): void {
    const adds = new Map<string, TelemetryEvent>();
    for (const event of changes.added) {
      // Still queued: write it next time. Gone since (sent): it never reached the disk, nothing to delete.
      if (this.events.has(event.id)) adds.set(event.id, event);
      else this.unsavedRemoves.delete(event.id);
    }
    for (const [id, event] of this.unsavedAdds) if (!adds.has(id)) adds.set(id, event);
    this.unsavedAdds = adds;
    for (const id of changes.removed) if (!this.events.has(id)) this.unsavedRemoves.add(id);
  }

  private remove(ids: Iterable<string>): number {
    let removed = 0;
    for (const id of ids) {
      if (!this.events.delete(id)) continue;
      removed++;
      // Never written: nothing to delete on disk.
      if (!this.unsavedAdds.delete(id)) this.unsavedRemoves.add(id);
    }
    return removed;
  }

  private enforceCap(): void {
    const over = this.events.size - this.cap;
    if (over <= 0) return;
    const oldest: string[] = [];
    for (const id of this.events.keys()) {
      if (oldest.length >= over) break;
      oldest.push(id);
    }
    this.remove(oldest);
  }
}
