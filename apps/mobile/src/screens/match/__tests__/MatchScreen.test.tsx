import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import type { MatchPlayer, QueueKey } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { MatchmakingClient } from '../../../net/matchmaking';
import { FakeMatchEntry, FakeMatchmaking, MATCH_PLAYERS } from '../../../net/testing/fakeMatchmaking';
import { cue } from '../../../services/feedback';
import { color } from '../../../theme';
import { iso, type Setup, setUp, styleOf, wait } from '../../game/connection/testing/setup';
import { MatchScreen } from '../MatchScreen';

/**
 * The match screens (work plan stage 9, spec §10; Match-Search, Match-Found, Match-Countdown, Match-Timeout)
 * over a real MatchmakingClient and a fake matchmaking room: what each shows in Hebrew and English, what each
 * button does, the sounds of the flow, Android's back, and reduced motion.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const cues = jest.mocked(cue);

let env: Setup;
let backs: jest.SpyInstance;

afterEach(() => {
  backs.mockRestore();
  env.restore();
  cues.mockClear();
});

async function show(
  lang: 'he' | 'en' = 'he',
  reduceMotion: 'on' | 'off' = 'off',
  queueKey: QueueKey = 'normal-2p',
) {
  env = await setUp(lang, reduceMotion);
  backs = jest.spyOn(BackHandler, 'addEventListener');
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const mm = new FakeMatchmaking(clock, scheduler);
  const entries: FakeMatchEntry[] = [];
  const client = new MatchmakingClient(queueKey, {
    connector: mm,
    clock,
    scheduler,
    enter: (m) => {
      const entry = new FakeMatchEntry(() => clock.now(), m.reservation);
      entries.push(entry);
      return entry;
    },
  });
  const handlers = {
    onPlay: jest.fn(),
    onLeave: jest.fn(),
    onBot: jest.fn(),
    onPractice: jest.fn(),
    onHome: jest.fn(),
  };
  await render(
    <MatchScreen match={client} self={{ name: 'Moshe', avatarId: 'av07' }} clock={clock} {...handlers} />,
  );
  await act(async () => {
    await client.start();
  });
  /** Server messages, inside act. */
  const server = async (send: () => void) => {
    await act(async () => send());
  };
  /** Moves the phone's clock (the client's) and its timers (the screen's ticks and animations). */
  const advance = async (ms: number, step = 250) => {
    for (let done = 0; done < ms; done += step) {
      const by = Math.min(step, ms - done);
      scheduler.advance(by);
      await wait(by);
    }
  };
  /** Android's back button, as the screen registered it last. */
  const back = async () => {
    const [, handler] = backs.mock.calls.at(-1)!;
    let handled = false;
    await act(async () => {
      handled = (handler as () => boolean)();
    });
    return handled;
  };
  return { client, mm, entries, handlers, server, advance, back, clock };
}

