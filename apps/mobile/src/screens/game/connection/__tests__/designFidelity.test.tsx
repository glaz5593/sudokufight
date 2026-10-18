/*
 * Stage 13 design QA of the connection screens against their boards (docs/design/screens/*.dc.html, in C's
 * look): Connection-Error, Opponent-Left, Surrender, Self-Reconnecting and Loading.
 */
import type { GameView, PlayerView } from '@sudoku-fight/engine';
import type { RatingEntry } from '@sudoku-fight/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { color } from '../../../../theme';
import { ConnectingView } from '../ConnectingView';
import { ConnectionError } from '../ConnectionError';
import type { ConnectionErrorModel, OpponentLeftModel, SelfReconnectingModel } from '../connectionModel';
import { OpponentLeft } from '../OpponentLeft';
import { RankedSurrender } from '../RankedSurrender';
import { ScoreLine, type ScoreLineData } from '../ScoreLine';
import { SelfReconnecting } from '../SelfReconnecting';
import { surrenderCostsNothing, surrenderRatingEstimate } from '../surrenderEstimate';
import { hidden, iso, type Setup, setUp, styleOf, wait } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));

let env: Setup;
afterEach(() => env.restore());

const errorModel = (over: Partial<ConnectionErrorModel> = {}): ConnectionErrorModel => ({
  kind: 'error',
  failure: 'unreachable',
  code: 'ERR_SOCKET_TIMEOUT · 504',
  attempts: 1,
  retrying: false,
  refusal: null,
  ...over,
});

const leftModel: OpponentLeftModel = {
  kind: 'opponentLeft',
  playerId: 'nina',
  name: 'NinaVolt',
  colorIndex: 1,
  me: { id: 'me', name: 'MosheG', score: 55 },
  opponentScore: 39.5,
  ratingDelta: 9,
  ratingGuard: null,
  gameType: 'normal',
  graceSeconds: 15,
};

const duel = (myScore: number, opponentScore: number): ScoreLineData => ({
  myName: 'MosheG',
  myScore,
  opponentName: 'NinaVolt',
  opponentScore,
  opponentColorIndex: 1,
});

const handlers = () => ({ onRetry: jest.fn(), onHome: jest.fn(), onPractice: jest.fn() });

