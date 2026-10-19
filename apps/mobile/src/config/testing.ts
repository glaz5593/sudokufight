import { LEVEL_RULES, type LevelRules } from '@sudoku-fight/engine';

import { type TestingSwitchesState, useTestingSwitches } from '../state/testingSwitches';
import { serverLabelOf } from './appVersion';
import { serverEndpoint } from './server';

/**
 * The testing switches of a staging build (1.0.2; dev-plan, Moshe's answers of 2026-10-18): the settings' "בדיקה"
 * section, so Moshe can try staged practice before he decides.
 *
 * - "שרשרת: ניחוש עולה 5 ש׳": [D64] is waiting for Moshe, so a chain is built per the original §14
 *   (LEVEL_RULES.chainNotYet 'accept'); the switch plays the next chain stage under the proposal ('penalty').
 * - "פתח את כל השלבים (בדיקה)": every stage open on the map (and "לשלב הבא" past a closed gate), so the later
 *   kinds (the first chain is L085, behind 8 gates) can be tried at once. Stars and XP count as usual.
 *
 * Which builds: a staging build (the server label 'staging': `npm run apk`, eas.json's preview profile), and a
 * development build (Metro) unless it points at production. Never a production build: the section is not
 * shown there, and what the phone kept of the switches is not read (every reader goes through here).
 */

export interface TestingBuildSources {
  /** The server's label (config/appVersion.ts serverLabelOf): 'staging', 'production', 'local' or a host. */
  server: string;
  /** A development build (__DEV__). */
  dev: boolean;
}

/** This build's: its server label, and whether it is a development build. */
export const thisBuild = (): TestingBuildSources => ({
  // By its name: Metro inlines EXPO_PUBLIC_* only when read this way.
  server: serverLabelOf(process.env.EXPO_PUBLIC_SERVER_LABEL, serverEndpoint.hostname),
  dev: __DEV__,
});

/** Does this build show (and read) the testing switches: staging, or a development build not on production. */
export function testingSwitchesAllowed({ server, dev }: TestingBuildSources = thisBuild()): boolean {
  if (server === 'production') return false;
  return server === 'staging' || dev;
}

type Switches = Pick<TestingSwitchesState, 'chainPenalty' | 'unlockAllLevels'>;

/** The switches as the code reads them: all off where they are not allowed. */
export function activeSwitches(
  switches: Switches = useTestingSwitches.getState(),
  build: TestingBuildSources = thisBuild(),
): Switches {
  if (!testingSwitchesAllowed(build)) return { chainPenalty: false, unlockAllLevels: false };
  return { chainPenalty: switches.chainPenalty, unlockAllLevels: switches.unlockAllLevels };
}

/**
 * The stages' rules for an attempt starting now (levels/levelSession.ts): LEVEL_RULES, with a chain's
 * chainNotYet 'penalty' while the staging switch is on [D64]. Read as a stage starts, so flipping the switch
 * changes the next chain stage only.
 */
export function levelRulesNow(switches: Switches = activeSwitches()): LevelRules {
  return switches.chainPenalty ? { ...LEVEL_RULES, chainNotYet: 'penalty' } : LEVEL_RULES;
}

/** "פתח את כל השלבים (בדיקה)", as the map reads it (false where the switches are not allowed). */
export function useUnlockAllLevels(build: TestingBuildSources = thisBuild()): boolean {
  const on = useTestingSwitches((s) => s.unlockAllLevels);
  return on && testingSwitchesAllowed(build);
}
