import { maxLevel } from '@sudoku-fight/engine';

import { PHONE } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { measuredWidth } from '../../../testing/fontMetrics';
import { size, space, tokens } from '../../../theme';
import { CHIP } from '../parts';

/**
 * "אימון בשלבים" on "משחק חדש" (D48; components.md §19.1): its chips stay on one line on Moshe's phone (360 dp),
 * even at the very end ("שלב 300 · ★ 900"), or the six rows no longer fit without scrolling
 * (ModesAndGameType.test: a row is 77). Measured in the font the app ships (fontMetrics: the glyphs' real
 * advances), in Hebrew and in English.
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

const words = (text: string) => measuredWidth(text, CHIP.font.fontFamily, CHIP.font.size);
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

  it.each(['he', 'en'] as const)(
    'at the end, "שלב 300 · ★ 900" and its offline chip fit (%s)',
    async (lang) => {
      await i18n.changeLanguage(lang);
      const line = progressChip() + CHIPS_GAP + chip(words(i18n.t('home:modes.levels.offline')));
      expect(line).toBeLessThanOrEqual(COLUMN);
    },
  );

  it.each(['he', 'en'] as const)(
    'a new player: the full "עובד גם בלי אינטרנט" alone, online or not (%s)',
    async (lang) => {
      await i18n.changeLanguage(lang);
      expect(chip(words(i18n.t('home:modes.chips.offline')))).toBeLessThanOrEqual(COLUMN);
      expect(chip(words(i18n.t('match:offline.availableOffline')))).toBeLessThanOrEqual(COLUMN);
    },
  );

  it('the long words would not fit beside the progress chip: why the row says them short', async () => {
    await i18n.changeLanguage('he');
    expect(progressChip() + CHIPS_GAP + chip(words(i18n.t('home:modes.chips.offline')))).toBeGreaterThan(
      COLUMN,
    );
  });
});
