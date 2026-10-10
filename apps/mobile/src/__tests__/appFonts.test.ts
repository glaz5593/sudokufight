import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FONT_FAMILIES, FONTS } from '../theme/fonts';

/**
 * The fonts the app ships (work plan stage 13, "ביצועים: גודל האפליקציה"; docs/PERF.md). Metro's part:
 * metroConfig.test.ts.
 */
const MOBILE = join(__dirname, '..', '..');

describe('fonts: the six weights in use', () => {
  const app = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, { fonts?: string[] }])[] };
  };
  const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-font') as
    [string, { fonts: string[] }] | undefined;

  it("app.json's expo-font plugin embeds exactly the fonts the tokens use (Android reads them from there)", () => {
    const embedded = (plugin?.[1].fonts ?? []).map((path) =>
      path
        .split('/')
        .pop()!
        .replace(/\.ttf$/, ''),
    );
    expect([...embedded].sort()).toEqual([...FONT_FAMILIES].sort());
  });

  it('development (and iOS) builds load the same six at run time, under the tokens’ names', () => {
    expect(Object.keys(FONTS).sort()).toEqual([...FONT_FAMILIES].sort());
  });
});
