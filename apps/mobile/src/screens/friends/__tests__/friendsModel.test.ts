import {
  FRIENDS_APP_ERRORS,
  FRIENDS_ERROR_CODES,
  FRIENDS_LOBBY_ERRORS,
  FRIENDS_ROOM_CLOSED_REASONS,
  type LobbyPlayer,
} from '@sudoku-fight/protocol';

import i18n from '../../../i18n';
import {
  boxesOf,
  changeText,
  closedText,
  codeOf,
  digitsOf,
  EMPTY_CODE,
  failureText,
  type FriendsLobby,
  type FriendsT,
  isolateCode,
  isRetryable,
  lobbyChanges,
  lobbyRefusalText,
  seatsOf,
  shareMessageOf,
  spellDigits,
  startModelOf,
  typeInto,
  waitText,
} from '../friendsModel';

const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const FSI = String.fromCharCode(0x2068);

const he = () => i18n.getFixedT('he', 'friends') as FriendsT;
const en = () => i18n.getFixedT('en', 'friends') as FriendsT;

const player = (id: string, name: string, more: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  id,
  name,
  avatarId: 'lava-lamp',
  country: 'IL',
  rating: 1287,
  ...more,
});

const MOSHE = player('p-moshe', 'MosheG');
const DANA = player('p-dana', 'Dana', { rating: 1190, country: 'US' });
const AVI = player('p-avi', 'Avi', { rating: null, country: null, avatarId: 'av00' });

const lobbyOf = (players: LobbyPlayer[], more: Partial<FriendsLobby> = {}): FriendsLobby => ({
  code: '123456',
  gameType: 'fast',
  players,
  hostId: players[0]?.id ?? null,
  minPlayers: 2,
  maxPlayers: 4,
  ...more,
});

