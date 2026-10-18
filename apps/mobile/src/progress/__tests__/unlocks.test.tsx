import 'react-native-reanimated';

import { INTERFERENCE_KINDS } from '@sudoku-fight/engine';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AVATAR_META, type AvatarMeta, avatarUnlockLevel } from '../../avatars';
import i18n from '../../i18n';
import { AvatarPicker } from '../../screens/account/AvatarPicker';
import { renderWholeAvatarGrid } from '../../screens/account/testing/avatarGrid';
import { ARSENAL_CONFIG, INTERFERENCE_UNLOCK_LEVELS, unlockedKinds } from '../../screens/game/arsenal/config';
import { useSettings } from '../../state/settings';
import { FIRST_LEVEL, isUnlocked } from '../unlocks';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

/** The avatar field's sheet, open, its whole grid rendered. */
async function openAvatarSheet() {
  renderWholeAvatarGrid();
  await fireEvent.press(screen.getByTestId('avatar-picker'));
  await screen.findByTestId('avatar-picker-sheet');
}

/**
 * Unlocking by level [D17] (spec §3.4, §7.1, §15): every avatar and every interference has an unlockLevel. In
 * V1 all of them are 0, so everything is open; the infrastructure is tested with other levels.
 */

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});
afterEach(() => jest.restoreAllMocks());

describe('isUnlocked', () => {
  it('opens at the level, and counts an unknown level as the first', () => {
    expect(isUnlocked(0, null)).toBe(true);
    expect(isUnlocked(1, null)).toBe(true);
    expect(isUnlocked(2, null)).toBe(false);
    expect(isUnlocked(5, 4)).toBe(false);
    expect(isUnlocked(5, 5)).toBe(true);
    expect(FIRST_LEVEL).toBe(1);
  });
});

describe('avatars [D17]', () => {
  it('every avatar has an unlockLevel, 0 in V1', () => {
    expect(Object.keys(AVATAR_META)).toEqual([...AVATAR_IDS]);
    expect(Object.values(AVATAR_META).every((m) => m.unlockLevel === 0)).toBe(true);
    expect(avatarUnlockLevel('maya')).toBe(0);
  });

  it('V1: the picker shows no lock', async () => {
    await render(<AvatarPicker value="noam" onChange={jest.fn()} level={1} />);
    await openAvatarSheet();
    expect(screen.getAllByRole('radio')).toHaveLength(AVATAR_IDS.length);
    expect(screen.queryAllByTestId(/^avatar-picker-.+-locked$/)).toHaveLength(0);
  });

  it('above my level: a lock, "נפתח ברמה N", and it cannot be chosen', async () => {
    const meta: Record<string, AvatarMeta> = Object.fromEntries(
      AVATAR_IDS.map((id) => [id, { unlockLevel: id === 'maya' ? 12 : 0 }]),
    );
    const onChange = jest.fn<void, [AvatarId]>();
    await render(<AvatarPicker value="noam" onChange={onChange} level={3} meta={meta} />);
    await openAvatarSheet();
    const locked = screen.getByTestId('avatar-picker-maya');
    expect(screen.getByTestId('avatar-picker-maya-locked')).toBeOnTheScreen();
    expect(locked).toHaveProp('accessibilityLabel', 'מאיה, נפתח ברמה 12');
    expect(locked).toHaveProp('accessibilityState', { checked: false, disabled: true });
    await fireEvent.press(locked);
    expect(onChange).not.toHaveBeenCalled();
    // The sheet stays open; an open one can be chosen.
    await fireEvent.press(screen.getByTestId('avatar-picker-ruthie'));
    expect(onChange).toHaveBeenLastCalledWith('ruthie');
  });

  it('opens once my level reaches it', async () => {
    const meta = { ...AVATAR_META, maya: { unlockLevel: 12 } };
    await render(<AvatarPicker value="noam" onChange={jest.fn()} level={12} meta={meta} />);
    await openAvatarSheet();
    expect(screen.getByTestId('avatar-picker-maya')).toHaveProp('accessibilityState', { checked: false });
    expect(screen.queryByTestId('avatar-picker-maya-locked')).toBeNull();
  });
});

describe('interferences [D17, D47]', () => {
  it('every kind has an unlockLevel: the first three open from the start, then scramble 2, ink 3, keypad 4', () => {
    expect(Object.keys(INTERFERENCE_UNLOCK_LEVELS).sort()).toEqual([...INTERFERENCE_KINDS].sort());
    expect(unlockedKinds(null)).toEqual(['fireworks', 'cats', 'warp']);
    expect(unlockedKinds(1)).toEqual(['fireworks', 'cats', 'warp']);
    expect(unlockedKinds(2)).toEqual(['fireworks', 'cats', 'warp', 'scramble']);
    expect(unlockedKinds(3)).toEqual(['fireworks', 'cats', 'warp', 'scramble', 'ink']);
    expect(unlockedKinds(4)).toEqual([...INTERFERENCE_KINDS]);
    expect(unlockedKinds(30)).toEqual([...INTERFERENCE_KINDS]);
    expect(ARSENAL_CONFIG.unlocked).toEqual(['fireworks', 'cats', 'warp']);
  });

  it('a kind the table does not name stays locked', () => {
    expect(unlockedKinds(99, { fireworks: 0 })).toEqual(['fireworks']);
  });

  it('a kind above my level stays out of the arsenal until I reach it', () => {
    const levels = { fireworks: 0, cats: 4, warp: 9 };
    expect(unlockedKinds(3, levels)).toEqual(['fireworks']);
    expect(unlockedKinds(4, levels)).toEqual(['fireworks', 'cats']);
    expect(unlockedKinds(null, levels)).toEqual(['fireworks']);
    expect(unlockedKinds(20, levels)).toEqual(['fireworks', 'cats', 'warp']);
  });
});