describe.each(['he', 'en'] as const)('Connection-Error board (%s)', (lang) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  it('says "לבית" / "Home" for the way out, as the board does', async () => {
    const h = handlers();
    await render(<ConnectionError model={errorModel()} {...h} />);
    await fireEvent.press(screen.getByRole('button', { name: lang === 'he' ? 'לבית' : 'Home' }));
    expect(h.onHome).toHaveBeenCalledTimes(1);
  });

  it('puts the failed attempt in a red chip beside the code', async () => {
    await render(<ConnectionError model={errorModel({ attempts: 2 })} {...handlers()} />);
    const chip = screen.getByTestId('connection-error-attempts');
    expect(chip).toHaveTextContent(lang === 'he' ? 'ניסיון 2 נכשל' : 'Try 2 failed');
    expect(styleOf(chip)).toMatchObject({
      borderColor: color.dangerBorder,
      backgroundColor: color.dangerSubtle,
    });
    // The code and the chip share one row (it wraps on a narrow screen).
    const row = screen.getByTestId('connection-error-meta');
    expect(styleOf(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(within(row).getByTestId('connection-error-code')).toBeOnTheScreen();
    expect(within(row).getByTestId('connection-error-attempts')).toBeOnTheScreen();
  });
});

describe.each(['he', 'en'] as const)('Opponent-Left board (%s)', (lang) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  const ui = (onHome = jest.fn()) => <OpponentLeft model={leftModel} onResults={jest.fn()} onHome={onHome} />;

  it('marks the departed avatar with the exit badge, hidden from screen readers', async () => {
    await render(ui());
    expect(screen.queryByTestId('opponent-left-exit')).not.toBeOnTheScreen();
    expect(screen.getByTestId('opponent-left-exit', hidden)).toHaveProp('accessibilityElementsHidden', true);
  });

  it('"לבית" is the secondary outline under the one primary, not a text link', async () => {
    const onHome = jest.fn();
    await render(ui(onHome));
    const home = screen.getByRole('button', { name: lang === 'he' ? 'לבית' : 'Home' });
    expect(styleOf(home)).toMatchObject({ borderWidth: 1, borderColor: color.border });
    expect(screen.queryByTestId('opponent-left-home-shadow')).not.toBeOnTheScreen();
    expect(screen.getByTestId('opponent-left-results-shadow')).toBeOnTheScreen();
    await fireEvent.press(home);
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('gives each final score its seat shape: ● for me, ▲ for the opponent', async () => {
    await render(ui());
    const scores = screen.getByTestId('opponent-left-scores');
    expect(within(scores).getByTestId('glyph-circle', hidden)).toBeTruthy();
    expect(within(scores).getByTestId('glyph-triangle', hidden)).toBeTruthy();
  });
});

describe.each(['he', 'en'] as const)('Surrender board (%s)', (lang) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  const surrender = (summary: ScoreLineData) => (
    <RankedSurrender visible players={2} summary={summary} onConfirm={jest.fn()} onCancel={jest.fn()} />
  );

  it('says who leads and by how much in my colour, with the lead bar under the scores', async () => {
    await render(surrender(duel(55, 39.5)));
    expect(screen.getByTestId('ranked-surrender-summary-lead')).toHaveTextContent(
      lang === 'he' ? 'אתה מוביל⁦+15.5⁩' : 'You lead⁦+15.5⁩',
    );
    expect(screen.getByTestId('ranked-surrender-summary-lead-gap')).toHaveStyle({
      color: color.players[0].ring,
    });
    const bar = screen.getByTestId('ranked-surrender-summary-bar');
    const [mine, theirs] = bar.children as unknown as { props: { style?: unknown } }[];
    expect(styleOf(mine!)).toMatchObject({ backgroundColor: color.players[0].ring });
    expect(styleOf(theirs!)).toMatchObject({ backgroundColor: color.players[1].ring });
    expect(styleOf(mine!).flex).toBeGreaterThan(styleOf(theirs!).flex as number);
    expect(screen.queryByText('VS', hidden)).not.toBeOnTheScreen();
  });

  it("names the opponent when they lead, in the opponent's colour; a tie says so", async () => {
    const { unmount } = await render(surrender(duel(10, 22.5)));
    expect(screen.getByTestId('ranked-surrender-summary-lead')).toHaveTextContent(
      lang === 'he' ? `${iso('NinaVolt')} מוביל⁦+12.5⁩` : `${iso('NinaVolt')} leads⁦+12.5⁩`,
    );
    expect(screen.getByTestId('ranked-surrender-summary-lead-gap')).toHaveStyle({
      color: color.players[1].ring,
    });
    await unmount();
    await render(surrender(duel(20, 20)));
    expect(screen.getByTestId('ranked-surrender-summary-lead')).toHaveTextContent(
      lang === 'he' ? 'שוויון0' : 'Tie0',
    );
  });
});

describe('ScoreLine', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('keeps the VS badge and no bar when the game is over', async () => {
    await render(<ScoreLine {...duel(55, 39.5)} testID="line" />);
    expect(screen.getByText('VS', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('line-bar')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('line-lead')).not.toBeOnTheScreen();
  });
});

const player = (over: Partial<PlayerView>): PlayerView =>
  ({
    id: 'me',
    seat: 0,
    name: null,
    isBot: false,
    rating: 1287,
    status: 'active',
    connected: true,
    graceEndsAt: null,
    score: 0,
    mistakes: 0,
    mistakePenalties: [],
    correct: 0,
    place: 1,
    isLeader: false,
    lock: null,
    hitBy: null,
    immuneUntil: 0,
    bestMove: null,
    ...over,
  }) as PlayerView;

const rankedView = (over: Partial<GameView> = {}): GameView =>
  ({
    mode: 'ranked',
    gameType: 'normal',
    me: 'me',
    players: [player({}), player({ id: 'nina', seat: 1, rating: 1305 })],
    // The engine's leave guards (spec §11.2): none, so a surrender now is a normal loss.
    leaveGuards: [],
    ...over,
  }) as GameView;

const entry = (over: Partial<RatingEntry> = {}): RatingEntry => ({
  key: 'normal',
  rating: 1287,
  games: 30,
  provisional: false,
  peak: 1300,
  ...over,
});

describe('surrenderRatingEstimate (the Surrender board: "שינוי דירוג משוער −15")', () => {
  it("is the engine's loss for my rating against theirs: 1287 vs 1305 → −15 (spec §11.2's example)", () => {
    expect(surrenderRatingEstimate(rankedView(), [entry()])).toEqual({ delta: -15, guard: null });
  });

  it('doubles in my first 10 games of the key', () => {
    expect(surrenderRatingEstimate(rankedView(), [entry({ games: 3, provisional: true })])).toEqual({
      delta: -30,
      guard: null,
    });
  });

  it('reads the per-table key first (RATING_OPTION A)', () => {
    expect(
      surrenderRatingEstimate(rankedView(), [
        entry({ key: 'normal-2p', games: 3 }),
        entry({ key: 'normal' }),
      ]),
    ).toEqual({ delta: -30, guard: null });
  });

  it('is 0, with the reason, when the engine says a surrender now costs nothing (spec §11.2)', () => {
    for (const reason of ['leftBeforeMoving', 'leftNotBehind'] as const) {
      const view = rankedView({ leaveGuards: [{ opponentId: 'nina', reason }] });
      expect(surrenderRatingEstimate(view, [entry()])).toEqual({ delta: 0, guard: reason });
      // Nothing is lost either way, so no rating entry is needed to say so.
      expect(surrenderRatingEstimate(view, null)).toEqual({ delta: 0, guard: reason });
    }
    // An unrated game (a development room): no rating to speak of, guard or not.
    expect(
      surrenderRatingEstimate(
        rankedView({
          players: [player({ rating: null }), player({ id: 'nina', seat: 1, rating: null })],
          leaveGuards: [{ opponentId: 'nina', reason: 'leftBeforeMoving' }],
        }),
        null,
      ),
    ).toBeNull();
    // A guard against someone else is not mine here.
    expect(
      surrenderRatingEstimate(rankedView({ leaveGuards: [{ opponentId: 'x', reason: 'leftNotBehind' }] }), [
        entry(),
      ]),
    ).toEqual({ delta: -15, guard: null });
  });

  it('a view from an older engine (no leaveGuards) is the plain estimate', () => {
    const older = rankedView();
    delete (older as Partial<GameView>).leaveGuards;
    expect(surrenderRatingEstimate(older, [entry()])).toEqual({ delta: -15, guard: null });
  });

  it('is null when it cannot be told honestly', () => {
    expect(surrenderRatingEstimate(rankedView({ mode: 'bot' }), [entry()])).toBeNull();
    expect(surrenderRatingEstimate(rankedView(), null)).toBeNull();
    expect(surrenderRatingEstimate(rankedView(), [entry({ key: 'hard' })])).toBeNull();
    expect(
      surrenderRatingEstimate(
        rankedView({ players: [player({}), player({ id: 'nina', seat: 1, rating: null })] }),
        [entry()],
      ),
    ).toBeNull();
    expect(
      surrenderRatingEstimate(
        rankedView({
          players: [player({}), player({ id: 'b', seat: 1 }), player({ id: 'c', seat: 2 })],
        }),
        [entry()],
      ),
    ).toBeNull();
  });
});

describe('surrenderCostsNothing (3–4 players)', () => {
  const four = (leaveGuards: GameView['leaveGuards']) =>
    rankedView({
      players: [
        player({}),
        player({ id: 'b', seat: 1 }),
        player({ id: 'c', seat: 2 }),
        player({ id: 'd', seat: 3, status: 'surrendered' }),
      ],
      leaveGuards,
    });

  it('is true only when every opponent still in the game is guarded', () => {
    const guard = (opponentId: string) => ({ opponentId, reason: 'leftNotBehind' as const });
    expect(surrenderCostsNothing(four([guard('b'), guard('c')]))).toBe(true);
    expect(surrenderCostsNothing(four([guard('b')]))).toBe(false);
    expect(surrenderCostsNothing(four([]))).toBe(false);
    expect(surrenderCostsNothing(four(null))).toBe(false);
    expect(surrenderCostsNothing({ ...four([guard('b'), guard('c')]), mode: 'bot' })).toBe(false);
    // A development room has no ratings: nothing to say about them.
    const unrated = four([guard('b'), guard('c')]);
    expect(
      surrenderCostsNothing({ ...unrated, players: unrated.players.map((p) => ({ ...p, rating: null })) }),
    ).toBe(false);
  });
});

describe.each(['he', 'en'] as const)('Self-Reconnecting board (%s)', (lang) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  const back = (phase: 'syncing' | 'synced'): SelfReconnectingModel => ({
    kind: 'selfReconnecting',
    phase,
    attempt: null,
    secondsLeft: null,
    remainingMs: null,
    graceMs: 15_000,
    syncItems: ['board', 'score', 'locks', 'timers'],
  });

  it('titles the card "מסנכרן…" while syncing and "הכל סונכרן" once all is back', async () => {
    const { rerender } = await render(<SelfReconnecting model={back('syncing')} />);
    expect(screen.getByTestId('self-reconnecting-card-title', hidden)).toHaveTextContent(
      lang === 'he' ? 'מסנכרן…' : 'Syncing…',
    );
    await rerender(<SelfReconnecting model={back('synced')} />);
    expect(screen.getByTestId('self-reconnecting-card-title', hidden)).toHaveTextContent(
      lang === 'he' ? 'הכל סונכרן' : 'All synced',
    );
    await wait(400);
  });
});

describe.each(['he', 'en'] as const)('Loading board, the game card (%s)', (lang) => {
  beforeEach(async () => {
    env = await setUp(lang);
  });

  it('titles the card "טוען לוח…" under "בכניסה למשחק", with the step under the marks', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'room' }} />);
    expect(screen.getByText(lang === 'he' ? 'בכניסה למשחק' : 'Entering the game')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-board')).toHaveTextContent(
      lang === 'he' ? 'טוען לוח…' : 'Loading the board…',
    );
    const card = screen.getByTestId('connecting-card');
    expect(styleOf(card)).toMatchObject({ backgroundColor: color.surface, borderColor: color.border });
    expect(within(card).getByTestId('connecting-step')).toHaveTextContent(
      lang === 'he' ? 'נכנס לחדר…' : 'Entering the room…',
    );
    // Still one progress bar for screen readers.
    expect(screen.getByRole('progressbar')).toHaveAccessibleName(
      lang === 'he' ? 'טעינת המשחק, שלב 2 מתוך 3' : 'Loading the game, step 2 of 3',
    );
  });
});
