/**
 * Test-only, imported FIRST by a test file (before anything of the app): from here on the test runs without the
 * globals Hermes lacks (./hermesGlobals.ts). `onHermes.restore()` puts them back (afterAll).
 */
import { takeAwayHermesMissingGlobals } from './hermesGlobals';

export const onHermes = takeAwayHermesMissingGlobals();