describe('Searching (Match-Search)', () => {
  it('connects, then shows what is played, the search time, my rating and the range as it widens', async () => {
    const { mm, server, advance } = await show();
    expect(screen.getByRole('header')).toHaveTextContent('מתחבר לתור…');
    expect(screen.queryByTestId('match-search-range')).not.toBeOnTheScreen();

    await server(() => mm.searching());
    expect(screen.getByTestId('match-search-header')).toHaveTextContent('מדורג · 2 שחקנים · רגיל');
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריב…');
    expect(screen.getByTestId('match-search-elapsed')).toHaveTextContent('0:00');
    expect(screen.getByTestId('match-search-radar')).toHaveAccessibleName('הדירוג שלי 1287');
    expect(screen.getByTestId('match-search-radar-rating')).toHaveTextContent('1287');
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('1237–1337');
    expect(styleOf(screen.getByTestId('match-search-range-value'))).toMatchObject({
      writingDirection: 'ltr',
    });
    expect(screen.getByLabelText('טווח דירוג 1237 עד 1337')).toBeOnTheScreen();
    expect(screen.getByText('הטווח מתרחב ככל שהחיפוש נמשך')).toBeOnTheScreen();
    expect(screen.getByLabelText('מקום פנוי: מחפש יריב')).toBeOnTheScreen();
    expect(screen.getByText('נמנעים מיריבים ששיחקת מולם לאחרונה')).toBeOnTheScreen();
    // Said once as the search runs; never the seconds.
    expect(env.announced()).toEqual(['מחפש יריב בטווח דירוג 1237 עד 1337']);

    await advance(14_000, 1000);
    expect(screen.getByTestId('match-search-elapsed')).toHaveTextContent('0:14');
    expect(screen.getByTestId('match-search-elapsed')).toHaveAccessibleName('זמן חיפוש 0:14');
    await server(() => mm.searching({ elapsedMs: 15_000 }));
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('1162–1412');
    // The range is shown as it widens, not said again every 5 s.
    expect(env.announced()).toEqual(['מחפש יריב בטווח דירוג 1237 עד 1337']);
  });

  it('the bar: lower ratings on the left, the band widening toward the cap, my mark in P1', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    const bar = screen.getByTestId('range-bar', { includeHiddenElements: true });
    expect(styleOf(bar)).toMatchObject({ direction: 'ltr', width: 240 });
    const narrow = styleOf(screen.getByTestId('range-band', { includeHiddenElements: true })).width as number;
    await server(() => mm.searching({ elapsedMs: 50_000 }));
    const wide = styleOf(screen.getByTestId('range-band', { includeHiddenElements: true })).width as number;
    expect(narrow).toBeLessThan(wide);
    expect(wide).toBe(240);
  });

  it('"ביטול חיפוש" leaves the queue and goes back', async () => {
    const { client, mm, server, handlers } = await show();
    await server(() => mm.searching());
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול חיפוש' }));
    expect(mm.room.sent).toEqual([{ type: 'cancel' }]);
    expect(client.info.phase).toBe('cancelled');
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
  });

  it('Android back cancels a search', async () => {
    const { client, mm, server, back, handlers } = await show();
    await server(() => mm.searching());
    expect(await back()).toBe(true);
    expect(client.info.phase).toBe('cancelled');
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
  });

  it('a match that fell through: back at the head of the queue, and the screen says so', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    await server(() => mm.found());
    await server(() => mm.matchCancelled({ requeued: true }));
    await server(() => mm.searching({ elapsedMs: 8000, requeued: true }));
    expect(screen.getByTestId('match-search-requeued')).toHaveTextContent(
      'השחקן השני לא התחבר בזמן. חזרת לראש התור.',
    );
  });

  it('the radar sweeps around me (motion.md search.sweep), the empty seat blinks', async () => {
    const { mm, server, advance } = await show();
    await server(() => mm.searching());
    const arc = screen.getByTestId('match-search-radar-arc', { includeHiddenElements: true });
    await advance(600, 100);
    expect(arc).not.toHaveAnimatedStyle({ transform: [{ rotate: '0deg' }] });
  });
});

