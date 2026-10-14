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
  /**
   * The sign-in (Firebase uid) whose owner accepted the terms of use and the privacy policy, or null. A Google
   * account signed in from the login screen skips step 2, so step 1 asks for them before it creates the fighter,
   * unless this account accepted them already: at step 2 just before Google's chooser (and the fighter then
   * failed), or in step 1's dialog. Tied to the account, not to the phone: someone else on the same phone, or an
   * attempt that never made an account, accepts nothing for it. (A password account accepted them at step 2,
   * before it was made, so step 1 never asks it.)
   */
  termsAcceptedBy: string | null;
  setAvatar: (avatarId: AvatarId) => void;
  setName: (displayName: string) => void;
  setCountry: (country: CountryCode) => void;
  acceptTermsFor: (uid: string) => void;
  reset: () => void;
}

/** The phone's region as a country the server knows, or null. */
export function defaultCountry(): CountryCode | null {
  const region = deviceCountry();
  return isCountryCode(region) ? region : null;
}

type DraftData = Pick<RegistrationDraft, 'avatarId' | 'displayName' | 'country' | 'termsAcceptedBy'>;

const initial = (): DraftData => ({
  avatarId: AVATAR_IDS[0],
  displayName: '',
  country: defaultCountry(),
  termsAcceptedBy: null,
});

function sanitize(saved: unknown): Partial<DraftData> {
  if (typeof saved !== 'object' || saved === null) return {};
  const s = saved as Record<string, unknown>;
  const out: Partial<DraftData> = {};
  // An id of the retired av01–av51 pack reads as its replacement; anything unknown keeps the default.
  const avatarId = normalizeAvatarId(s.avatarId);
  if (avatarId !== NO_AVATAR_ID) out.avatarId = avatarId;
  if (typeof s.displayName === 'string') out.displayName = s.displayName.slice(0, 64);
  if (isCountryCode(s.country)) out.country = s.country;
  const uid = s.termsAcceptedBy;
  if (typeof uid === 'string' && uid.length > 0 && uid.length <= 128) out.termsAcceptedBy = uid;
  return out;
}

export const useRegistrationDraft = create<RegistrationDraft>()(
  persist(
    (set) => ({
      ...initial(),
      setAvatar: (avatarId) => set({ avatarId }),
      setName: (displayName) => set({ displayName }),
      setCountry: (country) => set({ country }),
      acceptTermsFor: (uid) => set({ termsAcceptedBy: uid }),
      reset: () => set(initial()),
    }),
    {
      name: 'registration',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ avatarId, displayName, country, termsAcceptedBy }): DraftData => ({
        avatarId,
        displayName,
        country,
        termsAcceptedBy,
      }),
      merge: (saved, current) => ({ ...current, ...sanitize(saved) }),
    },
  ),
);
