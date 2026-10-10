// The avatar catalog (spec §3.4): av01–av51 without av36, and av00 for "no avatar". Files: assets/avatars.
// Generated list; keep requires static so Metro bundles them.
export const AVATARS = {
  av00: require('../../../../assets/avatars/av00.svg') as number,
  av01: require('../../../../assets/avatars/av01.svg') as number,
  av02: require('../../../../assets/avatars/av02.svg') as number,
  av03: require('../../../../assets/avatars/av03.svg') as number,
  av04: require('../../../../assets/avatars/av04.svg') as number,
  av05: require('../../../../assets/avatars/av05.svg') as number,
  av06: require('../../../../assets/avatars/av06.svg') as number,
  av07: require('../../../../assets/avatars/av07.svg') as number,
  av08: require('../../../../assets/avatars/av08.svg') as number,
  av09: require('../../../../assets/avatars/av09.svg') as number,
  av10: require('../../../../assets/avatars/av10.svg') as number,
  av11: require('../../../../assets/avatars/av11.svg') as number,
  av12: require('../../../../assets/avatars/av12.svg') as number,
  av13: require('../../../../assets/avatars/av13.svg') as number,
  av14: require('../../../../assets/avatars/av14.svg') as number,
  av15: require('../../../../assets/avatars/av15.svg') as number,
  av16: require('../../../../assets/avatars/av16.svg') as number,
  av17: require('../../../../assets/avatars/av17.svg') as number,
  av18: require('../../../../assets/avatars/av18.svg') as number,
  av19: require('../../../../assets/avatars/av19.svg') as number,
  av20: require('../../../../assets/avatars/av20.svg') as number,
  av21: require('../../../../assets/avatars/av21.svg') as number,
  av22: require('../../../../assets/avatars/av22.svg') as number,
  av23: require('../../../../assets/avatars/av23.svg') as number,
  av24: require('../../../../assets/avatars/av24.svg') as number,
  av25: require('../../../../assets/avatars/av25.svg') as number,
  av26: require('../../../../assets/avatars/av26.svg') as number,
  av27: require('../../../../assets/avatars/av27.svg') as number,
  av28: require('../../../../assets/avatars/av28.svg') as number,
  av29: require('../../../../assets/avatars/av29.svg') as number,
  av30: require('../../../../assets/avatars/av30.svg') as number,
  av31: require('../../../../assets/avatars/av31.svg') as number,
  av32: require('../../../../assets/avatars/av32.svg') as number,
  av33: require('../../../../assets/avatars/av33.svg') as number,
  av34: require('../../../../assets/avatars/av34.svg') as number,
  av35: require('../../../../assets/avatars/av35.svg') as number,
  av37: require('../../../../assets/avatars/av37.svg') as number,
  av38: require('../../../../assets/avatars/av38.svg') as number,
  av39: require('../../../../assets/avatars/av39.svg') as number,
  av40: require('../../../../assets/avatars/av40.svg') as number,
  av41: require('../../../../assets/avatars/av41.svg') as number,
  av42: require('../../../../assets/avatars/av42.svg') as number,
  av43: require('../../../../assets/avatars/av43.svg') as number,
  av44: require('../../../../assets/avatars/av44.svg') as number,
  av45: require('../../../../assets/avatars/av45.svg') as number,
  av46: require('../../../../assets/avatars/av46.svg') as number,
  av47: require('../../../../assets/avatars/av47.svg') as number,
  av48: require('../../../../assets/avatars/av48.svg') as number,
  av49: require('../../../../assets/avatars/av49.svg') as number,
  av50: require('../../../../assets/avatars/av50.svg') as number,
  av51: require('../../../../assets/avatars/av51.svg') as number,
} as const;

export type AvatarId = keyof typeof AVATARS;

export const EMPTY_AVATAR: AvatarId = 'av00';

/** The avatars a player can pick (all but the empty one). */
export const PICKABLE_AVATARS = (Object.keys(AVATARS) as AvatarId[]).filter((id) => id !== EMPTY_AVATAR);

export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && v in AVATARS;

/** An avatar's metadata beside its file. */
export interface AvatarMeta {
  /**
   * [D17] The level that opens it (spec §3.4: "פתיחת אווטרים נוספים לפי רמה: התשתית נבנית ב־V1 (שדה
   * unlockLevel), והתוכן מגיע ב־V1.1"). V1: 0 for every avatar, so all are open from the start.
   */
  unlockLevel: number;
}

export const AVATAR_META: Readonly<Record<AvatarId, AvatarMeta>> = Object.fromEntries(
  (Object.keys(AVATARS) as AvatarId[]).map((id) => [id, { unlockLevel: 0 }]),
) as Record<AvatarId, AvatarMeta>;

/** The level that opens `id` (0: open from the start). */
export const avatarUnlockLevel = (
  id: AvatarId,
  meta: Readonly<Record<string, AvatarMeta>> = AVATAR_META,
): number => meta[id]?.unlockLevel ?? 0;