describe('Nobody found (Match-Timeout)', () => {
  it('says how long and in what range it searched, and offers three ways on', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    await server(() => mm.timeout());
    expect(screen.getByRole('header')).toHaveTextContent('עדיין לא מצאנו יריב ברמה שלך');
    expect(screen.getByTestId('match-timeout-elapsed')).toHaveTextContent('1:00');
    expect(screen.getByTestId('match-timeout-body')).toHaveTextContent(
      'חיפשנו דקה שלמה שחקנים זמינים בטווח ⁦987–1587⁩, בלי יריבים ששיחקת מולם לאחרונה. אפשר להמשיך לחפש בלי הגבלת טווח, או להתאמן מול בוט בינתיים.',
    );
    expect(screen.getByRole('button', { name: 'המשך לחפש' })).toBeOnTheScreen();
    expect(screen.getByText('בלי הגבלת טווח')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'שחק מול בוט בינתיים' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'חזרה לבית' })).toBeOnTheScreen();
    expect(env.announced().at(-1)).toMatch(/^עדיין לא מצאנו יריב ברמה שלך\. חיפשנו דקה שלמה/);
  });

  it('"המשך לחפש": the search goes on with no cap on the range', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    await server(() => mm.timeout());
    await fireEvent.press(screen.getByRole('button', { name: 'המשך לחפש' }));
    expect(mm.room.sent).toEqual([{ type: 'keepSearching' }]);
    await server(() => mm.searching({ elapsedMs: 60_000, extended: true }));
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריב…');
    expect(screen.getByText('בלי הגבלת טווח: הטווח ממשיך להתרחב')).toBeOnTheScreen();
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('937–1637');
  });

  it('"שחק מול בוט בינתיים" and "חזרה לבית" leave the queue first', async () => {
    const first = await show();
    await first.server(() => first.mm.searching());
    await first.server(() => first.mm.timeout());
    await fireEvent.press(screen.getByRole('button', { name: 'שחק מול בוט בינתיים' }));
    expect(first.mm.room.left).toBe(true);
    expect(first.handlers.onBot).toHaveBeenCalledTimes(1);
    expect(first.handlers.onLeave).not.toHaveBeenCalled();
    first.client.close();
    env.restore();
    backs.mockRestore();

    const second = await show();
    await second.server(() => second.mm.searching());
    await second.server(() => second.mm.timeout());
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה לבית' }));
    expect(second.mm.room.left).toBe(true);
    expect(second.handlers.onHome).toHaveBeenCalledTimes(1);
  });
});

