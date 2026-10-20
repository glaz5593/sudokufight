import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import {
  ABI,
  ABORT_FREE,
  apkFileName,
  apkProblems,
  apksToPrune,
  appJsonFiles,
  BUNDLE_TASK,
  EXIT,
  failureSummary,
  formatBytes,
  formatDuration,
  gradleArgs,
  gradleTask,
  hasApkSigningBlock,
  inspectApk,
  installedVersions,
  installFailure,
  isFileLock,
  isLockedError,
  isOutOfMemory,
  javaMajorVersion,
  KEEP_APKS,
  MIN_FREE_FULL,
  MIN_FREE_INCREMENTAL,
  nativeConfigHash,
  newestApk,
  PACKAGE,
  packageDeps,
  parseAdbDevices,
  parseApkArgs,
  PREBUILD_PACKAGES,
  prebuildPlan,
  readZipEntry,
  releaseSigningConfig,
  REPLACEABLE,
  resolveServer,
  serverEnv,
  serverNativeInput,
  staleConfigDirs,
  uninstallCommand,
  USAGE,
  zipEntries,
} from '../../scripts/lib/build-apk.mjs';
import type { Interfaces } from '../../../../scripts/lib/lan.mjs';

/**
 * `npm run apk` (scripts/build-apk.mjs, docs/BUILD-APK.md): a release APK for the test phones, built on this PC.
 * Its pure parts (scripts/lib/build-apk.mjs) on made-up data: the command line, the server from eas.json, the
 * APK's name and which old ones go, when prebuild starts clean, the release signing in build.gradle, what adb,
 * Java and Gradle print, and the APK itself (a zip). Then the script, in the modes that build nothing.
 * The real build (Gradle, 15 to 40 minutes) is not run here.
 */

const MOBILE = join(__dirname, '..', '..');
const SCRIPT = join(MOBILE, 'scripts', 'build-apk.mjs');
const EAS = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8')) as unknown;
const APP = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as {
  expo: { version: string; android: { package: string } };
};

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const v4 = (address: string, mac = '3c:22:fb:12:34:56') => ({
  address,
  family: 'IPv4',
  internal: false,
  mac,
});
/** A Windows PC on Wi-Fi, with WSL's virtual adapter listed first. */
const PC: Interfaces = {
  'vEthernet (WSL)': [v4('172.20.16.1', '00:15:5d:01:02:03')],
  'Wi-Fi': [v4('192.168.1.23')],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};

const server = (choice: string, eas: unknown = EAS, interfaces: Interfaces = PC) => {
  const result = resolveServer(choice, eas, interfaces);
  if (result.kind !== 'server') throw new Error(result.error);
  return result.server;
};

describe('the command line', () => {
  const options = (...argv: string[]) => {
    const parsed = parseApkArgs(argv);
    if (parsed.kind !== 'options') throw new Error(JSON.stringify(parsed));
    return parsed.options;
  };

  it('builds for staging and installs nothing by default', () => {
    expect(options()).toEqual({
      server: 'staging',
      install: false,
      installOnly: false,
      replace: false,
      clean: false,
      cleanOnly: false,
      cleanNative: false,
      verbose: false,
      dryRun: false,
    });
  });

  it('takes the server both ways, and each switch', () => {
    expect(options('--server', 'local').server).toBe('local');
    expect(options('--server=production').server).toBe('production');
    expect(options('--install', '--replace', '--clean', '--clean-native', '--verbose')).toMatchObject({
      install: true,
      replace: true,
      clean: true,
      cleanNative: true,
      verbose: true,
    });
    expect(options('--install-only', '--replace')).toMatchObject({ installOnly: true, replace: true });
    expect(options('--clean-only').cleanOnly).toBe(true);
    expect(options('--dry-run').dryRun).toBe(true);
  });

  it('refuses what it does not know, and --replace without an install', () => {
    const error = (...argv: string[]) => {
      const parsed = parseApkArgs(argv);
      return parsed.kind === 'error' ? parsed.error : null;
    };
    expect(error('--server')).toMatch(/--server needs a value/);
    expect(error('--server', '--install')).toMatch(/--server needs a value/);
    expect(error('--srever', 'local')).toBe('unknown option --srever');
    expect(error('local')).toBe('unexpected local');
    expect(error('--install=yes')).toBe('--install takes no value');
    expect(error('--replace')).toMatch(/--replace works with --install/);
    expect(error('--install-only', '--clean-only')).toMatch(/pick one/);
    // Both build nothing, so a "dry run" of them would still install (uninstall, with --replace) or delete.
    expect(error('--install-only', '--replace', '--dry-run')).toMatch(/--install-only would still run/);
    expect(error('--dry-run', '--clean-only')).toMatch(/--clean-only would still run/);
    expect(options('--dry-run', '--install', '--clean').dryRun).toBe(true);
    expect(parseApkArgs(['--install', '--help'])).toEqual({ kind: 'help' });
    expect(parseApkArgs(['-h'])).toEqual({ kind: 'help' });
  });
});

