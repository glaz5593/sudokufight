import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

import {
  bannerLines,
  type BannerInfo,
  DEFAULT_PORT as LAN_PORT,
  DEV_ADMIN_PASSWORD as LAN_ADMIN_PASSWORD,
  firewallCommand,
  type Interfaces,
  lanCandidates,
  parseDevLanArgs,
  pickLanAddress,
  serverEnv,
  updateEnvText,
} from '../../../scripts/lib/lan.mjs';
import { DEFAULT_PORT, DEV_ADMIN_PASSWORD } from '../src/config';

/**
 * `npm run dev:lan` (scripts/dev-lan.mjs, for the device checks): its pure parts, scripts/lib/lan.mjs. Which
 * of the PC's addresses the phones get (os.networkInterfaces()-shaped data, as Windows, Linux and macOS report
 * it), the command line, apps/mobile/.env.local, and what it prints. Then the script itself, in the modes that
 * start nothing and write nothing (--help, a bad option, --no-server).
 */

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'dev-lan.mjs');

const v4 = (address: string, mac = '3c:22:fb:12:34:56') => ({
  address,
  family: 'IPv4',
  internal: false,
  mac,
});
const v6 = (address: string) => ({ address, family: 'IPv6', internal: false, mac: '3c:22:fb:12:34:56' });
const LOOPBACK = { address: '127.0.0.1', family: 'IPv4', internal: true, mac: '00:00:00:00:00:00' };

/** A Windows laptop on Wi-Fi with WSL, Hyper-V's switch, VirtualBox, a VPN's TAP adapter and Bluetooth. */
const WINDOWS: Interfaces = {
  'vEthernet (WSL (Hyper-V firewall))': [v4('172.28.144.1', '00:15:5d:01:02:03')],
  'vEthernet (Default Switch)': [v4('172.17.80.1', '00:15:5d:0a:0b:0c')],
  'Ethernet 2': [v4('192.168.56.1', '0a:00:27:00:00:05')],
  'Ethernet 3': [v4('10.8.0.6', '00:ff:6a:7b:8c:9d')],
  'Bluetooth Network Connection': [v4('169.254.10.20')],
  'Wi-Fi': [v6('fe80::1c2d:3e4f:5a6b:7c8d'), v4('192.168.1.20')],
  'Loopback Pseudo-Interface 1': [LOOPBACK],
};

