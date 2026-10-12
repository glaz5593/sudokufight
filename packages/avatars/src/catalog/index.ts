/** Every avatar, in the order the picker shows them: people, animals, objects. Ids are unique (index.test.ts). */

import type { AvatarDef, AvatarKind } from '../types';
import { ANIMALS } from './animals';
import { OBJECTS } from './objects';
import { PEOPLE } from './people';

export { ANIMALS, OBJECTS, PEOPLE };

export const AVATARS: readonly AvatarDef[] = [...PEOPLE, ...ANIMALS, ...OBJECTS];

const BY_ID = new Map(AVATARS.map((a) => [a.id, a]));

export function avatarById(id: string): AvatarDef | undefined {
  return BY_ID.get(id);
}

export function avatarsOfKind(kind: AvatarKind): AvatarDef[] {
  return AVATARS.filter((a) => a.kind === kind);
}
