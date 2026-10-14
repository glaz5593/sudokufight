import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

import { VERSION_PART_MAX, versionCodeOf, withBuildNumbers } from '../../app.config';
import type { Interfaces } from '../../../../scripts/lib/lan.mjs';
import { appServerLabel, buildInfoEnv, resolveServer } from '../../scripts/lib/build-apk.mjs';
import {
  BUMP_USAGE,
  buildNumber,
  bumpVersion,
  MAX_PART,
  parseBumpArgs,
  parseVersion,
  setAppJsonVersion,
} from '../../scripts/lib/version.mjs';

/**
 * Version management (Moshe, 14.10.2026: "start with 1.0.0 and next version will be 1.0.1 and I can see it in
 * the app"): app.json holds the version, `npm run version:bump` raises it (patch, minor, major) without
 * touching anything else, app.config.ts makes the build number from it (so a newer APK installs over the
 * older one), and `npm run apk` hands the app its commit and server for the version line.
 */

const MOBILE = join(__dirname, '..', '..');
const APP = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')) as { expo: ExpoConfig };

describe('the version and its build number', () => {
  it('app.json starts at 1.0.0 (build 10000); each patch is one more', () => {
    expect(parseVersion(APP.expo.version)).not.toBeNull();
    expect(versionCodeOf('1.0.0')).toBe(10000);
    expect(versionCodeOf('1.0.1')).toBe(10001);
    expect(versionCodeOf('1.2.3')).toBe(10203);
    expect(versionCodeOf('2.0.0')).toBe(20000);
    // Always rising: every bump gives a higher build number than the version before it.
    let v = '1.0.98';
    for (const part of ['patch', 'minor', 'patch', 'major'] as const) {
      const next = part === 'patch' && v.endsWith('.99') ? bumpVersion(v, 'minor') : bumpVersion(v, part);
      expect(versionCodeOf(next)).toBeGreaterThan(versionCodeOf(v));
      v = next;
    }
  });

  it('refuses what would give a wrong build number', () => {
    for (const bad of ['1.0', 'v1.0.0', '1.0.0-beta', '1.100.0', '1.0.100', '', '0.0.0'])
      expect(() => versionCodeOf(bad)).toThrow(/expo\.version/);
    expect(VERSION_PART_MAX).toBe(MAX_PART);
  });

  it("the app's config gets it as Android's versionCode and iOS's buildNumber (EAS counts its own)", () => {
    const config = withBuildNumbers(APP.expo);
    const code = versionCodeOf(APP.expo.version!);
    expect(config.android?.versionCode).toBe(code);
    expect(config.ios?.buildNumber).toBe(String(code));
    // Everything else as app.json says.
    expect(config.android?.package).toBe(APP.expo.android?.package);
    expect(config.ios?.bundleIdentifier).toBe(APP.expo.ios?.bundleIdentifier);
    // A config without a version (the tests' own) is left alone.
    const bare: ExpoConfig = { name: 'x', slug: 'x' };
    expect(withBuildNumbers(bare)).toBe(bare);
    const eas = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8')) as {
      cli: { appVersionSource: string };
    };
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('the script and the config agree on the build number', () => {
    for (const v of ['1.0.0', '1.0.1', '1.2.3', '3.99.99', '0.1.0'])
      expect(buildNumber(v)).toBe(versionCodeOf(v));
  });
});

describe('npm run version:bump (scripts/lib/version.mjs)', () => {
  it('patch by default; minor and major reset what follows; over 99 it says what to do instead', () => {
    expect(bumpVersion('1.0.0')).toBe('1.0.1');
    expect(bumpVersion('1.0.9', 'patch')).toBe('1.0.10');
    expect(bumpVersion('1.0.7', 'minor')).toBe('1.1.0');
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(() => bumpVersion('1.0.99')).toThrow(/version:bump -- minor/);
    expect(() => bumpVersion('1.99.0', 'minor')).toThrow(/up to 99/);
    expect(() => bumpVersion('one')).toThrow(/not a version/);
  });

  it('changes expo.version only, in place: the rest of app.json stays byte for byte', () => {
    const text = readFileSync(join(MOBILE, 'app.json'), 'utf8');
    const { text: next, from } = setAppJsonVersion(text, '7.8.9');
    expect(from).toBe(APP.expo.version);
    const before = text.split('\n');
    const after = next.split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.map((line, i) => (line === after[i] ? null : [line, after[i]])).filter(Boolean);
    expect(changed).toEqual([[`    "version": "${from}",`, '    "version": "7.8.9",']]);
    expect((JSON.parse(next) as { expo: ExpoConfig }).expo.version).toBe('7.8.9');
  });

  it('refuses an app.json it cannot change safely', () => {
    expect(() => setAppJsonVersion('{"expo":{}}', '1.0.1')).toThrow(/no expo.version/);
    const twice = '{"expo":{"version":"1.0.0","extra":{"x":{"version":"1.0.0"}}}}';
    expect(() => setAppJsonVersion(twice, '1.0.1')).toThrow(/found 2/);
    expect(() => setAppJsonVersion('{"expo":{"version":"1.0.0"}}', '1.0')).toThrow(/not a version/);
  });

  it('reads its command line', () => {
    expect(parseBumpArgs([])).toEqual({ kind: 'bump', part: 'patch', dryRun: false });
    expect(parseBumpArgs(['minor', '--dry-run'])).toEqual({ kind: 'bump', part: 'minor', dryRun: true });
    expect(parseBumpArgs(['major'])).toEqual({ kind: 'bump', part: 'major', dryRun: false });
    expect(parseBumpArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseBumpArgs(['minor', 'major'])).toMatchObject({ kind: 'error' });
    expect(parseBumpArgs(['1.2.3'])).toEqual({ kind: 'error', error: 'unknown argument 1.2.3' });
  });

  it('the script: --dry-run prints old -> new with the build numbers and writes nothing', () => {
    const script = join(MOBILE, 'scripts', 'bump-version.mjs');
    const before = readFileSync(join(MOBILE, 'app.json'), 'utf8');
    const dry = spawnSync(process.execPath, [script, '--dry-run'], { encoding: 'utf8' });
    expect(dry.status).toBe(0);
    const next = bumpVersion(APP.expo.version!);
    expect(dry.stdout).toContain(
      `(dry run) version ${APP.expo.version} -> ${next}  (build number ${buildNumber(APP.expo.version!)} -> ${buildNumber(next)})`,
    );
    expect(readFileSync(join(MOBILE, 'app.json'), 'utf8')).toBe(before);
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    expect(help.stdout).toBe(`${BUMP_USAGE}\n`);
    const bad = spawnSync(process.execPath, [script, 'sideways'], { encoding: 'utf8' });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('unknown argument sideways');
  });
});

describe('npm run apk tells the app its build (EXPO_PUBLIC_APP_BUILD, EXPO_PUBLIC_SERVER_LABEL)', () => {
  const eas = {
    build: {
      preview: {
        env: {
          EXPO_PUBLIC_SERVER_HOST: 'stg.example',
          EXPO_PUBLIC_SERVER_PORT: '443',
          EXPO_PUBLIC_SERVER_SECURE: 'true',
        },
      },
      production: {
        env: {
          EXPO_PUBLIC_SERVER_HOST: 'prd.example',
          EXPO_PUBLIC_SERVER_PORT: '443',
          EXPO_PUBLIC_SERVER_SECURE: 'true',
        },
      },
    },
  };
  const lan: Interfaces = {
    'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false, mac: '3c:22:fb:12:34:56' }],
  };
  const server = (choice: string) => {
    const r = resolveServer(choice, eas, lan);
    if (r.kind !== 'server') throw new Error(r.error);
    return r.server;
  };

  it('the commit (with -dirty, as in the APK name) and the server: staging, production, local, or the host', () => {
    expect(buildInfoEnv(server('staging'), { sha: 'a1b2c3d', dirty: false })).toEqual({
      EXPO_PUBLIC_APP_BUILD: 'a1b2c3d',
      EXPO_PUBLIC_SERVER_LABEL: 'staging',
    });
    expect(buildInfoEnv(server('production'), { sha: 'a1b2c3d', dirty: true }).EXPO_PUBLIC_APP_BUILD).toBe(
      'a1b2c3d-dirty',
    );
    expect(appServerLabel(server('production'))).toBe('production');
    expect(appServerLabel(server('local'))).toBe('local');
    expect(appServerLabel(server('game.example.com'))).toBe('game.example.com');
    expect(appServerLabel(server('192.168.1.50'))).toBe('192.168.1.50:2567');
  });

  it('--dry-run says which version and build line the APK will show', () => {
    const out = spawnSync(process.execPath, [join(MOBILE, 'scripts', 'build-apk.mjs'), '--dry-run'], {
      encoding: 'utf8',
    });
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(
      new RegExp(
        `version  ${APP.expo.version!.replace(/\./g, '\\.')} \\(build number ${buildNumber(APP.expo.version!)}\\); ` +
          'the app shows "build (?:[0-9a-f]{7,}|nogit)(?:-dirty)? · staging"',
      ),
    );
  });
});
