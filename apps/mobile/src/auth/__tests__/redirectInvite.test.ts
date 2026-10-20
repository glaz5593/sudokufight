import { isSignInPath, pathOf, redirectFor, ROUTES } from '../redirect';

/**
 * A room link opened before the player could go in (friends-room.md §6.5, D88): the sign-in, the end of the
 * registration and a new name lead straight into the room; until then the link changes nothing.
 */

const invite = '123456';
const ROOM = ['room', '[code]'];

describe('the auth gate with a pending invite [D88]', () => {
  it('signed out: the sign-in first, as for any screen (the link is kept, not followed)', () => {
    expect(redirectFor('signedOut', ROOM, { invite })).toBe(ROUTES.login);
    expect(redirectFor('signedOut', ['login'], { invite })).toBeNull();
    expect(redirectFor('signedOut', ['register', 'fighter'], { invite })).toBeNull();
  });

  it('signed in without a profile: the registration first', () => {
    expect(redirectFor('needsProfile', ROOM, { invite })).toBe(ROUTES.registerFighter);
    expect(redirectFor('needsProfile', ['register', 'fighter'], { invite })).toBeNull();
  });

  it('signed in, or the registration done: straight into the room, not Home', () => {
    for (const s of [['login'], ['register', 'fighter'], ['register', 'account'], ['forgot-password']])
      expect([s, redirectFor('ready', s, { invite })]).toEqual([s, '/room/123456']);
    expect(redirectFor('ready', ['(auth)', 'login'], { invite })).toBe('/room/123456');
  });

  it('an admin reset the name: the new name first, then the room', () => {
    expect(redirectFor('ready', ROOM, { invite, nameReset: true })).toBe(ROUTES.chooseName);
    expect(redirectFor('ready', ['choose-name'], { invite, nameReset: true })).toBeNull();
    expect(redirectFor('ready', ['choose-name'], { invite })).toBe('/room/123456');
  });

  it('ready anywhere else: the invite moves nobody (a link that came while playing asks first)', () => {
    for (const s of [[], ['modes'], ['game'], ROOM, ['friends', 'room'], ['settings']])
      expect([s, redirectFor('ready', s, { invite })]).toEqual([s, null]);
  });

  it('no invite, or not a code: Home, as before', () => {
    expect(redirectFor('ready', ['login'])).toBe(ROUTES.home);
    expect(redirectFor('ready', ['login'], { invite: null })).toBe(ROUTES.home);
    expect(redirectFor('ready', ['login'], { invite: '12345' })).toBe(ROUTES.home);
    expect(redirectFor('ready', ['choose-name'], { invite: 'abc' })).toBe(ROUTES.home);
  });

  it('still loading: nowhere yet', () => {
    expect(redirectFor('loading', ['login'], { invite })).toBeNull();
    expect(redirectFor('loading', ROOM, { invite })).toBeNull();
  });
});

describe('paths', () => {
  it("a screen's path, without its groups", () => {
    expect(pathOf([])).toBe('');
    expect(pathOf(['(auth)', 'login'])).toBe('login');
    expect(pathOf(['room', '[code]'])).toBe('room/[code]');
  });

  it('the screens a pending invite leads out of: signing in, signing up, a new name', () => {
    for (const p of ['login', 'forgot-password', 'register/fighter', 'register/account', 'choose-name'])
      expect([p, isSignInPath(p)]).toEqual([p, true]);
    for (const p of ['', 'modes', 'game', 'room/[code]', 'verify-email', 'settings'])
      expect([p, isSignInPath(p)]).toEqual([p, false]);
  });
});