describe('npm run dev:lan: the address the phones use', () => {
  it('Windows: the Wi-Fi adapter, past WSL, Hyper-V, VirtualBox, a VPN and Bluetooth', () => {
    expect(pickLanAddress(WINDOWS)).toEqual({
      name: 'Wi-Fi',
      address: '192.168.1.20',
      kind: 'wifi',
      virtual: false,
    });
    // The rest are still listed (the banner offers them for --ip), virtual ones last; link-local, IPv6 and
    // loopback addresses are not.
    expect(lanCandidates(WINDOWS).map((c) => [c.address, c.virtual])).toEqual([
      ['192.168.1.20', false],
      ['192.168.56.1', true],
      ['10.8.0.6', true],
      ['172.28.144.1', true],
      ['172.17.80.1', true],
    ]);
  });

  it('Wi-Fi before Ethernet, and Ethernet before an adapter of another kind', () => {
    const both: Interfaces = { Ethernet: [v4('192.168.1.30')], 'Wi-Fi': [v4('192.168.1.20')] };
    expect(pickLanAddress(both)?.address).toBe('192.168.1.20');
    const wired: Interfaces = { 'USB tether': [v4('192.168.42.10')], Ethernet: [v4('10.0.0.5')] };
    expect(pickLanAddress(wired)).toMatchObject({ name: 'Ethernet', kind: 'ethernet' });
    // A Hebrew or unknown adapter name is still a candidate.
    expect(pickLanAddress({ 'חיבור רשת': [v4('192.168.1.40')] })).toMatchObject({ kind: 'other' });
  });

  it('of two real adapters of one kind: 192.168.x, then 10.x, then 172.16–31.x, then the rest', () => {
    const lans: Interfaces = {
      'Ethernet 4': [v4('100.80.1.2')],
      'Ethernet 3': [v4('172.20.10.3')],
      'Ethernet 2': [v4('10.0.0.7')],
      Ethernet: [v4('192.168.0.12')],
    };
    expect(lanCandidates(lans).map((c) => c.address)).toEqual([
      '192.168.0.12',
      '10.0.0.7',
      '172.20.10.3',
      '100.80.1.2',
    ]);
    // Same kind and range: the order the system lists them in.
    expect(
      pickLanAddress({ 'Ethernet 2': [v4('192.168.1.9')], Ethernet: [v4('192.168.1.8')] })?.address,
    ).toBe('192.168.1.9');
  });

  it('Linux and macOS: wlan0 / en0, never docker0, a bridge, veth, tailscale or utun', () => {
    const linux: Interfaces = {
      lo: [LOOPBACK],
      docker0: [v4('172.17.0.1', '02:42:ac:11:00:01')],
      'br-5f2a': [v4('172.18.0.1')],
      veth1a2b: [v4('172.18.0.2')],
      tailscale0: [v4('100.101.102.103')],
      eth0: [v4('10.0.2.15')],
      wlan0: [v4('192.168.1.50')],
    };
    expect(pickLanAddress(linux)?.address).toBe('192.168.1.50');
    const mac: Interfaces = {
      lo0: [LOOPBACK],
      utun3: [v4('10.20.30.40')],
      bridge100: [v4('192.168.64.1')],
      en0: [v4('192.168.1.60')],
    };
    expect(pickLanAddress(mac)).toMatchObject({ name: 'en0', address: '192.168.1.60' });
  });

  it('Node 18.0–18.3 reported the family as a number', () => {
    expect(
      pickLanAddress({ 'Wi-Fi': [{ address: '192.168.1.20', family: 4, internal: false }] })?.address,
    ).toBe('192.168.1.20');
  });

  it('none: only virtual adapters, only link-local or IPv6, or no network at all', () => {
    const vmsOnly: Interfaces = { 'vEthernet (WSL)': [v4('172.28.144.1', '00:15:5d:01:02:03')] };
    expect(pickLanAddress(vmsOnly)).toBeNull();
    expect(lanCandidates(vmsOnly)).toHaveLength(1);
    expect(pickLanAddress({ 'Wi-Fi': [v4('169.254.3.4'), v6('fe80::1')] })).toBeNull();
    expect(pickLanAddress({ 'Loopback Pseudo-Interface 1': [LOOPBACK], Ethernet: undefined })).toBeNull();
    expect(pickLanAddress({})).toBeNull();
  });
});

