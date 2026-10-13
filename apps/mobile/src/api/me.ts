import { GAME_TYPES, type GameType } from '@sudoku-fight/engine';
import {
  isAvatarId,
  isCountryCode,
  isLegacyAvatarId,
  type Me,
  NO_AVATAR_ID,
  normalizeAvatarId,
  type RatingEntry,
  RENAME_COOLDOWN_MS,
} from '@sudoku-fight/protocol';

import type { KeyValueStore } from '../auth/types';

/**
 * The signed-in player's profile (GET /v1/me) as the app keeps it: checked when it arrives and when it is
 * read back from the phone, and saved after every change, so the app opens on it offline after the first
 * sign-in (D24 is not approved: registration is required, then practice works offline, spec §3.3, §16.1).
 */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

function isRatingEntry(v: unknown): v is RatingEntry {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.key === 'string' &&
    isNum(r.rating) &&
    isNum(r.games) &&
    typeof r.provisional === 'boolean' &&
    isNum(r.peak)
  );
}

/** A Me as the protocol describes it (anything else is refused: an old cache, a proxy's answer…). */
export function isMe(v: unknown): v is Me {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    m.id !== '' &&
    typeof m.displayName === 'string' &&
    (isAvatarId(m.avatarId) || m.avatarId === NO_AVATAR_ID) &&
    (m.country === null || isCountryCode(m.country)) &&
    (m.email === null || typeof m.email === 'string') &&
    typeof m.emailVerified === 'boolean' &&
    isNum(m.createdAt) &&
    isNumOrNull(m.displayNameChangedAt) &&
    isNumOrNull(m.nextRenameAt) &&
    Array.isArray(m.ratings) &&
    m.ratings.every(isRatingEntry)
  );
}

/**
 * A Me from the server or from the phone, or null. An avatar of the retired av01–av51 pack (a profile saved
 * before the pack was replaced, an older server) reads as its replacement (protocol normalizeAvatarId).
 */
export function readMe(v: unknown): Me | null {
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  const current = isLegacyAvatarId(m.avatarId) ? { ...m, avatarId: normalizeAvatarId(m.avatarId) } : m;
  return isMe(current) ? current : null;
}

/**
 * When the name may change again [D20]: the server's nextRenameAt, or 30 days after the last rename when an
 * older server leaves it out. Null: now.
 */
export function nextRenameAt(me: Me, now: number): number | null {
  const next =
    me.nextRenameAt ??
    (me.displayNameChangedAt === null ? null : me.displayNameChangedAt + RENAME_COOLDOWN_MS);
  return next !== null && next > now ? next : null;
}

export const ME_CACHE_KEY = 'account.me';

export interface MeCache {
  /** The saved profile of this sign-in, or null (none, another account's, or unreadable). */
  load(uid: string): Promise<Me | null>;
  save(uid: string, me: Me): Promise<void>;
  clear(): Promise<void>;
}

export function createMeCache(storage: KeyValueStore): MeCache {
  return {
    async load(uid) {
      try {
        const raw = await storage.getItem(ME_CACHE_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw) as { uid?: unknown; me?: unknown };
        return saved.uid === uid ? readMe(saved.me) : null;
      } catch {
        return null;
      }
    },
    async save(uid, me) {
      await storage.setItem(ME_CACHE_KEY, JSON.stringify({ uid, me }));
    },
    async clear() {
      await storage.removeItem(ME_CACHE_KEY);
    },
  };
}

export interface TypeRating {
  rating: number;
  provisional: boolean;
}

/**
 * The player card's three ratings, one per game type (spec §4.3: "3 באפשרות B, או בקיצור באפשרות A").
 * Option B has one key per type ("normal"). Option A has one per type and player count ("normal-3p"); in
 * short, a type shows its best settled rating, or its best provisional one while all are provisional.
 */
export function ratingsByType(ratings: readonly RatingEntry[]): Partial<Record<GameType, TypeRating>> {
  const out: Partial<Record<GameType, TypeRating>> = {};
  for (const type of GAME_TYPES) {
    const mine = ratings.filter((r) => r.key === type || r.key.startsWith(`${type}-`));
    if (mine.length === 0) continue;
    const settled = mine.filter((r) => !r.provisional);
    const pool = settled.length > 0 ? settled : mine;
    const best = Math.max(...pool.map((r) => r.rating));
    out[type] = { rating: best, provisional: settled.length === 0 };
  }
  return out;
}

/** The rating the league follows [D9]: the highest settled one. Null while every key is provisional. */
export function leagueRating(ratings: readonly RatingEntry[]): number | null {
  const settled = ratings.filter((r) => !r.provisional);
  return settled.length === 0 ? null : Math.max(...settled.map((r) => r.rating));
}
