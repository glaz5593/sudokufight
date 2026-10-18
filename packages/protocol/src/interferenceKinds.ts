import { INTERFERENCE_KINDS, type InterferenceKind, LEGACY_INTERFERENCE_KINDS } from '@sudoku-fight/engine';

/**
 * Which interference kinds a room allows when its players' apps differ (spec §7.2, §18) [D47].
 *
 * App 1.0.0 knows three kinds and crashes on any other. So every app says which kinds it can show when it
 * joins (`interferenceKinds` in MatchmakingJoinOptions, and in a private room's create and join options),
 * and a room allows only the kinds every player's app declared: the game's `rules.interferenceKinds`. An
 * app that declares nothing (1.0.0) counts as LEGACY_INTERFERENCE_KINDS. The engine then refuses any other
 * kind with `badKind`, and a new app's picker hides it.
 *
 * The legacy kinds are a floor: every app since 1.0.0 can show them, so a declaration that leaves them out
 * (`[]`, or only unknown strings) can only come from a tampered client, and still counts as them. So one
 * client can't turn interferences off for a whole ranked table (INTERFERENCES_BY_MODE.ranked [D44]).
 *
 * Deploy the server first: until then a new app meets only rooms of the old three, which it can show too.
 * The field only adds, so PROTOCOL_VERSION stays 1.
 */

/** At most this many kinds in a declaration; a longer list counts as none (the legacy three). */
export const MAX_DECLARED_INTERFERENCE_KINDS = 16;
/** At most this many characters in a declared kind; a longer one makes the declaration count as none. */
export const MAX_INTERFERENCE_KIND_LENGTH = 32;

/**
 * A declaration as it came over the wire: the list when it is an array of at most
 * MAX_DECLARED_INTERFERENCE_KINDS strings of at most MAX_INTERFERENCE_KIND_LENGTH characters; undefined
 * (no declaration: the legacy kinds) for anything else. Strings the engine does not know are kept here: a
 * newer app may know kinds this server does not, and roomInterferenceKinds ignores them. A list without the
 * legacy kinds (even `[]`) is kept too: roomInterferenceKinds adds them back (they are a floor).
 */
export function parseDeclaredInterferenceKinds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_DECLARED_INTERFERENCE_KINDS) return undefined;
  const kinds: unknown[] = value;
  return kinds.every((k): k is string => typeof k === 'string' && k.length <= MAX_INTERFERENCE_KIND_LENGTH)
    ? [...kinds]
    : undefined;
}

/**
 * The kinds a room of these players allows [D47]: those in `cap` (by default every kind the engine knows,
 * INTERFERENCE_KINDS) that every player's declaration includes. Every declaration counts as at least
 * LEGACY_INTERFERENCE_KINDS (a floor, so `[]` or a list of junk never empties the room), and a missing one
 * (undefined) as exactly those. Unknown strings are ignored, and the order is `cap`'s (the picker's). Only
 * `cap`, the server's own config, can narrow a room below the legacy kinds; a client's declaration can't.
 */
export function roomInterferenceKinds(
  declared: readonly (readonly unknown[] | undefined)[],
  cap: readonly InterferenceKind[] = INTERFERENCE_KINDS,
): InterferenceKind[] {
  const lists: readonly (readonly unknown[])[] = declared.map((d) =>
    d === undefined ? LEGACY_INTERFERENCE_KINDS : [...LEGACY_INTERFERENCE_KINDS, ...d],
  );
  return cap.filter((kind) => lists.every((list) => list.includes(kind)));
}
