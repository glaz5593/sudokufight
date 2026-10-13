import {
  AVATAR_KINDS,
  type AvatarDef,
  type AvatarKind,
  avatarById,
  type Expression,
} from '@sudoku-fight/avatars';
import { AVATAR_IDS, type AvatarId, NO_AVATAR_ID, normalizeAvatarId } from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

/**
 * The avatars in the app (spec §3.4): our own characters (packages/avatars), under the ids of the contract
 * (packages/protocol AVATAR_IDS; a test keeps the two lists equal and in the same order). This is the bridge
 * between an id and its character; AvatarArt draws it.
 *
 * Every id read from storage or the network goes through normalizeAvatarId (protocol): a current id stays, an
 * id of the retired av01–av51 pack becomes its replacement, anything else becomes av00 ("no avatar").
 */

export { NO_AVATAR_ID, normalizeAvatarId };

/** The picture a screen holds for a player: one of ours, or av00 (no avatar: a deleted or missing account). */
export type AvatarIdOrNone = AvatarId | typeof NO_AVATAR_ID;

/**
 * The character to draw for an id: null for av00 and for anything that is not ours (the placeholder). An id of
 * the old pack draws its replacement.
 */
export function avatarDef(id: string | null | undefined): AvatarDef | null {
  if (!id) return null;
  return avatarById(normalizeAvatarId(id)) ?? null;
}

/** A kind of character and its avatars, in the picker's order (by kind, then the catalog's). */
export interface AvatarGroup {
  kind: AvatarKind;
  ids: readonly AvatarId[];
}

export const AVATAR_GROUPS: readonly AvatarGroup[] = AVATAR_KINDS.map((kind) => ({
  kind,
  ids: AVATAR_IDS.filter((id) => avatarById(id)?.kind === kind),
})).filter((g) => g.ids.length > 0);

/** The kind of an avatar (the first group for an id that is not ours). */
export function kindOf(id: string | null | undefined): AvatarKind {
  return avatarDef(id)?.kind ?? AVATAR_GROUPS[0]!.kind;
}

/** An avatar's metadata beside its character. */
export interface AvatarMeta {
  /**
   * [D17] The level that opens it (spec §3.4: "פתיחת אווטרים נוספים לפי רמה: התשתית נבנית ב־V1 (שדה
   * unlockLevel), והתוכן מגיע ב־V1.1"). V1: 0 for every avatar, so all are open from the start.
   */
  unlockLevel: number;
}

export const AVATAR_META: Readonly<Record<AvatarId, AvatarMeta>> = Object.fromEntries(
  AVATAR_IDS.map((id) => [id, { unlockLevel: 0 }]),
) as Record<AvatarId, AvatarMeta>;

/** The level that opens `id` (0: open from the start). */
export const avatarUnlockLevel = (
  id: AvatarId,
  meta: Readonly<Record<string, AvatarMeta>> = AVATAR_META,
): number => meta[id]?.unlockLevel ?? 0;

/**
 * An avatar's name in the language shown ("שועל", "Fox"), from the `avatars` namespace (its strings come from
 * the package's data: scripts/gen-avatar-strings.ts). Null for av00 and for an id that is not ours.
 */
export function avatarName(t: TFunction<'avatars'>, id: string | null | undefined): string | null {
  const def = avatarDef(id);
  return def ? t(`names.${def.id}`) : null;
}

/** An expression's name ("חיוך", "Smile"). */
export const expressionName = (t: TFunction<'avatars'>, e: Expression): string => t(`expressions.${e}`);
