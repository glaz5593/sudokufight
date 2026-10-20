import { BOT_LEVEL_IDS, GAME_TYPES, LEVEL_KINDS, LEVEL_RULES, maxLevel } from '@sudoku-fight/engine';
import {
  FRIENDS_CLOSE_REASONS,
  FRIENDS_JOIN_RESULTS,
  FRIENDS_JOIN_VIAS,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  FRIENDS_OPEN_VIAS,
  FRIENDS_SHARE_BY,
  type FriendsEventProps,
  isReportReason,
  LEVEL_END_REASONS,
  type LevelEventProps,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  PLATFORMS,
  TELEMETRY_EVENT_NAMES,
  type TelemetryBatch,
  type TelemetryEventName,
  type TelemetryProps,
} from '@sudoku-fight/protocol';
import { z } from 'zod';

/**
 * What `POST /v1/events` accepts (spec §27.2): the protocol's TelemetryBatch, checked field by field.
 * Unknown fields are dropped, never stored (a `userId` in the body means nothing: stage 8 takes it from a
 * verified token).
 *
 * An event whose name this server does not know (a newer app's) is skipped, alone, and counted in `ignored`;
 * the rest of the batch is checked and stored as usual (1.0.2: before, the whole batch was a 400, and with it
 * every older event in it). A name that is not a name at all (not a string of 1–64 characters) is still a 400.
 *
 * Some events have their props checked too (EVENT_PROPS): `report_sent` exactly, the six of staged practice
 * and the six of playing with friends (1.0.4, generation 3) by type and range, with an extra key let through
 * (the next app may add one).
 */

/** Events from before this are refused: the app did not exist, so the phone's clock is wrong. */
export const MIN_EVENT_TIME = Date.UTC(2024, 0, 1);
/** Events further ahead of the server's clock than this are refused. */
export const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;
export const MAX_PROP_KEY_LENGTH = 64;
/** The longest event name that is skipped as unknown; anything longer, or not a string, is a 400. */
export const MAX_EVENT_NAME_LENGTH = 64;

/** UUIDs are stored in lower case, so one id in two spellings is still one id. */
const uuid = z.uuid({ error: 'not a UUID' }).transform((s) => s.toLowerCase());

const props = z
  .record(
    z.string().min(1).max(MAX_PROP_KEY_LENGTH),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
    {
      error: 'expected an object of strings, numbers, booleans and nulls',
    },
  )
  .refine((p) => Buffer.byteLength(JSON.stringify(p), 'utf8') <= MAX_PROPS_BYTES, {
    error: `more than ${MAX_PROPS_BYTES} bytes`,
  });

// ---- the props of some events ---------------------------------------------------------------------------

/** A whole number from `min` to `max`. */
const int = (min: number, max: number) => z.number().int().min(min).max(max);
/** A level's number (props use `level`, never an id): 1 … maxLevel(LEVEL_RULES). */
const level = int(1, maxLevel(LEVEL_RULES));
const stars = z.literal([0, 1, 2, 3], { error: 'stars: 0, 1, 2 or 3' });
const kind = z.enum(LEVEL_KINDS, { error: `one of ${LEVEL_KINDS.join(', ')}` });
/** A time in a level: from 0 to a day (a level lasts 30 s; the bound only keeps junk out). */
const ms = int(0, 24 * 3600 * 1000);
/** An attempt's number, a count of mistakes: not past what anyone plays. */
const count = int(0, 1_000_000);
/**
 * A level's rev (1.0.3) [D73]: a whole number from 1, optional (an app before 1.0.3 sends none; its levels
 * were all at rev 1), never null.
 */
const rev = int(1, 1_000_000).optional();

/**
 * Staged practice's events (1.0.2; the protocol's LevelEventProps): every prop of the protocol there, typed
 * and ranged; another key passes, so a later app may add one without its batches being refused.
 *
 * 1.0.3 is additive, so a 1.0.2 app's batches stay valid: the kinds are the engine's LEVEL_KINDS (puzzle,
 * fillRow and fillCol joined them), and level_start, level_end and level_quit may carry `rev`.
 */
