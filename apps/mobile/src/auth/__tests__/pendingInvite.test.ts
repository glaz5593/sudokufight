import Storage from 'expo-sqlite/kv-store';

import { LINKS_UI } from '../../config/links';
import {
  activityOf,
  type ActivitySources,
  announceLink,
  askAboutLink,
  clearArrival,
  clearPrompt,
  closePrompt,
  forgetInvite,
  forgetRoom,
  inviteCodeOf,
  linkStepOf,
  markStarted,
  pendingInviteCode,
  rememberInvite,
  rememberRoom,
  roomToResume,
  roomToResumeOf,
  sanitizeSaved,
  setGoing,
  usePendingInvite,
} from '../pendingInvite';

/**
 * A room link's way into the app (friends-room.md §6.5, §6.6, D88): the pending invite through a sign-in, the
 * room the app goes back to after it was closed, and what a link asks when the player is busy.
 */

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const KEY = 'friends-links';

const reset = () =>
  usePendingInvite.setState({
    invite: null,
    room: null,
    arrival: null,
    started: false,
    prompt: null,
    going: null,
  });

/** What the phone kept, read back as a new run would (synchronously, before the first render). */
const reload = async (saved: unknown) => {
  // The store writes itself to disk on every change: cleared first, then the saved state, then read.
  reset();
  await Storage.setItem(KEY, JSON.stringify({ version: 1, state: saved }));
  await usePendingInvite.persist.rehydrate();
  return usePendingInvite.getState();
};

beforeEach(reset);

describe('the pending invite [D88]', () => {
  it('a link keeps its code; good for 60 minutes (LINKS_UI.pendingInviteTtlMs), then forgotten', () => {
    rememberInvite('123456', T0);
    expect(pendingInviteCode(T0)).toBe('123456');
    expect(pendingInviteCode(T0 + 59 * MIN)).toBe('123456');
    expect(pendingInviteCode(T0 + LINKS_UI.pendingInviteTtlMs)).toBeNull();
    // A clock that went back: not trusted.
    expect(pendingInviteCode(T0 - 1)).toBeNull();
    expect(
      inviteCodeOf({ code: '123456', at: T0 }, T0 + 10 * MIN, { pendingInviteTtlMs: 5 * MIN }),
    ).toBeNull();
  });

  it('a newer link replaces it; forgetting it once used', () => {
    rememberInvite('123456', T0);
    rememberInvite('654321', T0 + MIN);
    expect(pendingInviteCode(T0 + MIN)).toBe('654321');
    forgetInvite();
    expect(pendingInviteCode(T0 + MIN)).toBeNull();
  });

  it('only a 6-digit code is kept', () => {
    for (const bad of ['12345', '1234567', '12 3456', 'abcdef', '']) rememberInvite(bad, T0);
    expect(usePendingInvite.getState().invite).toBeNull();
  });

  it('on disk at once, so an app closed mid-registration still has it at the next start', async () => {
    rememberInvite('123456', T0);
    const saved = JSON.parse((await Storage.getItem(KEY))!) as { state: unknown };
    expect(saved.state).toEqual({ invite: { code: '123456', at: T0 }, room: null });
    const state = await reload(saved.state);
    expect(state.invite).toEqual({ code: '123456', at: T0 });
  });

  it('what was saved is read back only when it is what this file writes', async () => {
    for (const invite of [
      { code: '12345', at: T0 },
      { code: 123456, at: T0 },
      { code: '123456', at: 'yesterday' },
      { code: '123456', at: -1 },
      { code: '123456' },
      '123456',
      null,
    ])
      expect((await reload({ invite })).invite).toBeNull();
    expect(sanitizeSaved(null)).toEqual({});
    expect(sanitizeSaved('x')).toEqual({});
    // Nothing of the moment (a question, a link on its way) is kept.
    expect((await reload({ arrival: { code: '123456', seq: 1 }, started: true })).arrival).toBeNull();
    expect(usePendingInvite.getState().started).toBe(false);
  });
});

describe('the current room: back to it after the app was closed (§6.5)', () => {
  it('for the same account, within LINKS_UI.currentRoomTtlMs (6 h)', () => {
    rememberRoom('123456', 'uid-1', T0);
    expect(roomToResume('uid-1', T0 + 5 * 60 * MIN)).toBe('123456');
    expect(roomToResume('uid-1', T0 + LINKS_UI.currentRoomTtlMs)).toBeNull();
    expect(roomToResume('uid-2', T0)).toBeNull();
    expect(roomToResume(null, T0)).toBeNull();
    expect(
      roomToResumeOf({ code: '123456', owner: 'u', at: T0 }, 'u', T0 + 2 * MIN, { currentRoomTtlMs: MIN }),
    ).toBe(null);
  });

  it('forgotten when the phone is out of it; kept on disk with its owner', async () => {
    rememberRoom('123456', 'uid-1', T0);
    expect((await reload({ room: { code: '123456', owner: 'uid-1', at: T0 } })).room).toEqual({
      code: '123456',
      owner: 'uid-1',
      at: T0,
    });
    forgetRoom();
    expect(roomToResume('uid-1', T0)).toBeNull();
    for (const room of [
      { code: '123456', owner: '', at: T0 },
      { code: '123456', owner: 'x'.repeat(129), at: T0 },
      { code: '123456', at: T0 },
      { code: 'abcdef', owner: 'u', at: T0 },
    ])
      expect((await reload({ room })).room).toBeNull();
  });

  it('needs a code and an account', () => {
    rememberRoom('12345', 'uid-1', T0);
    rememberRoom('123456', '', T0);
    expect(usePendingInvite.getState().room).toBeNull();
  });
});

