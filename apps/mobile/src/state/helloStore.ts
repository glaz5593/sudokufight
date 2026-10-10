import { create } from 'zustand';

/** Stage 0 only: proves Zustand is wired. Real stores arrive with the screens. */
interface HelloState {
  taps: number;
  tap: () => void;
}

export const useHelloStore = create<HelloState>((set) => ({
  taps: 0,
  tap: () => set((s) => ({ taps: s.taps + 1 })),
}));
