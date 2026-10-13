import {
  AVATAR_IDS,
  type AvatarId,
  type CountryCode,
  isCountryCode,
  NO_AVATAR_ID,
  normalizeAvatarId,
} from '@sudoku-fight/protocol';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { deviceCountry } from '../state/profile';

/**
 * Step 1 of the registration, "צור את הלוחם שלך" (spec §3.2): the avatar, the display name and the country
 * the player chose, kept on the phone until the account exists, so step 2 (and a registration resumed after
 * the app was closed, or after the name turned out to be taken) starts from them. Cleared once the profile
 * is on the server, and on sign-out.
 */
export interface RegistrationDraft {
  avatarId: AvatarId;
  displayName: string;
  /** [D21] The phone's region by default; null when it has none (the player picks one). */
  country: CountryCode | null;
  setAvatar: (avatarId: AvatarId) => void;
  setName: (displayName: string) => void;
  setCountry: (country: CountryCode) => void;
  reset: () => void;
}

/** The phone's region as a country the server knows, or null. */
export function defaultCountry(): CountryCode | null {
  const region = deviceCountry();
  return isCountryCode(region) ? region : null;
}

const initial = (): Pick<RegistrationDraft, 'avatarId' | 'displayName' | 'country'> => ({
  avatarId: AVATAR_IDS[0],
  displayName: '',
  country: defaultCountry(),
});

type DraftData = Pick<RegistrationDraft, 'avatarId' | 'displayName' | 'country'>;

function sanitize(saved: unknown): Partial<DraftData> {
  if (typeof saved !== 'object' || saved === null) return {};
  const s = saved as Record<string, unknown>;
  const out: Partial<DraftData> = {};
  // An id of the retired av01–av51 pack reads as its replacement; anything unknown keeps the default.
  const avatarId = normalizeAvatarId(s.avatarId);
  if (avatarId !== NO_AVATAR_ID) out.avatarId = avatarId;
  if (typeof s.displayName === 'string') out.displayName = s.displayName.slice(0, 64);
  if (isCountryCode(s.country)) out.country = s.country;
  return out;
}

export const useRegistrationDraft = create<RegistrationDraft>()(
  persist(
    (set) => ({
      ...initial(),
      setAvatar: (avatarId) => set({ avatarId }),
      setName: (displayName) => set({ displayName }),
      setCountry: (country) => set({ country }),
      reset: () => set(initial()),
    }),
    {
      name: 'registration',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ avatarId, displayName, country }): DraftData => ({ avatarId, displayName, country }),
      merge: (saved, current) => ({ ...current, ...sanitize(saved) }),
    },
  ),
);
