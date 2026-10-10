import { track } from '../analytics';
import { telemetry } from '../telemetry';

/**
 * track(): the one entry point for spec §22's events. It queues each into telemetry (spec §27.1), logs it in
 * development, and never throws, whatever happens underneath.
 */

const mockClient = { track: jest.fn() };
jest.mock('../telemetry', () => ({ telemetry: jest.fn(() => mockClient) }));

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

  it('logs it in development', () => {
    track('screen_view', { screen: '/settings' });
    expect(log).toHaveBeenCalledWith('[analytics] screen_view', { screen: '/settings' });
  });

  it('never throws, even when telemetry does', () => {
    mockClient.track.mockImplementationOnce(() => {
      throw new Error('queue broken');
    });
    expect(() => track('app_open')).not.toThrow();
    jest.mocked(telemetry).mockImplementationOnce(() => {
      throw new Error('no client');
    });
    expect(() => track('app_open')).not.toThrow();
  });

  it('takes only the protocol event names (checked by the compiler)', () => {
    // @ts-expect-error not an event of spec §22 / §27.1
    const typo = () => track('screen_viewed');
    expect(typo).not.toThrow();
  });
});