describe('Found (Match-Found) and 3-2-1-GO (Match-Countdown)', () => {
  it('found: VS, both players with flag and rating ("זמני"), ready badges after the VS; no way out', async () => {
    const { mm, server, advance, back, client, handlers } = await show();
    await server(() => mm.searching());
    await server(() => mm.found());
    expect(cues).toHaveBeenCalledWith('matchFound');
    expect(screen.getByRole('header')).toHaveTextContent('נמצא יריב!');
    expect(screen.getByTestId('match-found-vs')).toHaveTextContent('VS');
    expect(screen.getByTestId('seat-opp')).toHaveTextContent(/NinaVolt/);
    expect(screen.getByTestId('seat-opp')).toHaveTextContent(/1305/);
    expect(screen.getByTestId('seat-opp')).toHaveTextContent(/זמני/);
    expect(screen.getByTestId('seat-me')).toHaveTextContent(/אני/);
    expect(styleOf(screen.getByTestId('seat-me'))).toMatchObject({ borderColor: color.players[0].ring });
    expect(screen.getByText('לא שיחקתם זה מול זה לאחרונה')).toBeOnTheScreen();
    expect(screen.getByText('מכאן אין ביטול: יציאה נחשבת נטישה')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'ביטול חיפוש' })).not.toBeOnTheScreen();
    expect(env.announced()).toContain(`נמצא יריב: ${iso('NinaVolt')}`);
    // The "מוכן" badges pop in 800 ms after the VS (motion.md vs.slam).
    expect(screen.queryByTestId('seat-me-ready')).not.toBeOnTheScreen();
    await server(() => mm.ready(['me']));
    await advance(800, 100);
    expect(screen.getByTestId('seat-me-ready')).toHaveTextContent('מוכן');
    expect(screen.getByTestId('seat-opp-connecting')).toHaveTextContent('מתחבר…');
    expect(screen.getByTestId('seat-opp')).toHaveAccessibleName(
      `${iso('NinaVolt')}, דירוג 1305, זמני, מתחבר…`,
    );
    expect(screen.getByTestId('match-found-status')).toHaveTextContent(/^מחכים שכולם יתחברו…/);
    expect(screen.getByTestId('match-found-status')).toHaveAccessibleName(
      'מחכים שכולם יתחברו… 1 מתוך 2 מוכנים',
    );
    expect(screen.getByTestId('match-found-count')).toHaveTextContent('1/2');
    await server(() => mm.ready(['me', 'opp']));
    expect(screen.getByTestId('match-found-status')).toHaveTextContent(/^כל השחקנים מוכנים · המשחק מתחיל/);
    // Android back from here does nothing [D32].
    expect(await back()).toBe(true);
    expect(client.info.phase).toBe('found');
    expect(handlers.onLeave).not.toHaveBeenCalled();
  });

  it('3 · 2 · 1 · GO! at the server’s time, with a beat each, then the board: open the game', async () => {
    const { mm, server, advance, entries, handlers } = await show();
    await server(() => mm.searching());
    await server(() => mm.found());
    await server(() => mm.ready(['me', 'opp']));
    cues.mockClear();
    await server(() => void mm.countdown(3000));
    const text = () => screen.getByTestId('match-countdown-step-text');
    expect(text()).toHaveTextContent('3');
    expect(screen.getByText('התכוננו…')).toBeOnTheScreen();
    expect(screen.getByText('הלוח ייחשף לשניכם באותו רגע')).toBeOnTheScreen();
    expect(screen.getByTestId('ghost-board')).toHaveAccessibleName('הלוח, מוסתר עד תחילת המשחק');
    expect(styleOf(screen.getByTestId('ghost-board'))).toMatchObject({ direction: 'ltr' });
    expect(screen.getByTestId('match-countdown-step-ring')).toBeOnTheScreen();
    expect(env.announced().at(-1)).toBe('המשחק מתחיל בעוד 3 שניות');
    await advance(1000, 100);
    expect(text()).toHaveTextContent('2');
    await advance(1000, 100);
    expect(text()).toHaveTextContent('1');
    expect(env.announced().at(-1)).toBe('המשחק מתחיל בעוד שנייה אחת');
    await advance(1000, 100);
    expect(text()).toHaveTextContent('GO!');
    expect(screen.getByText('מכינים את הלוח…')).toBeOnTheScreen();
    expect(cues.mock.calls.map((c) => c[0])).toEqual([
      'countdownBeat',
      'countdownBeat',
      'countdownBeat',
      'go',
    ]);
    expect(handlers.onPlay).not.toHaveBeenCalled();

    await server(() => entries[0]!.host.set({ status: 'live', hasGame: true }));
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
    // GO! stays on screen while the game takes over.
    expect(text()).toHaveTextContent('GO!');
  });
});

