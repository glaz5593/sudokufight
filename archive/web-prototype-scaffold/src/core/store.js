// Minimal reactive store + the app-wide store.
import { load, save } from './storage.js';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    /** set(patch) shallow-merges; set(fn) receives state and returns a patch. */
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const fn of [...subs]) { try { fn(state); } catch (e) { console.error('[store] subscriber failed', e); } }
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

const STORAGE_KEY = 'sf.v1';
const persisted = load(STORAGE_KEY, {});

/**
 * Default demo profile ("me"). Screens must read the live profile from app.get().profile.
 * ratings: one per game type (Option B — the spec's initial preference). Option A keys
 * (e.g. 'fast-2p') may also appear; read through engine/rating.js ratingKey().
 */
export const DEFAULT_PROFILE = {
  id: 'me',
  name: 'Moshe',
  country: 'IL',
  avatar: 'av07',
  email: 'demo@sudokufight.app',
  ratings: { fast: 1342, normal: 1287, hard: 1198 },
  ratingsA: {},                     // Option A buckets, filled lazily: { 'fast-2p': 1342, … }
  league: 'gold',                   // bronze | silver | gold | diamond | legend
  level: 14, xp: 2380, xpNext: 3000,
  stats: { games: 86, wins: 49, losses: 37, bestStreak: 7, streak: 3, mistakes: 211, correct: 2148, bestMove: 12.5 },
  unlocked: { interferences: ['fireworks', 'cats', 'warp'], reactions: ['😂', '😱', '😎', '🤦', '🔥', '👀'], avatars: [] },
  friends: [],                      // filled by data/mock.js
  createdAt: '2026-03-02',
};

export const app = createStore({
  lang: persisted.lang || 'he',
  session: { loggedIn: persisted.session?.loggedIn ?? true },
  profile: { ...DEFAULT_PROFILE, ...(persisted.profile || {}) },
  settings: { sound: true, haptics: true, reducedMotion: false, ...(persisted.settings || {}) },
  /** Prototype controls (studio panel). These are NOT product settings. */
  proto: {
    turnModel: 'simultaneous',      // 'simultaneous' | 'turns'   (open decision D1)
    online: true,                   // network simulator: false = no internet
    latencyMs: 60,                  // simulated one-way latency
    ratingOption: 'B',              // 'A' | 'B'                  (open decision, spec §6)
    botSpeed: 1,                    // bot think-time multiplier (2 = twice as fast) for demos
    wrongReleasesCell: true,        // open decision D3
    pauseOnDisconnect2p: true,      // open decision D9
    ...(persisted.proto || {}),
  },
});

let saveTimer = 0;
app.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(STORAGE_KEY, { lang: s.lang, session: s.session, profile: s.profile, settings: s.settings, proto: s.proto }), 150);
});

/** Convenience: patch a nested branch. patchApp('settings', {sound:false}) */
export function patchApp(branch, patch) {
  app.set((s) => ({ [branch]: { ...s[branch], ...(typeof patch === 'function' ? patch(s[branch]) : patch) } }));
}
