import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { syncSettingsStorage } from './settings';

/**
 * The testing switches a staging build shows in its settings (1.0.2, so Moshe can try staged practice before he
 * decides; config/testing.ts says which builds show them and reads them). Kept on the phone like the settings,
 * apart from them: a production build never shows them and never reads what is kept here.
 */
export interface TestingSwitchesState {
  /** [D64, waiting for Moshe] The next chain stage charges 5 s for a digit that cannot be known yet ('penalty'). */
  chainPenalty: boolean;
  /** Every stage is open on the map (testing only); stars and XP count as usual. */
  unlockAllLevels: boolean;
  setChainPenalty: (on: boolean) => void;
  setUnlockAllLevels: (on: boolean) => void;
}

export const useTestingSwitches = create<TestingSwitchesState>()(
  persist(
    (set) => ({
      chainPenalty: false,
      unlockAllLevels: false,
      setChainPenalty: (chainPenalty) => set({ chainPenalty }),
      setUnlockAllLevels: (unlockAllLevels) => set({ unlockAllLevels }),
    }),
    {
      name: 'testing-switches',
      version: 1,
      storage: createJSONStorage(() => syncSettingsStorage),
      partialize: ({ chainPenalty, unlockAllLevels }) => ({ chainPenalty, unlockAllLevels }),
    },
  ),
);
