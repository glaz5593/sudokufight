import { cellName, missedPoints, type Rules } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { formatScore, ltr, scoreText, signedText } from '../../../components/player';
import { useToast } from '../../../components/ui';
import { answerIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { GameScreen, type GameSession } from '../GameScreen';
import { isolateName } from '../hit';
import { useReactionMutes } from '../reactions';
import { type Duel, duel } from '../testing/duel';
import { avatarIdsIn } from '../../../avatars/testing/avatarTesting';

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
const feedback = jest.requireMock<{ cue: jest.Mock; preloadCues: jest.Mock; cueCountUp: jest.Mock }>(
  '../../../services/feedback',
);
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const hidden = { includeHiddenElements: true };

let game: Duel | null = null;
/**
 * The game screen on a practice against a bot. A practice has no interferences [D44]: the tests of the
 * interference UI pass `rules: { interferences: true }` (a 2-player game where they are on).
 */
async function show(onEnded = jest.fn(), rules?: Partial<Rules>) {
  game = duel({ rules });
  await render(<GameScreen session={game.session} onEnded={onEnded} />);
  return { ...game, onEnded };
}

/** Moves the phone's timers on in frames, so every step of a count or a flight renders. */
async function frames(ms: number, frame = 50) {
  for (let t = 0; t < ms; t += frame) {
    await act(async () => {
      jest.advanceTimersByTime(frame);
    });
  }
}

/** The layouts the flights and floats need: a 390 × 844 screen as on Dir-C-Game (cards 159 × 160 at 16). */
async function layOut() {
  const layout = (testID: string, x: number, y: number, width: number, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x, y, width, height } } });
  await layout('duel-hud', 16, 48, 358, 160);
  await layout('duel-hud-mine', 199, 0, 159, 160); // Hebrew: mine on the right
  await layout('duel-hud-theirs', 0, 0, 159, 160);
  await layout('board-room', 0, 288, 390, 358);
  await layout('board-slot', 16, 0, 358, 358);
}

const theirScore = () => screen.getByTestId('card-opponent-score', hidden);
const myScore = () => screen.getByTestId('card-me-score', hidden);
const botScore = (g: Duel) => g.host.getView().players[1]!.score;
const live = () => screen.getByTestId('game-live');
/** The live region speaks at most every 1.5 s. */
const spoken = () => frames(1_600);

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useReactionMutes.getState().reset();
});

afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

