import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { MatchmakingClient, MatchmakingFailure } from '../../../net/matchmaking';
import { FakeMatchEntry, FakeMatchmaking } from '../../../net/testing/fakeMatchmaking';
import { type Setup, setUp } from '../../game/connection/testing/setup';
import { MatchScreen } from '../MatchScreen';

/**
 * Every way a ranked search can fail (work plan stage 13; spec §4.1 "מצבי שגיאה … Matchmaking", §16.3): no
 * answer, the connection lost while searching, a match called off, the server's refusals (already searching,
 * a closed or unknown queue, no sign-in), each with its explanation and support code, and the ways on that
 * can help: "חפש שוב" only when another search can get past it. Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

let env: Setup;
afterEach(() => env.restore());

async function show(lang: 'he' | 'en' = 'he') {
  env = await setUp(lang, 'on');
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const mm = new FakeMatchmaking(clock, scheduler);
  const client = new MatchmakingClient('normal-2p', {
    connector: mm,
    clock,
    scheduler,
    enter: (m) => new FakeMatchEntry(() => clock.now(), m.reservation),
  });
  const handlers = {
    onPlay: jest.fn(),
    onLeave: jest.fn(),
    onBot: jest.fn(),
    onPractice: jest.fn(),
    onVerifyEmail: jest.fn(),
    onHome: jest.fn(),
  };
  await render(
    <MatchScreen match={client} self={{ name: 'Moshe', avatarId: 'av07' }} clock={clock} {...handlers} />,
  );
  await act(async () => {
    await client.start();
  });
  const server = async (send: () => void) => {
    await act(async () => send());
  };
  /** The next search is refused with `error`. */
  const refuse = async (error: Error) => {
    mm.refuse = error;
    await act(async () => {
      await client.retry();
    });
  };
  return { client, mm, handlers, server, refuse };
}

const title = () => screen.getByTestId('match-error-title');
const body = () => screen.getByTestId('match-error-body');
const code = () => screen.getByTestId('match-error-code');

