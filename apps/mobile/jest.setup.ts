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

// react-native-svg's SvgXml parses its markup in JS into one native element per shape (an avatar has about 36,
// packages/avatars): under Jest it stays one host element `SvgXml` that keeps its `xml`, so screens full of
// avatars render fast and a test can read what an avatar draws (src/avatars/testing). Everything else is real.
jest.mock('react-native-svg', () => {
  const actual = jest.requireActual<Record<string, unknown>>('react-native-svg');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return { ...actual, __esModule: true, SvgXml: (props: object) => createElement('SvgXml', props) };
});

// Rendering whole screens takes seconds per test (3–4 s for a game screen while every core is busy): Jest's 5 s
// default is too close, more so on a CI runner's two cores. A test that hangs still fails; files that play whole
// games set more with their own jest.setTimeout. (Per project here: Jest reads testTimeout from the root only.)
jest.setTimeout(20_000);
