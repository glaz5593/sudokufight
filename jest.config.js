/**
 * One Jest run for the whole monorepo: a project per workspace (`npm test` at the root).
 * One workspace only: `npx jest --selectProjects engine`.
 *
 * ts-jest runs transpile-only (verbatimModuleSyntax implies isolatedModules), so type errors are caught by
 * `npm run typecheck`, not here.
 */

/** @returns {import('jest').Config} */
const tsProject = (name, dir, tsconfig) => ({
  displayName: name,
  rootDir: `<rootDir>/${dir}`,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/test/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: `<rootDir>/${tsconfig}` }] },
});

const server = tsProject('server', 'apps/server', 'tsconfig.jest.json');
// rou3 (@colyseus/core → better-call) is ESM-only and Jest 29 runs CommonJS: let ts-jest down-level it.
server.transform['^.+\\.mjs$'] = ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }];
// PGlite (the in-process Postgres for tests) loads Node built-ins with a dynamic import(), which Jest's VM
// refuses without --experimental-vm-modules: a tiny transform turns those into module.require().
server.transform['^.+[\\\\/]@electric-sql[\\\\/]pglite[\\\\/].+\\.cjs$'] =
  '<rootDir>/jest/pglite-transform.cjs';
// jose (Firebase ID token checks, stage 8) is ESM-only (.js with "type": "module"): ts-jest down-levels it too.
server.transform['^.+[\\\\/]node_modules[\\\\/]jose[\\\\/].+\\.js$'] = [
  'ts-jest',
  { tsconfig: '<rootDir>/tsconfig.jest.json' },
];
server.transformIgnorePatterns = ['/node_modules/(?!(rou3|@electric-sql/pglite|jose)/)'];

const engine = tsProject('engine', 'packages/engine', 'tsconfig.test.json');
// `npm run test:coverage`: the engine's own code, not its tests or test helpers.
engine.collectCoverageFrom = ['src/**/*.ts', '!**/*.test.ts', '!**/testing/**', '!**/index.ts'];

// The admin site (Vite + React): jsdom, .tsx through ts-jest, CSS imports to a stub. Fetch is mocked per test.
const admin = tsProject('admin', 'apps/admin', 'tsconfig.jest.json');
admin.testEnvironment = 'jsdom';
admin.testEnvironmentOptions = { url: 'http://localhost/admin/' };
admin.testMatch = ['<rootDir>/src/**/*.test.{ts,tsx}'];
admin.moduleFileExtensions = ['tsx', 'ts', 'js', 'mjs', 'json'];
admin.transform = { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }] };
admin.moduleNameMapper = { '\\.css$': '<rootDir>/jest/style-stub.cjs' };

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    engine,
    tsProject('protocol', 'packages/protocol', 'tsconfig.test.json'),
    server,
    admin,
    // jest-expo, configured in apps/mobile/jest.config.js
    '<rootDir>/apps/mobile',
  ],
};
