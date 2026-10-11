import { track } from '../analytics';
import { firebaseAnalytics } from '../firebaseAnalytics';
import { telemetry } from '../telemetry';

/**
 * track(): the one entry point for spec §22's events. It queues each into telemetry (spec §27.1), hands it to
 * Firebase Analytics (stage 14), logs it in development, and never throws, whatever happens underneath; one
 * side failing never keeps the event from the other.
 */

const mockClient = { track: jest.fn() };
jest.mock('../telemetry', () => ({ telemetry: jest.fn(() => mockClient) }));
const mockSink = { enabled: true, log: jest.fn() };
jest.mock('../firebaseAnalytics', () => ({ firebaseAnalytics: jest.fn(() => mockSink) }));

let log: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => log.mockRestore());

describe('track', () => {
  it('queues the event in telemetry, props or not', () => {
    track('game_start', { mode: 'solo', type: 'fast', players: 1 });
    track('app_open');
    expect(mockClient.track.mock.calls).toEqual([
      ['game_start', { mode: 'solo', type: 'fast', players: 1 }],
      ['app_open', {}],
    ]);
  });

  it('hands the same event to Firebase Analytics (stage 14)', () => {
    track('game_end', { mode: 'solo', result: 'finished', score: 12.5, mistakes: 0, durationSec: 61 });
    track('screen_view', { screen: '/settings' });
    expect(mockSink.log.mock.calls).toEqual([
      ['game_end', { mode: 'solo', result: 'finished', score: 12.5, mistakes: 0, durationSec: 61 }],
      ['screen_view', { screen: '/settings' }],
    ]);
  });

  it('logs it in development', () => {
    track('screen_view', { screen: '/settings' });
    expect(log).toHaveBeenCalledWith('[analytics] screen_view', { screen: '/settings' });
  });

  it('never throws, even when telemetry does; Firebase still gets the event', () => {
    mockClient.track.mockImplementationOnce(() => {
      throw new Error('queue broken');
    });
    expect(() => track('app_open')).not.toThrow();
    expect(mockSink.log).toHaveBeenCalledWith('app_open', {});
    jest.mocked(telemetry).mockImplementationOnce(() => {
      throw new Error('no client');
    });
    expect(() => track('app_open')).not.toThrow();
  });

  it('never throws when Firebase does; our server still gets the event', () => {
    mockSink.log.mockImplementationOnce(() => {
      throw new Error('native module gone');
    });
    expect(() => track('replay_open', { mode: 'ranked' })).not.toThrow();
    expect(mockClient.track).toHaveBeenCalledWith('replay_open', { mode: 'ranked' });
    jest.mocked(firebaseAnalytics).mockImplementationOnce(() => {
      throw new Error('no sink');
    });
    expect(() => track('app_open')).not.toThrow();
  });

  it('takes only the protocol event names (checked by the compiler)', () => {
    // @ts-expect-error not an event of spec §22 / §27.1
    const typo = () => track('screen_viewed');
    expect(typo).not.toThrow();
  });
});