describe('the seats (friends-room.md §3.2)', () => {
  it('keeps the order they came in, then the empty seats up to 4', () => {
    const seats = seatsOf(lobbyOf([MOSHE, DANA, AVI]), 'p-moshe');
    expect(seats.map((s) => s.player?.name ?? null)).toEqual(['MosheG', 'Dana', 'Avi', null]);
    expect(seats.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
  });

  it('draws me in P1 (●) wherever I sit, and the others ▲ ■ ◆ in seat order', () => {
    // I came in third: still colour 0; the others take 1–3 in their order, the empty seat too.
    const seats = seatsOf(lobbyOf([MOSHE, DANA, AVI]), 'p-avi');
    expect(seats.map((s) => s.colorIndex)).toEqual([1, 2, 0, 3]);
    expect(seats[2]!.player).toMatchObject({ name: 'Avi', isMe: true });
    // A spectator's view (no id yet): the seats as they are.
    expect(seatsOf(lobbyOf([MOSHE, DANA]), null).map((s) => s.colorIndex)).toEqual([0, 1, 2, 3]);
  });

  it('marks the host (the server’s word, else the first in), "לא בחדר כרגע", the flag and the rating', () => {
    const lobby = lobbyOf([MOSHE, { ...DANA, away: true }, AVI], { hostId: 'p-dana' });
    const [moshe, dana, avi] = seatsOf(lobby, 'p-moshe').map((s) => s.player!);
    expect(moshe).toMatchObject({ isHost: false, isMe: true, away: false, rating: 1287, country: 'IL' });
    expect(dana).toMatchObject({ isHost: true, isMe: false, away: true, rating: 1190, country: 'US' });
    expect(avi).toMatchObject({ isHost: false, rating: null, country: null, avatarId: 'av00' });
    // No hostId (an older server's lobby): the first one in.
    const first = seatsOf(lobbyOf([MOSHE, DANA], { hostId: null }), 'p-dana');
    expect(first[0]!.player!.isHost).toBe(true);
  });

  it('a room the server says is larger (or a lobby with more players) shows every seat', () => {
    expect(seatsOf(lobbyOf([MOSHE], { maxPlayers: undefined }), 'p-moshe')).toHaveLength(4);
    expect(seatsOf(lobbyOf([MOSHE, DANA, AVI], { maxPlayers: 2 }), 'p-moshe')).toHaveLength(3);
  });
});

describe('"התחל משחק" [D83]', () => {
  it('is the host’s alone, on from 2 connected players', () => {
    const alone = startModelOf(lobbyOf([MOSHE]), 'p-moshe');
    expect(alone).toMatchObject({ isHost: true, connected: 1, canStart: false });
    const two = startModelOf(lobbyOf([MOSHE, DANA]), 'p-moshe');
    expect(two).toMatchObject({ isHost: true, connected: 2, canStart: true, away: [] });
    // A guest never can, however many are in.
    const guest = startModelOf(lobbyOf([MOSHE, DANA, AVI]), 'p-dana');
    expect(guest).toMatchObject({ isHost: false, canStart: false, hostAway: false });
    expect(guest.host?.name).toBe('MosheG');
  });

  it('counts the connected players only; an away guest is asked about ("להתחיל בלי Avi?")', () => {
    const lobby = lobbyOf([MOSHE, DANA, { ...AVI, away: true }]);
    const m = startModelOf(lobby, 'p-moshe');
    expect(m.connected).toBe(2);
    expect(m.canStart).toBe(true);
    expect(m.away.map((p) => p.name)).toEqual(['Avi']);
    // Only away guests: one connected is not enough.
    expect(startModelOf(lobbyOf([MOSHE, { ...DANA, away: true }]), 'p-moshe').canStart).toBe(false);
  });

  it('with the setting "wait", stays off until everyone is back', () => {
    const lobby = lobbyOf([MOSHE, DANA, { ...AVI, away: true }]);
    expect(startModelOf(lobby, 'p-moshe', { startWithoutAway: 'wait' }).canStart).toBe(false);
    expect(startModelOf(lobbyOf([MOSHE, DANA]), 'p-moshe', { startWithoutAway: 'wait' }).canStart).toBe(true);
  });

  it('tells the guests when the host is away ("המארח לא בחדר כרגע")', () => {
    const m = startModelOf(lobbyOf([{ ...MOSHE, away: true }, DANA]), 'p-dana');
    expect(m).toMatchObject({ isHost: false, hostAway: true });
  });

  it('says the button, the wait and the question in Hebrew and English', () => {
    expect(he()('start.button', { count: 2 })).toBe('התחל משחק · 2 שחקנים');
    expect(he()('start.button', { count: 1 })).toBe('התחל משחק');
    expect(en()('start.button', { count: 3 })).toBe('Start game · 3 players');
    expect(he()('start.waitingForHost', { name: `${FSI}MosheG${PDI}` })).toBe(
      `מחכים ש־${FSI}MosheG${PDI} יתחיל`,
    );
    expect(he()('startWithout.title', { names: 'Avi' })).toBe('להתחיל בלי Avi?');
  });
});

describe('the words', () => {
  it('shows the code as "123 456", isolated left to right inside Hebrew text', () => {
    expect(isolateCode('123456')).toBe(`${LRI}123 456${PDI}`);
    // A screen reader spells it digit by digit.
    expect(spellDigits('123456')).toBe('1 2 3 4 5 6');
    expect(spellDigits('123 456')).toBe('1 2 3 4 5 6');
  });

  it('shares the code without a space, then the link on its own line (§6.7)', () => {
    const link = 'https://sudoku-fight-staging.fly.dev/r/123456';
    expect(shareMessageOf(he(), '123456', link)).toBe(`בוא לשחק איתי סודוקו פייט! קוד החדר: 123456\n${link}`);
    expect(shareMessageOf(en(), '123456', link)).toBe(`Join me in Sudoku Fight! Room code: 123456\n${link}`);
  });

  it('has words for every refusal the routes and the app can give, in both languages (§3.6)', () => {
    for (const t of [he(), en()]) {
      for (const failure of [...FRIENDS_ERROR_CODES, ...FRIENDS_APP_ERRORS]) {
        const words = failureText(t, failure, { code: '123456', retryAfterSec: 240 });
        expect({ failure, words }).toEqual({ failure, words: expect.stringMatching(/\S/) });
        expect(words).not.toMatch(/{{|errors\./);
      }
    }
  });

  it('says the code back for a missing room, and a block reads exactly the same [D85c]', () => {
    expect(failureText(he(), 'notFound', { code: '123456' })).toBe(
      `לא מצאנו חדר עם הקוד ${LRI}123 456${PDI}. בדוק את הספרות.`,
    );
    expect(failureText(he(), 'notFound')).toBe('לא מצאנו חדר עם הקוד הזה.');
    expect(failureText(he(), 'cantJoin')).toBe('חסמת שחקן שנמצא בחדר הזה.');
    expect(failureText(he(), 'roomFull')).toBe('החדר מלא (4 מתוך 4).');
    expect(failureText(he(), 'notAvailable')).toBe('האפשרות הזו עוד לא זמינה.');
    expect(failureText(en(), 'kicked')).toBe('The host removed you from the room.');
  });

  it('says how long to wait after too many tries', () => {
    expect(failureText(he(), 'tooManyRequests', { retryAfterSec: 240 })).toBe(
      'יותר מדי ניסיונות. נסה שוב בעוד 4 דקות.',
    );
    expect(waitText(he(), 61)).toBe('2 דקות');
    expect(waitText(he(), 30)).toBe('30 שניות');
    expect(waitText(he(), 1)).toBe('שנייה');
    expect(waitText(en(), 60)).toBe('a minute');
  });

  it('never says "blocked" when the server put me out [D85c]', () => {
    for (const reason of FRIENDS_ROOM_CLOSED_REASONS)
      for (const t of [he(), en()]) expect(closedText(t, reason)).not.toMatch(/חסמ|block/i);
    expect(closedText(he(), 'removed')).toBe('יצאת מהחדר.');
    expect(closedText(he(), 'otherDevice')).toBe('החדר נפתח במכשיר אחר.');
  });

  it('has words for every refused host command', () => {
    for (const reason of FRIENDS_LOBBY_ERRORS)
      expect(lobbyRefusalText(he(), reason, ['Avi'], ', ')).toMatch(/\S/);
    expect(lobbyRefusalText(he(), 'playersAway', ['Avi', 'Dana'], ', ')).toBe(
      `${FSI}Avi${PDI}, ${FSI}Dana${PDI} לא בחדר כרגע.`,
    );
  });

  it('only a lost connection or a busy server is worth "נסה שוב"', () => {
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('unavailable')).toBe(true);
    expect(isRetryable('notFound')).toBe(false);
    expect(isRetryable('kicked')).toBe(false);
    expect(isRetryable('roomFull')).toBe(false);
  });
});

describe('what changed in the room', () => {
  it('a friend coming in, stepping away, coming back, leaving; the host passing on', () => {
    const start = lobbyOf([MOSHE]);
    expect(lobbyChanges(null, start, 'p-moshe')).toEqual([]);
    const joined = lobbyOf([MOSHE, DANA]);
    expect(lobbyChanges(start, joined, 'p-moshe')).toEqual([{ kind: 'joined', name: 'Dana' }]);
    const away = lobbyOf([MOSHE, { ...DANA, away: true }]);
    expect(lobbyChanges(joined, away, 'p-moshe')).toEqual([{ kind: 'away', name: 'Dana' }]);
    expect(lobbyChanges(away, joined, 'p-moshe')).toEqual([{ kind: 'back', name: 'Dana' }]);
    // The host leaves: Dana is the host now [D84b].
    const passed = lobbyOf([DANA], { hostId: 'p-dana' });
    expect(lobbyChanges(joined, passed, 'p-dana')).toEqual([
      { kind: 'left', name: 'MosheG' },
      { kind: 'host', name: 'Dana', isMe: true },
    ]);
  });

  it('my own comings and goings are not news to me', () => {
    expect(lobbyChanges(lobbyOf([MOSHE]), lobbyOf([MOSHE, DANA]), 'p-dana')).toEqual([]);
  });

  it('says them as sentences ("Dana הצטרף", "עכשיו אתה המארח")', () => {
    expect(changeText(he(), { kind: 'joined', name: 'Dana' })).toBe(`${FSI}Dana${PDI} הצטרף`);
    expect(changeText(he(), { kind: 'host', name: 'Dana', isMe: true })).toBe('עכשיו אתה המארח');
    expect(changeText(en(), { kind: 'left', name: 'Avi' })).toBe(`${FSI}Avi${PDI} left the room`);
  });
});

describe('the code as typed', () => {
  it('takes digits only, any keyboard’s', () => {
    expect(digitsOf('1a2 3-4')).toBe('1234');
    expect(digitsOf(String.fromCharCode(0x661, 0x662, 0x6f3, 0xff14))).toBe('1234');
  });

  it('writes digits on from a box, and moves the focus', () => {
    expect(typeInto(EMPTY_CODE, 0, '1')).toEqual({ boxes: ['1', '', '', '', '', ''], focus: 1 });
    expect(typeInto(EMPTY_CODE, 2, '345')).toEqual({ boxes: ['', '', '3', '4', '5', ''], focus: 5 });
    // More than fits: the rest is dropped; the focus stays on the last box.
    expect(typeInto(EMPTY_CODE, 4, '5678')).toEqual({ boxes: ['', '', '', '', '5', '6'], focus: 5 });
  });

  it('is a code once all six boxes have a digit', () => {
    expect(codeOf(boxesOf('123456'))).toBe('123456');
    expect(codeOf(boxesOf('12345'))).toBeNull();
    expect(codeOf(EMPTY_CODE)).toBeNull();
  });
});
