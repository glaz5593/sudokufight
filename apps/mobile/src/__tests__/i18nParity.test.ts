import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { LANGUAGES, NAMESPACES, resources } from '../i18n';

/**
 * Spec §22 and CLAUDE.md: every string in Hebrew and in English. Every namespace has the same keys in both
 * languages, no empty value, and the same {{placeholders}} (a missing one would print a raw "{{name}}").
 */

type Entry = [key: string, value: unknown];

function entries(o: object, prefix = ''): Entry[] {
  return Object.entries(o).flatMap(([k, v]): Entry[] =>
    typeof v === 'object' && v !== null ? entries(v as object, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
}

const placeholders = (s: string): string[] => [...s.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]!).sort();

describe('translations', () => {
  it('registers every namespace in both languages', () => {
    for (const lng of LANGUAGES) expect(Object.keys(resources[lng]).sort()).toEqual([...NAMESPACES].sort());
  });

  it('registers every namespace file on disk', () => {
    for (const lng of LANGUAGES) {
      const files = readdirSync(join(__dirname, '..', 'i18n', 'locales', lng))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      expect(files).toEqual([...NAMESPACES].sort());
    }
  });

  describe.each(NAMESPACES)('namespace "%s"', (ns) => {
    const he = new Map(entries(resources.he[ns]));
    const en = new Map(entries(resources.en[ns]));

    it('has the same keys in Hebrew and English', () => {
      expect([...he.keys()].sort()).toEqual([...en.keys()].sort());
    });

    it('has no empty or non-string values', () => {
      for (const [key, value] of [...he, ...en]) {
        expect({ key, value }).toEqual({ key, value: expect.stringMatching(/\S/) });
      }
    });

    it('uses the same placeholders in both languages', () => {
      for (const [key, value] of he) {
        const other = en.get(key);
        if (typeof value !== 'string' || typeof other !== 'string') continue;
        expect({ key, placeholders: placeholders(value) }).toEqual({
          key,
          placeholders: placeholders(other),
        });
      }
    });
  });
});
