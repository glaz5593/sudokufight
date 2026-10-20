import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { serverSettings } from '../db/schema';
import type { GameRoomLog } from '../rooms/GameRoom';

/**
 * The stealth bot's switch (stealth-bot.md §8) [D90]: on or off at run time, from the admin site, with no
 * restart. A restart ends every ranked game being played (terms.ts), so it is no way to turn the bot off.
 *
 * Two levels:
 * - STEALTH_BOT_ENABLED (config.stealth.enabled), the master switch: false (the default, everywhere) means the
 *   feature does not exist on this server. `available` is false, the switch reads off whatever is stored, and
 *   set() refuses (the admin site shows no switch).
 * - The admin switch: a row of server_settings (key STEALTH_BOT_SETTING, value `{ "enabled": true|false }`). No
 *   row means off: the bot comes only after an admin turned it on [D90: on in staging only at Moshe's word].
 *
 * Matchmaking asks isOn() on every round (synchronous, from memory). The value read from the database is kept
 * for `ttlMs` (2 s) and read again in the background once older, so a change made elsewhere (another machine)
 * shows within seconds; set() (the admin route, in this process) takes effect at once. Turning it off stops NEW
 * bots only: a game already running against one ends as usual. A read that fails keeps the last value (off
 * until the first read succeeds) and is logged.
 */

/** server_settings.key of the stealth bot's switch. */
export const STEALTH_BOT_SETTING = 'stealth_bot';

/** How long a value read from the database is used before it is read again (ms). */
export const STEALTH_SWITCH_TTL_MS = 2000;

/** What is stored: the admin switch's position, who turned it and when. */
export interface StealthSwitchRecord {
  enabled: boolean;
  /** Epoch ms. */
  updatedAt: number;
  /** The admin's address (server_settings.updated_by), or null. */
  updatedBy: string | null;
}

/** Where the switch is kept (dbStealthSwitchStore: server_settings). */
export interface StealthSwitchStore {
  /** The stored switch, or null when it was never set (off). */
  read(): Promise<StealthSwitchRecord | null>;
  write(record: StealthSwitchRecord): Promise<void>;
}

/** The switch as the admin site shows it (GET) and gets it back after a change (PUT). */
export interface StealthSwitchState {
  /** STEALTH_BOT_ENABLED: the feature exists on this server; false: no switch to show. */
  available: boolean;
  /** The admin switch (off when never set). */
  enabled: boolean;
  /** The bot may come now: available and enabled. */
  on: boolean;
  /** When and by whom it was last turned; null when never. */
  updatedAt: number | null;
  updatedBy: string | null;
}

/** set() on a server whose STEALTH_BOT_ENABLED is false: there is no switch to turn. */
export class StealthSwitchUnavailableError extends Error {
  constructor() {
    super('The stealth bot is not available on this server (STEALTH_BOT_ENABLED=false)');
    this.name = 'StealthSwitchUnavailableError';
  }
}

export interface StealthSwitchOptions {
  /** STEALTH_BOT_ENABLED (config.stealth?.enabled ?? false). */
  available: boolean;
  store: StealthSwitchStore;
  now: () => number;
  log: Pick<GameRoomLog, 'error'>;
  ttlMs?: number;
}

export class StealthSwitch {
  readonly available: boolean;
  private readonly store: StealthSwitchStore;
  private readonly now: () => number;
  private readonly log: Pick<GameRoomLog, 'error'>;
  private readonly ttlMs: number;
  private record: StealthSwitchRecord | null = null;
  /** When the value in memory was read (null: never). */
  private readAt: number | null = null;
  private reading: Promise<StealthSwitchRecord | null> | null = null;
  /** Bumped by set(): a read that started before a set() does not overwrite it. */
  private version = 0;

  constructor(options: StealthSwitchOptions) {
    this.available = options.available;
    this.store = options.store;
    this.now = options.now;
    this.log = options.log;
    this.ttlMs = options.ttlMs ?? STEALTH_SWITCH_TTL_MS;
  }

  /**
   * The bot may come now (synchronous: matchmaking's every round). False whenever the master switch is off,
   * without reading anything. Otherwise the last value read; an old one is read again in the background.
   */
  isOn(): boolean {
    if (!this.available) return false;
    if (this.readAt === null || this.now() - this.readAt >= this.ttlMs)
      void this.load().catch(() => undefined);
    return this.record?.enabled === true;
  }

  /** Reads the stored switch now (the admin site's GET; and at start, so the first rounds know it). */
  async state(): Promise<StealthSwitchState> {
    if (this.available) await this.load();
    return this.describe();
  }

  /**
   * Turns the admin switch (the admin site's PUT). Effective at once in this process: matchmaking's next round
   * seats no new bot after `false`. Throws StealthSwitchUnavailableError under STEALTH_BOT_ENABLED=false.
   */
  async set(enabled: boolean, by: string | null): Promise<StealthSwitchState> {
    if (!this.available) throw new StealthSwitchUnavailableError();
    const record: StealthSwitchRecord = { enabled, updatedAt: this.now(), updatedBy: by };
    await this.store.write(record);
    this.version++;
    this.record = record;
    this.readAt = this.now();
    return this.describe();
  }

  private describe(): StealthSwitchState {
    const enabled = this.available && this.record?.enabled === true;
    return {
      available: this.available,
      enabled,
      on: enabled,
      updatedAt: this.record?.updatedAt ?? null,
      updatedBy: this.record?.updatedBy ?? null,
    };
  }

  /** One read at a time; a failed one keeps the last value and is tried again after ttlMs. */
  private load(): Promise<StealthSwitchRecord | null> {
    if (this.reading) return this.reading;
    const version = this.version;
    const reading = this.store
      .read()
      .then(
        (record) => {
          if (this.version === version) this.record = record;
          return this.record;
        },
        (error: unknown) => {
          this.log.error('[stealth] the switch could not be read; keeping the last value', error);
          return this.record;
        },
      )
      .finally(() => {
        this.readAt = this.now();
        this.reading = null;
      });
    this.reading = reading;
    return reading;
  }
}

/** The switch in server_settings (stealth-bot.md §8): one row, `{ "enabled": … }`. */
export function dbStealthSwitchStore(db: Db | (() => Db)): StealthSwitchStore {
  const database = typeof db === 'function' ? db : () => db;
  return {
    async read() {
      const [row] = await database()
        .select({
          value: serverSettings.value,
          updatedAt: serverSettings.updatedAt,
          updatedBy: serverSettings.updatedBy,
        })
        .from(serverSettings)
        .where(eq(serverSettings.key, STEALTH_BOT_SETTING));
      if (row === undefined) return null;
      const value = row.value as { enabled?: unknown } | null;
      return {
        // Anything but an explicit true is off.
        enabled: typeof value === 'object' && value !== null && value.enabled === true,
        updatedAt: row.updatedAt.getTime(),
        updatedBy: row.updatedBy,
      };
    },
    async write({ enabled, updatedAt, updatedBy }) {
      const at = new Date(updatedAt);
      await database()
        .insert(serverSettings)
        .values({ key: STEALTH_BOT_SETTING, value: { enabled }, updatedAt: at, updatedBy })
        .onConflictDoUpdate({
          target: serverSettings.key,
          set: { value: { enabled }, updatedAt: at, updatedBy },
        });
    },
  };
}
