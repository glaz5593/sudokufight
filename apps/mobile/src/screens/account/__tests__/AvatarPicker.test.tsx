import 'react-native-reanimated';
import { avatarById, MOTIONS, renderStatic } from '@sudoku-fight/avatars';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AVATAR_GROUPS } from '../../../avatars';
import { avatarIdsIn, drawnAvatarId, svgXmlsIn } from '../../../avatars/testing/avatarTesting';
import { AVATAR_SIZES } from '../../../components/player/metrics';
import { SHEET_GUTTER } from '../../../components/ui';
import { directionProblems, PHONE, setWindow } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { size } from '../../../theme';
import {
  AvatarPicker,
  gridColumns,
  gridHeaderHeight,
  gridLayout,
  gridSections,
  gridStartIndex,
} from '../AvatarPicker';
import { renderWholeAvatarGrid } from '../testing/avatarGrid';

/**
 * The avatar (spec §3.2, §3.4; Moshe's device test, 14.10.2026): a field like the name's and the country's,
 * and a tall sheet with all 101 of our characters in a grid under a header per kind. The field's avatar greets
 * a new choice; the grid's avatars stay still.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const FIELD = AVATAR_SIZES.compact.image;
type Node = ReturnType<typeof screen.getByTestId>;
const styleOf = (node: Node) => StyleSheet.flatten(node.props.style as object) as Record<string, unknown>;

function Picker({ initial, onChange }: { initial: AvatarId | null; onChange?: (id: AvatarId) => void }) {
  const [value, setValue] = useState<AvatarId | null>(initial);
  return (
    <AvatarPicker
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

const fieldXmls = () =>
  svgXmlsIn(screen.getByTestId('avatar-picker-selected-image', hidden)).map((x) => x.props.xml as string);
const gridRadios = () => within(screen.getByTestId('avatar-picker-grid')).queryAllByRole('radio', hidden);
const idOf = (radio: Node) => String(radio.props.testID).replace('avatar-picker-', '');

async function frames(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function openSheet() {
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  return screen.findByTestId('avatar-picker-sheet');
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the avatar field', () => {
  it('is a field like the others: the label, the chosen avatar small inside it with its name, "שינוי"', async () => {
    await render(<Picker initial="noam" />);
    const field = screen.getByRole('button', { name: 'האווטאר שנבחר: נועם' });
    expect(field).toHaveProp('testID', 'avatar-picker');
    expect(field).toHaveProp('accessibilityHint', 'בחר אווטאר');
    expect(screen.getByText('אווטאר')).toBeOnTheScreen();
    expect(field).toHaveTextContent('נועםשינוי');
    expect(avatarIdsIn(field)).toEqual(['noam']);
    // As high as the name field (44), the avatar inside it (34) included: not a stage any more.
    expect(styleOf(field).minHeight).toBe(size.input);
    expect(AVATAR_SIZES.compact.frame).toBeLessThan(size.input);
    expect(screen.queryByTestId('avatar-picker-sheet')).toBeNull();
    expect(screen.queryAllByRole('radio', hidden)).toHaveLength(0);
    expect(directionProblems(field)).toEqual([]);
  });

  it('nothing chosen yet: the "no avatar" placeholder and "בחר אווטאר"', async () => {
    await render(<Picker initial={null} />);
    expect(screen.getByRole('button', { name: 'בחר אווטאר' })).toHaveTextContent('בחר אווטארשינוי');
    expect(fieldXmls()).toEqual([renderStatic(null, { size: FIELD })]);
  });
});

describe('the avatar sheet', () => {
  it('shows all 101 in a grid, under a header per kind, in the catalog’s order, each still', async () => {
    renderWholeAvatarGrid();
    await render(<Picker initial="noam" />);
    const sheet = await openSheet();
    expect(within(sheet).getByRole('header', { name: 'בחר אווטאר' })).toBeOnTheScreen();
    expect(within(sheet).getByText('הבחירה שלך: נועם')).toBeOnTheScreen();

    const grid = screen.getByTestId('avatar-picker-grid');
    const kinds = AVATAR_GROUPS.map((g) => i18n.t(`avatars:kinds.${g.kind}.many`));
    expect(
      within(grid)
        .getAllByRole('header')
        .map((h) => h.props.children),
    ).toEqual(kinds);
    expect(gridRadios().map(idOf)).toEqual(AVATAR_GROUPS.flatMap((g) => [...g.ids]));
    expect(new Set(gridRadios().map(idOf))).toEqual(new Set(AVATAR_IDS));
    for (const radio of gridRadios()) {
      const id = idOf(radio);
      expect(radio).toHaveProp('accessibilityLabel', avatarById(id)!.name.he);
      // One still picture each: nothing in the grid idles or moves.
      expect(svgXmlsIn(radio)).toHaveLength(1);
      expect(avatarIdsIn(radio)).toEqual([id]);
    }
    // The chosen one is marked: checked, framed in my colour, with a tick.
    expect(screen.getByTestId('avatar-picker-noam')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('avatar-picker-noam-tick')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/-tick$/)).toHaveLength(1);
    expect(screen.getByTestId('avatar-picker-maya')).toHaveProp('accessibilityState', { checked: false });
  });

  it('renders a sheet’s worth at first and opens on the chosen avatar’s row', async () => {
    await render(<Picker initial="cassette" />);
    await openSheet();
    // Virtualized: not all 101 at once.
    expect(gridRadios().length).toBeGreaterThan(0);
    expect(gridRadios().length).toBeLessThan(AVATAR_IDS.length);
    expect(screen.getByTestId('avatar-picker-cassette')).toHaveProp('accessibilityState', { checked: true });
    const grid = screen.getByTestId('avatar-picker-grid');
    expect(grid.props.initialScrollIndex).toBeGreaterThan(0);
  });

  it('a tap chooses, closes the sheet, and the field greets the choice', async () => {
    const onChange = jest.fn();
    await render(<Picker initial="noam" onChange={onChange} />);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-picker-maya'));
    expect(onChange).toHaveBeenCalledWith('maya');
    await frames(0);
    expect(screen.getByRole('button', { name: 'האווטאר שנבחר: מאיה' })).toHaveTextContent('מאיהשינוי');
    // It bounces: the body moves, the whole character in one picture...
    expect(fieldXmls()).toHaveLength(1);
    expect(drawnAvatarId(fieldXmls()[0])).toBeNull();
    // ...and comes to rest, still.
    await frames(MOTIONS.bounce.durationMs + 1000);
    expect(fieldXmls()).toEqual([renderStatic(avatarById('maya')!, { size: FIELD })]);
    expect(screen.queryByTestId('avatar-picker-sheet')).toBeNull();
  });

  it('the chosen one again, the close button, the scrim and Android back close it, choosing nothing', async () => {
    const onChange = jest.fn();
    await render(<Picker initial="noam" onChange={onChange} />);
    const close = async (how: () => Promise<unknown>) => {
      await openSheet();
      await how();
      await frames(1000);
      expect(screen.queryByTestId('avatar-picker-sheet')).toBeNull();
    };
    await close(() => fireEvent.press(screen.getByTestId('avatar-picker-noam')));
    await close(() => fireEvent.press(screen.getByTestId('avatar-picker-sheet-close')));
    await close(() => fireEvent.press(screen.getByTestId('avatar-picker-sheet-scrim', hidden)));
    await close(() => fireEvent(screen.getByTestId('avatar-picker-sheet'), 'requestClose'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'האווטאר שנבחר: נועם' })).toBeOnTheScreen();
  });

  it('with reduced motion the choice only smiles, for the bounce’s length, still', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<Picker initial="noam" />);
    expect(fieldXmls()).toEqual([renderStatic(avatarById('noam')!, { size: FIELD })]);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-picker-maya'));
    await frames(0);
    expect(fieldXmls()).toEqual([renderStatic(avatarById('maya')!, { size: FIELD, expression: 'smile' })]);
    await frames(MOTIONS.bounce.durationMs);
    expect(fieldXmls()).toEqual([renderStatic(avatarById('maya')!, { size: FIELD })]);
  });

  it('on the phone: four big avatars to a row, spread over the sheet’s width', async () => {
    const restore = setWindow(PHONE);
    try {
      renderWholeAvatarGrid();
      await render(<Picker initial="noam" />);
      await openSheet();
      const columns = gridColumns(PHONE.width - 2 * SHEET_GUTTER);
      expect(columns).toBe(4);
      const firstRow = screen.getByTestId('avatar-picker-noam').parent!.parent as Node;
      expect(within(firstRow).getAllByRole('radio', hidden)).toHaveLength(columns);
      expect(styleOf(screen.getByTestId('avatar-picker-noam'))).toMatchObject({
        width: AVATAR_SIZES.home.frame,
        height: AVATAR_SIZES.home.frame,
      });
    } finally {
      await restore();
    }
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    renderWholeAvatarGrid();
    await render(<Picker initial="fox" />);
    expect(screen.getByRole('button', { name: 'Selected avatar: Fox' })).toHaveTextContent('FoxChange');
    expect(screen.getByText('Avatar')).toBeOnTheScreen();
    const sheet = await openSheet();
    expect(within(sheet).getByRole('header', { name: 'Choose an avatar' })).toBeOnTheScreen();
    expect(within(sheet).getByText('Your pick: Fox')).toBeOnTheScreen();
    expect(within(sheet).getByRole('header', { name: 'Animals' })).toBeOnTheScreen();
    expect(screen.getByTestId('avatar-picker-owl')).toHaveProp('accessibilityLabel', 'Owl');
  });
});

describe('the grid’s geometry', () => {
  it('fits as many 72 dp avatars to a row as the width holds, at least 8 dp apart', () => {
    expect(gridColumns(328)).toBe(4);
    expect(gridColumns(4 * 72 + 3 * 8)).toBe(4);
    expect(gridColumns(4 * 72 + 3 * 8 - 1)).toBe(3);
    expect(gridColumns(40)).toBe(1);
  });

  it('a section per kind, its avatars in rows', () => {
    const sections = gridSections(4);
    expect(sections.map((s) => s.kind)).toEqual(AVATAR_GROUPS.map((g) => g.kind));
    for (const [i, s] of sections.entries()) {
      expect(s.data.flat()).toEqual([...AVATAR_GROUPS[i]!.ids]);
      expect(s.data.every((row) => row.length >= 1 && row.length <= 4)).toBe(true);
    }
  });

  it('lays the cells out as the SectionList counts them: a header, the rows, an empty footer', () => {
    const sections = gridSections(4);
    const header = gridHeaderHeight(1);
    const cells = gridLayout(sections, header);
    expect(cells).toHaveLength(sections.reduce((n, s) => n + s.data.length + 2, 0));
    expect(cells[0]).toEqual({ length: header, offset: 0 });
    const row = AVATAR_SIZES.home.frame + 12;
    expect(cells[1]).toEqual({ length: row, offset: header });
    const firstFooter = sections[0]!.data.length + 1;
    expect(cells[firstFooter]).toEqual({ length: 0, offset: header + row * sections[0]!.data.length });
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.offset).toBe(cells[i - 1]!.offset + cells[i - 1]!.length);
    }
    // The header's line grows with the phone's text size.
    expect(gridHeaderHeight(2)).toBeGreaterThan(header);
  });

  it('opens a row above the chosen avatar (its kind’s header sticks over the top)', () => {
    const sections = gridSections(4);
    expect(gridStartIndex(sections, null)).toBeUndefined();
    // The very first row: the top.
    expect(gridStartIndex(sections, AVATAR_GROUPS[0]!.ids[0]!)).toBeUndefined();
    // The second kind's first row: that kind's header.
    const secondHeader = sections[0]!.data.length + 2;
    expect(gridStartIndex(sections, AVATAR_GROUPS[1]!.ids[0]!)).toBe(secondHeader);
    // The second kind's second row: the row above it.
    expect(gridStartIndex(sections, AVATAR_GROUPS[1]!.ids[4]!)).toBe(secondHeader + 1);
  });
});