const LEVEL_EVENT_PROPS: { [N in keyof LevelEventProps]: z.ZodType<LevelEventProps[N]> } = {
  level_map_open: z.looseObject({ level, stars: int(0, 3 * maxLevel(LEVEL_RULES)) }),
  level_start: z.looseObject({
    level,
    rev,
    chapter: int(1, LEVEL_RULES.chapterCount),
    kind,
    attempt: int(1, 1_000_000),
    bestStars: stars,
    quick: z.boolean(),
  }),
  level_end: z.looseObject({
    level,
    rev,
    kind,
    stars,
    prevBest: stars,
    durationMs: ms,
    reason: z.enum(LEVEL_END_REASONS, { error: `one of ${LEVEL_END_REASONS.join(', ')}` }),
    mistakes: count,
    // A duel's lead may be below 0; null when the end has no measure (a quit, a failure).
    metric: z.number().min(-1_000_000).max(1_000_000).nullable(),
    botLevel: z.literal(BOT_LEVEL_IDS, { error: `1 to ${BOT_LEVEL_IDS.length}, or null` }).nullable(),
    attempt: int(1, 1_000_000),
  }),
  level_quit: z.looseObject({ level, rev, atMs: ms }),
  // The chapter behind the gate: chapter 1 has none in front of it.
  chapter_gate: z.looseObject({
    chapter: int(2, LEVEL_RULES.chapterCount),
    stars: int(0, 3 * LEVEL_RULES.chapterSize),
    open: z.boolean(),
  }),
  level_tutorial: z.looseObject({
    kind: z.enum([...LEVEL_KINDS, 'boss'], { error: `one of ${LEVEL_KINDS.join(', ')}, boss` }),
    skipped: z.boolean(),
  }),
};

/** One of a list; the message says which values there are. */
const oneOf = <const T extends readonly [string, ...string[]]>(list: T) =>
  z.enum(list, { error: `one of ${list.join(', ')}` });

/** Whole seconds a player waited in a room: from 0 to a week (a room has no time limit [D84a]; junk out). */
const waitedSec = int(0, 7 * 24 * 3600);

/**
 * Playing with friends' events (1.0.4, generation 3; the protocol's FriendsEventProps, friends-room.md §7.4):
 * counts, choices and outcomes only, never a code or an id. Each value is checked against the protocol's lists
 * (an app sends nothing else: friendsJoinResultOf() turns any other join outcome into `other`); another key
 * passes, so a later app may add one without its batches being refused. `game_start` and `game_end` carry
 * `friends: true` for a game in a friends room; their props are not checked (generation 1).
 */
const FRIENDS_EVENT_PROPS: { [N in keyof FriendsEventProps]: z.ZodType<FriendsEventProps[N]> } = {
  friends_room_open: z.looseObject({ gameType: oneOf(GAME_TYPES), via: oneOf(FRIENDS_OPEN_VIAS) }),
  friends_room_join: z.looseObject({ via: oneOf(FRIENDS_JOIN_VIAS), result: oneOf(FRIENDS_JOIN_RESULTS) }),
  friends_invite_share: z.looseObject({ by: oneOf(FRIENDS_SHARE_BY) }),
  friends_link_open: z.looseObject({ signedIn: z.boolean() }),
  friends_room_start: z.looseObject({ players: int(FRIENDS_MIN_PLAYERS, FRIENDS_MAX_PLAYERS), waitedSec }),
  // The seats when this player was out: 1 (alone) to 4, this player's included.
  friends_room_close: z.looseObject({
    reason: oneOf(FRIENDS_CLOSE_REASONS),
    players: int(1, FRIENDS_MAX_PLAYERS),
    waitedSec,
  }),
};