describe('npm run dev:lan: the command line', () => {
  const defaults = { ip: null, port: null, seed: false, writeEnv: false, server: true };

  it('defaults, and each option', () => {
    expect(parseDevLanArgs([])).toEqual({ kind: 'options', options: defaults });
    expect(parseDevLanArgs(['--ip', '192.168.1.20', '--port=3000', '--seed', '--write-env'])).toEqual({
      kind: 'options',
      options: { ip: '192.168.1.20', port: 3000, seed: true, writeEnv: true, server: true },
    });
    expect(parseDevLanArgs(['--ip=10.0.0.5', '--no-server'])).toEqual({
      kind: 'options',
      options: { ...defaults, ip: '10.0.0.5', server: false },
    });
    expect(parseDevLanArgs(['--write-env', '--help'])).toEqual({ kind: 'help' });
    expect(parseDevLanArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it.each([
    [['--ip'], /--ip needs an IPv4/],
    [['--ip', 'my-pc.local'], /--ip needs an IPv4/],
    [['--ip', '192.168.1.256'], /--ip needs an IPv4/],
    [['--ip', '192.168.01.2'], /--ip needs an IPv4/],
    [['--ip', '--seed'], /--ip needs an IPv4/],
    [['--port', '0'], /--port needs a number/],
    [['--port=70000'], /--port needs a number/],
    [['--port', '25x'], /--port needs a number/],
    [['--seed=1'], /--seed takes no value/],
    [['--wifi'], /unknown option --wifi/],
    [['192.168.1.20'], /unknown option 192\.168\.1\.20/],
    // Seeding needs the PGlite folder, which a running server holds.
    [['--no-server', '--seed'], /--seed needs the server stopped/],
  ])('%j is refused', (argv, error) => {
    const parsed = parseDevLanArgs(argv);
    expect(parsed.kind).toBe('error');
    expect(parsed.kind === 'error' && parsed.error).toMatch(error);
  });
});

describe('npm run dev:lan --write-env: apps/mobile/.env.local', () => {
  const values = serverEnv('192.168.1.20', 2567);

  it('the three lines: the PC, the port, no TLS', () => {
    expect(values).toEqual({
      EXPO_PUBLIC_SERVER_HOST: '192.168.1.20',
      EXPO_PUBLIC_SERVER_PORT: '2567',
      EXPO_PUBLIC_SERVER_SECURE: 'false',
    });
  });

  it('a new file starts from the real .env.example, with its comments and other settings', () => {
    const template = readFileSync(path.join(__dirname, '..', '..', 'mobile', '.env.example'), 'utf8');
    const { text, changed } = updateEnvText(null, values, template);
    expect(changed).toBe(true);
    expect(text).toContain('EXPO_PUBLIC_SERVER_HOST=192.168.1.20\n');
    expect(text).toContain('EXPO_PUBLIC_SERVER_PORT=2567\n');
    expect(text).toContain('EXPO_PUBLIC_SERVER_SECURE=false\n');
    expect(text).not.toContain('=localhost');
    // Everything else as in the template, line for line.
    const others = (s: string) =>
      s.split('\n').filter((l) => !/^EXPO_PUBLIC_SERVER_(HOST|PORT|SECURE)=/.test(l));
    expect(others(text)).toEqual(others(template));
  });

  it('an existing file: the lines replaced in place, the rest untouched (CRLF too); missing ones added', () => {
    const current = [
      '# mine',
      'EXPO_PUBLIC_SERVER_HOST=10.0.0.9',
      '# EXPO_PUBLIC_SERVER_PORT=1234',
      'EXPO_PUBLIC_LEGAL_BASE_URL=https://example.com/legal',
      '',
    ].join('\r\n');
    const { text, changed } = updateEnvText(current, values, 'ignored when the file exists');
    expect(changed).toBe(true);
    expect(text).toBe(
      [
        '# mine',
        'EXPO_PUBLIC_SERVER_HOST=192.168.1.20',
        '# EXPO_PUBLIC_SERVER_PORT=1234',
        'EXPO_PUBLIC_LEGAL_BASE_URL=https://example.com/legal',
        'EXPO_PUBLIC_SERVER_PORT=2567',
        'EXPO_PUBLIC_SERVER_SECURE=false',
        '',
      ].join('\r\n'),
    );
    // Run again: nothing to change.
    expect(updateEnvText(text, values, null)).toEqual({ text, changed: false });
  });

  it('a file without a final newline, or none and no template', () => {
    expect(updateEnvText('A=1', { B: '2' }, null).text).toBe('A=1\nB=2\n');
    expect(updateEnvText(null, values, null).text).toBe(
      'EXPO_PUBLIC_SERVER_HOST=192.168.1.20\nEXPO_PUBLIC_SERVER_PORT=2567\nEXPO_PUBLIC_SERVER_SECURE=false\n',
    );
    // A value with $ or regex characters goes in as written.
    expect(updateEnvText('X=old\n', { X: 'a$&b' }, null).text).toBe('X=a$&b\n');
  });
});

describe('npm run dev:lan: what it prints', () => {
  const info: BannerInfo = {
    host: '192.168.1.20',
    port: 2567,
    adapter: 'Wi-Fi',
    others: [{ name: 'vEthernet (WSL)', address: '172.28.144.1' }],
    admin: { kind: 'dev' },
    adminBuilt: true,
    envFile: null,
    lanCheck: 'ok',
    platform: 'win32',
    serverStarted: true,
  };
  const HEBREW = /[֐-׿]/;

  it('the same port and admin password as the server', () => {
    expect(LAN_PORT).toBe(DEFAULT_PORT);
    expect(LAN_ADMIN_PASSWORD).toBe(DEV_ADMIN_PASSWORD);
  });

  it('the URLs, the .env.local lines, the admin site, the firewall rule and the fake opponents', () => {
    const lines = bannerLines(info);
    for (const expected of [
      '  http://192.168.1.20:2567',
      '  http://192.168.1.20:2567/health',
      '  172.28.144.1   (vEthernet (WSL))',
      '    EXPO_PUBLIC_SERVER_HOST=192.168.1.20',
      '    EXPO_PUBLIC_SERVER_PORT=2567',
      '    EXPO_PUBLIC_SERVER_SECURE=false',
      '  npm run mobile -- --clear',
      '  http://192.168.1.20:2567/admin',
      `    ${DEV_ADMIN_PASSWORD}`,
      `       ${firewallCommand(2567, 'dev server')}`,
      '       Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private',
      '    npm run fake-client -- --queue fast-2p --name Ana --speed 20',
      '    npm run fake-client -- --create --name Fake1',
    ])
      expect(lines).toContain(expected);
    expect(lines.some((l) => l.includes('Ctrl+C'))).toBe(true);
    // On the default port fake-client finds the server without --url.
    expect(lines.some((l) => l.includes('--url'))).toBe(false);
    // Printed for Moshe to run as administrator: an inbound TCP rule on the port, private networks only.
    expect(firewallCommand(2567, 'dev server')).toBe(
      'New-NetFirewallRule -DisplayName "Sudoku Fight dev server (TCP 2567)" -Direction Inbound -Action Allow ' +
        '-Protocol TCP -LocalPort 2567 -Profile Private',
    );
  });

  it('every URL, command and value on a line without Hebrew (a terminal without bidi keeps it readable)', () => {
    const lines = bannerLines(info);
    const literal =
      /https?:\/\/|npm run|EXPO_PUBLIC_|New-NetFirewallRule|Get-Net|Set-Net|\$env:|sudoku-admin-dev/;
    const mixed = lines.filter((l) => literal.test(l) && HEBREW.test(l));
    expect(mixed).toEqual([]);
  });

  it('as things are: --write-env done, the admin site unbuilt or off, the LAN check failed, not Windows', () => {
    const written = bannerLines({ ...info, envFile: { changed: true } }).join('\n');
    expect(written).toContain('עודכן');
    expect(bannerLines({ ...info, envFile: { changed: false } }).join('\n')).toContain('כבר מעודכן');
    expect(bannerLines({ ...info, adminBuilt: false })).toContain('    npm run admin:build');
    const off = bannerLines({ ...info, admin: { kind: 'off' } }).join('\n');
    expect(off).not.toContain(DEV_ADMIN_PASSWORD);
    expect(bannerLines({ ...info, admin: { kind: 'env' } }).join('\n')).toContain('ADMIN_PASSWORD');
    expect(bannerLines({ ...info, lanCheck: 'failed' }).join('\n')).toContain('השרת לא ענה בכתובת הזאת');
    expect(bannerLines(info).join('\n')).not.toContain('השרת לא ענה');
    const linux = bannerLines({ ...info, platform: 'linux', serverStarted: false }).join('\n');
    expect(linux).not.toContain('New-NetFirewallRule');
    expect(linux).not.toContain('Ctrl+C');
  });
});

describe('scripts/dev-lan.mjs itself', () => {
  /** Node only, as `node scripts/dev-lan.mjs` (not under npm: no npm_execpath). New processes: slow under load. */
  function run(...args: string[]) {
    const env = { ...process.env };
    delete env.npm_execpath;
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 30_000 });
    return { code: result.status, out: result.stdout, err: result.stderr };
  }

  /** A port nothing listens on. */
  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
    const { port } = probe.address() as { port: number };
    await new Promise((done) => probe.close(done));
    return port;
  }

  it('--help prints the options; a bad one is refused with exit code 2', () => {
    const help = run('--help');
    expect(help.code).toBe(0);
    expect(help.out).toContain('--write-env');
    const bad = run('--wifi');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown option --wifi');
  }, 60_000);

  it('--no-server: no server on the port, so it says so and prints the details for the address given', async () => {
    const port = await freePort();
    const { code, out } = run('--no-server', '--ip', '192.168.1.20', '--port', String(port));
    expect(code).toBe(0);
    expect(out).toContain('--no-server');
    expect(out).toContain(`  http://192.168.1.20:${port}/health`);
    expect(out).toContain(`    EXPO_PUBLIC_SERVER_PORT=${port}`);
    // Not the default port: the fake players are told where the server is.
    expect(out).toContain(`npm run fake-client -- --create --name Fake1 --url ws://localhost:${port}`);
    // Nothing started, so nothing to stop.
    expect(out).not.toContain('Ctrl+C');
  }, 60_000);
});