describe('which server the APK talks to', () => {
  it("staging (the default) and production come from eas.json's profiles, so they never drift", () => {
    const build = (EAS as { build: Record<string, { env: Record<string, string> }> }).build;
    for (const [choice, profile, label] of [
      ['staging', 'preview', 'staging'],
      ['preview', 'preview', 'staging'],
      ['production', 'production', 'production'],
    ] as const) {
      const env = build[profile]!.env;
      expect(server(choice)).toEqual({
        label,
        host: env.EXPO_PUBLIC_SERVER_HOST,
        port: Number(env.EXPO_PUBLIC_SERVER_PORT),
        secure: env.EXPO_PUBLIC_SERVER_SECURE === 'true',
        source: `eas.json ${profile}`,
      });
    }
    // Today's values (docs/BUILD-APK.md names them).
    expect(server('staging')).toMatchObject({
      host: 'sudoku-fight-staging.fly.dev',
      port: 443,
      secure: true,
    });
    expect(server('STAGING').label).toBe('staging');
  });

  it('a profile without the server in its env is an error, not a build for localhost', () => {
    const result = resolveServer('production', { build: { production: { env: {} } } }, PC);
    expect(result).toEqual({ kind: 'error', error: expect.stringMatching(/production profile has no/) });
  });

  it("local: this PC's Wi-Fi address (not WSL's), the dev server's port, no TLS", () => {
    expect(server('local')).toEqual({
      label: 'local',
      host: '192.168.1.23',
      port: 2567,
      secure: false,
      source: 'this PC (Wi-Fi)',
    });
    expect(
      resolveServer('local', EAS, { 'vEthernet (WSL)': [v4('172.20.16.1', '00:15:5d:01:02:03')] }),
    ).toEqual({
      kind: 'error',
      error: expect.stringMatching(/no Wi-Fi or Ethernet address/),
    });
  });

  it('any other host: TLS on port 443 (the default), plain on others; a scheme decides', () => {
    expect(server('sudoku-test.fly.dev')).toMatchObject({
      label: 'sudoku-test-fly-dev',
      host: 'sudoku-test.fly.dev',
      port: 443,
      secure: true,
    });
    expect(server('192.168.1.40:2567')).toMatchObject({
      label: '192-168-1-40-2567',
      port: 2567,
      secure: false,
    });
    expect(server('https://Example.org:8443/')).toMatchObject({
      host: 'example.org',
      port: 8443,
      secure: true,
    });
    expect(server('wss://example.org')).toMatchObject({ port: 443, secure: true });
    expect(server('ws://10.0.0.5')).toMatchObject({ port: 2567, secure: false, label: '10-0-0-5-2567' });
    expect(server('http://10.0.0.5:80')).toMatchObject({ port: 80, secure: false });
    // An IP address alone is `npm run server` on a desk, as with --server local (after the PC's address changed).
    expect(server('192.168.1.50')).toEqual({
      label: '192-168-1-50-2567',
      host: '192.168.1.50',
      port: 2567,
      secure: false,
      source: 'command line',
    });
    expect(server('192.168.1.50:443')).toMatchObject({ port: 443, secure: true });
    expect(server('wss://10.0.0.5')).toMatchObject({ port: 443, secure: true });
    for (const bad of ['not a host', 'host:99999', 'ftp://x.org', '-bad-.org', 'a/b/c'])
      expect(resolveServer(bad, EAS, PC).kind).toBe('error');
  });

  it('becomes the three EXPO_PUBLIC_ variables src/config/server.ts reads', () => {
    expect(serverEnv(server('staging'))).toEqual({
      EXPO_PUBLIC_SERVER_HOST: 'sudoku-fight-staging.fly.dev',
      EXPO_PUBLIC_SERVER_PORT: '443',
      EXPO_PUBLIC_SERVER_SECURE: 'true',
    });
    expect(serverEnv(server('local')).EXPO_PUBLIC_SERVER_SECURE).toBe('false');
  });
});

