import { type PlayerInfo, toView } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { scoreText, signedText } from '../../../components/player';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { configOf, fourPlayerGame, Table } from '../../replay/testing/games';
import { type ResultsSession, sessionResultsModel } from '../resultsModel';
import { ResultsScreen } from '../ResultsScreen';

/**
 * Stage 11 results (spec §12) for rated games, on real engine games: my rating change counting from the old
 * rating to the new one (a jump under Reduced Motion), each opponent's change, the full ranking of a
 * four-player game (a podium and the 4th place), and what each award means.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const hidden = { includeHiddenElements: true };

const sessionOf = (table: Table, me: string): ResultsSession => ({
  id: table.config.id,
  mode: table.config.mode,
  gameType: table.config.gameType,
  playerId: me,
  getView: () => toView(table.state, me, table.now),
});

/** Two rated players; `me` fills most of the board and wins. */
function rankedDuel(): Table {
  const players: PlayerInfo[] = [
    { id: 'me', name: 'Moshe', rating: 1287, ratedGames: 12 },
    { id: 'nina', name: 'NinaVolt', rating: 1305, ratedGames: 12 },
  ];
  const table = new Table(configOf('ranked', players, { id: 'duel' }));
  let k = 0;
  while (table.state.status === 'running') {
    table.move(k % 4 === 3 ? 'nina' : 'me', table.empty()[0]!, 1_000);
    k++;
  }
  return table;
}

async function show(
  table: Table,
  me: string,
  { fakeTimers = false, onOpenPlayer }: { fakeTimers?: boolean; onOpenPlayer?: (id: string) => void } = {},
) {
  const model = sessionResultsModel(sessionOf(table, me))!;
  await render(
    <ResultsScreen
      gameId={model.gameId}
      load={async () => ({ kind: 'found', model })}
      onNewGame={jest.fn()}
      onHome={jest.fn()}
      onOpenPlayer={onOpenPlayer}
    />,
  );
  await act(async () => {
    if (fakeTimers) await Promise.resolve();
    else await new Promise((r) => setImmediate(r));
  });
  return model;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  useProfile.setState({ avatarId: 'lava-lamp' });
});