describe('matchmaking errors (stage 13)', () => {
  it('no network: "אין חיבור לשרת", the code, "חפש שוב" searches again', async () => {
    const { mm, client } = await show();
    mm.offline = true;
    await act(async () => {
      await client.retry();
    });
    expect(title()).toHaveTextContent('אין חיבור לשרת');
    expect(body()).toHaveTextContent('לא הצלחנו להגיע לשרת המשחק. בדוק את החיבור ונסה שוב.');
    expect(code()).toHaveAccessibleName(/^קוד שגיאה: network/);
    expect(env.announced()).toContainEqual(expect.stringMatching(/^אין חיבור לשרת/));
    mm.offline = false;
    await fireEvent.press(screen.getByRole('button', { name: 'חפש שוב' }));
    expect(screen.queryByTestId('match-error')).toBeNull();
  });

  it('the connection lost while searching: says so, with the close code', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    await server(() => mm.room.cut(1006));
    expect(title()).toHaveTextContent('אין חיבור לשרת');
    expect(body()).toHaveTextContent('החיבור לשרת המשחק אבד באמצע החיפוש.');
    expect(code()).toHaveTextContent('lost-1006');
    expect(screen.getByRole('button', { name: 'חפש שוב' })).toBeOnTheScreen();
  });

  it('a match called off (this phone did not reach it in time): "החיפוש נעצר"', async () => {
    const { mm, server } = await show();
    await server(() => mm.searching());
    await server(() => mm.found());
    await server(() => mm.matchCancelled({ requeued: false }));
    expect(title()).toHaveTextContent('החיפוש נעצר');
    expect(body()).toHaveTextContent('לא הצלחנו להתחבר למשחק בזמן, ולכן הוא בוטל.');
    expect(code()).toHaveTextContent('noShow');
  });

  it('already searching (or playing) on another device; a closed queue: "חפש שוב" may help later', async () => {
    const { refuse } = await show();
    await refuse(FakeMatchmaking.refusal('alreadyQueued'));
    expect(body()).toHaveTextContent('כבר יש לך חיפוש או משחק מדורג פעיל, אולי במכשיר אחר.');
    expect(screen.getByRole('button', { name: 'חפש שוב' })).toBeOnTheScreen();
    await refuse(FakeMatchmaking.refusal('queueClosed'));
    expect(body()).toHaveTextContent('התור הזה עוד לא פתוח.');
    expect(code()).toHaveTextContent('queueClosed-4215');
    expect(screen.getByRole('button', { name: 'חפש שוב' })).toBeOnTheScreen();
  });

  it('signed out, or an unknown queue: no "חפש שוב"; "עבור לאימון" is the one primary', async () => {
    const { refuse, handlers } = await show();
    await refuse(new MatchmakingFailure('signedOut', 'Ranked games need a signed-in account'));
    expect(title()).toHaveTextContent('החיפוש נעצר');
    expect(body()).toHaveTextContent('צריך להתחבר לחשבון כדי לשחק במדורג.');
    expect(code()).toHaveTextContent('signedOut');
    expect(screen.queryByRole('button', { name: 'חפש שוב' })).toBeNull();
    // The gold primary carries its hard shadow.
    expect(screen.getByTestId('match-error-practice-shadow')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    expect(handlers.onPractice).toHaveBeenCalledTimes(1);
  });

  it('an unknown queue, and a sign-in the server refused (a fresh token may help)', async () => {
    const { refuse } = await show();
    await refuse(FakeMatchmaking.refusal('badQueue'));
    expect(body()).toHaveTextContent('התור הזה לא קיים.');
    expect(screen.queryByRole('button', { name: 'חפש שוב' })).toBeNull();
    await refuse(FakeMatchmaking.refusal('unauthenticated'));
    expect(body()).toHaveTextContent('צריך להתחבר לחשבון כדי לשחק במדורג.');
    expect(screen.getByRole('button', { name: 'חפש שוב' })).toBeOnTheScreen();
    expect(screen.queryByTestId('match-error-practice-shadow')).toBeNull();
  });

  it('an email the server does not see as verified [D22]: "אמת את המייל" leads to the verification', async () => {
    const { refuse, handlers } = await show();
    await refuse(FakeMatchmaking.refusal('emailNotVerified'));
    expect(title()).toHaveTextContent('החיפוש נעצר');
    expect(body()).toHaveTextContent(
      'משחק מדורג דורש מייל מאומת, והמייל שלך עוד לא מאומת אצלנו. אם כבר פתחת את קישור האימות, לחץ "אימתתי" במסך הבא.',
    );
    expect(code()).toHaveTextContent('emailNotVerified-4215');
    // Another search can't help before the email is verified: "אמת את המייל" in place of "חפש שוב".
    expect(screen.queryByRole('button', { name: 'חפש שוב' })).toBeNull();
    expect(screen.getByTestId('match-error-verify-shadow')).toBeOnTheScreen();
    expect(screen.queryByTestId('match-error-practice-shadow')).toBeNull();
    expect(screen.getByRole('button', { name: 'עבור לאימון' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'אמת את המייל' }));
    expect(handlers.onVerifyEmail).toHaveBeenCalledTimes(1);
    // Once: the screen is being left.
    await fireEvent.press(screen.getByRole('button', { name: 'אמת את המייל' }));
    expect(handlers.onVerifyEmail).toHaveBeenCalledTimes(1);
    expect(handlers.onPractice).not.toHaveBeenCalled();
  });

  it('"חזרה לבית" leaves', async () => {
    const { refuse, handlers } = await show();
    await refuse(FakeMatchmaking.refusal('queueClosed'));
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה לבית' }));
    expect(handlers.onHome).toHaveBeenCalledTimes(1);
  });

  it('speaks English', async () => {
    const { mm, client, server, refuse } = await show('en');
    mm.offline = true;
    await act(async () => {
      await client.retry();
    });
    expect(title()).toHaveTextContent("Can't reach the server");
    expect(body()).toHaveTextContent(
      "We couldn't reach the game server. Check your connection and try again.",
    );
    expect(code()).toHaveAccessibleName(/^Error code: network/);
    mm.offline = false;
    await act(async () => {
      await client.retry();
    });
    await server(() => mm.searching());
    await server(() => mm.room.cut(1006));
    expect(body()).toHaveTextContent('The connection to the game server was lost during the search.');
    await refuse(FakeMatchmaking.refusal('alreadyQueued'));
    expect(body()).toHaveTextContent(
      'You already have a ranked search or game going, maybe on another device.',
    );
    await refuse(new MatchmakingFailure('signedOut', 'no account'));
    expect(body()).toHaveTextContent('Sign in to your account to play ranked.');
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to practice' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Back home' })).toBeOnTheScreen();
    await refuse(FakeMatchmaking.refusal('emailNotVerified'));
    expect(body()).toHaveTextContent(
      'Ranked games need a verified email, and yours isn\'t verified with us yet. If you already opened the verification link, tap "I verified" on the next screen.',
    );
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Search again' })).toBeNull();
  });
});
