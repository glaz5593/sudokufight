/* Test-only: the avatar field's sheet, whose grid a test can't scroll. */
import { AVATAR_IDS, type AvatarId } from '@sudoku-fight/protocol';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { AVATAR_GROUPS } from '../../../avatars';
import { AVATAR_GRID } from '../AvatarPicker';

/**
 * Lets the avatar sheet's grid render whole when it opens, from its top (every avatar, and every kind's header
 * and footer), until the returned restore (or jest.restoreAllMocks).
 */
export function renderWholeAvatarGrid(): { restore: () => void } {
  const count = jest.replaceProperty(
    AVATAR_GRID,
    'initialNumToRender',
    AVATAR_IDS.length + 2 * AVATAR_GROUPS.length,
  );
  const top = jest.replaceProperty(AVATAR_GRID, 'startAtChosen', false);
  return {
    restore: () => {
      count.restore();
      top.restore();
    },
  };
}

/** Opens the avatar field's sheet, taps `id` in its grid, and lets the sheet close. Needs fake timers. */
export async function chooseAvatar(id: AvatarId, testID = 'avatar-picker'): Promise<void> {
  const whole = renderWholeAvatarGrid();
  try {
    await fireEvent.press(screen.getByTestId(testID));
    const sheet = await screen.findByTestId(`${testID}-sheet`);
    await fireEvent.press(within(sheet).getByTestId(`${testID}-${id}`));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  } finally {
    whole.restore();
  }
}
