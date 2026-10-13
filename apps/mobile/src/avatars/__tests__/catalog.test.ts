import { AVATAR_KINDS, AVATARS } from '@sudoku-fight/avatars';
import { BOT_LEVELS } from '@sudoku-fight/engine';
import { AVATAR_IDS, isAvatarId, LEGACY_AVATAR_IDS, LEGACY_AVATAR_MAP } from '@sudoku-fight/protocol';

import i18n from '../../i18n';
import {
  AVATAR_GROUPS,
  AVATAR_META,
  avatarDef,
  avatarName,
  expressionName,
  kindOf,
  NO_AVATAR_ID,
  normalizeAvatarId,
} from '../catalog';

/**
 * The bridge between the contract's ids (packages/protocol) and our characters (packages/avatars), spec §3.4.
 */

describe('the catalog and the contract', () => {
  it("AVATAR_IDS are the catalog ids, in the same order (the picker's: by kind, then by catalog file)", () => {
    expect([...AVATAR_IDS]).toEqual(AVATARS.map((a) => a.id));
    expect(AVATAR_IDS).toHaveLength(101);
  });

  it('every bot of the engine has one of our avatars', () => {
    for (const bot of BOT_LEVELS) expect(isAvatarId(bot.avatar)).toBe(true);
  });

  it('every id draws its character; av00, null and anything else draw the placeholder', () => {
    for (const id of AVATAR_IDS) expect(avatarDef(id)?.id).toBe(id);
    expect(avatarDef(NO_AVATAR_ID)).toBeNull();
    expect(avatarDef(null)).toBeNull();
    expect(avatarDef(undefined)).toBeNull();
    expect(avatarDef('av36')).toBeNull();
    expect(avatarDef('not-an-avatar')).toBeNull();
  });

  it('an id of the retired av01–av51 pack draws its replacement', () => {
    for (const id of LEGACY_AVATAR_IDS) {
      expect(normalizeAvatarId(id)).toBe(LEGACY_AVATAR_MAP[id]);
      expect(avatarDef(id)?.id).toBe(LEGACY_AVATAR_MAP[id]);
    }
    expect(avatarDef('av50')?.id).toBe('fox');
  });

  it("groups all 101 by kind, in AVATAR_KINDS order, each group in the contract's order", () => {
    expect(AVATAR_GROUPS.map((g) => g.kind)).toEqual(
      AVATAR_KINDS.filter((k) => AVATARS.some((a) => a.kind === k)),
    );
    expect(AVATAR_GROUPS.flatMap((g) => g.ids)).toEqual([...AVATAR_IDS]);
    for (const g of AVATAR_GROUPS) for (const id of g.ids) expect(avatarDef(id)?.kind).toBe(g.kind);
    expect(kindOf('fox')).toBe('animal');
    expect(kindOf('kettle')).toBe('object');
    expect(kindOf(null)).toBe(AVATAR_GROUPS[0]!.kind);
  });

  it('[D17] every avatar has an unlockLevel, 0 in V1', () => {
    expect(Object.keys(AVATAR_META)).toEqual([...AVATAR_IDS]);
    expect(Object.values(AVATAR_META).every((m) => m.unlockLevel === 0)).toBe(true);
  });
});

describe('names in both languages (the avatars namespace)', () => {
  afterAll(() => i18n.changeLanguage('he'));

  it('Hebrew and English, from the package data', async () => {
    await i18n.changeLanguage('he');
    const t = i18n.getFixedT('he', 'avatars');
    expect(avatarName(t, 'fox')).toBe('שועל');
    expect(avatarName(t, 'av50')).toBe('שועל');
    expect(avatarName(t, NO_AVATAR_ID)).toBeNull();
    expect(expressionName(t, 'smile')).toBe('חיוך');
    expect(t('kinds.animal.many')).toBe('חיות');
    const en = i18n.getFixedT('en', 'avatars');
    expect(avatarName(en, 'fox')).toBe('Fox');
    expect(expressionName(en, 'sleepy')).toBe('Sleepy');
    expect(en('kinds.object.one')).toBe('Object');
    for (const a of AVATARS) {
      expect(avatarName(t, a.id)).toBe(a.name.he);
      expect(avatarName(en, a.id)).toBe(a.name.en);
    }
  });
});
