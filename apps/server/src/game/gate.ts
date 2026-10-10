import type { ClientAction, PlayerId } from '@sudoku-fight/engine';
import { CLIENT_MESSAGE_TYPES, type ClientMessageType } from '@sudoku-fight/protocol';
import { z } from 'zod';

import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';

/**
 * Everything a client sends passes here before the engine sees it (spec §21):
 *
 * 1. The type must be one of CLIENT_MESSAGE_TYPES and the payload must have exactly its shape (numbers that
 *    are integers, short strings, no extra keys). Ranges (a cell 0–80, a digit 1–9, a known kind or emoji)
 *    are the engine's to check, so the client gets the engine's reason (badCell, badDigit, badKind…).
 * 2. A rate limit per player and per message type (token buckets: a burst, refilled evenly). Over the limit
 *    the message is dropped without an answer.
 * 3. clientSeq must be above the last one this connection used (gaps are fine): a duplicate or an old one is
 *    dropped without an answer, since the first copy already got one. A reconnection keeps the count; a
 *    fresh join (newSession) starts it over.
 *
 * Malformed messages and messages over a limit are violations; too many of them in a window (abuseLimit)
 * and admit() says to disconnect the client.
 */

export type MessageLimits = Record<ClientMessageType, RateLimitRule>;

/** Generous for a person, tight for a script. `react` is also limited by the engine (one per 2 s, D19). */
export const DEFAULT_MESSAGE_LIMITS: MessageLimits = {
  select: { limit: 10, windowMs: 1000 },
  release: { limit: 10, windowMs: 1000 },
  place: { limit: 5, windowMs: 1000 },
  interfere: { limit: 3, windowMs: 1000 },
  react: { limit: 2, windowMs: 2000 },
  surrender: { limit: 2, windowMs: 1000 },
  // 2 a second, with a burst of 5 for a quick clock sync.
  ping: { limit: 5, windowMs: 2500 },
};

/** More violations than this in the window: the client is disconnected. */
export const DEFAULT_ABUSE_LIMIT: RateLimitRule = { limit: 20, windowMs: 10_000 };

export type DropReason =
  /** Not a client message type. */
  | 'unknownType'
  /** The payload does not have the type's shape. */
  | 'malformed'
  /** Over the type's rate limit. */
  | 'rateLimited'
  /** clientSeq not above the last one. */
  | 'duplicate';

export type Admission =
  | { kind: 'ping'; t: number }
  | { kind: 'action'; clientSeq: number; action: ClientAction }
  | {
      kind: 'dropped';
      reason: DropReason;
      /** The message's clientSeq when it had a readable one, so a malformed action can be answered. */
      clientSeq: number | null;
      /** Too many violations: disconnect the client. */
      kick: boolean;
    };

const clientSeq = z.int().positive();
/** The `type` inside the payload is optional; when present it must agree with the message type. */
const typeField = <T extends ClientMessageType>(type: T) => z.literal(type).optional();

const SHAPES = {
  select: z.strictObject({ type: typeField('select'), clientSeq, cell: z.int() }),
  release: z.strictObject({ type: typeField('release'), clientSeq }),
  place: z.strictObject({ type: typeField('place'), clientSeq, cell: z.int(), digit: z.int() }),
  interfere: z.strictObject({
    type: typeField('interfere'),
    clientSeq,
    targetId: z.string().max(64),
    kind: z.string().max(32),
  }),
  react: z.strictObject({ type: typeField('react'), clientSeq, emoji: z.string().max(16) }),
  surrender: z.strictObject({ type: typeField('surrender'), clientSeq }),
  ping: z.strictObject({ type: typeField('ping'), t: z.number() }),
} satisfies Record<ClientMessageType, z.ZodType>;

const isClientMessageType = (type: unknown): type is ClientMessageType =>
  typeof type === 'string' && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);

type Parsed = { kind: 'ping'; t: number } | { kind: 'action'; clientSeq: number; action: ClientAction };

