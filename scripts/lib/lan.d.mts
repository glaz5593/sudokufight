// Types of lan.mjs, for the tests that import it (apps/server/test/devLan.test.ts).

export declare const DEFAULT_PORT: number;
export declare const METRO_PORT: number;
export declare const DEV_ADMIN_PASSWORD: string;

/** One entry of os.networkInterfaces(), as far as lan.mjs reads it. */
export interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
  mac?: string;
}

export type Interfaces = Record<string, readonly InterfaceAddress[] | undefined>;

export interface LanCandidate {
  /** The adapter, as Windows names the connection ("Wi-Fi", "Ethernet 2", "vEthernet (WSL)"). */
  name: string;
  address: string;
  kind: 'wifi' | 'ethernet' | 'other';
  /** A VM's, WSL's, a VPN's or Bluetooth's adapter: not where the phones are. */
  virtual: boolean;
}

export declare function isIPv4(address: string): boolean;
export declare function lanCandidates(interfaces: Interfaces): LanCandidate[];
export declare function pickLanAddress(interfaces: Interfaces): LanCandidate | null;

export interface DevLanOptions {
  ip: string | null;
  port: number | null;
  seed: boolean;
  writeEnv: boolean;
  server: boolean;
}

export declare const USAGE: string;
export declare function parseDevLanArgs(
  argv: readonly string[],
): { kind: 'help' } | { kind: 'error'; error: string } | { kind: 'options'; options: DevLanOptions };

export declare function serverEnv(
  host: string,
  port: number,
): {
  EXPO_PUBLIC_SERVER_HOST: string;
  EXPO_PUBLIC_SERVER_PORT: string;
  EXPO_PUBLIC_SERVER_SECURE: 'false';
};

export declare function updateEnvText(
  current: string | null,
  values: Record<string, string>,
  template: string | null,
): { text: string; changed: boolean };

export declare function firewallCommand(port: number, what: string): string;

export interface BannerInfo {
  host: string;
  port: number;
  adapter: string | null;
  others: readonly { name: string; address: string }[];
  admin: { kind: 'dev' } | { kind: 'env' } | { kind: 'off' };
  adminBuilt: boolean;
  /** Written with --write-env (changed: it said something else before), or null. */
  envFile: { changed: boolean } | null;
  lanCheck: 'ok' | 'failed' | 'skipped';
  platform: string;
  /** dev:lan started the server (Ctrl+C stops it), rather than finding one running. */
  serverStarted: boolean;
}

export declare function bannerLines(info: BannerInfo): string[];
