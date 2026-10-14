import {
  isReportReason,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  PLATFORMS,
  TELEMETRY_EVENT_NAMES,
  type TelemetryBatch,
  type TelemetryProps,
} from '@sudoku-fight/protocol';
import { z } from 'zod';

/**
 * What `POST /v1/events` accepts (spec §27.2): the protocol's TelemetryBatch, checked field by field.
 * Unknown fields are dropped, never stored (a `userId` in the body means nothing: stage 8 takes it from a
 * verified token).
 */

/** Events from before this are refused: the app did not exist, so the phone's clock is wrong. */
export const MIN_EVENT_TIME = Date.UTC(2024, 0, 1);
/** Events further ahead of the server's clock than this are refused. */
export const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;
export const MAX_PROP_KEY_LENGTH = 64;

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

/**
 * Events whose props are fixed, checked one by one: anything else in them is refused. `report_sent` (spec
 * §3.5) carries the reason only, so a report's player or game never lands in the usage data.
 */
const FIXED_PROPS: Partial<Record<(typeof TELEMETRY_EVENT_NAMES)[number], (p: TelemetryProps) => boolean>> = {
  report_sent: (p) => Object.keys(p).length === 1 && isReportReason(p.reason),
};

export const telemetryEventSchema = z
  .object({
    id: uuid,
    name: z.enum(TELEMETRY_EVENT_NAMES, { error: 'unknown event name' }),
    props,
    t: z.number().int(),
  })
  .refine((e) => FIXED_PROPS[e.name]?.(e.props) ?? true, {
    error: 'not the props of this event (report_sent: { reason } only)',
    path: ['props'],
  });

export const telemetryBatchSchema = z.object({
  installId: uuid,
  platform: z.enum(PLATFORMS, { error: `expected one of ${PLATFORMS.join(', ')}` }),
  appVersion: z.string().regex(/^[\x20-\x7e]{1,32}$/, '1–32 printable characters'),
  events: z.array(telemetryEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

// Fails to compile the day this schema and the protocol's TelemetryBatch drift apart.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type _SchemaMatchesProtocol = Assert<Equals<z.infer<typeof telemetryBatchSchema>, TelemetryBatch>>;

export type ParseBatchResult = { ok: true; batch: TelemetryBatch } | { ok: false; message: string };

/** Checks a request body; `message` is short, for the 400 answer. */
export function parseBatch(body: unknown, now: number): ParseBatchResult {
  const parsed = telemetryBatchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { ok: false, message: `${where}${issue?.message ?? 'invalid'}` };
  }
  const batch = parsed.data;
  const late = now + MAX_CLOCK_AHEAD_MS;
  const bad = batch.events.findIndex((e) => e.t < MIN_EVENT_TIME || e.t > late);
  if (bad >= 0) return { ok: false, message: `events.${bad}.t: not between 2024 and a day from now` };
  return { ok: true, batch };
}
