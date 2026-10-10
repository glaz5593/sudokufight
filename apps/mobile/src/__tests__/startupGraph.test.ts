import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eagerImports, importChain, importGraph, REPO_ROOT } from '../testing/importGraph';

/**
 * What runs before the first screen (spec §22: open in under 2 s; work plan stage 13, docs/PERF.md): the root
 * layout and Home, and everything they import. Expo Router loads every other route when it is first shown,
 * so what only some screens use stays out of the start, as long as nothing on this path imports it. A
 * require() inside a function is lazy (it runs when called) and is not followed.
 */
const STARTUP = importGraph(['app/_layout.tsx', 'app/index.tsx']);

/** Heavy packages the first screen doesn't need, and what loads them later. */
const LATE_PACKAGES: Record<string, string> = {
  '@shopify/react-native-skia': "the interferences' effects (the game screen)",
  '@colyseus/sdk': 'an online game or matchmaking (net/device, net/matchmakingDevice, required lazily)',
  '@colyseus/schema': 'an online game',
  '@react-native-firebase/auth': 'the Firebase provider, required on first use',
  '@react-native-firebase/crashlytics': 'the crash reporter, required on first use',
};

/** App files the first screen doesn't need (prefixes, repo-relative). */
const LATE_FILES: Record<string, string> = {
  'apps/mobile/src/game/data/offline-puzzles.json': "300 KB of puzzles: a practice's start (offlinePool)",
  'apps/mobile/src/components/interference/': 'Skia effects: the game screen',
  'apps/mobile/src/screens/replay/': 'the replay screen',
  'apps/mobile/src/screens/game/GameScreen.tsx': 'the game screen',
  'apps/mobile/src/components/dev/': 'the design system (development builds only)',
  'apps/mobile/src/screens/DesignSystemScreen.tsx': 'development builds only',
  'apps/mobile/src/screens/HelloScreen.tsx': 'development builds only',
  'apps/mobile/src/net/device.ts': 'an online game',
  'apps/mobile/src/net/onlineClient.ts': 'an online game',
  'apps/mobile/src/screens/home/SettingsScreen.tsx':
    'the settings (Home imports its own file, not the barrel)',
  'apps/mobile/src/screens/home/ModesScreen.tsx': 'the modes screen',
  'apps/mobile/src/screens/home/GameTypeScreen.tsx': 'the game-type screen',
  'apps/mobile/src/screens/home/BotSelectScreen.tsx': 'the bot selection',
};

describe('the start: what the first screen loads (spec §22)', () => {
  it.each(Object.entries(LATE_PACKAGES))('leaves %s for later (%s)', (pkg) => {
    expect(STARTUP.packages.has(pkg) ? importChain(STARTUP, pkg) : null).toBeNull();
  });

  it.each(Object.entries(LATE_FILES))('leaves %s for later (%s)', (prefix) => {
    const reached = [...STARTUP.files.keys()].filter((f) => f.startsWith(prefix));
    expect(reached.map((f) => importChain(STARTUP, f))).toEqual([]);
  });

  it('still loads what the first screen needs (the graph is followed at all)', () => {
    expect(STARTUP.files.has('apps/mobile/src/screens/home/HomeScreen.tsx')).toBe(true);
    expect(STARTUP.files.has('apps/mobile/src/i18n/index.ts')).toBe(true);
    expect(STARTUP.packages.has('expo-router')).toBe(true);
    expect(STARTUP.packages.has('expo-font')).toBe(true);
    // …and what a later screen needs shows up from that screen.
    expect(importGraph(['app/game.tsx']).packages.has('@shopify/react-native-skia')).toBe(true);
  });

  it('the dev routes require their screens only behind __DEV__, so release bundles drop them', () => {
    for (const route of ['design-system', 'hello']) {
      const file = join(REPO_ROOT, 'apps', 'mobile', 'app', 'dev', `${route}.tsx`);
      const text = readFileSync(file, 'utf8');
      // No static import of a screen: only `__DEV__ ? require(...) : null`.
      expect(eagerImports(file).filter((s) => s.includes('/screens/'))).toHaveLength(1);
      expect(text).not.toMatch(/^import .*\/screens\//m);
      expect(text).toMatch(/= __DEV__\s*\?[\s\S]*require\('\.\.\/\.\.\/src\/screens\//);
    }
  });
});

describe('the offline puzzles (spec §16.1) load on first use', () => {
  it('importing the pool reads nothing; the first lookup reads the file once', () => {
    jest.isolateModules(() => {
      const read = jest.fn();
      jest.doMock('../game/data/offline-puzzles.json', () => {
        read();
        return [{ id: 'p1', givens: '0'.repeat(81), solution: '1'.repeat(81), gameType: 'fast' }];
      });
      const pool = jest.requireActual<typeof import('../game/offlinePool')>('../game/offlinePool');
      expect(read).not.toHaveBeenCalled();
      expect(pool.poolIds('fast')).toEqual(['p1']);
      expect(pool.puzzleById('p1')?.gameType).toBe('fast');
      expect(pool.allOfflinePuzzles()).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});
