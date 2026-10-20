import 'react-native-reanimated';

import { gateState, levelIdOf, type LevelRecords, type Stars } from '@sudoku-fight/engine';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../../../i18n';
import { allLevels } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { GateSheet, gateSheetModel } from '../GateSheet';

/**
 * A locked gate's sheet (components.md §19.11; the Map-Gate board; plan §4.5): what it still needs, up to three
 * stages to play again (the engine's replayCandidates), the primary, and with enough stars but the boss not
 * played, the boss as the primary.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const BY_ID = new Map(allLevels().map((l) => [l.id, l]));

/** Chapter 4 (L031–L040) with these stars, stage by stage; 0 means not played. */
function chapter4(stars: readonly number[]): LevelRecords {
  const out: Record<string, { stars: Stars; plays: number; lastPlayedAt: number }> = {};
  for (let k = 1; k <= 30; k++) out[levelIdOf(k)] = { stars: 3, plays: 1, lastPlayedAt: k };
  stars.forEach((s, i) => {
    if (s > 0 || i < stars.length)
      out[levelIdOf(31 + i)] = { stars: s as Stars, plays: 1, lastPlayedAt: 100 + i };
  });
  return out;
}

async function show(records: LevelRecords) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  const gate = gateState(4, records);
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <GateSheet
        visible
        chapter={5}
        gate={gate}
        records={records}
        levelsById={BY_ID}
        onClose={onClose}
        onPick={onPick}
      />
    </SafeAreaProvider>,
  );
  return { onPick, onClose, gate };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('GateSheet', () => {
  it('"צריך 20 כוכבים בפרק 4. יש לך 17, חסרים 3." and up to three stages to play again', async () => {
    // Chapter 4 played to its boss: 17 stars.
    const records = chapter4([3, 1, 2, 2, 1, 2, 2, 1, 2, 1]);
    const { onPick } = await show(records);
    expect(screen.getByRole('header', { name: 'פרק 5 נעול' })).toBeTruthy();
    expect(screen.getByTestId('gate-sheet-body')).toHaveTextContent(
      'צריך 20 כוכבים בפרק 4. יש לך 17, חסרים 3.',
    );
    const rows = within(screen.getByTestId('gate-sheet-rows')).getAllByRole('button');
    expect(rows).toHaveLength(3);
    // The fewest stars first, a tie to the most recent: 40 (★), 38 (★), 35 (★).
    expect(rows.map((r) => r.props.testID)).toEqual([
      'gate-sheet-row-40',
      'gate-sheet-row-38',
      'gate-sheet-row-35',
    ]);
    expect(rows[0]).toHaveProp('accessibilityLabel', 'שחק שוב את שלב 40, מרוץ מול הבוט, כוכב אחד מתוך שלושה');
    await fireEvent.press(screen.getByTestId('gate-sheet-primary'));
    expect(onPick).toHaveBeenCalledWith('L040');
    expect(
      screen.getByText('רוב השלבים עד 30 שניות, ומילוי ופאזל עד 60. הכוכבים הטובים ביותר נשמרים.'),
    ).toBeTruthy();
  });

  it('22 stars and the boss not played: the boss’s words, and the boss is the primary', async () => {
    const records = chapter4([3, 3, 3, 3, 3, 3, 2, 1, 1]);
    const { gate } = await show(records);
    expect(gate).toMatchObject({ stars: 22, need: 20, bossPlayed: false, open: false });
    expect(screen.getByTestId('gate-sheet-body')).toHaveTextContent(
      'יש לך מספיק כוכבים. שחק את שלב 40 (בוס) כדי לפתוח',
    );
    expect(screen.getByTestId('gate-sheet-primary')).toHaveProp('accessibilityLabel', 'שחק את שלב 40');
    // It is the first row too, as a stage not played yet.
    expect(screen.getByTestId('gate-sheet-row-40')).toHaveProp(
      'accessibilityLabel',
      'שחק את שלב 40, מרוץ מול הבוט, עוד לא שוחק',
    );
  });

  it('a row plays its stage', async () => {
    const { onPick } = await show(chapter4([3, 1, 2, 2, 1, 2, 2, 1, 2, 1]));
    await fireEvent.press(screen.getByTestId('gate-sheet-row-38'));
    expect(onPick).toHaveBeenCalledWith('L038');
  });

  it('its model: never more than three, the missing stars they hold', () => {
    const records = chapter4([3, 1, 2, 2, 1, 2, 2, 1, 2, 1]);
    const model = gateSheetModel(5, gateState(4, records), records);
    expect(model).toMatchObject({
      prev: 4,
      ids: ['L040', 'L038', 'L035'],
      primary: 'L040',
      bossOnly: false,
      missing: 6,
    });
  });
});