describe('the APK file', () => {
  it('is named by version, commit, uncommitted changes and server', () => {
    expect(apkFileName({ version: '0.1.0', sha: 'a4b6c88', dirty: false, label: 'staging' })).toBe(
      'sudoku-fight-0.1.0-a4b6c88-staging.apk',
    );
    expect(apkFileName({ version: '0.2.0', sha: 'f9c98c1', dirty: true, label: 'local' })).toBe(
      'sudoku-fight-0.2.0-f9c98c1-dirty-local.apk',
    );
  });

  it('keeps the newest 3 of ours, and never touches other files', () => {
    const files = [
      { name: 'sudoku-fight-0.1.0-aaaaaaa-staging.apk', mtimeMs: 1000 },
      { name: 'sudoku-fight-0.1.0-bbbbbbb-staging.apk', mtimeMs: 5000 },
      { name: 'sudoku-fight-0.1.0-ccccccc-local.apk', mtimeMs: 3000 },
      { name: 'sudoku-fight-0.1.0-ddddddd-staging.apk', mtimeMs: 4000 },
      { name: 'sudoku-fight-0.1.0-eeeeeee-dirty-staging.apk', mtimeMs: 2000 },
      { name: 'last-build.log', mtimeMs: 9000 },
      { name: 'someone-elses.apk', mtimeMs: 1 },
    ];
    expect(KEEP_APKS).toBe(3);
    expect(apksToPrune(files)).toEqual([
      'sudoku-fight-0.1.0-eeeeeee-dirty-staging.apk',
      'sudoku-fight-0.1.0-aaaaaaa-staging.apk',
    ]);
    expect(apksToPrune(files.slice(0, 2))).toEqual([]);
    expect(newestApk(files)).toBe('sudoku-fight-0.1.0-bbbbbbb-staging.apk');
    expect(newestApk([{ name: 'last-build.log', mtimeMs: 1 }])).toBeNull();
  });

  it('C++ build folders of earlier configurations go; the newest stays', () => {
    expect(
      staleConfigDirs([
        { name: '3d3e6r4g', mtimeMs: 1000 },
        { name: '5b4j201d', mtimeMs: 3000 },
        { name: 'x1', mtimeMs: 2000 },
      ]),
    ).toEqual(['x1', '3d3e6r4g']);
    expect(staleConfigDirs([{ name: 'only', mtimeMs: 1 }])).toEqual([]);
    expect(staleConfigDirs([])).toEqual([]);
  });

  it("the package and the version are app.json's", () => {
    expect(PACKAGE).toBe(APP.expo.android.package);
    expect(uninstallCommand('R58N12ABCDE')).toBe(`adb -s R58N12ABCDE uninstall ${PACKAGE}`);
    expect(uninstallCommand('adb-R58N12ABCDE-AbCdEf (2)._adb-tls-connect._tcp')).toBe(
      `adb -s "adb-R58N12ABCDE-AbCdEf (2)._adb-tls-connect._tcp" uninstall ${PACKAGE}`,
    );
  });
});

