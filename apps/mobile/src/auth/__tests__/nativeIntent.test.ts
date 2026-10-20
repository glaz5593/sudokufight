import { roomAppLink, roomLink } from '@sudoku-fight/protocol';

import { redirectSystemPath } from '../../../app/+native-intent';
import { useToast } from '../../components/ui/toastStore';
import i18n from '../../i18n';
import { track } from '../../services/analytics';
import { useAuth } from '../authStore';
import { pendingInviteCode, usePendingInvite } from '../pendingInvite';

/**
 * app/+native-intent.tsx (friends-room.md §6, D87, D88): every URL the app is opened with. A room link goes
 * straight into its room: at a start by its route, while running through auth/InviteLinkPrompt.tsx (which
 * asks first when the player is busy). A room link that leads nowhere goes home; anything else is left alone.
 */

const STAGING = 'sudoku-fight-staging.fly.dev';

jest.mock('../../config/server', () => ({
  serverEndpoint: { hostname: 'sudoku-fight-staging.fly.dev', port: 443, secure: true },
  httpBaseUrl: () => 'https://sudoku-fight-staging.fly.dev:443',
}));
jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

const linkOpens = () => jest.mocked(track).mock.calls.filter(([name]) => name === 'friends_link_open');
const toasts = () => {
  const { current, queue } = useToast.getState();
  return [current, ...queue].filter((t) => t !== null).map((t) => t.message);
};

beforeEach(async () => {
  jest.mocked(track).mockClear();
  useToast.getState().clear();
  usePendingInvite.setState({ invite: null, arrival: null, prompt: null, going: null });
  useAuth.setState({ status: 'ready' });
  await i18n.changeLanguage('he');
});

describe('a room link at the start', () => {
  it("https://<this app's server>/r/123456 and sudokufight://room/123456: into /room/123456", () => {
    expect(redirectSystemPath({ path: roomLink(STAGING, '123456'), initial: true })).toBe('/room/123456');
    expect(pendingInviteCode()).toBe('123456');
    expect(redirectSystemPath({ path: roomAppLink('654321'), initial: true })).toBe('/room/654321');
    expect(pendingInviteCode()).toBe('654321');
    // Nothing to ask at a start: the room's route goes in (through the sign-in first, when there is one).
    expect(usePendingInvite.getState().arrival).toBeNull();
  });

  it('friends_link_open {signedIn}, never the code', () => {
    redirectSystemPath({ path: roomLink(STAGING, '123456'), initial: true });
    expect(linkOpens()).toEqual([['friends_link_open', { signedIn: true }]]);
    useAuth.setState({ status: 'signedOut' });
    redirectSystemPath({ path: roomLink(STAGING, '123456'), initial: true });
    expect(linkOpens()[1]).toEqual(['friends_link_open', { signedIn: false }]);
  });

  it('while the sign-in still loads, friends_link_open waits for it', () => {
    useAuth.setState({ status: 'loading' });
    redirectSystemPath({ path: roomAppLink('123456'), initial: true });
    expect(linkOpens()).toEqual([]);
    useAuth.setState({ status: 'loading' });
    expect(linkOpens()).toEqual([]);
    useAuth.setState({ status: 'needsProfile' });
    expect(linkOpens()).toEqual([['friends_link_open', { signedIn: false }]]);
    useAuth.setState({ status: 'ready' });
    expect(linkOpens()).toHaveLength(1);
  });

  it('another server\'s link, or a bad code: Home, and "הקישור לא תקין"', () => {
    expect(redirectSystemPath({ path: 'https://evil.example/r/123456', initial: true })).toBe('/');
    expect(redirectSystemPath({ path: `https://${STAGING}/r/12345`, initial: true })).toBe('/');
    expect(redirectSystemPath({ path: 'sudokufight://room/abc', initial: true })).toBe('/');
    expect(toasts()).toEqual(['הקישור לא תקין', 'הקישור לא תקין', 'הקישור לא תקין']);
    expect(pendingInviteCode()).toBeNull();
    expect(linkOpens()).toEqual([]);
  });
});

describe('a room link while the app runs', () => {
  it('stays where it is; InviteLinkPrompt goes in, or asks first', () => {
    expect(redirectSystemPath({ path: roomLink(STAGING, '123456'), initial: false })).toBeNull();
    expect(pendingInviteCode()).toBe('123456');
    expect(usePendingInvite.getState().arrival).toMatchObject({ code: '123456' });
    expect(linkOpens()).toHaveLength(1);
  });

  it('a bad one never ends what is on screen (a game): "הקישור לא תקין" only', () => {
    expect(redirectSystemPath({ path: 'https://evil.example/r/123456', initial: false })).toBeNull();
    expect(toasts()).toEqual(['הקישור לא תקין']);
    expect(usePendingInvite.getState().arrival).toBeNull();
  });
});

describe('anything else', () => {
  it('as it is: the routes of expo-router, and +not-found for the unknown', () => {
    for (const path of [
      'sudokufight:///',
      '/leaderboard',
      'sudokufight://results/abc',
      'exp+sudoku-fight://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081',
      'https://sudoku-fight-staging.fly.dev/privacy',
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(path);
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
    expect(pendingInviteCode()).toBeNull();
    expect(toasts()).toEqual([]);
  });
});
