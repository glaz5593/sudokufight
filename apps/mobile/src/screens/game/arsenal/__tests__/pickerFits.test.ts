import { INTERFERENCE_KINDS } from '@sudoku-fight/engine';
import type { TextStyle } from 'react-native';

import {
  expectFits,
  expectRoom,
  fixedT,
  layoutLanguages,
  typefaceOf,
  widthIn,
} from '../../../../components/ui/testing/layout';
import { signedText } from '../../../../components/player/format';
import { size, space, text, tokens } from '../../../../theme';
import { pickerLayout } from '../arsenalModel';
import { arsenalMetrics, arsenalMetricsFor } from '../metrics';

/**
 * The interference picker shows every kind at once, never a scroll (spec §7.3, 01-SPEC line 1032, D45), in every
 * layout language the app has strings for (localization plan 0טו, D124: a language that doesn't fit shortens its
 * words): the sheet's height with the language's line heights, and its words in their room on the phones of the
 * picker's own test (arsenalModel.test.ts).
 */

const PHONES = [
  [360, 780, 48],
  [360, 640, 48],
  [320, 568, 48],
  [390, 844, 34],
] as const;

/** A text style's font: Rubik's file, or the system font's weight (no fontFamily: theme uiFont). */
type Font = { fontFamily?: string; fontWeight?: TextStyle['fontWeight']; fontSize: number };

/** A chip's words already cut in English on Moshe's phone (found by this test, 2026-10-23; reported). */
const CUT_TODAY: ReadonlySet<string> = new Set(['arsenal.busy']);

/** How many lines `words` take in `room`, broken between words (anywhere in a script without spaces). */
function lineCount(lang: string, words: string, font: Font, room: number): number {
  const spaced = /\s/.test(words.trim());
  const pieces = spaced ? words.trim().split(/\s+/) : [...words];
  let lines = 1;
  let line = '';
  for (const piece of pieces) {
    if (widthIn(lang, piece, font) > room) return Infinity;
    const next = line ? `${line}${spaced ? ' ' : ''}${piece}` : piece;
    if (widthIn(lang, next, font) <= room) line = next;
    else {
      lines += 1;
      line = piece;
    }
  }
  return lines;
}

const fontOf = (style: TextStyle): Font => ({
  fontFamily: style.fontFamily,
  fontWeight: style.fontWeight,
  fontSize: style.fontSize!,
});

describe('the picker’s sizes in each script (plan 0ט)', () => {
  it('Hebrew and English: the design’s, exactly', () => {
    for (const lang of ['he', 'en']) {
      const m = arsenalMetricsFor(typefaceOf(lang));
      expect({ button: m.button.height, header: m.header.height, info: m.info.height }).toEqual({
        button: 104,
        header: 52,
        info: 16,
      });
      expect(m).toEqual(arsenalMetrics);
    }
  });

  it('a taller script grows a kind button, the header and the info line by what its lines need', () => {
    const thai = arsenalMetricsFor(typefaceOf('th'));
    // Two lines of 13 at 1.5 (20 each): 6 + 36 + 2 + 40 + 4 + 22 and the hairlines.
    expect(thai.button.height).toBe(112);
    // h1 22 at 1.5 (33), the gap, label 13 at 1.5 (20).
    expect(thai.header.height).toBe(57);
    expect(thai.info.height).toBe(18);
    expect(arsenalMetricsFor(typefaceOf('ar')).button.height).toBe(108);
  });

  it.each(['ar', 'th', 'vi', 'ja'])(
    'with %s’s line heights, every kind still fits on every phone',
    (lang) => {
      const metrics = arsenalMetricsFor(typefaceOf(lang));
      for (const [width, height, bottomInset] of PHONES) {
        const layout = pickerLayout({
          width,
          height,
          bottomInset,
          count: INTERFERENCE_KINDS.length,
          metrics,
        });
        expect({ lang, width, height, fits: layout.fits }).toEqual({ lang, width, height, fits: true });
      }
    },
  );
});

describe.each(layoutLanguages())('the picker in %s (D45, D124)', (lang) => {
  const m = arsenalMetricsFor(typefaceOf(lang));

  it.each(PHONES)('%i × %i: every kind at once, no scroll', (width, height, bottomInset) => {
    expect(
      pickerLayout({ width, height, bottomInset, count: INTERFERENCE_KINDS.length, metrics: m }).fits,
    ).toBe(true);
  });

  it.each(PHONES)(
    '%i × %i: the title and the info on one line, a name in two, a chip in one',
    async (width, height) => {
      const t = await fixedT(lang, 'game');
      const layout = pickerLayout({ width, height, count: INTERFERENCE_KINDS.length, metrics: m });
      const inner = width - 2 * m.sheet.paddingX;
      // The title beside the close button (44) and the header's gap.
      expectRoom(
        lang,
        'game:arsenal.title',
        widthIn(lang, t('arsenal.title'), fontOf(text('h1'))),
        inner - space[6] - size.iconButton,
      );
      expectRoom(
        lang,
        'game:arsenal.info',
        widthIn(lang, t('arsenal.info', { count: 5, seconds: 5 }), fontOf(text('micro'))),
        inner,
      );

      const column = layout.columnWidth - 2 * m.button.paddingX - 2 * tokens.border.hairline;
      for (const kind of INTERFERENCE_KINDS) {
        const name = t(`arsenal.kind.${kind}`);
        expectFits(
          lang,
          `game:arsenal.kind.${kind} in ${m.button.nameLines} lines`,
          lineCount(lang, name, fontOf(m.button.nameStyle), column) <= m.button.nameLines,
        );
      }

      // A chip: the price ("⁦−16⁩ נק׳"), or why the kind can't go now (a lock before a level). English's "Under
      // interference" is already cut on a 104 dp button (CUT_TODAY): there a language may be as wide as the wider of
      // Hebrew and English, no wider.
      const room = column - 2 * m.button.chip.paddingX;
      const unit = fontOf(m.button.chipTextStyle);
      const sources = await Promise.all(['he', 'en'].map((l) => fixedT(l, 'game')));
      const chip = (key: string, options?: Record<string, number>) =>
        CUT_TODAY.has(key)
          ? Math.max(room, ...sources.map((s, i) => widthIn(['he', 'en'][i]!, s(key, options), unit)))
          : room;
      const price =
        widthIn(lang, signedText(-16), fontOf(m.button.chipNumberStyle)) +
        m.button.chip.gap +
        widthIn(lang, t('arsenal.unit'), unit);
      expectRoom(lang, 'the price chip', price, room);
      const lock = m.button.chip.icon + m.button.chip.gap;
      for (const [key, options, extra] of [
        ['arsenal.missing', { count: 12 }, 0],
        ['arsenal.busy', undefined, 0],
        ['arsenal.unavailable', undefined, 0],
        ['arsenal.locked', undefined, lock],
        ['arsenal.level', { level: 12 }, lock],
      ] as const) {
        const words = t(key, options);
        expectRoom(lang, `game:${key} "${words}"`, widthIn(lang, words, unit) + extra, chip(key, options));
      }
    },
  );
});
