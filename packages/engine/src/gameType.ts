/**
 * The three game types (spec §5.2): board difficulty (how many givens at the start, DEFAULT_GIVENS, and the
 * techniques the board needs) and pace together [D5, D43].
 */
export const GAME_TYPES = ['fast', 'normal', 'hard'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const isGameType = (v: unknown): v is GameType => GAME_TYPES.includes(v as GameType);
