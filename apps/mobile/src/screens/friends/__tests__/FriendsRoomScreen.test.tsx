import type { LobbyPlayer } from '@sudoku-fight/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { useToast } from '../../../components/ui/toastStore';
import { FRIENDS_UI } from '../../../config/friends';
import { cue } from '../../../services/feedback';
import { color } from '../../../theme';
import { iso, type Setup, setUp, styleOf, wait } from '../../game/connection/testing/setup';
import type { FriendsLobby } from '../friendsModel';
import { type FriendsRoomPhase, FriendsRoomScreen, type FriendsRoomScreenProps } from '../FriendsRoomScreen';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

const MOSHE: LobbyPlayer = {
  id: 'p-moshe',
  name: 'MosheG',
  avatarId: 'lava-lamp',
  country: 'IL',
  rating: 1287,
};
const DANA: LobbyPlayer = { id: 'p-dana', name: 'Dana', avatarId: 'av00', country: 'US', rating: 1190 };
const AVI: LobbyPlayer = { id: 'p-avi', name: 'Avi', country: null, rating: null };

const LINK = 'https://sudoku-fight-staging.fly.dev/r/123456';

const lobbyOf = (players: LobbyPlayer[], more: Partial<FriendsLobby> = {}): FriendsLobby => ({
  code: '123456',
  gameType: 'fast',
  players,
  hostId: 'p-moshe',
  minPlayers: 2,
  maxPlayers: 4,
  ...more,
});

const inLobby = (
  players: LobbyPlayer[],
  myId = 'p-moshe',
  more: Partial<FriendsLobby> = {},
): FriendsRoomPhase => ({
  kind: 'lobby',
  lobby: lobbyOf(players, more),
  myId,
});

function props(phase: FriendsRoomPhase, over: Partial<FriendsRoomScreenProps> = {}): FriendsRoomScreenProps {
  return {
    phase,
    linkFor: (code) => `https://sudoku-fight-staging.fly.dev/r/${code}`,
    onShare: jest.fn().mockResolvedValue(undefined),
    onCopy: jest.fn().mockResolvedValue(undefined),
    onStart: jest.fn(),
    onSetGameType: jest.fn(),
    onKick: jest.fn(),
    onLeave: jest.fn(),
    onRetry: jest.fn(),
    onCreateRoom: jest.fn(),
    onJoinWithCode: jest.fn(),
    onHome: jest.fn(),
    onReplace: jest.fn(),
    ...over,
  };
}

let env: Setup;
afterEach(() => {
  env.restore();
  useToast.getState().clear();
  jest.mocked(cue).mockClear();
  Object.assign(FRIENDS_UI, { shareBy: 'everyone', kick: true, startWithoutAway: 'confirm', joinCue: true });
});