describe('a table of 3–4 (stage 10)', () => {
  const FOUR: MatchPlayer[] = [
    ...MATCH_PLAYERS,
    { id: 'p3', name: 'Ziv', avatarId: 'av20', country: 'FR', rating: 1250, provisional: false },
    { id: 'p4', name: 'Lea', avatarId: 'av31', country: 'US', rating: 1190, provisional: false },
  ];
  /** The seats' tiles (or the countdown's columns) in the order they are drawn. */
  const order = (prefix: 'seat' | 'mini') =>
    screen
      .getAllByTestId(new RegExp(`^${prefix}-(me|opp|p3|p4)$`))
      .map((el) => String(el.props.testID).slice(prefix.length + 1));

  it('searches three seats, then shows all four players (me first) and counts down with all four', async () => {
    const { mm, server, advance } = await show('he', 'off', 'fast-4p');
    await server(() => mm.searching());
    expect(screen.getByTestId('match-search-header')).toHaveTextContent('מדורג · 4 שחקנים · מהיר');
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריבים…');
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(3);
    expect(env.announced()).toEqual(['מחפש יריבים בטווח דירוג 1237 עד 1337']);

    // Found: "נמצאו יריבים!", a grid in the game's order, me in P1's colour.
    await server(() => mm.found({ players: FOUR }));
    expect(screen.getByRole('header')).toHaveTextContent('נמצאו יריבים!');
    expect(screen.queryByTestId('match-found-vs')).not.toBeOnTheScreen();
    expect(order('seat')).toEqual(['me', 'opp', 'p3', 'p4']);
    expect(styleOf(screen.getByTestId('seat-me'))).toMatchObject({ borderColor: color.players[0].ring });
    for (const [id, name, rating] of [
      ['p3', 'Ziv', 1250],
      ['p4', 'Lea', 1190],
    ] as const) {
      expect(screen.getByTestId(`seat-${id}`)).toHaveTextContent(new RegExp(`${name}.*${rating}`));
    }
    expect(env.announced()).toContain(`נמצאו יריבים: ${iso('NinaVolt')}, ${iso('Ziv')}, ${iso('Lea')}`);
    await server(() => mm.ready(['me', 'opp', 'p3']));
    await advance(800, 100);
    expect(screen.getByTestId('match-found-count')).toHaveTextContent('3/4');
    expect(screen.getByTestId('seat-p4-connecting')).toBeOnTheScreen();
    expect(screen.getByTestId('match-found-status')).toHaveAccessibleName(
      'מחכים שכולם יתחברו… 3 מתוך 4 מוכנים',
    );

    // One of them never came: back at the head of the queue, and the line says "one of the players".
    await server(() => mm.matchCancelled({ requeued: true, missing: ['p4'] }));
    await server(() => mm.searching({ elapsedMs: 9000, requeued: true }));
    expect(screen.getByTestId('match-search-requeued')).toHaveTextContent(
      'אחד השחקנים לא התחבר בזמן. חזרת לראש התור.',
    );

    // Found again; everyone in: 3 · 2 · 1 with the four across the top, no "VS" between them.
    await server(() => mm.found({ players: FOUR, matchId: 'match-2' }));
    await server(() => mm.ready(['me', 'opp', 'p3', 'p4'], 'match-2'));
    await server(() => void mm.countdown(3000, 'match-2'));
    expect(screen.getByTestId('match-countdown-step-text')).toHaveTextContent('3');
    expect(order('mini')).toEqual(['me', 'opp', 'p3', 'p4']);
    expect(within(screen.getByTestId('match-countdown-players')).queryByText('VS')).not.toBeOnTheScreen();
    expect(screen.getByTestId('mini-p4')).toHaveTextContent(/Lea.*1190/);
    expect(screen.getByText('הלוח ייחשף לכולם באותו רגע')).toBeOnTheScreen();
  });

  it('the timeout says there are not enough opponents yet', async () => {
    const he = await show('he', 'off', 'normal-3p');
    await he.server(() => he.mm.searching());
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריבים…');
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(2);
    await he.server(() => he.mm.timeout());
    expect(screen.getByRole('header')).toHaveTextContent('עדיין לא מצאנו מספיק יריבים ברמה שלך');
    expect(screen.getByTestId('match-timeout-header')).toHaveTextContent('מדורג · 3 שחקנים · רגיל');
  });

  it('speaks English at a table of three', async () => {
    const en = await show('en', 'off', 'normal-3p');
    await en.server(() => en.mm.searching());
    expect(screen.getByRole('header')).toHaveTextContent('Finding opponents…');
    await en.server(() => en.mm.found({ players: FOUR.slice(0, 3) }));
    expect(screen.getByRole('header')).toHaveTextContent('Opponents found!');
    expect(env.announced()).toContain(`Opponents found: ${iso('NinaVolt')}, ${iso('Ziv')}`);
    await en.server(() => en.mm.matchCancelled({ requeued: true, missing: ['p3'] }));
    await en.server(() => en.mm.searching({ elapsedMs: 9000, requeued: true }));
    expect(screen.getByTestId('match-search-requeued')).toHaveTextContent(
      "A player didn't connect in time. You're back at the head of the queue.",
    );
    await en.server(() => en.mm.timeout());
    expect(screen.getByRole('header')).toHaveTextContent('Not enough opponents at your level yet');
  });
});

