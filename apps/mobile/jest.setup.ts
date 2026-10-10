// Reanimated 4.5 with worklets 0.10 under Jest: the worklets runtime is mocked, then Reanimated's test setup.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
require('react-native-reanimated').setUpTests();

// expo-sqlite's key-value store (settings persistence) kept in memory.
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
    getItemSync: (k: string) => store.get(k) ?? null,
    setItemSync: (k: string, v: string) => void store.set(k, v),
  };
  return { __esModule: true, default: api, Storage: api };
});

jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(() => Promise.resolve()) }));

// The gesture handler's native module doesn't exist under Jest: its own mocks, so screens with gestures (the
// arsenal's drag) render, and tests can drive them (react-native-gesture-handler/jest-utils).
require('react-native-gesture-handler/jestSetup');

// Skia draws natively and its ESM build doesn't load under Jest: the game screen's interference effects draw
// into this stand-in (a test can still mock it its own way).
jest.mock(
  '@shopify/react-native-skia',
  () => jest.requireActual('./src/components/interference/testing/skiaMock').skiaModule,
);
