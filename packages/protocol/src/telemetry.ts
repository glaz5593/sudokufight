import type { BotLevelId, LevelEndReason, LevelKind, Stars } from '@sudoku-fight/engine';

/**
 * Usage reporting from the app to our server (spec §27.1, §27.2): `POST /v1/events`.
 *
 * - Every install gets a random `installId` on first launch, so it counts even without an account.
 * - Events wait in a queue on the phone and go out in batches when there is a connection. Each event has its
 *   own id, so a batch that is sent twice (a retry after a lost answer) is stored once.
 * - Who the user is comes only from a verified Firebase ID token in the Authorization header (stage 8),
 *   never from the body.
 */

export const TELEMETRY_PATH = '/v1/events';

/** At most this many events in one batch. */
export const MAX_EVENTS_PER_BATCH = 100;
/** At most this many bytes of JSON in one event's props. */
export const MAX_PROPS_BYTES = 2048;
/**
 * At most this many bytes of JSON in one request body. 100 events with full props would pass it, so the app
 * splits a batch by size as well as by count.
 */
export const MAX_BATCH_BYTES = 64 * 1024;

export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * The events the app reports: spec §22's analytics list, plus `screen_view` (§27.1), plus staged practice's
 * six (1.0.2, spec §5.3, §22).
 * The server stores no other name, so a typo can't fill the table with junk: since 1.0.2 it skips an event
 * whose name it does not know and stores the rest of the batch (`ignored` in the answer). A server before
 * that refuses the whole batch with a 400, which is why the app never mixes generations in one batch
 * (TELEMETRY_EVENT_GENERATION).
 */
