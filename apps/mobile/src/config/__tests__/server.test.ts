import { httpBaseUrl, serverEndpoint } from '../server';

/** The game server's HTTP address (for `POST /v1/events`): the WebSocket's host and port, http(s). */
describe('httpBaseUrl', () => {
  it('http for ws, https for wss, on the same host and port', () => {
    expect(httpBaseUrl({ hostname: 'localhost', port: 2567, secure: false })).toBe('http://localhost:2567');
    expect(httpBaseUrl({ hostname: '192.168.1.20', port: 2567, secure: false })).toBe(
      'http://192.168.1.20:2567',
    );
    expect(httpBaseUrl({ hostname: 'play.example.com', port: 443, secure: true })).toBe(
      'https://play.example.com:443',
    );
  });

  it('an IPv6 address goes in brackets', () => {
    expect(httpBaseUrl({ hostname: '::1', port: 2567, secure: false })).toBe('http://[::1]:2567');
    expect(httpBaseUrl({ hostname: '[::1]', port: 2567, secure: false })).toBe('http://[::1]:2567');
  });

  it('defaults to the configured server (EXPO_PUBLIC_SERVER_*)', () => {
    const { hostname, port, secure } = serverEndpoint;
    expect(httpBaseUrl()).toBe(`${secure ? 'https' : 'http'}://${hostname}:${port}`);
  });
});