/**
 * The events whose props are checked, beyond the flat values every event has. `report_sent` (spec §3.5)
 * carries the reason only, so a report's player or game never lands in the usage data: anything else in it is
 * refused, as a whole. The level events say which prop is wrong.
 */
export const EVENT_PROPS: Partial<Record<TelemetryEventName, z.ZodType>> = {
  report_sent: z.custom<TelemetryProps>(
    (p) =>
      typeof p === 'object' &&
      p !== null &&
      Object.keys(p).length === 1 &&
      isReportReason((p as TelemetryProps).reason),
    { error: 'not the props of this event (report_sent: { reason } only)' },
  ),
  ...LEVEL_EVENT_PROPS,
  ...FRIENDS_EVENT_PROPS,
};

export const telemetryEventSchema = z
  .object({
    id: uuid,
    name: z.enum(TELEMETRY_EVENT_NAMES, { error: 'unknown event name' }),
    props,
    t: z.number().int(),
  })
  .superRefine((e, ctx) => {
    const check = EVENT_PROPS[e.name]?.safeParse(e.props);
    if (check === undefined || check.success) return;
    for (const issue of check.error.issues)
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['props', ...issue.path] });
  });

/** The batch around its events, which are checked one by one (an unknown name is skipped, not refused). */
const envelopeSchema = z.object({
  installId: uuid,
  platform: z.enum(PLATFORMS, { error: `expected one of ${PLATFORMS.join(', ')}` }),
  appVersion: z.string().regex(/^[\x20-\x7e]{1,32}$/, '1–32 printable characters'),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

// Fails to compile the day these schemas and the protocol's TelemetryBatch drift apart.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type CheckedBatch = {
  [K in keyof z.infer<typeof envelopeSchema>]: K extends 'events'
    ? z.infer<typeof telemetryEventSchema>[]
    : z.infer<typeof envelopeSchema>[K];
};
type _SchemaMatchesProtocol = Assert<Equals<CheckedBatch, TelemetryBatch>>;

export type ParseBatchResult =
  | {
      ok: true;
      /** The events of known names only (maybe none). */
      batch: TelemetryBatch;
      /** The events skipped for a name this server does not know. */
      ignored: number;
    }
  | { ok: false; message: string };

const KNOWN_NAMES: ReadonlySet<string> = new Set(TELEMETRY_EVENT_NAMES);

/** A name a newer app may send: a string that could be a name, and not one of ours. */
const isUnknownName = (event: unknown): boolean => {
  if (typeof event !== 'object' || event === null) return false;
  const { name } = event as { name?: unknown };
  return (
    typeof name === 'string' &&
    name.length >= 1 &&
    name.length <= MAX_EVENT_NAME_LENGTH &&
    !KNOWN_NAMES.has(name)
  );
};

function issueMessage(issues: z.ZodError['issues'], prefix: (string | number)[] = []): string {
  const issue = issues[0];
  const path = [...prefix, ...(issue?.path ?? [])];
  const where = path.length > 0 ? `${path.join('.')}: ` : '';
  return `${where}${issue?.message ?? 'invalid'}`;
}

/** Checks a request body; `message` is short, for the 400 answer. */
export function parseBatch(body: unknown, now: number): ParseBatchResult {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) return { ok: false, message: issueMessage(envelope.error.issues) };
  const { events: raw, ...meta } = envelope.data;
  const late = now + MAX_CLOCK_AHEAD_MS;
  const events: TelemetryBatch['events'] = [];
  let ignored = 0;
  for (const [i, value] of raw.entries()) {
    if (isUnknownName(value)) {
      ignored++;
      continue;
    }
    const event = telemetryEventSchema.safeParse(value);
    if (!event.success) return { ok: false, message: issueMessage(event.error.issues, ['events', i]) };
    if (event.data.t < MIN_EVENT_TIME || event.data.t > late)
      return { ok: false, message: `events.${i}.t: not between 2024 and a day from now` };
    events.push(event.data);
  }
  return { ok: true, batch: { ...meta, events }, ignored };
}
