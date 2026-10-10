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
  // SVG avatars are assets for Metro; in tests any number will do.
  moduleNameMapper: { '\\.svg$': '<rootDir>/src/testing/svgStub.js' },
};