describe('GameScreen against a bot (spec §6.8, §9)', () => {
  it('two cards, me at the start; the lead bar; no solo HUD; the cards’ actions as the view says', async () => {
    useProfile.setState({ country: 'IL' });
    await show();
    expect(screen.queryByTestId('solo-hud')).toBeNull();
    expect(screen.queryByTestId('board-progress')).toBeNull();
    expect(screen.getByLabelText('אני · 0 נקודות · אין טעויות')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Mr. Hoot · 0 נקודות · חושב, אין טעויות, בוט, רמה 3, מתקדם, מחובר'),
    ).toBeOnTheScreen();
    const theirs = within(screen.getByTestId('card-opponent'));
    expect(theirs.getByTestId('bot-chip', hidden)).toBeOnTheScreen();
    // The bot's level under its name, where a player's rating would be (Game-Bot: "בוט · חד"; spec §9).
    expect(theirs.getByTestId('card-opponent-bot-level', hidden)).toHaveTextContent('3 · מתקדם');
    expect(screen.queryByTestId('card-me-bot-level', hidden)).toBeNull();
    // A practice has no profiles: my flag is my profile's (Game-Bot board); the bot has none.
    expect(screen.queryAllByTestId(/^flag-/, hidden).map((f) => f.props.testID)).toEqual(['flag-IL']);
    expect(within(screen.getByTestId('card-me')).getByTestId('flag-IL', hidden)).toBeTruthy();
    expect(screen.getByLabelText('שוויון בניקוד')).toBeOnTheScreen();
    // Me first in the row: the start edge (the right in Hebrew).
    const row = screen.getByTestId('duel-hud');
    expect(row.children[0]).toBe(screen.getByTestId('duel-hud-mine'));

    // "סיום אימון" works (spec §6.6); so do reactions (§8); no "הפרעה" against a bot [D44].
    expect(screen.getByRole('button', { name: 'סיום אימון' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeEnabled();
    expect(screen.queryByTestId('interfere', hidden)).toBeNull();
    expect(screen.getByLabelText('בחר משבצת')).toBeOnTheScreen();
  });

  it('the bot’s lock shows on the board with its avatar; its card says what it is choosing', async () => {
    const g = await show();
    const a = g.cells[0]!;
    const name = cellName(a);
    await act(async () => g.bot.select(a));
    const cell = screen.getByTestId(`cell-${name}`);
    expect(cell).toHaveProp('accessibilityLabel', `${name}, ריקה, נעולה על ידי Mr. Hoot, 8 שניות`);
    expect(avatarIdsIn(within(cell).getByTestId('cell-avatar', hidden))).toEqual(['owl']);
    expect(avatarIdsIn(screen.getByTestId('card-opponent'))).toEqual(['owl']);
    expect(
      screen.getByLabelText(`Mr. Hoot · 0 נקודות · בוחר ${name}, אין טעויות, בוט, רמה 3, מתקדם, מחובר`),
    ).toBeOnTheScreen();
  });

  it('my card shows my profile’s avatar; the bot’s lock never shows mine', async () => {
    useProfile.setState({ avatarId: 'lava-lamp' });
    const g = await show();
    expect(avatarIdsIn(screen.getByTestId('card-me'))).toEqual(['lava-lamp']);
    await fireEvent.press(screen.getByTestId(`cell-${cellName(g.cells[0]!)}`));
    expect(
      within(screen.getByTestId(`cell-${cellName(g.cells[0]!)}`)).queryByTestId('cell-avatar', hidden),
    ).toBeNull();
  });
});

describe('a ranked duel’s profiles (spec §6.8)', () => {
  it('the opponent’s own avatar, and a flag on both cards, as the match gave them', async () => {
    game = duel();
    const s = game.session;
    const opponent = s.getView().players.find((p) => p.id !== s.playerId)!.id;
    const session: GameSession = {
      id: s.id,
      host: s.host,
      clock: s.clock,
      playerId: s.playerId,
      getView: () => s.getView(),
      subscribe: (listener) => s.subscribe(listener),
      endPractice: () => s.endPractice(),
      profiles: {
        [s.playerId]: { avatarId: 'sun', country: 'IL' },
        [opponent]: { avatarId: 'maya', country: 'DE' },
      },
    };
    await render(<GameScreen session={session} onEnded={jest.fn()} />);
    expect(avatarIdsIn(screen.getByTestId('card-opponent'))).toEqual(['maya']);
    expect(within(screen.getByTestId('card-opponent')).getByTestId('flag-DE', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('card-me')).getByTestId('flag-IL', hidden)).toBeTruthy();
  });
});

describe('the bot’s moves (spec §6.4, §6.5; motion.md §4.2: in its colour, to its own card)', () => {
  it('a correct move: the cell takes its colour, its chip flies to its card and its score counts; mine stays', async () => {
    const g = await show();
    await layOut();
    const a = g.cells[0]!;
    const name = cellName(a);
    await act(async () => g.bot.solve(a));
    const points = botScore(g);
    expect(points).toBeGreaterThan(0);

    expect(screen.getByTestId(`cell-${name}`)).toHaveProp(
      'accessibilityLabel',
      `${name}, ${answerIn(g.puzzle, a)}, נפתרה על ידי Mr. Hoot`,
    );
    const seq = g.host.events.find((e) => e.type === 'placedCorrect')!.seq;
    expect(screen.getByTestId(`flight-${seq}`, hidden)).toHaveTextContent(signedText(points));
    expect(theirScore()).toHaveAnimatedProps({ text: '0' }); // held until the chip lands
    await frames(750);
    expect(screen.getByTestId('card-opponent-delta', hidden)).toHaveTextContent(signedText(points));
    await frames(700);
    expect(theirScore()).toHaveAnimatedProps({ text: formatScore(points) });
    expect(myScore()).toHaveAnimatedProps({ text: '0' });
    // Opponents' board moves are silent (motion.md §7); the live region says them, and the new leader.
    expect(cues()).toEqual([]);
    expect(feedback.cueCountUp).not.toHaveBeenCalled();
    await spoken();
    expect(live()).toHaveTextContent(
      `Mr. Hoot פתר את ${ltr(name)}: ${answerIn(g.puzzle, a)}, ${signedText(points)}, ` +
        `Mr. Hoot מוביל ב־${formatScore(points)} נקודות`,
    );
    expect(screen.getByLabelText(`Mr. Hoot מוביל ב־${formatScore(points)} נקודות`)).toBeOnTheScreen();
  });

  it('a wrong move: the red digit stays on the board, the penalty lands on its card', async () => {
    const g = await show();
    await layOut();
    const a = g.cells[0]!;
    const name = cellName(a);
    const before = g.host.getView().grid.slice();
    let digit = 0;
    await act(async () => {
      digit = g.bot.miss(a);
    });
    // The engine's penalty (§6.5): what the right digit would have scored in that cell.
    const wrong = g.host.events.find((e) => e.type === 'placedWrong')!;
    const penalty = wrong.type === 'placedWrong' ? wrong.penalty : NaN;
    expect(penalty).toBe(missedPoints(before, a, answerIn(g.puzzle, a)).points);
    expect(screen.getByTestId(`cell-${name}`)).toHaveProp(
      'accessibilityLabel',
      `${name}, ריקה, ספרות שגויות: ${digit}`,
    );
    expect(screen.getByTestId('cell-wrong', hidden)).toHaveTextContent(String(digit));
    expect(screen.getByTestId(`flight-${wrong.seq}`, hidden)).toHaveTextContent(signedText(-penalty));
    await frames(1_500);
    expect(theirScore()).toHaveAnimatedProps({ text: scoreText(-penalty) });
    expect(screen.getByTestId('card-opponent-delta', hidden)).toHaveTextContent(signedText(-penalty));
    const points = i18n.t('player:points', { count: -penalty, score: scoreText(-penalty) });
    expect(
      screen.getByLabelText(`Mr. Hoot · ${points} · חושב, טעות אחת, בוט, רמה 3, מתקדם, מחובר`),
    ).toBeOnTheScreen();
    // Its mistake is silent; the bot below zero puts me in the lead (0), and that one is mine: cued and said.
    expect(cues()).toEqual(['leadTake']);
    await spoken();
    const lead = i18n.t('game:live.leadMine', { count: penalty, gap: formatScore(penalty) });
    expect(live()).toHaveTextContent(
      `Mr. Hoot טעה: ${digit} לא מתאימה ל־${ltr(name)}, ${signedText(-penalty)}, ${lead}`,
    );
  });

  it('with reduced motion nothing flies: the bot’s score jumps, its delta shows beside it', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await show();
    await layOut();
    await act(async () => g.bot.solve(g.cells[0]!));
    expect(screen.queryByTestId(/^flight-\d+$/, hidden)).toBeNull();
    // The UI thread shows it on its next frame: the whole score, no count.
    await frames(16, 16);
    expect(theirScore()).toHaveAnimatedProps({ text: formatScore(botScore(g)) });
    expect(screen.getByTestId('card-opponent-delta', hidden)).toHaveTextContent(signedText(botScore(g)));
  });

  it('my correct move still flies to my card; taking the lead is said, and cued as the count lands', async () => {
    const g = await show();
    await layOut();
    const a = g.cells[0]!;
    await fireEvent.press(screen.getByTestId(`cell-${cellName(a)}`));
    await fireEvent.press(screen.getByTestId(`key-${answerIn(g.puzzle, a)}`));
    const points = g.host.getView().players[0]!.score;
    const seq = g.host.events.find((e) => e.type === 'placedCorrect')!.seq;
    expect(screen.getByTestId(`flight-${seq}`, hidden)).toHaveTextContent(signedText(points));
    expect(cues()).toEqual(['cellSelect', 'correct']);
    await frames(700);
    expect(cues()).toEqual(['cellSelect', 'correct', 'leadTake']);
    expect(feedback.cueCountUp).toHaveBeenCalledTimes(1);
    await frames(700);
    expect(myScore()).toHaveAnimatedProps({ text: formatScore(points) });
    await spoken();
    expect(live()).toHaveTextContent(`אתה מוביל ב־${formatScore(points)} נקודות`, { exact: false });

    // The bot passes me: I lose the lead.
    await act(async () => {
      for (const c of g.cells.slice(1, 4)) g.bot.solve(c);
    });
    await frames(700);
    expect(cues().at(-1)).toBe('leadLose');
  });
});

describe('the bot’s reactions and interferences', () => {
  it('a reaction floats up from the bot’s card, with its sound, and goes after 1.6 s', async () => {
    const g = await show();
    await layOut();
    await act(async () => g.bot.react('😂'));
    const seq = g.host.events.at(-1)!.seq;
    expect(screen.getByTestId(`reaction-${seq}`, hidden)).toHaveTextContent('😂');
    expect(cues()).toEqual(['reactLaugh']);
    await spoken();
    expect(live()).toHaveTextContent('Mr. Hoot שלח תגובה 😂');
    await frames(100);
    expect(screen.queryByTestId(`reaction-${seq}`, hidden)).toBeNull();
  });

  it('with reduced motion a reaction fades in place at the card, for the same 1.6 s', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await show();
    await layOut();
    await act(async () => g.bot.react('🔥'));
    const seq = g.host.events.at(-1)!.seq;
    expect(screen.getByTestId(`reaction-${seq}`, hidden)).toHaveTextContent('🔥');
    expect(cues()).toEqual(['reactFire']);
    await frames(1_550);
    expect(screen.getByTestId(`reaction-${seq}`, hidden)).toBeOnTheScreen();
    await frames(100);
    expect(screen.queryByTestId(`reaction-${seq}`, hidden)).toBeNull();
  });

  it('an interference on me: my lock strip stops, my card shows the hit with its 5 s; the bot pays', async () => {
    const g = await show(undefined, { interferences: true });
    await act(async () => g.bot.solve(g.cells[0]!)); // the bot needs the points for it (D10)
    const name = cellName(g.cells[1]!);
    await fireEvent.press(screen.getByTestId(`cell-${name}`));
    expect(screen.getByLabelText(`המשבצת שלך ${name}, נותרו 8 שניות`)).toBeOnTheScreen();
    feedback.cue.mockClear();

    const before = botScore(g);
    await act(async () => g.bot.interfere('fireworks'));
    expect(botScore(g)).toBe(before - 2);
    expect(screen.getByLabelText(`המשבצת שלך ${name}, הטיימר עצור`)).toBeOnTheScreen();
    const myCard = () => within(screen.getByTestId('card-me'));
    expect(myCard().getByTestId('hit-chip', hidden)).toHaveTextContent('5');
    expect(screen.getByLabelText('אני · 0 נקודות · אין טעויות, תחת הפרעה, 5 שניות')).toBeOnTheScreen();
    expect(screen.getByTestId('card-opponent-delta', hidden)).toHaveTextContent(signedText(-2));
    expect(cues()).toEqual(['hitFireworks']);
    await spoken();
    // The start line as the hit layer says it (its wording is the hit layer's, D46: the board is dimmed).
    const started = i18n.t('game:hit.started', {
      title: `${isolateName('Mr. Hoot')} שלח/ה לך זיקוקים!`,
      time: i18n.t('game:hit.seconds', { count: 5 }),
    });
    expect(live()).toHaveTextContent(started, { exact: false });

    // The timer stands still while it lasts, and runs again after the 5 s.
    await act(async () => g.scheduler.advance(3_000));
    await frames(250);
    expect(myCard().getByTestId('hit-chip', hidden)).toHaveTextContent('2');
    expect(screen.getByLabelText(`המשבצת שלך ${name}, הטיימר עצור`)).toBeOnTheScreen();
    await act(async () => g.scheduler.advance(2_000));
    await frames(250);
    expect(myCard().queryByTestId('hit-chip', hidden)).toBeNull();
    expect(screen.getByLabelText(`המשבצת שלך ${name}, נותרו 8 שניות`)).toBeOnTheScreen();
    await spoken();
    expect(live()).toHaveTextContent('ההפרעה נגמרה, הטיימר שלך ממשיך', { exact: false });
  });
});

describe('no interferences against a bot [D44]', () => {
  it('no "הפרעה" on the bot’s card, no picker, and the bot can’t interfere with me', async () => {
    const g = await show();
    await layOut();
    await act(async () => {
      for (const cell of g.cells) {
        if (g.host.getView().players[0]!.score >= 6) break;
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
      g.bot.solve(g.cells.at(-1)!);
      g.bot.solve(g.cells.at(-2)!);
    });
    await frames(2_000);
    const view = g.host.getView();
    expect(view.rules.interferences).toBe(false);
    expect(view.interference).toBeNull();
    expect(screen.queryByTestId('interfere', hidden)).toBeNull();
    expect(screen.queryByLabelText(/^הפרעה ל־/, hidden)).toBeNull();
    expect(screen.queryByTestId('arsenal-sheet', hidden)).toBeNull();
    // The engine refuses the bot's interference (the bot's brain never tries one): no hit on me.
    expect(() => g.bot.interfere('cats')).toThrow(/interferencesOff/);
    await frames(300);
    expect(g.host.getView().players[0]!.hitBy).toBeNull();
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
  });
});

describe('interfering with the opponent (spec §7.2, D11)', () => {
  it('"הפרעה" rests while the opponent is under my hit and in its second of immunity, then is ready', async () => {
    const g = await show(undefined, { interferences: true });
    await layOut();
    await act(async () => {
      for (const cell of g.cells) {
        if (g.host.getView().players[0]!.score >= 6) break; // 2 for this one, 4 for the next (D10)
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
    });
    await frames(2_000);
    const bolt = () => screen.getByTestId('interfere', hidden);
    expect(bolt()).toHaveProp('accessibilityLabel', 'הפרעה ל־Mr. Hoot · עלות 2 נק׳');
    await act(async () => g.host.interfere(g.host.getView().players[1]!.id, 'cats'));
    const endsAt = g.host.getView().players[1]!.hitBy!.expiresAt!;
    const busyUntil = g.host.getView().interference!.targets[0]!.busyUntil!;
    expect(busyUntil).toBeGreaterThan(endsAt);
    expect(bolt()).toBeDisabled();
    expect(bolt()).toHaveProp('accessibilityLabel', 'הפרעה ל־Mr. Hoot לא זמינה, כבר תחת הפרעה');

    // The hit ends; its second of immunity still holds "הפרעה" back.
    await act(async () => g.scheduler.advance(endsAt - g.clock.now()));
    await frames(250);
    expect(g.host.getView().players[1]!.hitBy).toBeNull();
    expect(bolt()).toBeDisabled();
    // The second passes with no move from anyone: "הפרעה" is ready at once, at the next cost.
    await act(async () => g.clock.advance(busyUntil - g.clock.now()));
    await frames(300); // a tick
    expect(bolt()).toBeEnabled();
    expect(bolt()).toHaveProp('accessibilityLabel', 'הפרעה ל־Mr. Hoot · עלות 4 נק׳');
  });

  it('two taps: "הפרעה" opens the picker aimed at the opponent, a kind launches it once', async () => {
    const g = await show(undefined, { interferences: true });
    await layOut();
    await act(async () => {
      for (const cell of g.cells) {
        if (g.host.getView().players[0]!.score >= 2) break;
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
    });
    await frames(1_000);
    const before = g.host.getView().players[0]!.score;
    await fireEvent.press(screen.getByRole('button', { name: 'הפרעה ל־Mr. Hoot · עלות 2 נק׳' }));
    await frames(400);
    expect(screen.getByTestId('arsenal-sheet')).toBeOnTheScreen();
    expect(cues()).toContain('arsenalOpen');
    await fireEvent.press(screen.getByTestId('arsenal-kind-warp'));
    await frames(600);
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();
    expect(cues().filter((c) => c === 'launch')).toHaveLength(1);
    const view = g.host.getView();
    expect(view.players[1]!.hitBy).toMatchObject({ kind: 'warp' });
    expect(view.players[0]!.score).toBe(before - 2);
    // Only the victim sees it [D46]: no dim, no effect, no banner on the sender's screen.
    expect(screen.queryByTestId('board-hit', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-layer-banner', hidden)).toBeNull();
  });

  it('a blocked "הפרעה" says why in a short toast, with a light haptic', async () => {
    await show(undefined, { interferences: true });
    useToast.getState().clear();
    await fireEvent.press(screen.getByRole('button', { name: 'הפרעה ל־Mr. Hoot · חסרות 2 נק׳' }));
    await frames(400);
    expect(screen.queryByTestId('arsenal-sheet')).toBeNull();
    expect(useToast.getState().current).toMatchObject({
      variant: 'error',
      message: 'אין מספיק נקודות להפרעה הבאה (2 נק׳)',
    });
    expect(cues()).toContain('nudge');
  });

  it('an interference the host refuses (the picker already closed) says nothing was sent or charged', async () => {
    const g = await show(undefined, { interferences: true });
    useToast.getState().clear();
    // Short of points: the engine refuses it, no score changes.
    await act(async () => void g.host.interfere(g.host.getView().players[1]!.id, 'cats'));
    await frames(300);
    expect(useToast.getState().current).toMatchObject({
      variant: 'warning',
      message: 'ההפרעה לא נשלחה, ולא ירדו לך נקודות',
    });
    expect(g.host.getView().players[0]!.score).toBe(0);
  });

  it('refused for a general reason (the game froze before my tap arrived): still "not sent" [D45]', async () => {
    const g = await show(undefined, { interferences: true });
    await act(async () => {
      for (const cell of g.cells) {
        if (g.host.getView().players[0]!.score >= 2) break;
        g.host.select(cell);
        g.host.place(cell, answerIn(g.puzzle, cell));
      }
    });
    await frames(1_000);
    const before = g.host.getView().players[0]!.score;
    const bot = g.host.getView().players[1]!.id;
    // The opponent drops and the game freezes (spec §16.2): the host refuses with 'paused'.
    await act(async () => void g.host.dispatch({ type: 'disconnect', playerId: bot }));
    expect(g.host.getView().status).toBe('paused');
    await frames(300);
    useToast.getState().clear();
    // A select refused for the same reason is no interference: no "not sent".
    await act(async () => void g.host.select(g.cells.at(-1)!));
    await frames(300);
    expect(useToast.getState().current).toBeNull();
    await act(async () => void g.host.interfere(bot, 'warp'));
    await frames(300);
    expect(useToast.getState().current).toMatchObject({
      variant: 'warning',
      message: 'ההפרעה לא נשלחה, ולא ירדו לך נקודות',
    });
    expect(g.host.getView().players[0]!.score).toBe(before);
    expect(g.host.getView().players[1]!.hitBy).toBeNull();
  });
});

describe('an interference on me, on screen (spec §7.4, §22; D35; interferences on, D44)', () => {
  const region = () => screen.getByTestId('hit-layer-region', hidden);
  const hitMe = async (g: Duel) => {
    await act(async () => g.bot.solve(g.cells[0]!)); // the bot's points pay for it (D10)
    feedback.cue.mockClear();
    await act(async () => g.bot.interfere('cats'));
    return g.host.getView().players[0]!.hitBy!.expiresAt!;
  };

  it('plays over the whole screen with its banner, its cue once, and is gone exactly at its end', async () => {
    const g = await show(undefined, { interferences: true });
    await layOut();
    const endsAt = await hitMe(g);
    const { width, height } = Dimensions.get('window');
    expect(StyleSheet.flatten(region().props.style)).toMatchObject({ left: 0, top: 0, width, height });
    expect(within(region()).getByTestId('hit-cats', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('hit-layer-banner', hidden)).toHaveProp(
      'accessibilityLabel',
      `${isolateName('Mr. Hoot')} שלח/ה לך חתולים! זה עלה 2 נק׳ · המשחק ממשיך, נותרו 5 שניות`,
    );
    expect(cues()).toEqual(['hitCats']);

    await act(async () => g.scheduler.advance(endsAt - 1 - g.clock.now()));
    await frames(250);
    expect(region()).toBeOnTheScreen();
    await act(async () => g.scheduler.advance(1));
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-layer-banner', hidden)).toBeNull();
    expect(cues().filter((c) => c === 'hitCats')).toHaveLength(1);
  });

  it('two hits in a row with no frame between them (back from the background): the next starts afresh', async () => {
    const g = await show(undefined, { interferences: true });
    await layOut();
    await act(async () => {
      for (const cell of g.cells) {
        if (botScore(g) >= 6) break; // 2 for the first, 4 for the second (D10)
        g.bot.solve(cell);
      }
    });
    feedback.cue.mockClear();
    await act(async () => g.bot.interfere('cats'));
    const first = g.host.getView().players[0]!.hitBy!.expiresAt!;
    const immunity = g.host.state.config.rules.interferenceImmunityMs;
    // All at once: the first ends, its second of immunity passes, the bot sends the same again.
    await act(async () => {
      g.scheduler.advance(first + immunity - g.clock.now());
      g.bot.interfere('cats');
    });
    const second = g.host.getView().players[0]!.hitBy!.expiresAt!;
    expect(second).toBeGreaterThan(first);
    expect(cues().filter((c) => c === 'hitCats')).toHaveLength(2);
    expect(screen.getByTestId('hit-layer-banner', hidden)).toHaveProp(
      'accessibilityLabel',
      `${isolateName('Mr. Hoot')} שלח/ה לך חתולים! זה עלה 4 נק׳ · המשחק ממשיך, נותרו 5 שניות`,
    );
    await spoken();
    const said = String(live().props.children);
    const started = `${isolateName('Mr. Hoot')} שלח/ה לך חתולים!`;
    const ended = 'ההפרעה נגמרה, הטיימר שלך ממשיך';
    expect(said.indexOf(started)).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(ended)).toBeGreaterThan(said.indexOf(started));
    expect(said.lastIndexOf(started)).toBeGreaterThan(said.indexOf(ended));
    // The second lasts its full 5 s.
    await act(async () => g.scheduler.advance(second - 1 - g.clock.now()));
    await frames(250);
    expect(region()).toBeOnTheScreen();
    await act(async () => g.scheduler.advance(1));
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
  });

  it('with reduced motion: a static cover of the same area for the same 5 s, no rumble', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const g = await show(undefined, { interferences: true });
    await layOut();
    const endsAt = await hitMe(g);
    const { width, height } = Dimensions.get('window');
    expect(StyleSheet.flatten(region().props.style)).toMatchObject({ left: 0, top: 0, width, height });
    expect(within(region()).getByTestId('hit-cats-still', hidden)).toBeOnTheScreen();
    expect(within(region()).queryByTestId('hit-cats', hidden)).toBeNull();
    await act(async () => g.scheduler.advance(endsAt - 1 - g.clock.now()));
    await frames(250);
    expect(within(region()).getByTestId('hit-cats-still', hidden)).toBeOnTheScreen();
    await act(async () => g.scheduler.advance(1));
    expect(screen.queryByTestId('hit-layer-region', hidden)).toBeNull();
    expect(cues()).toEqual(['hitCats']);
  });
});

describe('reactions (spec §8, D19)', () => {
  it('my card’s button opens the picker; a pick goes to the host and rises from my card', async () => {
    const g = await show();
    await layOut();
    await fireEvent.press(screen.getByRole('button', { name: 'תגובות' }));
    expect(screen.getByTestId('reaction-picker')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'תגובה: אש' }));
    const sent = g.host.events.at(-1)!;
    expect(sent).toMatchObject({ type: 'reaction', playerId: 'me', emoji: '🔥' });
    expect(screen.getByTestId(`reaction-${sent.seq}`, hidden)).toHaveTextContent('🔥');
    // My own float makes no sound of its own: the pick already did.
    expect(cues()).toEqual(['reactSend']);
    expect(screen.getByRole('button', { name: 'תגובות' })).toBeDisabled();
  });

  it('a long press on the bot’s card mutes it: its reactions are not shown, played or said', async () => {
    const g = await show();
    await layOut();
    await fireEvent(screen.getByTestId('card-menu-trigger'), 'longPress');
    await fireEvent.press(screen.getByRole('menuitem', { name: /Mr\. Hoot/ }));
    await act(async () => g.bot.react('😂'));
    const seq = g.host.events.at(-1)!.seq;
    expect(screen.queryByTestId(`reaction-${seq}`, hidden)).toBeNull();
    expect(cues()).toEqual([]);
    await spoken();
    expect(live()).not.toHaveTextContent('Mr. Hoot שלח תגובה', { exact: false });
  });
});

describe('ending a practice against a bot', () => {
  it('"סיום אימון" asks first, then ends the practice (no rating effect) and opens the results', async () => {
    const g = await show();
    await fireEvent.press(screen.getByRole('button', { name: 'סיום אימון' }));
    expect(screen.getByRole('header', { name: 'לסיים את האימון?' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'כן, לסיים' }));
    expect(cues()).toEqual(['surrender']);
    expect(g.host.getView().result?.reason).toBe('practiceEnded');
    expect(g.host.getView().result?.ratingChanges).toEqual([]);
    // The results replace the game once the dialog has slid away (sheet.out, 240 ms).
    expect(g.onEnded).not.toHaveBeenCalled();
    await frames(250);
    expect(g.onEnded).toHaveBeenCalledWith(g.session.id);
  });

  it('a full board filled by the bot holds the last flash, then opens the results', async () => {
    // All but the last cell are filled before the screen opens; the screen plays the last one.
    game = duel();
    const g = game;
    for (const c of g.cells.slice(0, -1)) g.bot.solve(c);
    const onEnded = jest.fn();
    await render(<GameScreen session={g.session} onEnded={onEnded} />);
    await act(async () => g.bot.solve(g.cells.at(-1)!));
    expect(g.host.getView().result?.reason).toBe('boardComplete');
    expect(onEnded).not.toHaveBeenCalled();
    await frames(1_100);
    expect(onEnded).toHaveBeenCalledWith(g.session.id);
  });
});

describe('in English', () => {
  it('the cards, the lead and the live region speak English; the board stays LTR', async () => {
    await i18n.changeLanguage('en');
    const g = await show();
    expect(screen.getByLabelText('Me · 0 points · No mistakes')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Mr. Hoot · 0 points · Thinking, No mistakes, Bot, Level 3, Advanced, Online'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'End practice' })).toBeEnabled();
    expect(screen.getByTestId('board')).toHaveStyle({ direction: 'ltr' });
    expect(screen.getByTestId('keypad')).toHaveStyle({ direction: 'ltr' });
    await act(async () => g.bot.solve(g.cells[0]!));
    await spoken();
    expect(live()).toHaveTextContent(`Mr. Hoot solved ${ltr(cellName(g.cells[0]!))}`, { exact: false });
    expect(live()).toHaveTextContent(`Mr. Hoot leads by ${formatScore(botScore(g))} points`, {
      exact: false,
    });
  });
});
