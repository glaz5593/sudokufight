import { FRIENDS_APP_SCHEME, FRIENDS_PATHS, roomAppLink, roomLink } from '@sudoku-fight/protocol';

import { LINKS_UI, linkHost, ROOM_PATHS, ROOM_ROUTE, roomLinkOf, roomPath } from '../links';
import { serverEndpoint } from '../server';

/** Room links on the phone (1.0.4, friends-room.md §6, D87, D88). */

const STAGING = 'sudoku-fight-staging.fly.dev';

describe('LINKS_UI (each a setting, read where it is named)', () => {
  it('a pending invite waits 60 minutes; the current room, as long as the server holds an away seat (6 h)', () => {
    expect(LINKS_UI.pendingInviteTtlMs).toBe(60 * 60 * 1000);
    expect(LINKS_UI.currentRoomTtlMs).toBe(6 * 60 * 60 * 1000);
  });
});

describe('the room route', () => {
  it('/room/<code>, and ?resume=1 for the way back after the app was closed', () => {
    expect(roomPath('123456')).toBe('/room/123456');
    expect(roomPath('000001', { resume: true })).toBe('/room/000001?resume=1');
    expect(ROOM_ROUTE).toBe('/room/[code]');
  });

  it('only for a code (a bug, not an input)', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '123 456', ''])
      expect(() => roomPath(bad)).toThrow(RangeError);
  });

  it('the friends room screens, as the gate names paths', () => {
    expect(ROOM_PATHS).toEqual(['room/[code]', 'friends/room']);
  });
});

describe('roomLinkOf: what a URL the app was opened with says', () => {
  it("a link to this app's server, https or http, any port: the room's code", () => {
    expect(roomLinkOf(roomLink(STAGING, '123456'), STAGING)).toEqual({ kind: 'room', code: '123456' });
    expect(roomLinkOf(`https://${STAGING}/r/654321?utm=wa#x`, STAGING)).toEqual({
      kind: 'room',
      code: '654321',
    });
    expect(roomLinkOf('http://192.168.1.20:2567/r/000000', '192.168.1.20')).toEqual({
      kind: 'room',
      code: '000000',
    });
    // The host's case does not matter.
    expect(roomLinkOf(`HTTPS://SUDOKU-FIGHT-STAGING.FLY.DEV/r/123456`, STAGING)).toEqual({
      kind: 'room',
      code: '123456',
    });
  });

  it("the app's own scheme, and a bare path: the code, whatever the server", () => {
    expect(roomLinkOf(roomAppLink('123456'), STAGING)).toEqual({ kind: 'room', code: '123456' });
    expect(roomLinkOf(`${FRIENDS_APP_SCHEME}:///room/123456`, STAGING)).toEqual({
      kind: 'room',
      code: '123456',
    });
    expect(roomLinkOf('/r/123456', STAGING)).toEqual({ kind: 'room', code: '123456' });
    expect(roomLinkOf('/room/123456', STAGING)).toEqual({ kind: 'room', code: '123456' });
  });

  it("another server's room link, or a code that is not 6 digits: a bad room link (Home)", () => {
    for (const url of [
      'https://sudoku-fight-prod.fly.dev/r/123456',
      'https://evil.example/r/123456',
      `https://${STAGING}/r/12345`,
      `https://${STAGING}/r/1234567`,
      `https://${STAGING}/r/abcdef`,
      `https://${STAGING}/r/`,
      `https://${STAGING}/r`,
      `${FRIENDS_APP_SCHEME}://room/12345`,
      `${FRIENDS_APP_SCHEME}://room`,
      '/r/12a456',
      '/room/',
    ])
      expect([url, roomLinkOf(url, STAGING)]).toEqual([url, { kind: 'badRoom' }]);
  });

  it('anything else stays as it is (the dev client, the app opened from its icon, other routes)', () => {
    for (const url of [
      'sudokufight:///',
      'sudokufight://',
      '/',
      '/leaderboard',
      'sudokufight://results/abc',
      `https://${STAGING}/privacy`,
      `https://${STAGING}/rooms/123456`,
      'exp+sudoku-fight://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081',
      '/roomy/123456',
    ])
      expect([url, roomLinkOf(url, STAGING)]).toEqual([url, { kind: 'other' }]);
  });

  it("the links' host is this app's server (EXPO_PUBLIC_SERVER_HOST), by default", () => {
    expect(linkHost()).toBe(serverEndpoint.hostname);
    expect(linkHost({ hostname: STAGING, port: 443, secure: true })).toBe(STAGING);
    expect(roomLinkOf(roomLink(serverEndpoint.hostname, '123456'))).toEqual({ kind: 'room', code: '123456' });
  });

  it("the server's link route is the one these links have", () => {
    expect(FRIENDS_PATHS.link).toBe('/r/:code');
  });
});
