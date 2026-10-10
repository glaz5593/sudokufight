import 'react-native-reanimated';

import { INTERFERENCE_KINDS } from '@sudoku-fight/engine';
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AVATAR_META, type AvatarMeta, AVATARS, avatarUnlockLevel } from '../../assets/avatars';
import i18n from '../../i18n';
import { AvatarPicker } from '../../screens/account/AvatarPicker';
import { ARSENAL_CONFIG, INTERFERENCE_UNLOCK_LEVELS, unlockedKinds } from '../../screens/game/arsenal/config';
import { useSettings } from '../../state/settings';
import { FIRST_LEVEL, isUnlocked } from '../unlocks';

/**
 * Unlocking by level [D17] (spec §3.4, §7.1, §15): every avatar and every interference has an unlockLevel. In
 * V1 all of them are 0, so everything is open; the infrastructure is tested with other levels.
 */

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

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
    expect(Object.keys(AVATAR_META).sort()).toEqual(Object.keys(AVATARS).sort());
    expect(Object.values(AVATAR_META).every((m) => m.unlockLevel === 0)).toBe(true);
    expect(avatarUnlockLevel('av12')).toBe(0);
  });

  it('V1: the picker shows no lock', async () => {
    await render(<AvatarPicker value="av01" onChange={jest.fn()} level={1} />);
    expect(screen.queryAllByTestId(/^avatar-picker-av\d+-locked$/)).toHaveLength(0);
  });

  it('above my level: a lock, "נפתח ברמה N", and it cannot be chosen; previous / next skip it', async () => {
    const meta: Record<string, AvatarMeta> = Object.fromEntries(
      AVATAR_IDS.map((id) => [id, { unlockLevel: id === 'av02' ? 12 : 0 }]),
    );
    const onChange = jest.fn<void, [AvatarId]>();
    await render(<AvatarPicker value="av01" onChange={onChange} level={3} meta={meta} />);
    const locked = screen.getByTestId('avatar-picker-av02');
    expect(screen.getByTestId('avatar-picker-av02-locked')).toBeOnTheScreen();
    expect(locked).toHaveProp('accessibilityLabel', 'אווטאר 2, נפתח ברמה 12');
    expect(locked).toHaveProp('accessibilityState', { checked: false, disabled: true });
    await fireEvent.press(locked);
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'האווטאר הבא' }));
    expect(onChange).toHaveBeenLastCalledWith('av03');
  });

  it('opens once my level reaches it', async () => {
    const meta = { ...AVATAR_META, av02: { unlockLevel: 12 } };
    await render(<AvatarPicker value="av01" onChange={jest.fn()} level={12} meta={meta} />);
    expect(screen.queryByTestId('avatar-picker-av02-locked')).toBeNull();
  });
});

describe('interferences [D17]', () => {
  it('every kind has an unlockLevel, 0 in V1: all three open at any level', () => {
    expect(Object.keys(INTERFERENCE_UNLOCK_LEVELS).sort()).toEqual([...INTERFERENCE_KINDS].sort());
    expect(unlockedKinds(null)).toEqual(['fireworks', 'cats', 'warp']);
    expect(unlockedKinds(1)).toEqual(['fireworks', 'cats', 'warp']);
    expect(ARSENAL_CONFIG.unlocked).toEqual(['fireworks', 'cats', 'warp']);
  });

  it('a kind above my level stays out of the arsenal until I reach it', () => {
    const levels = { fireworks: 0, cats: 4, warp: 9 };
    expect(unlockedKinds(3, levels)).toEqual(['fireworks']);
    expect(unlockedKinds(4, levels)).toEqual(['fireworks', 'cats']);
    expect(unlockedKinds(null, levels)).toEqual(['fireworks']);
    expect(unlockedKinds(20, levels)).toEqual(['fireworks', 'cats', 'warp']);
  });
});