describe('a rated two-player game', () => {
  const table = rankedDuel();
  const result = table.state.result!;
  const mine = result.ratingChanges.find((c) => c.playerId === 'me')!;
  const hers = result.ratingChanges.find((c) => c.playerId === 'nina')!;

  it('the model carries the engine’s rating changes, mine and the opponent’s', () => {
    const model = sessionResultsModel(sessionOf(table, 'me'))!;
    expect(mine.delta).toBeGreaterThan(0);
    expect(model.rating).toEqual({
      before: mine.before,
      after: mine.after,
      delta: mine.delta,
      provisional: false,
    });
    expect(model.opponents[0]!.rating).toMatchObject({
      before: hers.before,
      after: hers.after,
      delta: hers.delta,
    });
    expect(model.ranking).toEqual([]);
  });

  it('shows my new rating at once under Reduced Motion, with the change and the old rating', async () => {
    await show(table, 'me');
    expect(screen.getByTestId('results-rating-value', hidden)).toHaveAnimatedProps({
      text: String(Math.round(mine.after)),
    });
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      `שינוי דירוג: ${signedText(mine.delta)}, מ־${Math.round(mine.before)} ל־${Math.round(mine.after)}`,
    );
    expect(screen.getByTestId('results-rating-delta', hidden)).toHaveTextContent(signedText(mine.delta));
    expect(screen.queryByTestId('results-unrated')).toBeNull();
    // The opponent's row says how her rating moved.
    expect(screen.getByTestId('results-opponent-nina')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`דירוג ${signedText(hers.delta)}`),
    );
    expect(screen.getByTestId('results-opponent-nina-rating', hidden)).toHaveTextContent(
      `${Math.round(hers.before)} → ${Math.round(hers.after)}`,
      { exact: false },
    );
  });

  it('counts from the old rating to the new one when motion is on', async () => {
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
    try {
      await show(table, 'me', { fakeTimers: true });
      expect(screen.getByTestId('results-rating-value', hidden)).toHaveAnimatedProps({
        text: String(Math.round(mine.before)),
      });
      // The count starts as the sections land (motion.md ratingCountAt), then runs for rewardMax.
      await act(async () => {
        jest.advanceTimersByTime(1_200);
      });
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(screen.getByTestId('results-rating-value', hidden)).toHaveAnimatedProps({
        text: String(Math.round(mine.after)),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('every award says what it is for', async () => {
    await show(table, 'me');
    for (const a of result.awards)
      expect(screen.getByTestId(`results-award-${a.kind}-definition`, hidden)).toHaveTextContent(/\S/);
    expect(screen.getByTestId('results-award-bestMove-definition', hidden)).toHaveTextContent(
      'הניקוד הגבוה ביותר במהלך בודד',
    );
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show(table, 'nina');
    expect(screen.getByRole('header', { name: 'Defeat' })).toBeOnTheScreen();
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      `Rating change: ${signedText(hers.delta)}, from ${Math.round(hers.before)} to ${Math.round(hers.after)}`,
    );
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
  });
});

describe('a four-player game: the full ranking (spec §12)', () => {
  const table = fourPlayerGame();
  const result = table.state.result!;

  it('puts everyone in the ranking by place, me included, with each one’s rating change', () => {
    const model = sessionResultsModel(sessionOf(table, 'p2'))!;
    expect(model.ranking.map((r) => [r.playerId, r.place])).toEqual(
      result.ranking.map((r) => [r.playerId, r.place]),
    );
    expect(model.ranking.find((r) => r.isMe)).toMatchObject({ playerId: 'p2', colorIndex: 0 });
    // Whoever left first ranks last (spec §6.7): p3 surrendered before p4 abandoned.
    expect(model.ranking.find((r) => r.playerId === 'p4')).toMatchObject({ left: true, place: 3 });
    expect(model.ranking.find((r) => r.playerId === 'p3')).toMatchObject({ left: true, place: 4 });
    for (const r of model.ranking)
      expect(r.rating?.delta).toBe(result.ratingChanges.find((c) => c.playerId === r.playerId)!.delta);
  });

  it('splits my rating change by opponent, as the engine did (Results-4P), adding up to it', () => {
    const model = sessionResultsModel({ ...sessionOf(table, 'p2'), profiles: { p1: { avatarId: 'maya' } } })!;
    const engine = result.ratingPairs!.find((p) => p.playerId === 'p2')!;
    expect(model.ratingPairs.map((p) => [p.playerId, p.delta])).toEqual(
      engine.pairs.map((p) => [p.opponentId, p.delta]),
    );
    // The opponents by place, each with their seat colour (never mine) and their own avatar when known.
    expect(model.ratingPairs.map((p) => p.playerId)).toEqual(
      result.ranking.filter((r) => r.playerId !== 'p2').map((r) => r.playerId),
    );
    expect(model.ratingPairs.every((p) => p.colorIndex > 0)).toBe(true);
    expect(model.ratingPairs.find((p) => p.playerId === 'p1')).toMatchObject({ name: 'P1', avatar: 'maya' });
    const tenths = model.ratingPairs.reduce((a, p) => a + Math.round(p.delta * 10), 0);
    expect(tenths).toBe(model.rating!.delta * 10);

    // Two players: the one pair would be the change itself, so there is none.
    expect(sessionResultsModel(sessionOf(rankedDuel(), 'me'))!.ratingPairs).toEqual([]);
    // A result from before the split (no ratingPairs): none, and nothing breaks.
    const older = { ...result };
    delete older.ratingPairs;
    const view = toView(table.state, 'p2', table.now);
    const oldModel = sessionResultsModel({
      ...sessionOf(table, 'p2'),
      getView: () => ({ ...view, result: older }),
    })!;
    expect(oldModel.ratingPairs).toEqual([]);
    expect(oldModel.rating).toEqual(model.rating);
  });

  it('shows the change against each opponent under my rating, and says it for screen readers', async () => {
    const model = await show(table, 'p2');
    expect(screen.getByText('מחושב מול כל יריב בנפרד', hidden)).toBeOnTheScreen();
    for (const p of model.ratingPairs)
      expect(screen.getByTestId(`results-rating-pair-${p.playerId}-delta`, hidden)).toHaveTextContent(
        signedText(p.delta),
      );
    const said = model.ratingPairs.map((p) => `מול ${p.name}: ${signedText(p.delta)}`).join(', ');
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`. מחושב מול כל יריב בנפרד: ${said}`),
    );

    await i18n.changeLanguage('en');
    await show(table, 'p2');
    expect(screen.getByText('Counted against each opponent separately', hidden)).toBeOnTheScreen();
  });

  it('a ranked match’s opponents get their own avatars (the profiles from "found"); the rest keep the default', () => {
    const plain = sessionResultsModel(sessionOf(table, 'p2'))!;
    expect(plain.ranking.filter((r) => !r.isMe).every((r) => r.avatar === 'av00')).toBe(true);
    const model = sessionResultsModel({
      ...sessionOf(table, 'p2'),
      profiles: { p1: { avatarId: 'maya' }, p3: { avatarId: 'omer' }, p4: { avatarId: 'nope' } },
    })!;
    const avatarOf = (id: string) => model.ranking.find((r) => r.playerId === id)!.avatar;
    expect([avatarOf('p1'), avatarOf('p3'), avatarOf('p4')]).toEqual(['maya', 'omer', 'av00']);
  });

  it('draws a podium for the first three and a row for the 4th', async () => {
    const model = await show(table, 'p2');
    expect(screen.getByRole('header', { name: 'דירוג המשחק' })).toBeOnTheScreen();
    const [first, second, third, fourth] = model.ranking;
    for (const r of [first!, second!, third!])
      expect(screen.getByTestId(`results-podium-${r.place}-${r.playerId}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`results-ranking-4-${fourth!.playerId}`)).toHaveProp(
      'accessibilityLabel',
      `מקום 4: P3 · ${scoreText(fourth!.score)} נקודות · יצא מהמשחק · דירוג ${signedText(fourth!.rating!.delta)}`,
    );
    // Me: "אני", in the podium or the 4th row.
    expect(screen.getAllByLabelText(/^מקום \d: אני · /).length).toBe(1);
    expect(screen.queryByTestId('results-opponents')).toBeNull();
    expect(screen.getByTestId('results-rating')).toBeOnTheScreen();
  });
});

describe('stage 12: another player of a ranked game opens their card (spec §14.3)', () => {
  it('two players: the opponent’s row is a button', async () => {
    const onOpenPlayer = jest.fn();
    await show(rankedDuel(), 'me', { onOpenPlayer });
    const row = screen.getByTestId('results-opponent-nina');
    expect(row).toHaveProp('accessibilityRole', 'button');
    expect(row).toHaveProp('accessibilityHint', 'פתיחת כרטיס השחקן');
    await fireEvent.press(row);
    expect(onOpenPlayer).toHaveBeenCalledWith('nina');
  });

  it('four players: every other player opens their card; my own row does not', async () => {
    const onOpenPlayer = jest.fn();
    const model = await show(fourPlayerGame(), 'p2', { onOpenPlayer });
    for (const r of model.ranking) {
      const id =
        r.place === 4 ? `results-ranking-4-${r.playerId}` : `results-podium-${r.place}-${r.playerId}`;
      expect(screen.getByTestId(id)).toHaveProp('accessibilityRole', r.isMe ? 'text' : 'button');
    }
    const other = model.ranking.find((r) => !r.isMe && r.place < 4)!;
    await fireEvent.press(screen.getByTestId(`results-podium-${other.place}-${other.playerId}`));
    expect(onOpenPlayer).toHaveBeenCalledWith(other.playerId);
  });
});