describe('when expo prebuild starts from scratch', () => {
  const INPUTS: [string, string | null][] = [
    ['app.json', '{"expo":{}}'],
    ['package.json dependencies', '{"dependencies":{"expo":"~57.0.20"}}'],
    ['google-services.json', null],
    ['cleartext', 'no'],
  ];

  it('the fingerprint depends on the contents, not on the order', () => {
    const hash = nativeConfigHash(INPUTS);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(nativeConfigHash([...INPUTS].reverse())).toBe(hash);
    const changed = (index: number, content: string | null) =>
      nativeConfigHash(INPUTS.map(([name, old], i) => [name, i === index ? content : old]));
    expect(changed(0, '{"expo":{"name":"x"}}')).not.toBe(hash);
    // The Firebase file appearing changes the plugins; an empty file isn't a missing one.
    expect(changed(2, '{}')).not.toBe(hash);
    expect(changed(2, '')).not.toBe(changed(2, null));
    // --server local allows cleartext in the manifest.
    expect(changed(3, 'yes')).not.toBe(hash);
  });

  it("1.0.4: the game server too, since the room links' intent filter is built from it (app.config.ts)", () => {
    const staging = { host: 'sudoku-fight-staging.fly.dev', port: 443, secure: true };
    const production = { ...staging, host: 'sudoku-fight-prod.fly.dev' };
    const local = { host: '192.168.1.20', port: 2567, secure: false };
    expect(serverNativeInput(staging)).toBe('https://sudoku-fight-staging.fly.dev:443');
    expect(serverNativeInput(local)).toBe('http://192.168.1.20:2567');
    // The host's case changes nothing; another host, port or TLS is another native project.
    expect(serverNativeInput({ ...staging, host: 'SUDOKU-fight-staging.fly.dev' })).toBe(
      serverNativeInput(staging),
    );
    const hashFor = (server: typeof staging) =>
      nativeConfigHash([...INPUTS, ['server', serverNativeInput(server)]]);
    expect(hashFor(production)).not.toBe(hashFor(staging));
    expect(hashFor({ ...staging, port: 8443 })).not.toBe(hashFor(staging));
    expect(hashFor(local)).not.toBe(hashFor({ ...local, host: '192.168.1.21' }));
    expect(hashFor(staging)).toBe(hashFor({ ...staging }));
    // The script hashes it with the rest (an APK for another server prebuilds again).
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(/\['server', serverNativeInput\(server\)\]/);
  });

  it("package.json's scripts don't count, its dependencies do", () => {
    const pkg = (extra: object) =>
      JSON.stringify({ name: 'm', scripts: { start: 'expo start' }, dependencies: { expo: '1' }, ...extra });
    expect(packageDeps(pkg({ scripts: { apk: 'node x' } }))).toBe(packageDeps(pkg({})));
    expect(packageDeps(pkg({ dependencies: { expo: '2' } }))).not.toBe(packageDeps(pkg({})));
  });

  it('so are the installed versions: package-lock.json can move a config plugin under the same range', () => {
    const pkg = JSON.stringify({
      dependencies: { expo: '~57.0.20', 'expo-splash-screen': '~57.0.3', zustand: '^5.0.0' },
      devDependencies: { jest: '^30.0.0' },
    });
    const installed: Record<string, string> = {
      expo: '57.0.20',
      'expo-splash-screen': '57.0.3',
      zustand: '5.0.8',
      '@expo/prebuild-config': '57.0.6',
      '@expo/config-plugins': '57.0.4',
    };
    const versions = (overrides: Record<string, string | null> = {}) =>
      installedVersions(pkg, (name) => (name in overrides ? overrides[name]! : (installed[name] ?? null)));
    expect(versions()).toEqual([
      ['installed @expo/config-plugins', '57.0.4'],
      ['installed @expo/prebuild-config', '57.0.6'],
      ['installed expo', '57.0.20'],
      ['installed expo-splash-screen', '57.0.3'],
      ['installed zustand', '5.0.8'],
    ]);
    expect(PREBUILD_PACKAGES).toContain('@expo/prebuild-config');
    // package.json unchanged, a patch of a config plugin (or of prebuild) installed: prebuild runs again.
    const inputs = (overrides?: Record<string, string | null>) =>
      nativeConfigHash([['package.json dependencies', packageDeps(pkg)], ...versions(overrides)]);
    expect(inputs({ 'expo-splash-screen': '57.0.4' })).not.toBe(inputs());
    expect(inputs({ '@expo/prebuild-config': '57.0.7' })).not.toBe(inputs());
    expect(inputs({ 'expo-splash-screen': null })).not.toBe(inputs());
    expect(inputs({})).toBe(inputs());
  });

  it('the files app.json points at (icons, splash, fonts, local plugins) are fingerprinted too', () => {
    const appJson = JSON.stringify({
      expo: {
        name: 'Sudoku Fight',
        icon: './assets/brand/icon.png',
        android: { adaptiveIcon: { foregroundImage: './assets/brand/fg.png', backgroundColor: '#0f1218' } },
        plugins: [
          'expo-router',
          ['./plugins/a.js', { x: 1 }],
          ['expo-font', { fonts: ['../../node_modules/f/Rubik.ttf'] }],
          ['expo-splash-screen', { image: './assets/brand/icon.png', imageWidth: 176 }],
        ],
      },
    });
    expect(appJsonFiles(appJson)).toEqual([
      '../../node_modules/f/Rubik.ttf',
      './assets/brand/fg.png',
      './assets/brand/icon.png',
      './plugins/a.js',
    ]);
    expect(appJsonFiles(JSON.stringify({ expo: { name: 'x' } }))).toEqual([]);
    // The real app.json: its icons and fonts.
    const real = appJsonFiles(readFileSync(join(MOBILE, 'app.json'), 'utf8'));
    expect(real).toContain('./assets/brand/icon.png');
    expect(real.some((path) => path.endsWith('.ttf'))).toBe(true);
  });

  it('runs only when needed (each prebuild writes android/ anew), and then from scratch', () => {
    const plan = (state: Partial<Parameters<typeof prebuildPlan>[0]>) =>
      prebuildPlan({
        androidExists: true,
        storedHash: 'h1',
        currentHash: 'h1',
        cleanNative: false,
        ...state,
      });
    expect(plan({})).toEqual({ run: false, clean: false, reason: 'native config unchanged' });
    expect(plan({ currentHash: 'h2' })).toEqual({ run: true, clean: true, reason: 'native config changed' });
    expect(plan({ storedHash: null })).toMatchObject({ run: true, clean: true });
    expect(plan({ cleanNative: true })).toEqual({ run: true, clean: true, reason: 'asked (--clean-native)' });
    // No folder yet: a plain prebuild creates it.
    expect(plan({ androidExists: false, storedHash: null, cleanNative: true })).toEqual({
      run: true,
      clean: false,
      reason: 'first prebuild',
    });
  });
});

