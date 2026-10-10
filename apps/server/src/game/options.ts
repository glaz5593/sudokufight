import { GAME_TYPES, type GameType } from '@sudoku-fight/engine';
import { type GameRoomRuleOverrides, normalizeRoomCode } from '@sudoku-fight/protocol';
import { z } from 'zod';

import type { NodeEnv } from '../config';

/**
 * The options of `client.create('game', options)` (protocol: GameRoomCreateOptions), checked. Stage 7 has
 * private rooms with a code only, and only outside production (work plan, stage 7); rule overrides (a short
 * grace period for tests) are refused in production too, should rooms ever be created there.
 */

export interface GameRoomSetup {
  /** The code asked for (normalised), or null to draw one. */
  code: string | null;
  gameType: GameType;
  playerCount: number;
  rules: GameRoomRuleOverrides;
  /** A ranked game: rated and stored (stage 9). */
  rated: boolean;
}

export class RoomOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomOptionsError';
  }
}

const ms = (min: number, max: number) => z.int().min(min).max(max);

/** Bounds keep a dev room playable and the engine's timers sane. */
const rulesSchema = z.strictObject({
  graceMs: ms(100, 120_000).optional(),
  thinkTimeMs: ms(500, 120_000).optional(),
  turnPickMs: ms(500, 120_000).optional(),
  turnModel: z.enum(['simultaneous', 'turns']).optional(),
  interferences: z.boolean().optional(),
  interferenceMs: ms(100, 60_000).optional(),
  interferenceImmunityMs: ms(0, 60_000).optional(),
  relockCooldownMs: ms(0, 60_000).optional(),
  reactionCooldownMs: ms(0, 60_000).optional(),
  mistakePenaltyCap: z.int().min(1).max(1024).nullable().optional(),
}) satisfies z.ZodType<GameRoomRuleOverrides>;

// Not strict: the same object carries the creator's join options (devUserId, name).
const createSchema = z.object({
  private: z.literal(true, 'stage 7 has private rooms only: pass private: true (matchmaking is stage 9)'),
  code: z.string().max(32).optional(),
  gameType: z.enum(GAME_TYPES).default('fast'),
  playerCount: z.int().min(2).max(4).default(2),
  rules: rulesSchema.optional(),
  rated: z.boolean().default(false),
});

export function parseCreateOptions(options: unknown, nodeEnv: NodeEnv): GameRoomSetup {
  if (nodeEnv === 'production')
    throw new RoomOptionsError('private rooms with a code exist only outside production (stage 7)');
  const parsed = createSchema.safeParse(options ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'options'}: ${i.message}`);
    throw new RoomOptionsError(issues.join('; '));
  }
  const o = parsed.data;
  let code: string | null = null;
  if (o.code !== undefined) {
    code = normalizeRoomCode(o.code);
    if (code === null) throw new RoomOptionsError('code: 6 characters from the room code alphabet');
  }
  return { code, gameType: o.gameType, playerCount: o.playerCount, rules: o.rules ?? {}, rated: o.rated };
}