/** The message as the engine takes it, or null when the payload does not have the type's shape. */
export function parseClientMessage(type: ClientMessageType, payload: unknown): Parsed | null {
  switch (type) {
    case 'ping': {
      const r = SHAPES.ping.safeParse(payload);
      return r.success ? { kind: 'ping', t: r.data.t } : null;
    }
    case 'select': {
      const r = SHAPES.select.safeParse(payload);
      return r.success ? act(r.data.clientSeq, { type, cell: r.data.cell }) : null;
    }
    case 'release': {
      const r = SHAPES.release.safeParse(payload);
      return r.success ? act(r.data.clientSeq, { type }) : null;
    }
    case 'place': {
      const r = SHAPES.place.safeParse(payload);
      // The engine checks the digit (badDigit); the type says Digit, the wire says number.
      return r.success
        ? act(r.data.clientSeq, { type, cell: r.data.cell, digit: r.data.digit } as ClientAction)
        : null;
    }
    case 'interfere': {
      const r = SHAPES.interfere.safeParse(payload);
      // The engine checks the kind (badKind).
      return r.success
        ? act(r.data.clientSeq, { type, targetId: r.data.targetId, kind: r.data.kind } as ClientAction)
        : null;
    }
    case 'react': {
      const r = SHAPES.react.safeParse(payload);
      return r.success ? act(r.data.clientSeq, { type, emoji: r.data.emoji }) : null;
    }
    case 'surrender': {
      const r = SHAPES.surrender.safeParse(payload);
      return r.success ? act(r.data.clientSeq, { type }) : null;
    }
  }
}

const act = (seq: number, action: ClientAction): Parsed => ({ kind: 'action', clientSeq: seq, action });

/** A clientSeq that can be read from any payload, for answering a malformed action. */
function readClientSeq(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const seq = (payload as Record<string, unknown>).clientSeq;
  return clientSeq.safeParse(seq).success ? (seq as number) : null;
}

export interface MessageGateOptions {
  /** The clock of the rate limits (epoch ms). */
  now: () => number;
  limits?: MessageLimits;
  abuseLimit?: RateLimitRule;
}

export class MessageGate {
  private readonly limiters: Map<ClientMessageType, RateLimiter>;
  private readonly abuse: RateLimiter;
  private readonly lastSeq = new Map<PlayerId, number>();

  constructor({
    now,
    limits = DEFAULT_MESSAGE_LIMITS,
    abuseLimit = DEFAULT_ABUSE_LIMIT,
  }: MessageGateOptions) {
    // One gate per room, and a room has at most 4 players.
    const maxKeys = 8;
    this.limiters = new Map(
      CLIENT_MESSAGE_TYPES.map((type) => [type, new RateLimiter({ ...limits[type], now, maxKeys })]),
    );
    this.abuse = new RateLimiter({ ...abuseLimit, now, maxKeys });
  }

  /** A message from this player's connection: what to do with it. */
  admit(playerId: PlayerId, type: unknown, payload: unknown): Admission {
    if (!isClientMessageType(type)) return this.violation(playerId, 'unknownType', null);
    const parsed = parseClientMessage(type, payload);
    if (parsed === null) return this.violation(playerId, 'malformed', readClientSeq(payload));
    const seq = parsed.kind === 'action' ? parsed.clientSeq : null;
    if (!this.limiters.get(type)!.take(playerId).ok) return this.violation(playerId, 'rateLimited', seq);
    if (parsed.kind === 'ping') return parsed;

    const last = this.lastSeq.get(playerId) ?? 0;
    if (parsed.clientSeq <= last)
      return { kind: 'dropped', reason: 'duplicate', clientSeq: parsed.clientSeq, kick: false };
    this.lastSeq.set(playerId, parsed.clientSeq);
    return parsed;
  }

  /** A fresh join of this player (not a reconnection): its clientSeq count starts over. */
  newSession(playerId: PlayerId): void {
    this.lastSeq.delete(playerId);
  }

  /** The last clientSeq taken from this player, 0 before any. */
  lastClientSeq(playerId: PlayerId): number {
    return this.lastSeq.get(playerId) ?? 0;
  }

  private violation(playerId: PlayerId, reason: DropReason, seq: number | null): Admission {
    const kick = !this.abuse.take(playerId).ok;
    return { kind: 'dropped', reason, clientSeq: seq, kick };
  }
}