export const TELEMETRY_EVENT_NAMES = [
  'app_open',
  'screen_view',
  'register_step',
  'register_complete',
  'game_start',
  'game_end',
  'interference_sent',
  'reaction_sent',
  'matchmaking_wait',
  'reconnect',
  'latency_sample',
  'replay_open',
  'account_delete',
  /**
   * A player report went out (spec §3.5): props `{ reason }` (a ReportReason) and nothing else, never an id
   * of the player or the game. The server refuses any other props for it.
   */
  'report_sent',
  /** The levels' map opens (staged practice, 1.0.2): LevelMapOpenProps. */
  'level_map_open',
  /** A level really starts (after "מוכן?" or "איך משחקים"): LevelStartProps. */
  'level_start',
  /** A level ends, any end that counts (a quit with the X too): LevelEndProps. */
  'level_end',
  /** A level left without an end (the app went away mid-level): LevelQuitProps. */
  'level_quit',
  /** An attempt at a closed gate, after a level of its chapter once the boss was played: ChapterGateProps. */
  'chapter_gate',
  /** The "איך משחקים" card of a kind was shown: LevelTutorialProps. */
  'level_tutorial',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

/**
 * When each event came (1: before 1.0.2; 2: staged practice). The app sends one generation per batch, so a
 * server that does not know the newer names refuses only the batch that has them, and the older events still
 * get through (spec §22, compatibility).
 */
export const TELEMETRY_EVENT_GENERATION: Readonly<Record<TelemetryEventName, 1 | 2>> = {
  app_open: 1,
  screen_view: 1,
  register_step: 1,
  register_complete: 1,
  game_start: 1,
  game_end: 1,
  interference_sent: 1,
  reaction_sent: 1,
  matchmaking_wait: 1,
  reconnect: 1,
  latency_sample: 1,
  replay_open: 1,
  account_delete: 1,
  report_sent: 1,
  level_map_open: 2,
  level_start: 2,
  level_end: 2,
  level_quit: 2,
  chapter_gate: 2,
  level_tutorial: 2,
};

// ---------------------------------------------------------------------------------------------------------
// Staged practice's events (1.0.2, spec §5.3, §22)

/**
 * The props of the six level events. The server checks each one (ranges, kinds) and lets an extra key through,
 * so the next app version can add a prop without losing batches. Rules for every prop:
 * - `level` is the level's number (1 … the server's maxLevel), never its id: the app's own filter before
 *   Google Analytics (apps/mobile/src/services/ga4.ts, PERSONAL_KEY) drops every key that ends in "id", and
 *   keys with name, user, device or install in them.
 * - Flat values only (TelemetryProps); booleans stay booleans; numbers are whole (ms too), but `metric`.
 * - A bad prop refuses the whole batch (400): build them with the types below.
 * - `kind` is checked against the server's LEVEL_KINDS, so a kind it does not know refuses the whole batch: a
 *   server that knows a new kind goes live before the app that sends it (1.0.3: puzzle, fillRow, fillCol).
 */

export { LEVEL_END_REASONS, type LevelEndReason } from '@sudoku-fight/engine';

/** `level_tutorial.kind`: a kind's card, or the boss's (a boss has its own "איך משחקים"). */
export type LevelTutorialKind = LevelKind | 'boss';

/** level_map_open: where the map opened. */
export interface LevelMapOpenProps {
  /** The current level (the map's current node). */
  level: number;
  /** All my best stars (0 … 3 × the levels). */
  stars: number;
}

/**
 * level_start: one per start, when the level's clock starts.
 *
 * `rev` (1.0.3) [D73], on level_start, level_end and level_quit: the level's rev in the app's levels.json (a
 * whole number ≥ 1), so the admin site can keep a rebuilt level's plays apart from the old rev's. Optional,
 * and never null: an app before 1.0.3 sends none, and every server takes the key (a server before 1.0.3 lets
 * an extra key through; since 1.0.3 it checks it). An event without `rev` is a 1.0.2 app's, whose levels were
 * all at rev 1.
 */
export interface LevelStartProps {
  level: number;
  /** The level's rev (1.0.3) [D73]; absent from an app before it. */
  rev?: number;
  /** 1 … LEVEL_RULES.chapterCount. */
  chapter: number;
  kind: LevelKind;
  /** This attempt's number: the plays so far + 1. */
  attempt: number;
  /** The best stars before it. */
  bestStars: Stars;
  /** Started by "לשלב הבא", straight from a result (the quick entry). */
  quick: boolean;
}

/** level_end: the end of an attempt, as the engine's levelOutcome reads it. */
export interface LevelEndProps {
  level: number;
  /** The level's rev (1.0.3) [D73], as in level_start; absent from an app before it. */
  rev?: number;
  kind: LevelKind;
  stars: Stars;
  /** The best stars before this attempt. */
  prevBest: Stars;
  /** The level clock at the end (levelOutcome's elapsedMs: penalties in, a background freeze out). */
  durationMs: number;
  reason: LevelEndReason;
  /** My mistakes: wrong digits, wrong taps' penalties, or a puzzle's wrong swaps [D70c]. */
  mistakes: number;
  /** The kind's measure (the engine's LEVEL_METRIC; a duel's lead may be below 0), or null when it has none. */
  metric: number | null;
  /** The bot's level (1–5), or null in a level without a bot. */
  botLevel: BotLevelId | null;
  attempt: number;
}

/** level_quit: an attempt left without an end (it does not count as played). */
export interface LevelQuitProps {
  level: number;
  /** The level's rev (1.0.3) [D73], as in level_start; absent from an app before it. */
  rev?: number;
  /** The level clock when it was left. */
  atMs: number;
}

/**
 * chapter_gate: after each end of a level of chapter k once its boss was played (that end included), while
 * the gate to k + 1 was still closed.
 */
export interface ChapterGateProps {
  /** The chapter behind the gate, k + 1 (2 … LEVEL_RULES.chapterCount). */
  chapter: number;
  /** The best stars of chapter k now (0 … 3 × chapterSize). */
  stars: number;
  /** The gate opened with this end. */
  open: boolean;
}

/** level_tutorial: "איך משחקים" was shown before the first level of a kind (or the first boss). */
export interface LevelTutorialProps {
  kind: LevelTutorialKind;
  /** "דלג" instead of going through it. */
  skipped: boolean;
}

/** The props of each level event, by name. */
export interface LevelEventProps {
  level_map_open: LevelMapOpenProps;
  level_start: LevelStartProps;
  level_end: LevelEndProps;
  level_quit: LevelQuitProps;
  chapter_gate: ChapterGateProps;
  level_tutorial: LevelTutorialProps;
}

/** Flat values only; keys up to 64 characters, at most MAX_PROPS_BYTES of JSON in all. */
export type TelemetryProps = Record<string, string | number | boolean | null>;

export interface TelemetryEvent {
  /** A UUID made on the phone; the server ignores an id it already has. */
  id: string;
  name: TelemetryEventName;
  props: TelemetryProps;
  /**
   * The phone's clock, epoch ms (an integer), when it happened. Before 2024, or more than a day ahead of the
   * server's clock, is refused.
   */
  t: number;
}

export interface TelemetryBatch {
  /** A UUID made on first launch and kept on the phone. */
  installId: string;
  platform: Platform;
  /** The app's version, e.g. "0.1.0" (1–32 printable characters). */
  appVersion: string;
  events: TelemetryEvent[];
}

/**
 * The answers to `POST /v1/events`:
 * - 202 TelemetryResponse: stored; drop the batch from the queue.
 * - 400 / 413 TelemetryError: malformed or too big; sending it again won't help, so drop it. (An event of an
 *   unknown name is not a 400 since 1.0.2: it is skipped, and counted in `ignored`.)
 * - 429 TelemetryError: too many batches; keep it and wait `Retry-After` seconds.
 * - 5xx or no answer: keep it and try again later.
 */
export interface TelemetryResponse {
  /** New events stored. */
  accepted: number;
  /** Events already stored (same id). */
  duplicates: number;
  /**
   * Events skipped because this server does not know their name (a newer app): not stored, and sending them
   * again won't help. Only when there were some (and never from a server before 1.0.2, which refuses the batch).
   */
  ignored?: number;
}

export interface TelemetryError {
  error: 'badRequest' | 'tooLarge' | 'tooManyRequests' | 'internal';
  /** For 400: what was wrong, e.g. "events.3.name: Invalid option…". */
  message?: string;
}