describe('the friends room (Hebrew, friends-room.md §3.2)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('shows the code big, left to right, spelled out for a screen reader, and the room’s type and seats', async () => {
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, DANA, AVI]))} />);
    expect(screen.getByRole('header', { name: 'חדר עם חברים' })).toBeOnTheScreen();
    expect(screen.getByText('מהיר · 3 מתוך 4')).toBeOnTheScreen();
    const code = screen.getByTestId('friends-code');
    // An LRI…PDI isolate: Android ignores `writingDirection` (iOS only), and the bare "123 456" in the RTL
    // layout showed as "456 123" on the phone (1.0.4).
    expect(code).toHaveTextContent(`${LRI}123 456${PDI}`);
    expect(code).toHaveProp('selectable', true);
    expect(code).toHaveAccessibleName('קוד החדר: 1 2 3 4 5 6');
    expect(styleOf(code)).toMatchObject({ writingDirection: 'ltr', textAlign: 'center' });
    expect(screen.getByText('שחקנים · 3 מתוך 4')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'מהיר' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );
  });

  it('draws the seats: me in P1 with "אני", the host’s crown, flags and ratings, the empty seat waiting', async () => {
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, DANA, AVI], 'p-dana'))} />);
    expect(screen.getByTestId('friends-seat-0-who')).toHaveAccessibleName('MosheG, מארח, ישראל, דירוג 1287');
    expect(screen.getByTestId('friends-seat-1-who')).toHaveAccessibleName(
      'Dana, אני, ארצות הברית, דירוג 1190',
    );
    // No flag, no rating yet: nothing made up.
    expect(screen.getByTestId('friends-seat-2-who')).toHaveAccessibleName('Avi');
    expect(screen.getByTestId('friends-seat-3')).toHaveAccessibleName('כיסא פנוי, ממתין לשחקן');
    expect(screen.getByText('ממתין לשחקן…')).toBeOnTheScreen();
    // Me: P1's ring around my row, and the "אני" tag in P1.
    expect(styleOf(screen.getByTestId('friends-seat-1'))).toMatchObject({
      borderColor: color.players[0].ring,
    });
    expect(within(screen.getByTestId('friends-seat-1')).getByText('אני')).toHaveStyle({
      color: color.players[0].onRing,
    });
    expect(screen.getByTestId('friends-seat-0-host')).toHaveTextContent('מארח');
    expect(screen.getByTestId('friends-seat-0-rating')).toHaveTextContent('1287');
  });

  it('dims a player whose app is away, "לא בחדר כרגע" [D84a]', async () => {
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, { ...DANA, away: true }]))} />);
    expect(screen.getByTestId('friends-seat-1-away')).toHaveTextContent('לא בחדר כרגע');
    expect(screen.getByTestId('friends-seat-1-who')).toHaveAccessibleName(
      'Dana, ארצות הברית, דירוג 1190, לא בחדר כרגע',
    );
    expect(styleOf(screen.getByTestId('friends-seat-1-who')).opacity).toBeLessThan(1);
  });

  it('"שתף קישור" shares the code (no space) and the link; "העתק קוד" says "הקוד הועתק" for a moment', async () => {
    const p = props(inLobby([MOSHE, DANA], 'p-dana'));
    await render(<FriendsRoomScreen {...p} />);
    // A guest shares too [D87].
    await fireEvent.press(screen.getByRole('button', { name: 'שתף קישור' }));
    expect(p.onShare).toHaveBeenCalledWith(`בוא לשחק איתי סודוקו פייט! קוד החדר: 123456\n${LINK}`);
    await fireEvent.press(screen.getByRole('button', { name: 'העתק קוד' }));
    await wait(0);
    expect(p.onCopy).toHaveBeenCalledWith('123456');
    expect(screen.getByTestId('friends-copied')).toHaveTextContent('הקוד הועתק');
    expect(env.announced()).toContain('הקוד הועתק');
    await wait(FRIENDS_UI.copiedHoldMs);
    expect(screen.queryByTestId('friends-copied')).not.toBeOnTheScreen();
  });

  it('a share or a copy that fails says so, and breaks nothing', async () => {
    const p = props(inLobby([MOSHE]), {
      onShare: jest.fn().mockRejectedValue(new Error('no sheet')),
      onCopy: jest.fn().mockRejectedValue(new Error('no clipboard')),
    });
    await render(<FriendsRoomScreen {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'שתף קישור' }));
    await wait(0);
    expect(useToast.getState().current?.message).toBe('לא הצלחנו לפתוח את השיתוף');
    useToast.getState().clear();
    await fireEvent.press(screen.getByRole('button', { name: 'העתק קוד' }));
    await wait(0);
    expect(useToast.getState().current?.message).toBe('לא הצלחנו להעתיק את הקוד');
    expect(screen.queryByTestId('friends-copied')).not.toBeOnTheScreen();
  });

  it('with "share: host only" [D87 ב], a guest sees the code but no "שתף קישור"', async () => {
    FRIENDS_UI.shareBy = 'host';
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, DANA], 'p-dana'))} />);
    expect(screen.queryByRole('button', { name: 'שתף קישור' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('friends-code')).toHaveTextContent(`${LRI}123 456${PDI}`);
  });

  it('the host’s controls are the host’s alone: start, kick, the game type', async () => {
    const guest = props(inLobby([MOSHE, DANA], 'p-dana'));
    const { unmount } = await render(<FriendsRoomScreen {...guest} />);
    expect(screen.queryByTestId('friends-start')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('friends-seat-0-kick')).not.toBeOnTheScreen();
    expect(screen.getByTestId('friends-waiting')).toHaveTextContent(`מחכים ש־${iso('MosheG')} יתחיל`);
    expect(screen.getByText('המארח בוחר')).toBeOnTheScreen();
    const hard = screen.getByRole('radio', { name: 'קשה' });
    expect(hard).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));
    await fireEvent.press(hard);
    expect(guest.onSetGameType).not.toHaveBeenCalled();
    await unmount();

    const host = props(inLobby([MOSHE, DANA]));
    await render(<FriendsRoomScreen {...host} />);
    expect(screen.getByRole('button', { name: 'התחל משחק · 2 שחקנים' })).toBeOnTheScreen();
    expect(screen.getByText('רק המארח משנה')).toBeOnTheScreen();
    // No kick on my own row.
    expect(screen.queryByTestId('friends-seat-0-kick')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'קשה' }));
    expect(host.onSetGameType).toHaveBeenCalledWith('hard');
    await fireEvent.press(screen.getByRole('button', { name: 'התחל משחק · 2 שחקנים' }));
    expect(host.onStart).toHaveBeenCalledWith([]);
  });

  it('"התחל" is off with one connected player, and says why', async () => {
    const p = props(inLobby([MOSHE]));
    await render(<FriendsRoomScreen {...p} />);
    const start = screen.getByTestId('friends-start');
    expect(start).toHaveProp('accessibilityState', expect.objectContaining({ disabled: true }));
    expect(start).toHaveProp('accessibilityHint', 'צריך לפחות 2 שחקנים מחוברים כדי להתחיל');
    expect(screen.getByTestId('friends-start-hint')).toBeOnTheScreen();
    await fireEvent.press(start);
    expect(p.onStart).not.toHaveBeenCalled();
  });

  it('with a guest away, the button counts the connected only and asks "להתחיל בלי Avi?" [D83]', async () => {
    const p = props(inLobby([MOSHE, DANA, { ...AVI, away: true }]));
    await render(<FriendsRoomScreen {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'התחל משחק · 2 שחקנים' }));
    expect(p.onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: `להתחיל בלי ${iso('Avi')}?` })).toBeOnTheScreen();
    expect(screen.getByText(`${iso('Avi')} לא בחדר כרגע. מי שלא בחדר נשאר בחוץ.`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'לא, נחכה' }));
    expect(p.onStart).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'התחל משחק · 2 שחקנים' }));
    await fireEvent.press(screen.getByRole('button', { name: 'כן, להתחיל' }));
    expect(p.onStart).toHaveBeenCalledWith(['p-avi']);
  });

  it('"הוצא מהחדר" asks first [D85a]', async () => {
    const p = props(inLobby([MOSHE, DANA]));
    await render(<FriendsRoomScreen {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'הוצא את Dana מהחדר' }));
    expect(screen.getByRole('header', { name: `להוציא את ${iso('Dana')} מהחדר?` })).toBeOnTheScreen();
    expect(p.onKick).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'הוצא' }));
    expect(p.onKick).toHaveBeenCalledWith('p-dana');
  });

  it('without kicks (FRIENDS_UI.kick off) the host has no such button', async () => {
    FRIENDS_UI.kick = false;
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, DANA]))} />);
    expect(screen.queryByTestId('friends-seat-1-kick')).not.toBeOnTheScreen();
  });

  it('says who comes and goes, and a friend coming in is heard [§3.2]', async () => {
    const p = props(inLobby([MOSHE]));
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    expect(cue).not.toHaveBeenCalledWith('matchFound');
    await rerender(<FriendsRoomScreen {...p} phase={inLobby([MOSHE, DANA])} />);
    expect(env.announced()).toContain(`${iso('Dana')} הצטרף`);
    expect(cue).toHaveBeenCalledWith('matchFound');
    await rerender(<FriendsRoomScreen {...p} phase={inLobby([MOSHE, { ...DANA, away: true }])} />);
    expect(env.announced()).toContain(`${iso('Dana')} לא בחדר כרגע`);
    // The host leaves: Dana sees she is the host now [D84b].
    await rerender(<FriendsRoomScreen {...p} phase={inLobby([DANA], 'p-dana', { hostId: 'p-dana' })} />);
    expect(env.announced()).toContain(`${iso('MosheG')} יצא מהחדר. עכשיו אתה המארח`);
    expect(screen.getByTestId('friends-start')).toBeOnTheScreen();
  });

  it('a guest hears the host’s new game type [D82]; the host, who chose it, does not', async () => {
    const guest = props(inLobby([MOSHE, DANA], 'p-dana'));
    const { rerender, unmount } = await render(<FriendsRoomScreen {...guest} />);
    await rerender(
      <FriendsRoomScreen {...guest} phase={inLobby([MOSHE, DANA], 'p-dana', { gameType: 'hard' })} />,
    );
    expect(env.announced()).toContain('סוג המשחק עכשיו: קשה');
    expect(screen.getByRole('radio', { name: 'קשה' })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: true }),
    );
    await unmount();
    const host = props(inLobby([MOSHE, DANA]));
    const again = await render(<FriendsRoomScreen {...host} />);
    await again.rerender(
      <FriendsRoomScreen {...host} phase={inLobby([MOSHE, DANA], 'p-moshe', { gameType: 'normal' })} />,
    );
    expect(env.announced().filter((l) => l.startsWith('סוג המשחק'))).toHaveLength(1);
  });

  it('back after the game started without me: "המשחק התחיל בלעדיך" [D83]', async () => {
    await render(
      <FriendsRoomScreen
        {...props({ kind: 'failed', failure: 'gameStarted', code: '123456', startedWithout: true })}
      />,
    );
    expect(screen.getByText('המשחק התחיל בלעדיך.')).toBeOnTheScreen();
  });

  it('a command the server refused shows once, as a toast', async () => {
    const p = props(inLobby([MOSHE, DANA]));
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    const refused = (seq: number): FriendsRoomPhase => ({
      ...(inLobby([MOSHE, DANA, { ...AVI, away: true }]) as Extract<FriendsRoomPhase, { kind: 'lobby' }>),
      refused: { reason: 'playersAway', away: ['p-avi'], seq },
    });
    await rerender(<FriendsRoomScreen {...p} phase={refused(1)} />);
    expect(useToast.getState().current?.message).toBe(`${iso('Avi')} לא בחדר כרגע.`);
    useToast.getState().clear();
    await rerender(<FriendsRoomScreen {...p} phase={refused(1)} />);
    expect(useToast.getState().current).toBeNull();
  });

  it('leaves without asking (nothing is lost before the game)', async () => {
    const p = props(inLobby([MOSHE, DANA]));
    await render(<FriendsRoomScreen {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'יציאה מהחדר' }));
    expect(p.onLeave).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(p.onLeave).toHaveBeenCalledTimes(2);
  });

  it('blinks an empty seat in full motion', async () => {
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE]))} />);
    await wait(300);
    expect(screen.getByTestId('friends-seat-1-dot')).not.toHaveAnimatedStyle({ opacity: 1 });
  });

  it('says a refusal in the words of §3.6, with what can be done next', async () => {
    const p = props({ kind: 'failed', failure: 'notFound', code: '123456' });
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    expect(screen.getByText(`לא מצאנו חדר עם הקוד ${LRI}123 456${PDI}. בדוק את הספרות.`)).toBeOnTheScreen();
    expect(screen.queryByTestId('friends-retry')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'הצטרף עם קוד' }));
    expect(p.onJoinWithCode).toHaveBeenCalled();

    await rerender(<FriendsRoomScreen {...p} phase={{ kind: 'failed', failure: 'network' }} />);
    expect(screen.getByText('אין חיבור לאינטרנט.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('put out of the room: why, never "blocked", and a new room is a tap away', async () => {
    const p = props({ kind: 'closed', reason: 'kicked' });
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    expect(screen.getByText('המארח הוציא אותך מהחדר.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
    expect(p.onCreateRoom).toHaveBeenCalled();
    await rerender(<FriendsRoomScreen {...p} phase={{ kind: 'closed', reason: 'removed' }} />);
    expect(screen.getByText('יצאת מהחדר.')).toBeOnTheScreen();
  });

  it('asks "לסגור את החדר הקודם?" about the lobby I host, its code isolated', async () => {
    const p = props({ kind: 'replace', openCode: '654321' });
    await render(<FriendsRoomScreen {...p} />);
    expect(screen.getByRole('header', { name: 'לסגור את החדר הקודם?' })).toBeOnTheScreen();
    expect(
      screen.getByText(`כבר יש לך חדר פתוח, ${LRI}654 321${PDI}. אפשר לסגור אותו ולפתוח חדש, או לחזור אליו.`),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'סגור ופתח חדש' }));
    expect(p.onReplace).toHaveBeenCalledWith('close');
  });

  it('opening, and the 3… 2… 1… after "התחל"', async () => {
    const p = props({ kind: 'opening', via: 'create' });
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    expect(screen.getByText('פותח חדר…')).toBeOnTheScreen();
    const lobby = lobbyOf([MOSHE, DANA, { ...AVI, away: true }]);
    await rerender(
      <FriendsRoomScreen {...p} phase={{ kind: 'countdown', lobby, myId: 'p-moshe', step: 3 }} />,
    );
    expect(screen.getByTestId('friends-countdown-step')).toHaveTextContent('3');
    // Only the players in the game: Avi was away at the start.
    expect(screen.getByTestId('friends-countdown-p-dana')).toBeOnTheScreen();
    expect(screen.queryByTestId('friends-countdown-p-avi')).not.toBeOnTheScreen();
    await rerender(
      <FriendsRoomScreen {...p} phase={{ kind: 'countdown', lobby, myId: 'p-moshe', step: 'go' }} />,
    );
    expect(screen.getByTestId('friends-countdown-step')).toHaveTextContent('GO!');
    expect(screen.queryByRole('button', { name: 'חזרה' })).not.toBeOnTheScreen();
  });
});

