import { toView } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';

import { shownFace } from '../../../avatars/testing/avatarTesting';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { BOT } from '../../game/testing/duel';
import { fourPlayerGame } from '../../replay/testing/games';
import { loadPracticeResults, type ResultsLoad, resultsModel, sessionResultsModel } from '../resultsModel';
import { ResultsScreen } from '../ResultsScreen';
import { lostDuel, type SavedDuel, tiedRecord, wonDuel } from '../testing/duelGames';

/**
 * The avatars react to the end on the results (spec §3.4, §12): as the players' section lands, the winner
 * laughs and spins, then smiles on (and idles); whoever is behind looks sad; a draw smiles. Before that, the
 * moods; with reduced motion the faces alone, as soon as the section fades in.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const hidden = { includeHiddenElements: true };
const faceOf = (testID: string) => shownFace(screen.getByTestId(`${testID}-avatar-image`, hidden));
const victory = motion.sequence.victory;
/** When the players' section is in place (section 1 of the sequence). */
const LANDED = victory.crownAt + victory.awardsStagger + motion.duration.rewardMin;

async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

async function show(load: (id: string) => Promise<ResultsLoad>, id: string) {
  await render(<ResultsScreen gameId={id} load={load} onNewGame={jest.fn()} onHome={jest.fn()} />);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
}

const fromDisk = (game: SavedDuel) => (id: string) =>
  loadPracticeResults(id, { repo: async () => game.repo, session: () => null });

beforeEach(async () => {
  // The load waits on a real setImmediate; everything else on the test's clock.
  jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useProfile.setState({ avatarId: 'fox' });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('against a bot', () => {
  it('I lost: the bot’s avatar smiles, then laughs and spins as the section lands, then smiles on', async () => {
    const game = await lostDuel();
    await show(fromDisk(game), game.id);
    const bot = `results-opponent-${BOT.id}`;
    expect(faceOf(bot)).toBe('smile');
    await frames(LANDED - 100);
    expect(faceOf(bot)).toBe('smile');
    await frames(150);
    expect(faceOf(bot)).toBe('laugh');
    await frames(2_000);
    expect(faceOf(bot)).toBe('smile');
  });

  it('I won: the bot looks sad; a tie: it smiles', async () => {
    const won = await wonDuel();
    await show(fromDisk(won), won.id);
    await frames(LANDED + 100);
    expect(faceOf(`results-opponent-${BOT.id}`)).toBe('sad');
    screen.unmount();

    const saved = (await won.repo.getGame(won.id))!;
    const model = resultsModel(tiedRecord(saved, BOT.id), await won.repo.loadEvents(won.id));
    await show(async () => ({ kind: 'found', model }), won.id);
    await frames(LANDED + 100);
    expect(faceOf(`results-opponent-${BOT.id}`)).toBe('smile');
  });

  it('reduced motion: the face alone, as the section fades in (200 ms)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const game = await lostDuel();
    await show(fromDisk(game), game.id);
    await frames(motion.duration.reducedFade + 50);
    const art = screen.getByTestId(`results-opponent-${BOT.id}-avatar-image`, hidden);
    expect(shownFace(art)).toBe('laugh');
  });
});

describe('4 players: the podium', () => {
  it('first laughs as the podium lands; second, third and fourth look sad', async () => {
    const table = fourPlayerGame();
    const ranking = table.state.result!.ranking;
    const me = ranking.find((r) => r.place === 2)!.playerId;
    const model = sessionResultsModel({
      id: table.config.id,
      mode: table.config.mode,
      gameType: table.config.gameType,
      playerId: me,
      getView: () => toView(table.state, me, table.now),
    })!;
    await show(async () => ({ kind: 'found', model }), model.gameId);
    const at = (place: number) => {
      const r = ranking.find((x) => x.place === place)!;
      return place <= 3 ? `results-podium-${place}-${r.playerId}` : `results-ranking-${place}-${r.playerId}`;
    };
    expect(faceOf(at(1))).toBe('smile');
    await frames(LANDED + 100);
    expect(faceOf(at(1))).toBe('laugh');
    for (const place of [2, 3, 4]) expect(faceOf(at(place))).toBe('sad');
  });
});
