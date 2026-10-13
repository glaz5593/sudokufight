import {
  type BotLevelId,
  GAME_MODES,
  type GameMode,
  type GameType,
  isBotLevelId,
  isGameType,
} from '@sudoku-fight/engine';
import { QUEUE_PLAYER_COUNTS, type QueuePlayerCount } from '@sudoku-fight/protocol';
import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type AvatarIdOrNone, NO_AVATAR_ID, normalizeAvatarId } from '../avatars';

/**
 * The player on this phone, until accounts arrive (work plan stage 8): a local profile for the home screen's
 * player card, the last game setting, for "עוד סיבוב" (spec §4.3), and the bot level chosen last (the bot
 * selection opens on it). Kept in expo-sqlite's key-value store, like the settings, so it survives restarts.
 * The practices themselves live in the practice database [D25].
 */
export interface LastPlay {
  mode: GameMode;
  gameType: GameType;
  /** A practice against a bot: the bot's level (spec §9). */
  botLevel?: BotLevelId;
  /** A ranked game (stage 9): how many players, so "עוד סיבוב" searches the same queue. */
  players?: QueuePlayerCount;
}

export interface ProfileState {
  /** Null until the player chooses one: screens show t('home:profile.defaultName'). */
  name: string | null;
  avatarId: AvatarIdOrNone;
  /** ISO 3166-1 alpha-2. Detected from the phone's region, and can change [D21]. Null: unknown. */
  country: string | null;
  /** The last game the player started, or null before the first one. */
  lastPlay: LastPlay | null;
  /** The bot level of the last practice against a bot, or null before the first one. */
  botLevel: BotLevelId | null;
  setName: (name: string | null) => void;
  setAvatar: (avatarId: AvatarIdOrNone) => void;
  setCountry: (country: string | null) => void;
  /** Remembers a game just started; a bot practice also sets `botLevel`. */
  rememberPlay: (play: LastPlay) => void;
}

const COUNTRY = /^[A-Za-z]{2}$/;

/** The phone's region as a country code ("IL"), or null when it has none. */
export function deviceCountry(): string | null {
  try {
    const region = getLocales()[0]?.regionCode;
    return region && COUNTRY.test(region) ? region.toUpperCase() : null;
  } catch {
    return null;
  }
}

const cleanName = (name: string | null): string | null => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
};

const isPlayerCount = (v: unknown): v is QueuePlayerCount =>
  QUEUE_PLAYER_COUNTS.includes(v as QueuePlayerCount);

const isLastPlay = (v: unknown): v is LastPlay =>
  typeof v === 'object' &&
  v !== null &&
  GAME_MODES.includes((v as LastPlay).mode) &&
  isGameType((v as LastPlay).gameType) &&
  ((v as LastPlay).botLevel === undefined || isBotLevelId((v as LastPlay).botLevel)) &&
  ((v as LastPlay).players === undefined || isPlayerCount((v as LastPlay).players));

/** Only what a LastPlay holds: the level only with a bot, the number of players only when ranked. */
function lastPlayOf({ mode, gameType, botLevel, players }: LastPlay): LastPlay {
  if (mode === 'bot' && botLevel !== undefined) return { mode, gameType, botLevel };
  if (mode === 'ranked' && players !== undefined) return { mode, gameType, players };
  return { mode, gameType };
}

type ProfileData = Pick<ProfileState, 'name' | 'avatarId' | 'country' | 'lastPlay' | 'botLevel'>;

/** What came back from storage, with anything this version does not know dropped. */
function sanitize(saved: unknown): Partial<ProfileData> {
  if (typeof saved !== 'object' || saved === null) return {};
  const s = saved as Record<string, unknown>;
  const out: Partial<ProfileData> = {};
  if (s.name === null || typeof s.name === 'string') out.name = cleanName(s.name);
  // An id of the retired av01–av51 pack reads as its replacement (protocol normalizeAvatarId).
  if (typeof s.avatarId === 'string') out.avatarId = normalizeAvatarId(s.avatarId);
  if (s.country === null || (typeof s.country === 'string' && COUNTRY.test(s.country)))
    out.country = s.country === null ? null : s.country.toUpperCase();
  if (s.lastPlay === null) out.lastPlay = null;
  else if (isLastPlay(s.lastPlay)) out.lastPlay = lastPlayOf(s.lastPlay);
  if (s.botLevel === null || isBotLevelId(s.botLevel)) out.botLevel = s.botLevel;
  return out;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      name: null,
      avatarId: NO_AVATAR_ID,
      country: deviceCountry(),
      lastPlay: null,
      botLevel: null,
      setName: (name) => set({ name: cleanName(name) }),
      setAvatar: (avatarId) => set({ avatarId }),
      setCountry: (country) =>
        set({ country: country && COUNTRY.test(country) ? country.toUpperCase() : null }),
      rememberPlay: (play) => {
        const lastPlay = lastPlayOf(play);
        set(lastPlay.botLevel === undefined ? { lastPlay } : { lastPlay, botLevel: lastPlay.botLevel });
      },
    }),
    {
      name: 'profile',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ name, avatarId, country, lastPlay, botLevel }): ProfileData => ({
        name,
        avatarId,
        country,
        lastPlay,
        botLevel,
      }),
      merge: (saved, current) => ({ ...current, ...sanitize(saved) }),
    },
  ),
);
