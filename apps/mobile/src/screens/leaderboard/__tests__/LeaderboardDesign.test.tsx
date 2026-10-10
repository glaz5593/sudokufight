import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { entry } from '../../../api/testing/fakeProgress';
import i18n from '../../../i18n';
import { PinnedMe } from '../LeaderboardParts';

/**
 * Stage 13 design QA of the leaderboard (Leaderboard.dc.html): my pinned row carries the screen's gold "שחק"
 * ("play to climb the table") beside it, and keeps it while I have no rating in the tab; in Hebrew and English.
 */

const ME = entry({ id: 'me', displayName: 'MosheG', rank: 214, rating: 1287, league: 'gold', level: 14 });

describe.each([
  ['he', 'שחק', 'שחק כדי לטפס בטבלה', 'שחק משחק מדורג כדי להיכנס לטבלה'],
  ['en', 'Play', 'Play to climb the table', 'Play a ranked game to join the table'],
] as const)('my pinned row in %s', (lng, play, climb, join) => {
  beforeEach(async () => {
    await i18n.changeLanguage(lng);
  });

  it('my row, and "play" beside it', async () => {
    const onPlay = jest.fn();
    const onOpen = jest.fn();
    await render(<PinnedMe me={ME} onOpen={onOpen} onPlay={onPlay} />);
    const pinned = screen.getByTestId('leaderboard-me');
    expect(within(pinned).getByTestId('leaderboard-me-row')).toBeOnTheScreen();
    const button = within(pinned).getByRole('button', { name: climb });
    expect(button).toHaveTextContent(play);
    await fireEvent.press(button);
    expect(onPlay).toHaveBeenCalledTimes(1);
    await fireEvent.press(within(pinned).getByTestId('leaderboard-me-row'));
    expect(onOpen).toHaveBeenCalledWith(ME);
  });

  it('no rating in this tab yet: the line and "play"', async () => {
    const onPlay = jest.fn();
    await render(<PinnedMe me={null} onOpen={jest.fn()} onPlay={onPlay} />);
    await fireEvent.press(screen.getByRole('button', { name: join }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