describe('the friends room, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('keeps the empty seat still, and a friend comes in without motion', async () => {
    const p = props(inLobby([MOSHE]));
    const { rerender } = await render(<FriendsRoomScreen {...p} />);
    await wait(300);
    expect(screen.getByTestId('friends-seat-1-dot')).toHaveAnimatedStyle({ opacity: 1 });
    await rerender(<FriendsRoomScreen {...p} phase={inLobby([MOSHE, DANA])} />);
    expect(screen.getByTestId('friends-seat-1-who')).toBeOnTheScreen();
    expect(screen.getByTestId('friends-seat-2-dot')).toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('the friends room (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(<FriendsRoomScreen {...props(inLobby([MOSHE, DANA, { ...AVI, away: true }]))} />);
    expect(screen.getByRole('header', { name: 'Room with friends' })).toBeOnTheScreen();
    expect(screen.getByText('Fast · 3 of 4')).toBeOnTheScreen();
    expect(screen.getByTestId('friends-code')).toHaveAccessibleName('Room code: 1 2 3 4 5 6');
    // The same isolate in English: harmless in an LTR line, and the code never depends on the language.
    expect(screen.getByTestId('friends-code')).toHaveTextContent(`${LRI}123 456${PDI}`);
    expect(screen.getByRole('button', { name: 'Start game · 2 players' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeOnTheScreen();
    expect(screen.getByTestId('friends-seat-2-who')).toHaveAccessibleName('Avi, Not in the room right now');
    expect(screen.getByRole('button', { name: 'Leave room' })).toBeOnTheScreen();
  });
});
