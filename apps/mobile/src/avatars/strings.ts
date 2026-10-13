import {
  AVATAR_KINDS,
  AVATARS,
  EXPRESSION_NAMES,
  EXPRESSIONS,
  KIND_NAMES,
  type Localized,
  MOTION_IDS,
  MOTIONS,
} from '@sudoku-fight/avatars';

/**
 * The `avatars` namespace (i18n/locales/<lang>/avatars.json), built from the package's own { he, en } data:
 * every avatar's name, every kind (one character, and the group), every expression and every motion. The JSON
 * files are generated from this (`npm run avatars:strings -w @sudoku-fight/mobile`) so they live where every
 * other string lives and `npm run i18n:check` sees them; a test fails when they drift from the package.
 * Not imported by the app itself (only by that script and the test).
 */

export type AvatarStringsLanguage = keyof Localized;

export interface AvatarStrings {
  names: Record<string, string>;
  kinds: Record<string, { one: string; many: string }>;
  expressions: Record<string, string>;
  motions: Record<string, string>;
}

export function avatarStrings(lang: AvatarStringsLanguage): AvatarStrings {
  return {
    names: Object.fromEntries(AVATARS.map((a) => [a.id, a.name[lang]])),
    kinds: Object.fromEntries(
      AVATAR_KINDS.map((k) => [k, { one: KIND_NAMES[k].one[lang], many: KIND_NAMES[k].many[lang] }]),
    ),
    expressions: Object.fromEntries(EXPRESSIONS.map((e) => [e, EXPRESSION_NAMES[e][lang]])),
    motions: Object.fromEntries(MOTION_IDS.map((m) => [m, MOTIONS[m].name[lang]])),
  };
}

/** The file's text: two-space JSON and a final newline, as Prettier writes it. */
export const avatarStringsJson = (lang: AvatarStringsLanguage): string =>
  `${JSON.stringify(avatarStrings(lang), null, 2)}\n`;
