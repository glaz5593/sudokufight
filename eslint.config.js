// @ts-check
const { defineConfig, globalIgnores } = require('eslint/config');
const { builtinModules } = require('node:module');
const js = require('@eslint/js');
const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');
const globals = require('globals');
// Comes with eslint-config-expo (a root dev dependency); the admin site uses its rules too.
const reactHooks = require('eslint-plugin-react-hooks');

/**
 * One flat config for the monorepo (`npm run lint`): eslint-config-expo for the app, type-aware
 * typescript-eslint for the packages and the server, and the same plus React's hooks rules for the admin site.
 *
 * The engine (packages/engine/src) is pure and deterministic (CLAUDE.md, spec §17): no platform, UI, network
 * or protocol imports, no wall clock, no Math.random, no host timers. Time comes in as `now`, randomness as
 * an Rng. Tests (*.test.ts, src/testing) and scripts are exempt.
 */

const TS_NODE = ['packages/**/*.ts', 'apps/server/**/*.ts'];
const ADMIN = ['apps/admin/**/*.{ts,tsx}'];
const MOBILE = ['apps/mobile/**/*.{js,jsx,ts,tsx}'];
const ENGINE_SRC = ['packages/engine/src/**/*.ts'];
const ENGINE_EXEMPT = ['packages/engine/src/**/*.test.ts', 'packages/engine/src/testing/**'];

const PURE =
  'The engine is pure TypeScript: no platform, UI, network or protocol imports (CLAUDE.md, spec §17).';
const CLOCK =
  'Inject time (now / Clock) and randomness (Rng): the engine never reads the wall clock or Math.random.';

module.exports = defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.expo/',
    'archive/',
    'assets/',
    'assets-src/',
    'docs/',
    'apps/mobile/android/',
    'apps/mobile/ios/',
  ]),

  // ---- the app: Expo's rules (React, hooks with the React Compiler checks, imports) ----
  {
    files: MOBILE,
    extends: [expoConfig],
    rules: {
      // i18next documents the default-import style (i18n.use(...).init(...)).
      'import/no-named-as-default-member': 'off',
    },
    settings: {
      'import/resolver': {
        typescript: { project: ['apps/mobile/tsconfig.json', 'packages/*/tsconfig.src.json'] },
        node: true,
      },
    },
  },

  // ---- packages and server: type-aware TypeScript ----
  {
    files: TS_NODE,
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      // `_name` marks a value that is unused on purpose; rest siblings drop keys from a copy.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  // ---- the admin site (apps/admin): type-aware TypeScript, React hooks rules, browser globals ----
  {
    files: ADMIN,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['apps/admin/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/admin/src/**/*.test.{ts,tsx}', 'apps/admin/src/testing/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Plain JS config files at the root and in the packages run in Node.
    files: [
      '*.{js,cjs,mjs}',
      'packages/**/*.{js,cjs,mjs}',
      'apps/server/**/*.{js,cjs,mjs}',
      'apps/admin/**/*.{js,cjs,mjs}',
    ],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The monorepo's Node scripts (scripts/i18n-check.mjs): ES modules.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    // The app's Node-side config files and the Jest setup.
    files: ['apps/mobile/*.{js,cjs}', 'apps/mobile/jest.setup.ts', 'apps/mobile/src/net/ws-shim.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/server/**/*.ts', 'packages/*/scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.test.ts', '**/testing/**/*.ts'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
    // Jest's asymmetric matchers (expect.any, expect.objectContaining) are typed `any`.
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // ---- packages/engine/src: pure and deterministic ----
  {
    files: ENGINE_SRC,
    ignores: ENGINE_EXEMPT,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.map((name) => ({ name, message: PURE })),
          patterns: [
            {
              group: [
                'node:*',
                'react',
                'react/*',
                'react-*',
                '@react-native/*',
                '@react-native-*/*',
                'expo',
                'expo/*',
                'expo-*',
                '@expo/*',
                'colyseus',
                'colyseus/*',
                'colyseus.js',
                '@colyseus/*',
                '@sudoku-fight/protocol',
                '@sudoku-fight/protocol/*',
                'zustand',
                'zustand/*',
              ],
              message: PURE,
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'setTimeout',
          'setInterval',
          'setImmediate',
          'clearTimeout',
          'clearInterval',
          'clearImmediate',
          'queueMicrotask',
          'requestAnimationFrame',
          'performance',
          'process',
          'require',
          'crypto',
          'global',
          'globalThis',
          'window',
          'self',
          'console',
          // Not in the Hermes VM of React Native 0.86 (the engine also runs on the phone).
          'structuredClone',
        ].map((name) => ({ name, message: `${CLOCK} (no host globals)` })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: CLOCK },
        { object: 'Math', property: 'random', message: CLOCK },
        { object: 'performance', property: 'now', message: CLOCK },
        { property: 'toSorted', message: 'Not in Hermes (React Native 0.86): use slice().sort().' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK },
        { selector: "CallExpression[callee.name='Date']", message: CLOCK },
        { selector: 'ImportExpression', message: `${PURE} (no dynamic import)` },
      ],
    },
  },
]);
