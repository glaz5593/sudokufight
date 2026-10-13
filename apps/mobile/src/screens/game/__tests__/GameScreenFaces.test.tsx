// The gesture handler's Jest mocks, before anything loads it (its native module does not exist under Jest).
import 'react-native-gesture-handler/jestSetup';

import { MOTIONS } from '@sudoku-fight/avatars';
import { cellName, ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { NO_AVATAR_ID } from '../../../avatars';
import { AVATAR_REACTIONS } from '../../../avatars/reactions';
import { avatarIdsIn, shownFace, svgXmlsIn } from '../../../avatars/testing/avatarTesting';
import { puzzleById } from '../../../game/offlinePool';
import { startPractice } from '../../../game/session';
import { answerIn, emptyCellsOf, smallPool, wrongIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';
import { type Duel, duel } from '../testing/duel';
import { type Group, group, ME } from '../testing/group';

/**
 * The avatars react to the game on the game screen (spec §3.4; the table: avatars/reactions.ts), on a practice
 * against a bot, a 3-player game and a solo practice on manual clocks: each card's face (AvatarArt's root
 * says it, hidden from screen readers) as the moves, the hits, the reactions and the time go by. With reduced
 * motion the faces change and nothing moves.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const hidden = { includeHiddenElements: true };
/** The face a card's avatar shows now. */
const faceOn = (card: string) => shownFace(screen.getByTestId(`${card}-avatar-image`, hidden));

/** The phone's timers in frames (AvatarArt's reactions, the screen's tick). */
async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

let close: (() => void) | null = null;
async function showDuel(): Promise<Duel> {
  const g = duel();
  close = () => g.session.close();
  await render(
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <GameScreen session={g.session} onEnded={jest.fn()} />
    </GestureHandlerRootView>,
  );
  return g;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useProfile.setState({ avatarId: NO_AVATAR_ID });
});
afterEach(() => {
  close?.();
  close = null;
  jest.useRealTimers();
});

describe('against a bot: each card’s face', () => {
  it('the bot’s correct digit: its avatar smiles for 1.2 s, then calm again; mine stays calm', async () => {
    const g = await showDuel();
    expect(faceOn('card-opponent')).toBe('neutral');
    await act(async () => g.bot.solve(g.cells[0]!));
    await frames(50);
    expect(faceOn('card-opponent')).toBe('smile');
    expect(faceOn('card-me')).toBe('neutral');
    await frames(1_200);
    expect(faceOn('card-opponent')).toBe('neutral');
  });

  it('my wrong digit: my avatar looks sad and shakes (its layers move), then stays sad, still, to 1.6 s', async () => {
    useProfile.setState({ avatarId: 'fox' });
    const g = await showDuel();
    const cell = g.cells[0]!;
    const art = () => screen.getByTestId('card-me-avatar-image', hidden);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
    await act(async () => g.host.place(cell, wrongIn(g.puzzle, cell)));
    await frames(50);
    expect(faceOn('card-me')).toBe('sad');
    // Moving: layers, none of them the still picture with its id.
    expect(avatarIdsIn(art())).toEqual([]);
    await frames(MOTIONS.shake.durationMs);
    expect(faceOn('card-me')).toBe('sad');
    expect(avatarIdsIn(art())).toEqual(['fox']);
    await frames(1_600 - MOTIONS.shake.durationMs);
    expect(faceOn('card-me')).toBe('neutral');
  });

  it('the bot’s reaction emoji plays on its face (😎: a wink)', async () => {
    const g = await showDuel();
    await act(async () => g.bot.react('😎'));
    await frames(50);
    expect(faceOn('card-opponent')).toBe('wink');
  });

  it('an interference on me: dizzy while it lasts; the bot winks as it sends it', async () => {
    const g = await showDuel();
    await act(async () => g.bot.solve(g.cells[0]!)); // the bot needs the points (D10)
    await act(async () => g.clock.advance(3_000));
    await frames(1_500);
    await act(async () => g.bot.interfere('cats'));
    await frames(50);
    expect(faceOn('card-me')).toBe('dizzy');
    expect(faceOn('card-opponent')).toBe('wink');
    expect(screen.getByTestId('hit-layer-banner-avatar', hidden)).toBeTruthy();
    expect(shownFace(screen.getByTestId('hit-layer-banner-avatar', hidden))).toBe(
      AVATAR_REACTIONS.moods.sender,
    );
    await act(async () => g.scheduler.advance(3_000));
    await frames(300);
    expect(faceOn('card-me')).toBe('dizzy');
    await act(async () => g.scheduler.advance(2_000));
    await frames(2_000);
    expect(faceOn('card-me')).toBe('neutral');
  });

  it('20 s without an action of mine: my avatar falls asleep; a tap on the board wakes it', async () => {
    const g = await showDuel();
    await act(async () => g.clock.advance(AVATAR_REACTIONS.sleepy!.afterMs));
    await frames(300);
    expect(faceOn('card-me')).toBe('sleepy');
    expect(faceOn('card-opponent')).toBe('neutral');
    await fireEvent.press(screen.getByTestId(`cell-${cellName(g.cells[0]!)}`));
    await frames(50);
    expect(faceOn('card-me')).toBe('neutral');
  });

  it('reduced motion: the faces change, the avatars never move (one still picture each)', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await showDuel();
    await act(async () => g.bot.solve(g.cells[0]!));
    await frames(50);
    expect(faceOn('card-opponent')).toBe('smile');
    expect(avatarIdsIn(screen.getByTestId('card-opponent-avatar-image', hidden))).toEqual(['owl']);
    expect(svgXmlsIn(screen.getByTestId('card-opponent-avatar-image', hidden))).toHaveLength(1);
  });
});

describe('3 players: every compact card reacts', () => {
  let current: Group | null = null;
  afterEach(() => {
    current?.session.close();
    current = null;
  });

  it('a hit between two others: the target is dizzy, the sender winks, my face stays calm', async () => {
    const g = (current = group());
    await render(
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <GameScreen session={g.session} onEnded={jest.fn()} />
      </GestureHandlerRootView>,
    );
    const [pip, biscuit] = [g.players[1]!.id, g.players[2]!.id];
    await act(async () => g.as(pip).solve(g.cells[0]!));
    await act(async () => g.clock.advance(3_000));
    await frames(1_500);
    expect(faceOn(`card-${pip}`)).toBe('neutral');
    await act(async () => g.as(pip).interfere(biscuit, 'warp'));
    await frames(50);
    expect(faceOn(`card-${biscuit}`)).toBe('dizzy');
    expect(faceOn(`card-${pip}`)).toBe('wink');
    expect(faceOn('card-me')).toBe('neutral');
    expect(g.players[0]!.id).toBe(ME);
  });
});

describe('solo practice', () => {
  it('my correct digit smiles on the solo card', async () => {
    const clock = new ManualClock(1_000_000);
    const scheduler = new ManualScheduler(clock);
    const session = await startPractice(
      { gameType: 'fast' },
      { repo: null, clock, scheduler, pool: smallPool(1), seed: 7, track: () => undefined },
    );
    close = () => session.close();
    const puzzle = puzzleById(session.puzzleId)!;
    await render(<GameScreen session={session} onEnded={jest.fn()} />);
    expect(faceOn('solo-hud')).toBe('neutral');
    const cell = emptyCellsOf(puzzle)[0]!;
    await fireEvent.press(screen.getByTestId(`cell-${cellName(cell)}`));
    await act(async () => session.host.place(cell, answerIn(puzzle, cell)));
    await frames(50);
    expect(faceOn('solo-hud')).toBe('smile');
  });
});
