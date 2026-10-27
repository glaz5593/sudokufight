/**
 * Globals that Hermes (the JS engine on the phone) lacks but a library touches when it loads. Jest runs on Node,
 * which has them, so a missing one only shows on a device: app/_layout.tsx imports this file first.
 *
 * - Intl.PluralRules, first and ALWAYS, even over the engine's own (localization plan 0ג, D123): our own rules for
 *   the app's languages (./pluralRules.ts). Hermes on Android has none, and i18next then knows only one/other (the
 *   Hebrew "two" form never showed); an engine with an older CLDR would pick other forms than the tests check.
 * - FinalizationRegistry: @colyseus/schema creates one at module load, for StateView (a server-side feature the
 *   app never uses). Without it the online code fails to load, and "מצא יריב" crashed the app (Crashlytics,
 *   2026-10-14: "Property 'FinalizationRegistry' doesn't exist"). The stand-in never calls back, which only
 *   skips a clean-up after garbage collection.
 * - WeakRef: the Colyseus SDK and schema use it. Recent Hermes has it; if not, the stand-in keeps a normal
 *   reference, so deref() always answers.
 */
import { installPluralRules } from './pluralRules';

installPluralRules();

type Global = { FinalizationRegistry?: unknown; WeakRef?: unknown };
const g = globalThis as Global;

if (typeof g.FinalizationRegistry !== 'function') {
  g.FinalizationRegistry = class FinalizationRegistry {
    register(): void {
      // No clean-up callbacks without the engine's support.
    }

    unregister(): boolean {
      return false;
    }
  };
}

if (typeof g.WeakRef !== 'function') {
  g.WeakRef = class WeakRef<T extends object> {
    readonly #target: T;

    constructor(target: T) {
      this.#target = target;
    }

    deref(): T {
      return this.#target;
    }
  };
}

export {};
