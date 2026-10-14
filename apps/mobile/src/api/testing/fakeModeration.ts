/* Test-only: the game server's report and block routes in memory, with the protocol's rules (moderation.ts). */
import {
  type BlockedPlayer,
  MAX_BLOCKS,
  type ModerationError,
  type PublicPlayer,
  REPORT_RESPONSE_HOURS,
  type ReportReason,
  REPORTS_PER_HOUR,
} from '@sudoku-fight/protocol';

import { type ModerationApi, ModerationApiError } from '../moderationApi';

const HOUR_MS = 60 * 60 * 1000;

export interface FakeReport {
  id: string;
  reporterId: string;
  playerId: string;
  reason: ReportReason;
  gameId: string | null;
  createdAt: number;
  status: 'open' | 'resolved' | 'dismissed';
}

export interface FakeModeration {
  /** The API as the app calls it, signed in as `me`. */
  api: ModerationApi;
  /** Every call, as "METHOD path". */
  readonly calls: string[];
  readonly reports: FakeReport[];
  /** Who blocked whom: "blocker>blocked". */
  readonly blocks: Map<string, number>;
  /** Players the server knows (their public cards). */
  addPlayer(player: Partial<PublicPlayer> & { id: string }): void;
  /** The next call of `method` fails with this error (once). */
  failNext(method: keyof ModerationApi, error: ModerationApiError): void;
  /** Every call fails with 'network' while on. */
  setOffline(offline: boolean): void;
  setSuspended(on: boolean): void;
  setNow(now: number): void;
  /** The ids I blocked, newest first. */
  blockedBy(id: string): string[];
}

export function publicPlayer(over: Partial<PublicPlayer> & { id: string }): PublicPlayer {
  return {
    displayName: over.id,
    avatarId: 'maya',
    country: 'IL',
    league: null,
    level: 3,
    ...over,
  };
}

export function createFakeModeration({
  me = 'me',
  now: start = 1_760_000_000_000,
}: { me?: string; now?: number } = {}): FakeModeration {
  const calls: string[] = [];
  const reports: FakeReport[] = [];
  const blocks = new Map<string, number>();
  const players = new Map<string, PublicPlayer>([[me, publicPlayer({ id: me })]]);
  const failures = new Map<keyof ModerationApi, ModerationApiError>();
  let offline = false;
  let suspended = false;
  let now = start;
  let nextId = 1;

  const reject = (status: number, body: ModerationError): never => {
    throw new ModerationApiError(body.error, status, body);
  };

  function enter(method: keyof ModerationApi, call: string): void {
    calls.push(call);
    if (offline) throw new ModerationApiError('network');
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  }

  const playerOf = (id: string): PublicPlayer => players.get(id) ?? reject(404, { error: 'notFound' });
  const blockedBy = (id: string) =>
    [...blocks.entries()]
      .filter(([key]) => key.startsWith(`${id}>`))
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key.slice(id.length + 1));
  const cardOf = (id: string): BlockedPlayer => ({ ...playerOf(id), blockedAt: blocks.get(`${me}>${id}`)! });

  const api: ModerationApi = {
    async report({ playerId, reason, gameId }) {
      enter('report', `POST /v1/reports ${playerId} ${reason}`);
      if (suspended) reject(403, { error: 'suspended' });
      if (playerId === me) reject(400, { error: 'self' });
      playerOf(playerId);
      const open = reports.find(
        (r) => r.reporterId === me && r.playerId === playerId && r.reason === reason && r.status === 'open',
      );
      // The server's 409 duplicate, as the app's API hands it on (moderationApi.ts): the same thank-you.
      if (open) return { id: open.id, duplicate: true, respondWithinHours: REPORT_RESPONSE_HOURS };
      const lastHour = reports.filter((r) => r.reporterId === me && r.createdAt > now - HOUR_MS);
      if (lastHour.length >= REPORTS_PER_HOUR) {
        const oldest = Math.min(...lastHour.map((r) => r.createdAt));
        reject(429, { error: 'rateLimited', retryAt: oldest + HOUR_MS });
      }
      const report: FakeReport = {
        id: `report-${nextId++}`,
        reporterId: me,
        playerId,
        reason,
        gameId: gameId ?? null,
        createdAt: now,
        status: 'open',
      };
      reports.push(report);
      return { id: report.id, duplicate: false, respondWithinHours: REPORT_RESPONSE_HOURS };
    },
    async blocks() {
      enter('blocks', 'GET /v1/me/blocks');
      return { blocks: blockedBy(me).map(cardOf), max: MAX_BLOCKS };
    },
    async block(playerId) {
      enter('block', `POST /v1/me/blocks ${playerId}`);
      if (playerId === me) reject(400, { error: 'self' });
      playerOf(playerId);
      const key = `${me}>${playerId}`;
      if (!blocks.has(key)) {
        if (blockedBy(me).length >= MAX_BLOCKS) reject(409, { error: 'limitReached', max: MAX_BLOCKS });
        blocks.set(key, now++);
      }
      return cardOf(playerId);
    },
    async unblock(playerId) {
      enter('unblock', `DELETE /v1/me/blocks/${playerId}`);
      blocks.delete(`${me}>${playerId}`);
    },
  };

  return {
    api,
    calls,
    reports,
    blocks,
    addPlayer: (player) => void players.set(player.id, publicPlayer(player)),
    failNext: (method, error) => void failures.set(method, error),
    setOffline: (on) => {
      offline = on;
    },
    setSuspended: (on) => {
      suspended = on;
    },
    setNow: (t) => {
      now = t;
    },
    blockedBy,
  };
}
