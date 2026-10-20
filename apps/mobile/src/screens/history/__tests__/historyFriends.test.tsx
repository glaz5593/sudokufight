import { render, screen } from '@testing-library/react-native';

import i18n from '../../../i18n';
import { HistoryCard } from '../HistoryCard';
import type { HistoryEntry } from '../historyModel';

/**
 * A game with friends in the history (1.0.4; friends-room.md §3.5, D81a): "עם חברים", and "בלי דירוג" where a
 * rated game shows its change. Its replay opens as any server game's.
 */

const hidden = { includeHiddenElements: true };
const NOW = Date.UTC(2026, 9, 20, 12);

const withFriends: HistoryEntry = {
  id: 'f1',
  source: 'ranked',
  mode: 'ranked',
  gameType: 'fast',
  startedAt: NOW - 60_000,
  outcome: 'win',
  place: 1,
  playerCount: 2,
  opponents: [{ id: 'dana', name: 'Dana', avatar: 'maya', isBot: false, country: 'IL', colorIndex: 1 }],
  myScore: 84.5,
  opponentScore: 62,
  ratingDelta: null,
  friends: true,
};

describe('a game with friends in the history', () => {
  it('says "עם חברים · בלי דירוג" (Hebrew)', async () => {
    await i18n.changeLanguage('he');
    await render(<HistoryCard entry={withFriends} myAvatar="lava-lamp" now={NOW} onOpen={jest.fn()} />);
    expect(screen.getByText('ניצחון · עם חברים · מהיר', hidden)).toBeTruthy();
    expect(screen.getByTestId('history-card-f1-rating', hidden)).toHaveTextContent('בלי דירוג');
    expect(screen.getByTestId('history-card-f1')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^ניצחון, .*Dana.*\. עם חברים · מהיר\. .+\. בלי דירוג\. /),
    );
  });

  it('and in English', async () => {
    await i18n.changeLanguage('en');
    await render(<HistoryCard entry={withFriends} myAvatar="lava-lamp" now={NOW} onOpen={jest.fn()} />);
    expect(screen.getByText('Win · With friends · Fast', hidden)).toBeTruthy();
    expect(screen.getByTestId('history-card-f1-rating', hidden)).toHaveTextContent('Unrated');
  });
});
