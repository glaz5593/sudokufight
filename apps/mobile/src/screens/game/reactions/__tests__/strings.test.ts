import en from '../../../../i18n/locales/en/game.json';
import he from '../../../../i18n/locales/he/game.json';
import { REACTION_NAMES } from '../model';

/** Every key of a translation block, dotted. */
function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const placeholders = (s: string): string[] => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]!).sort();

describe('the reactions’ strings (game:reactions.*, CLAUDE.md: Hebrew and English)', () => {
  it('has the same keys, and the same placeholders, in both languages', () => {
    expect(keys(he.reactions).sort()).toEqual(keys(en.reactions).sort());
    const at = (o: object, path: string) =>
      path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o) as string;
    for (const key of keys(he.reactions)) {
      expect(at(he.reactions, key)).toMatch(/\S/);
      expect(placeholders(at(he.reactions, key))).toEqual(placeholders(at(en.reactions, key)));
    }
  });

  it('names each base reaction (components.md §8.2: צחוק / בהלה / קול / פספוס / אש / עיניים)', () => {
    const names = Object.values(REACTION_NAMES);
    expect(names.map((k) => he.reactions.name[k as keyof typeof he.reactions.name])).toEqual([
      'צחוק',
      'בהלה',
      'קול',
      'פספוס',
      'אש',
      'עיניים',
    ]);
    for (const k of names) expect(en.reactions.name[k as keyof typeof en.reactions.name]).toMatch(/\S/);
  });

  it('uses the spec’s words for the card menu (spec §8)', () => {
    expect(he.reactions.menu.mute).toBe('השתק תגובות');
    expect(he.reactions.menu.unmute).toBe('בטל השתקה');
    expect(he.reactions.picker).toBe('תגובות');
  });
});
