/* global jest */
/**
 * The server's tests start real servers, sockets and PGlite databases: a second or more per test, several while
 * every core is busy (the whole monorepo's run) or on a CI runner's two cores, where Jest's 5 s default fails
 * tests that are only slow. A test that hangs still fails, and the files that play whole games set more.
 * (A per-project setup file: Jest reads testTimeout from the root config only.)
 */
jest.setTimeout(20_000);
