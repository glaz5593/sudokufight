import { maxLevel } from '@sudoku-fight/engine';

import { expectRoom, layoutLanguages, PHONE, widthIn } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { size, space, tokens } from '../../../theme';
import { CHIP } from '../parts';

/**
 * "אימון בשלבים" on "משחק חדש" (D48; components.md §19.1): its chips stay on one line on Moshe's phone (360 dp),
 * even at the very end ("שלב 300 · ★ 900"), or the six rows no longer fit without scrolling
 * (ModesAndGameType.test: a row is 77). Measured in the font the app ships (fontMetrics: the glyphs' real
 * advances), in every layout language the app has strings for (layout.ts widthIn: estimated by script where the
 * language takes the system's font; localization plan 0טו).
 *
 * The column the chips have: the screen less its gutters (16 each side), the card's border and padding (1 and
 * 12), the 44 picture, the card's two gaps (12) and the chevron (20): 214.
 */

const COLUMN =
  PHONE.width -
  2 * tokens.layout.gutterGame -
  2 * tokens.border.hairline -
  2 * space[6] -
  size.avatar.card.frame -
  2 * space[6] -
  size.icon.chevron;
/** Between two chips (ModesScreen's chips row). */
const CHIPS_GAP = space[3];

const words = (text: string) =>
  widthIn(i18n.language, text, { fontFamily: CHIP.font.fontFamily, fontSize: CHIP.font.size });
const chip = (inner: number) => 2 * CHIP.paddingX + 2 * CHIP.border + inner;
/** "שלב 300 ·", the star, "900". */
const progressChip = () =>
  chip(
    words(i18n.t('home:modes.levels.chip', { stage: maxLevel() })) +
      CHIP.gap +
      CHIP.icon +
      CHIP.gap +
      words(String(3 * maxLevel())),
  );

describe('the staged practice row’s chips fit one line (Modes-Levels, D48)', () => {
  it('has the 214 dp column of the other rows', () => {
    expect(COLUMN).toBe(214);
  });

  it.each(layoutLanguages())('at the end, "שלב 300 · ★ 900" and its offline chip fit (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    const line = progressChip() + CHIPS_GAP + chip(words(i18n.t('home:modes.levels.offline')));
    expectRoom(lang, 'home:modes.levels.chip and home:modes.levels.offline', line, COLUMN);
  });

  it.each(layoutLanguages())(
    'a new player: the full "עובד גם בלי אינטרנט" alone, online or not (%s)',
    async (lang) => {
      await i18n.changeLanguage(lang);
      expectRoom(lang, 'home:modes.chips.offline', chip(words(i18n.t('home:modes.chips.offline'))), COLUMN);
      expectRoom(
        lang,
        'match:offline.availableOffline',
        chip(words(i18n.t('match:offline.availableOffline'))),
        COLUMN,
      );
    },
  );

  it('the long words would not fit beside the progress chip: why the row says them short', async () => {
    await i18n.changeLanguage('he');
    expect(progressChip() + CHIPS_GAP + chip(words(i18n.t('home:modes.chips.offline')))).toBeGreaterThan(
      COLUMN,
    );
  });
});
