/**
 * Test-only: the phone runs the app on Hermes, Jest runs it on Node, and Node has globals that Hermes (on
 * Android) does not. A test that takes them away before the app's modules load runs them the way the phone
 * does: a module or a screen that reaches for one of these fails here too, instead of only on a device (as
 * @colyseus/schema's FinalizationRegistry did: services/hermesPolyfills.ts). See ./asOnHermes.ts.
 *
 * - FinalizationRegistry, WeakRef: the app installs stand-ins (hermesPolyfills.ts, first in app/_layout.tsx).
 * - structuredClone: not in Hermes.
 * - Intl: Hermes on Android has Collator, DateTimeFormat and NumberFormat (and getCanonicalLocales); the rest is
 *   taken away, PluralRules and DisplayNames (country names) included.
 * - Intl.PluralRules: the phone always runs on the app's own (services/pluralRules.ts, which hermesPolyfills.ts
 *   installs before anything else, even over an engine's own), so after taking Node's away this puts the app's in
 *   its place, the way the phone has it. `{ appPluralRules: false }` leaves none, as before the app had its own:
 *   i18next then falls back to one/other (Hebrew's "two" never showed; localization plan 0ג).
 */
import { installPluralRules } from '../services/pluralRules';

export const HERMES_MISSING_GLOBALS = ['FinalizationRegistry', 'WeakRef', 'structuredClone'] as const;

export const HERMES_MISSING_INTL = [
  'DisplayNames',
  'PluralRules',
  'RelativeTimeFormat',
  'ListFormat',
  'Locale',
  'Segmenter',
  'DurationFormat',
] as const;

export interface WithoutNodeGlobals {
  /** Puts Node's globals back (afterAll). */
  restore(): void;
  /** Node's own values that are still (or again) there: none, as long as nothing put them back. */
  nodeGlobalsLeft(): string[];
}

export interface HermesOptions {
  /** The app's own Intl.PluralRules in place of Node's, as on the phone (default true). */
  appPluralRules?: boolean;
}

/** Takes the globals Hermes lacks away from this test's environment. */
export function takeAwayHermesMissingGlobals({
  appPluralRules = true,
}: HermesOptions = {}): WithoutNodeGlobals {
  const saved: {
    owner: object;
    key: string;
    name: string;
    descriptor: PropertyDescriptor;
    original: unknown;
  }[] = [];
  const remove = (owner: object, key: string, name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor) return;
    saved.push({ owner, key, name, descriptor, original: (owner as Record<string, unknown>)[key] });
    delete (owner as Record<string, unknown>)[key];
  };
  for (const key of HERMES_MISSING_GLOBALS) remove(globalThis, key, key);
  if (typeof Intl !== 'undefined') for (const key of HERMES_MISSING_INTL) remove(Intl, key, `Intl.${key}`);
  if (appPluralRules) installPluralRules(globalThis);
  return {
    restore() {
      for (const { owner, key, descriptor } of [...saved].reverse())
        Object.defineProperty(owner, key, descriptor);
    },
    nodeGlobalsLeft: () =>
      saved
        .filter(
          ({ owner, key, original }) => key in owner && (owner as Record<string, unknown>)[key] === original,
        )
        .map(({ name }) => name),
  };
}