describe('a link while the app runs (§6.6)', () => {
  it('each link is an arrival of its own (the same room twice too), until handled', () => {
    announceLink('123456');
    const first = usePendingInvite.getState().arrival;
    announceLink('123456');
    const second = usePendingInvite.getState().arrival;
    expect(first?.code).toBe('123456');
    expect(second).toEqual({ code: '123456', seq: first!.seq + 1 });
    clearArrival();
    expect(usePendingInvite.getState().arrival).toBeNull();
    announceLink('nope');
    expect(usePendingInvite.getState().arrival).toBeNull();
  });

  it('a question stays while its dialog leaves, then goes', () => {
    askAboutLink('leavePractice', '123456');
    expect(usePendingInvite.getState().prompt).toEqual({
      question: 'leavePractice',
      code: '123456',
      open: true,
    });
    closePrompt();
    expect(usePendingInvite.getState().prompt).toEqual({
      question: 'leavePractice',
      code: '123456',
      open: false,
    });
    clearPrompt();
    expect(usePendingInvite.getState().prompt).toBeNull();
    // An open question is not cleared by a dialog that left before it.
    askAboutLink('inGame', '654321');
    clearPrompt();
    expect(usePendingInvite.getState().prompt?.open).toBe(true);
  });

  it('the start mark and the way into a room are of this run only', () => {
    markStarted();
    setGoing('123456');
    expect(usePendingInvite.getState()).toMatchObject({ started: true, going: '123456' });
    setGoing(null);
    expect(usePendingInvite.getState().going).toBeNull();
  });
});

describe('what the player is in the middle of', () => {
  const view = (status: string) => ({ getView: () => ({ status }) });
  const online = (o: { hasGame?: boolean; status?: string; over?: boolean; startsAt?: number }) => ({
    hasGame: o.hasGame ?? false,
    getView: () => ({ status: o.over ? 'over' : 'running' }),
    online: { status: o.status ?? 'live', startsAt: o.startsAt ?? null },
  });
  const of = (s: Partial<ActivitySources>) =>
    activityOf({ path: '', session: null, online: null, match: null, friendsRoom: null, ...s });

  it('nothing: idle (Home, the menus)', () => {
    expect(of({})).toEqual({ kind: 'idle' });
    expect(of({ path: 'modes' })).toEqual({ kind: 'idle' });
  });

  it('a practice on the game screen, or a stage: practice (over: idle)', () => {
    expect(of({ path: 'game', session: view('running') })).toEqual({ kind: 'practice' });
    expect(of({ path: 'game', session: view('paused') })).toEqual({ kind: 'practice' });
    expect(of({ path: 'game', session: view('over') })).toEqual({ kind: 'idle' });
    expect(of({ path: 'levels/play' })).toEqual({ kind: 'practice' });
    // A practice the store still holds while Home is on screen is not under way.
    expect(of({ path: '', session: view('running') })).toEqual({ kind: 'idle' });
  });

  it('a ranked search: search; its match found, before GO and after: game', () => {
    expect(of({ path: 'match', match: {} })).toEqual({ kind: 'search' });
    expect(of({ match: {}, online: online({ status: 'lobby' }) })).toEqual({ kind: 'game' });
    expect(of({ match: {}, online: online({ hasGame: true }) })).toEqual({ kind: 'game' });
  });

  it("a friends room before its game: room, with that room's code; its game: game", () => {
    expect(of({ path: 'friends/room', online: online({ status: 'lobby' }), friendsRoom: '654321' })).toEqual({
      kind: 'room',
      code: '654321',
    });
    expect(of({ online: online({ status: 'reconnecting' }), friendsRoom: '654321' })).toEqual({
      kind: 'room',
      code: '654321',
    });
    expect(of({ online: online({ hasGame: true }), friendsRoom: '654321' })).toEqual({ kind: 'game' });
  });

  it("a friends room's 3… 2… 1… (the host started, no board yet): game, so a link asks inGame", () => {
    const counting = of({ online: online({ status: 'lobby', startsAt: 5000 }), friendsRoom: '654321' });
    expect(counting).toEqual({ kind: 'game' });
    expect(linkStepOf(counting, '123456')).toEqual({ kind: 'ask', question: 'inGame' });
  });

  it('an online game that is over, or a connection that closed: idle', () => {
    expect(of({ online: online({ hasGame: true, over: true }) })).toEqual({ kind: 'idle' });
    expect(of({ online: online({ hasGame: true, status: 'closed' }) })).toEqual({ kind: 'idle' });
    expect(of({ online: online({ status: 'closed' }) })).toEqual({ kind: 'idle' });
  });
});

describe('what a link does (§6.6)', () => {
  it('free: straight in; already in that room: nothing', () => {
    expect(linkStepOf({ kind: 'idle' }, '123456')).toEqual({ kind: 'enter' });
    expect(linkStepOf({ kind: 'room', code: '123456' }, '123456')).toEqual({ kind: 'here' });
  });

  it('busy: asks first', () => {
    expect(linkStepOf({ kind: 'practice' }, '123456')).toEqual({ kind: 'ask', question: 'leavePractice' });
    expect(linkStepOf({ kind: 'search' }, '123456')).toEqual({ kind: 'ask', question: 'cancelSearch' });
    expect(linkStepOf({ kind: 'room', code: '654321' }, '123456')).toEqual({
      kind: 'ask',
      question: 'switchRoom',
    });
    expect(linkStepOf({ kind: 'game' }, '123456')).toEqual({ kind: 'ask', question: 'inGame' });
  });
});
