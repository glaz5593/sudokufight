/**
 * Every avatar. Each catalog file exports one list, and this file only joins them: a new set of characters
 * goes in its own file, and nobody needs to edit this one.
 *
 * The picker groups them by kind, in AVATAR_KINDS order (person, animal, object, food, nature, creature,
 * symbol), and within a kind in the order of CATALOG_FILES and of each file's list. Ids are unique across
 * every file (index.test.ts).
 */

import { AVATAR_KINDS, type AvatarDef, type AvatarKind } from '../types';
import { ANIMALS } from './animals';
import { CREATURES } from './creatures';
import { DIGITS } from './digits';
import { FOOD } from './food';
import { HOME } from './home';
import { NATURE } from './nature';
import { OBJECTS } from './objects';
import { OFFICE } from './office';
import { PEOPLE } from './people';
import { PEOPLE2 } from './people2';
import { PLAY } from './play';
import { SYMBOLS } from './symbols';

export { ANIMALS, CREATURES, DIGITS, FOOD, HOME, NATURE, OBJECTS, OFFICE, PEOPLE, PEOPLE2, PLAY, SYMBOLS };

/** The catalog files' lists, by file name. */
export const CATALOG_FILES: Readonly<Record<string, readonly AvatarDef[]>> = {
  people: PEOPLE,
  people2: PEOPLE2,
  animals: ANIMALS,
  objects: OBJECTS,
  home: HOME,
  office: OFFICE,
  play: PLAY,
  food: FOOD,
  nature: NATURE,
  creatures: CREATURES,
  digits: DIGITS,
  symbols: SYMBOLS,
};

const ALL = Object.values(CATALOG_FILES).flat();

export const AVATARS: readonly AvatarDef[] = AVATAR_KINDS.flatMap((kind) =>
  ALL.filter((a) => a.kind === kind),
);

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]));

export function avatarById(id: string): AvatarDef | undefined {
  return BY_ID.get(id);
}

export function avatarsOfKind(kind: AvatarKind): AvatarDef[] {
  return AVATARS.filter((a) => a.kind === kind);
}
