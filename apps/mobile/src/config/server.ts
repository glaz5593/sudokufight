/**
 * Where the game server is (stage 0: the echo room). Set EXPO_PUBLIC_SERVER_HOST in apps/mobile/.env.local:
 * - emulator: keep localhost and run `adb reverse tcp:2567 tcp:2567`
 * - phone on the same Wi-Fi: the computer's LAN IP, e.g. 192.168.1.20
 * Passed to Colyseus as { hostname, port, secure }, because React Native's own URL does not parse ws:// hosts.
 */
export interface ServerEndpoint {
  hostname: string;
  port: number;
  secure: boolean;
}

export const serverEndpoint: ServerEndpoint = {
  hostname: process.env.EXPO_PUBLIC_SERVER_HOST ?? 'localhost',
  port: Number(process.env.EXPO_PUBLIC_SERVER_PORT ?? 2567),
  secure: process.env.EXPO_PUBLIC_SERVER_SECURE === 'true',
};

/**
 * The game server's HTTP address: the same host and port as its WebSocket (Colyseus and the Express routes,
 * such as `POST /v1/events`, share one port), `https` when the socket is `wss`. No trailing slash.
 */
export function httpBaseUrl({ hostname, port, secure }: ServerEndpoint = serverEndpoint): string {
  // An IPv6 literal needs brackets in a URL.
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  return `${secure ? 'https' : 'http'}://${host}:${port}`;
}
