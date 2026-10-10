import { render, screen } from '@testing-library/react-native';

import { ltr, paletteAt } from '../../../components/player';
import i18n from '../../../i18n';
import { color } from '../../../theme';
import { HistoryCard } from '../HistoryCard';
import type { HistoryEntry } from '../historyModel';

/**
 * Stage 13 design QA of a history card (History.dc.html): my score is in my colour (me is always P1,
 * CLAUDE.md), the opponent's muted, and "84.5 : 62" stays left to right inside Hebrew.
 */

const hidden = { includeHiddenElements: true };
const NOW = Date.UTC(2026, 9, 10, 12);
const ME = paletteAt(0).ring;

const duel: HistoryEntry = {
  id: 'g1',
  source: 'ranked',
  mode: 'ranked',
  gameType: 'normal',
  startedAt: NOW - 60_000,
  outcome: 'win',
  place: 1,
  playerCount: 2,
  opponents: [{ id: 'lior', name: 'Lior.K', avatar: 'av12', isBot: false, country: 'IL', colorIndex: 1 }],
  myScore: 84.5,
  opponentScore: 62,
  ratingDelta: 11,
};

const four: HistoryEntry = {
  ...duel,
  id: 'g4',
  place: 2,
  outcome: 'loss',
  playerCount: 4,
  opponents: [
    { id: 'a', name: 'A', avatar: 'av01', isBot: false, country: null, colorIndex: 1 },
    { id: 'b', name: 'B', avatar: 'av02', isBot: false, country: null, colorIndex: 2 },
    { id: 'c', name: 'C', avatar: 'av03', isBot: false, country: null, colorIndex: 3 },
  ],
  myScore: 47.5,
  opponentScore: null,
  ratingDelta: 6,
};

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as object;

describe.each(['he', 'en'] as const)('HistoryCard in %s', (lng) => {
  beforeEach(async () => {
    await i18n.changeLanguage(lng);
  });

  it('one opponent: "84.5 : 62" isolated LTR, mine in P1 and theirs muted', async () => {
    await render(<HistoryCard entry={duel} myAvatar="av07" now={NOW} onOpen={jest.fn()} />);
    expect(screen.getByTestId('history-card-g1-score', hidden)).toHaveTextContent(ltr('84.5 : 62'));
    expect(flat(screen.getByTestId('history-card-g1-score', hidden).props.style)).toMatchObject({
      color: color.textMuted,
    });
    expect(flat(screen.getByTestId('history-card-g1-my-score', hidden).props.style)).toMatchObject({
      color: ME,
    });
  });

  it('several opponents: my points in P1', async () => {
    await render(<HistoryCard entry={four} myAvatar="av07" now={NOW} onOpen={jest.fn()} />);
    expect(flat(screen.getByTestId('history-card-g4-score', hidden).props.style)).toMatchObject({
      color: ME,
    });
    expect(screen.queryByTestId('history-card-g4-my-score', hidden)).toBeNull();
  });
});
