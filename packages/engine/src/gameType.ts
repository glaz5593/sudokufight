/** The three game types (spec §5.2): board difficulty and pace together [D5]. */
export const GAME_TYPES = ['fast', 'normal', 'hard'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const isGameType = (v: unknown): v is GameType => GAME_TYPES.includes(v as GameType);