describe("the release build's signing (android/app/build.gradle)", () => {
  // As Expo 57's template writes it (comments included).
  const TEMPLATE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}`;

  it("Expo's template signs release builds with the debug keystore", () => {
    expect(releaseSigningConfig(TEMPLATE)).toBe('debug');
    expect(
      releaseSigningConfig(
        TEMPLATE.replace(
          /signingConfig signingConfigs\.debug(?=\s+def)/,
          'signingConfig = signingConfigs.upload',
        ),
      ),
    ).toBe('upload');
  });

  it('a release block without one, or only a commented-out one, would build an unsigned APK', () => {
    const unsigned = TEMPLATE.replace(
      /(release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1// signingConfig signingConfigs.debug',
    );
    expect(releaseSigningConfig(unsigned)).toBeNull();
    expect(
      releaseSigningConfig('android { buildTypes { debug { signingConfig signingConfigs.debug } } }'),
    ).toBeNull();
    expect(releaseSigningConfig('')).toBeNull();
  });
});

describe('what the tools print', () => {
  it('java -version: the major version, old and new styles', () => {
    expect(javaMajorVersion('java version "17.0.2" 2022-01-18 LTS\nJava(TM) SE Runtime Environment')).toBe(
      17,
    );
    expect(javaMajorVersion('openjdk version "21.0.4" 2024-07-16\nOpenJDK Runtime Environment')).toBe(21);
    expect(javaMajorVersion('java version "1.8.0_381"')).toBe(8);
    expect(javaMajorVersion("'java' is not recognized")).toBeNull();
  });

  it('adb devices -l: ready phones, unauthorized and offline ones, wireless ones; not the daemon chatter', () => {
    const text = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'R58N12ABCDE            device usb:1-1 product:a54xnsxx model:SM_A546E device:a54x transport_id:1',
      '9A281FFAZ004LT         unauthorized usb:1-2 transport_id:2',
      '192.168.1.40:37211     device product:panther model:Pixel_7 device:panther transport_id:3',
      // Wireless debugging found by mDNS, its name taken once already: the serial has a space.
      'adb-R58N12ABCDE-AbCdEf (2)._adb-tls-connect._tcp device product:a54xnsxx model:SM_A546E device:a54x transport_id:4',
      'adb-9A281FFAZ004LT-XyZ._adb-tls-connect._tcp authorizing transport_id:5',
      '0123456789ABCDEF       no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:6',
      'emulator-5554          offline',
      '',
    ].join('\r\n');
    expect(parseAdbDevices(text)).toEqual([
      { serial: 'R58N12ABCDE', state: 'device', model: 'SM_A546E' },
      { serial: '9A281FFAZ004LT', state: 'unauthorized', model: null },
      { serial: '192.168.1.40:37211', state: 'device', model: 'Pixel_7' },
      { serial: 'adb-R58N12ABCDE-AbCdEf (2)._adb-tls-connect._tcp', state: 'device', model: 'SM_A546E' },
      { serial: 'adb-9A281FFAZ004LT-XyZ._adb-tls-connect._tcp', state: 'authorizing', model: null },
      { serial: '0123456789ABCDEF', state: 'no permissions', model: null },
      { serial: 'emulator-5554', state: 'offline', model: null },
    ]);
    // A state adb adds one day: the first two words, as before.
    expect(parseAdbDevices('R58N12ABCDE    newstate usb:1-1 model:X')).toEqual([
      { serial: 'R58N12ABCDE', state: 'newstate', model: 'X' },
    ]);
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
  });

  it('adb install: success, a different signature (cloud build), and the other common failures', () => {
    expect(installFailure('Performing Streamed Install\nSuccess\n')).toBeNull();
    const incompatible = installFailure(
      'Performing Streamed Install\nadb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: ' +
        'Existing package com.mosheg.sudokufight signatures do not match newer version; ignoring!]',
    );
    expect(incompatible).toEqual({
      code: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
      hint: expect.stringMatching(/signed with another key/),
    });
    expect(REPLACEABLE).toContain('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
    expect(REPLACEABLE).toContain('INSTALL_FAILED_VERSION_DOWNGRADE');
    expect(
      installFailure('Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries]'),
    ).toEqual({ code: 'INSTALL_FAILED_NO_MATCHING_ABIS', hint: expect.stringContaining(ABI) });
    expect(
      installFailure('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]')?.hint,
    ).toMatch(/Install via USB/);
    expect(installFailure('adb: device unauthorized.\nThis adb server')?.hint).toMatch(/Allow USB debugging/);
    expect(installFailure("adb: device 'X' not found")?.hint).toMatch(/replug/);
    expect(installFailure('Failure [INSTALL_FAILED_SOMETHING_NEW]')).toEqual({
      code: 'INSTALL_FAILED_SOMETHING_NEW',
      hint: expect.any(String),
    });
  });

  it("Gradle's command line: the release APK for one ABI, 2 workers, Kotlin in-process, no lint vital", () => {
    // The JS is bundled on every build: the bundle task's own inputs are only apps/mobile's .js/.ts files, so
    // Gradle would keep an old bundle after a change in packages/*, a text (JSON), an image or the server.
    expect(BUNDLE_TASK).toBe(':app:createBundleReleaseJsAndAssets');
    expect(gradleArgs()).toEqual([
      'assembleRelease',
      ':app:createBundleReleaseJsAndAssets',
      '--rerun',
      '-PreactNativeArchitectures=arm64-v8a',
      '--max-workers=2',
      '-Pkotlin.compiler.execution.strategy=in-process',
      '-x',
      'lintVitalRelease',
      '-x',
      'lintVitalAnalyzeRelease',
      '--console=plain',
    ]);
  });

  it("Gradle's plain console: the task now running, memory errors, and the failure's own summary", () => {
    expect(gradleTask('> Task :app:createBundleReleaseJsAndAssets')).toBe(
      ':app:createBundleReleaseJsAndAssets',
    );
    expect(gradleTask('> Task :react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a]')).toBe(
      ':react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a]',
    );
    expect(gradleTask('BUILD SUCCESSFUL in 12m 3s')).toBeNull();

    expect(isOutOfMemory('Execution failed\n> java.lang.OutOfMemoryError: Java heap space')).toBe(true);
    expect(isOutOfMemory('Expiring Daemon because JVM heap space is exhausted')).toBe(false);
    expect(isOutOfMemory('BUILD SUCCESSFUL')).toBe(false);

    // Windows kept a file open (an antivirus scan, Android Studio's indexer): the script tries once more.
    const locked = [
      "> Unable to delete directory 'C:\\sf\\build\\intermediates\\cxx\\obj\\arm64-v8a'",
      '    Failed to delete some children. This might happen because a process has files open',
    ].join('\n');
    expect(isFileLock(locked)).toBe(true);
    expect(isFileLock('The process cannot access the file because it is being used by another process')).toBe(
      true,
    );
    expect(isFileLock("Execution failed for task ':app:compileReleaseKotlin'.")).toBe(false);
    // Moving android/.gradle aside while Android Studio holds it: EPERM on Windows.
    const fsError = (code: string) => Object.assign(new Error(`${code}: operation not permitted`), { code });
    expect(isLockedError(fsError('EPERM'))).toBe(true);
    expect(isLockedError(fsError('EBUSY'))).toBe(true);
    expect(isLockedError(fsError('ENOSPC'))).toBe(false);
    expect(isLockedError(new Error('no code'))).toBe(false);
    expect(isLockedError(null)).toBe(false);

    const log = [
      '> Task :app:mergeReleaseResources',
      'FAILURE: Build failed with an exception.',
      '',
      '* What went wrong:',
      "Execution failed for task ':app:createBundleReleaseJsAndAssets'.",
      "> Process 'command 'node'' finished with non-zero exit value 1",
      '',
      '* Try:',
      '> Run with --stacktrace option to get the stack trace.',
    ].join('\n');
    expect(failureSummary(log)).toBe(
      "* What went wrong:\nExecution failed for task ':app:createBundleReleaseJsAndAssets'.\n" +
        "> Process 'command 'node'' finished with non-zero exit value 1",
    );
    expect(failureSummary('a\nb\nc\nd', 2)).toBe('c\nd');
  });

  it('free space: a first build needs what it writes (about 4 GB) above the point where Gradle is stopped', () => {
    const GB = 1024 ** 3;
    expect(ABORT_FREE).toBe(GB);
    expect(MIN_FREE_FULL).toBeGreaterThanOrEqual(ABORT_FREE + 5 * GB);
    expect(MIN_FREE_INCREMENTAL).toBeGreaterThan(ABORT_FREE);
    expect(MIN_FREE_INCREMENTAL).toBeLessThan(MIN_FREE_FULL);
  });

  it('sizes and times, short', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(61.24 * 1024 ** 2)).toBe('61.2 MB');
    expect(formatBytes(4 * 1024 ** 3)).toBe('4.0 GB');
    expect(formatDuration(45_400)).toBe('45s');
    expect(formatDuration(18 * 60_000 + 5_000)).toBe('18m 05s');
  });
});

describe('the APK, read as a zip', () => {
  /** A zip as an APK is laid out: entries, an optional APK Signing Block, the central directory. */
  function zip(entries: { name: string; data: Buffer; deflate?: boolean }[], signed: boolean): Buffer {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
      const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
      const name = Buffer.from(entry.name, 'utf8');
      const method = entry.deflate ? 8 : 0;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(method, 8);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(method, 10);
      header.writeUInt32LE(body.length, 20);
      header.writeUInt32LE(entry.data.length, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt32LE(offset, 42);
      parts.push(local, name, body);
      central.push(header, name);
      offset += 30 + name.length + body.length;
    }
    const block = signed
      ? Buffer.concat([Buffer.alloc(32, 7), Buffer.from('APK Sig Block 42', 'latin1')])
      : Buffer.alloc(0);
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset + block.length, 16);
    return Buffer.concat([...parts, block, directory, end]);
  }

  const HOST = 'sudoku-fight-staging.fly.dev';
  // Hermes bytecode keeps string literals as plain bytes.
  const bundle = Buffer.concat([
    Buffer.from([0xc6, 0x1f, 0xbc, 0x03]),
    Buffer.from(`\0${HOST}\0wss\0`.repeat(50)),
  ]);
  const apk = (signed = true, libs = ['lib/arm64-v8a/libhermes.so', 'lib/arm64-v8a/libreanimated.so']) =>
    zip(
      [
        { name: 'AndroidManifest.xml', data: Buffer.from('manifest') },
        { name: 'assets/index.android.bundle', data: bundle, deflate: true },
        ...libs.map((name) => ({ name, data: Buffer.from('ELF') })),
      ],
      signed,
    );

  it('lists and reads entries, stored or deflated', () => {
    const buf = apk();
    const entries = zipEntries(buf);
    expect(entries.map((e) => e.name)).toEqual([
      'AndroidManifest.xml',
      'assets/index.android.bundle',
      'lib/arm64-v8a/libhermes.so',
      'lib/arm64-v8a/libreanimated.so',
    ]);
    expect(readZipEntry(buf, entries[0]!).toString()).toBe('manifest');
    expect(entries[1]!.method).toBe(8);
    expect(readZipEntry(buf, entries[1]!).equals(bundle)).toBe(true);
    expect(() => zipEntries(Buffer.from('not a zip at all, just some bytes'))).toThrow(/not a zip/);
  });

  it('a good APK: signed, arm64-v8a only, the server host in the bundle', () => {
    const report = inspectApk(apk(), HOST);
    expect(report).toEqual({ signed: true, abis: [ABI], bundleSize: bundle.length, hostInBundle: true });
    expect(apkProblems(report, HOST)).toEqual([]);
  });

  it('names each problem: unsigned, other ABIs, another server, no bundle', () => {
    expect(hasApkSigningBlock(apk(false))).toBe(false);
    const report = inspectApk(
      apk(false, ['lib/armeabi-v7a/libhermes.so', 'lib/arm64-v8a/libhermes.so']),
      'example.org',
    );
    expect(apkProblems(report, 'example.org')).toEqual([
      'the APK is not signed',
      'native libraries for arm64-v8a, armeabi-v7a, expected arm64-v8a only',
      'the JS bundle does not contain the server host example.org',
    ]);
    const empty = zip([{ name: 'AndroidManifest.xml', data: Buffer.from('m') }], true);
    expect(apkProblems(inspectApk(empty, HOST), HOST)).toEqual([
      'native libraries for no ABI, expected arm64-v8a only',
      'no JS bundle (assets/index.android.bundle) in the APK',
    ]);
  });
});

describe('scripts/build-apk.mjs', () => {
  it('--help prints every option; a bad option exits 2 with the help', () => {
    const help = run('--help');
    expect(help.code).toBe(EXIT.ok);
    for (const option of [
      '--server',
      '--install',
      '--install-only',
      '--replace',
      '--clean',
      '--clean-only',
      '--clean-native',
    ])
      expect(help.out).toContain(option);
    expect(help.out).toBe(`${USAGE}\n`);

    const bad = run('--bogus');
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.out).toContain('unknown option --bogus');
    expect(run('--server', 'not a host!').code).toBe(EXIT.usage);
    // Refused before anything runs: no adb uninstall, no folder deleted.
    const dryInstall = run('--install-only', '--replace', '--dry-run');
    expect(dryInstall.code).toBe(EXIT.usage);
    expect(dryInstall.out).toContain('--install-only would still run');
  });

  it('--dry-run says what it would build, from the real eas.json and app.json, and builds nothing', () => {
    const staging = run('--dry-run');
    expect(staging.code).toBe(EXIT.ok);
    expect(staging.out).toContain('sudoku-fight-staging.fly.dev:443 (TLS)  [eas.json preview]');
    expect(staging.out).toMatch(
      new RegExp(
        `sudoku-fight-${APP.expo.version.replace(/\./g, '\\.')}-(?:[0-9a-f]{7,}|nogit)(?:-dirty)?-staging\\.apk`,
      ),
    );
    const production = run('--dry-run', '--server', 'production');
    expect(production.out).toContain('sudoku-fight-prod.fly.dev:443 (TLS)  [eas.json production]');
    const lan = run('--dry-run', '--server', '192.168.1.40:2567');
    expect(lan.out).toContain('192.168.1.40:2567 (no TLS)');
    expect(lan.out).toMatch(/allows cleartext traffic/);
  });
});