describe('A failure', () => {
  it('explains it with the support code, and offers to search again, to practise, or home', async () => {
    const { client, mm, handlers } = await show();
    mm.refuse = FakeMatchmaking.refusal('alreadyQueued');
    await act(async () => {
      await client.retry();
    });
    expect(screen.getByRole('header')).toHaveTextContent('החיפוש נעצר');
    expect(screen.getByTestId('match-error-body')).toHaveTextContent(
      'כבר יש לך חיפוש או משחק מדורג פעיל, אולי במכשיר אחר.',
    );
    expect(screen.getByTestId('match-error-code')).toHaveAccessibleName('קוד שגיאה: alreadyQueued-4215');
    await fireEvent.press(screen.getByRole('button', { name: 'חפש שוב' }));
    expect(mm.joins).toHaveLength(3);
    expect(screen.getByRole('header')).toHaveTextContent('מתחבר לתור…');

    mm.offline = true;
    await act(async () => {
      await client.retry();
    });
    expect(screen.getByRole('header')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByTestId('match-error-body')).toHaveTextContent(
      'לא הצלחנו להגיע לשרת המשחק. בדוק את החיבור ונסה שוב.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    expect(handlers.onPractice).toHaveBeenCalledTimes(1);
  });
});

describe('English (LTR)', () => {
  it('searching, the timeout and the VS speak English', async () => {
    const { mm, server } = await show('en');
    await server(() => mm.searching());
    expect(screen.getByTestId('match-search-header')).toHaveTextContent('Ranked · 2 players · Normal');
    expect(screen.getByRole('header')).toHaveTextContent('Finding an opponent…');
    expect(screen.getByLabelText('Rating range 1237 to 1337')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancel search' })).toBeOnTheScreen();
    await server(() => mm.timeout());
    expect(screen.getByRole('header')).toHaveTextContent('No opponent at your level yet');
    expect(screen.getByRole('button', { name: 'Keep searching' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Play a bot meanwhile' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep searching' }));
    await server(() => mm.searching({ elapsedMs: 60_000, extended: true }));
    await server(() => mm.found());
    expect(screen.getByRole('header')).toHaveTextContent('Opponent found!');
    expect(screen.getByText("You haven't played each other lately")).toBeOnTheScreen();
    await server(() => void mm.countdown(3000));
    expect(screen.getByText('Get ready…')).toBeOnTheScreen();
    expect(screen.getByText('The board appears for both of you at the same moment')).toBeOnTheScreen();
  });

  it('a failure speaks English', async () => {
    const { client, mm } = await show('en');
    mm.refuse = FakeMatchmaking.refusal('queueClosed');
    await act(async () => {
      await client.retry();
    });
    expect(screen.getByRole('header')).toHaveTextContent('The search stopped');
    expect(screen.getByTestId('match-error-body')).toHaveTextContent("This queue isn't open yet.");
    expect(screen.getByTestId('match-error-code')).toHaveAccessibleName('Error code: queueClosed-4215');
    expect(screen.getByRole('button', { name: 'Search again' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Go to practice' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Back home' })).toBeOnTheScreen();
  });
});

describe('reduced motion (spec §22)', () => {
  it('the radar stands still (the time still runs), the badges show at once, no ring around the digits', async () => {
    const { mm, server, advance } = await show('he', 'on');
    await server(() => mm.searching());
    const arc = screen.getByTestId('match-search-radar-arc', { includeHiddenElements: true });
    await advance(1200, 100);
    expect(arc).toHaveAnimatedStyle({ transform: [{ rotate: '0deg' }] });
    expect(screen.getByTestId('match-search-elapsed')).toHaveTextContent('0:01');

    await server(() => mm.found());
    await server(() => mm.ready(['me']));
    expect(screen.getByTestId('seat-me-ready')).toBeOnTheScreen();

    await server(() => void mm.countdown(3000));
    expect(screen.getByTestId('match-countdown-step-text')).toHaveTextContent('3');
    expect(screen.queryByTestId('match-countdown-step-ring')).not.toBeOnTheScreen();
  });
});
