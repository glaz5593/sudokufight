/**
 * The app's tests (jest-expo). Run from the root with `npm test`, or alone with
 * `npx jest --selectProjects mobile`.
 * Tests live outside app/: every file there becomes a route.
 * No babel.config.js anywhere: jest-expo takes its Babel root from the working directory, so one would apply
 * differently depending on where Jest starts. Expo 57 needs none (it adds the worklets plugin itself).
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'mobile',
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/app/'],
  // The Node scripts' pure parts (scripts/lib/*.mjs, and the monorepo's scripts/lib they import) are ES modules:
  // the server's tests already turn them into CommonJS with this transform (apps/server/jest/script-transform.cjs).
  // Jest merges it with jest-expo's, which only matches .js/.jsx/.ts/.tsx.
  transform: {
    '[\\\\/]scripts[\\\\/]lib[\\\\/][^\\\\/]+\\.mjs$': '<rootDir>/../server/jest/script-transform.cjs',
  },
};
