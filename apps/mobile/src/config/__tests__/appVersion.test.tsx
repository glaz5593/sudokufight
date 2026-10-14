import { render, screen } from '@testing-library/react-native';

import { ltr } from '../../components/player';
import { VersionInfo } from '../../components/VersionInfo';
import i18n from '../../i18n';
import {
  appVersionInfo,
  nativeVersionOf,
  readVersionInfo,
  serverLabelOf,
  type VersionSources,
} from '../appVersion';

/**
 * The version line (Moshe, 14.10.2026: "I can see it in the app"): the installed app's version first (the native
 * one), the config's when there is none; the commit `npm run apk` built, when it is one; the server's label, or a
 * guess from its host. Then how the settings and the login screen show it, in Hebrew and English.
 */

const SOURCES: VersionSources = {
  native: '1.0.1',
  config: '1.0.0',
  build: 'a1b2c3d',
  label: 'staging',
  host: 'sudoku-fight-staging.fly.dev',
};

describe('readVersionInfo', () => {
  it("the native version is what is installed: it wins over the bundle's config", () => {
    expect(readVersionInfo(SOURCES)).toEqual({ version: '1.0.1', build: 'a1b2c3d', server: 'staging' });
    expect(readVersionInfo({ ...SOURCES, native: null }).version).toBe('1.0.0');
    expect(readVersionInfo({ ...SOURCES, native: ' ', config: undefined }).version).toBeNull();
  });

  it('a build id only when it is a commit (with -dirty) or nogit', () => {
    for (const build of ['a1b2c3d', 'a1b2c3d-dirty', 'nogit', '0123456789abcdef0123456789abcdef01234567'])
      expect(readVersionInfo({ ...SOURCES, build }).build).toBe(build);
    for (const build of [undefined, '', 'release', 'A1B2C3D', 'a1b2c3d; rm -rf'])
      expect(readVersionInfo({ ...SOURCES, build }).build).toBeNull();
  });

  it("the server: the build's label, else a guess from the host", () => {
    expect(serverLabelOf('production', 'x')).toBe('production');
    expect(serverLabelOf('192.168.1.20:2567', 'x')).toBe('192.168.1.20:2567');
    expect(serverLabelOf(undefined, 'localhost')).toBe('local');
    expect(serverLabelOf(undefined, '192.168.1.20')).toBe('local');
    expect(serverLabelOf('', '10.0.2.2')).toBe('local');
    expect(serverLabelOf(undefined, 'sudoku-fight-staging.fly.dev')).toBe('staging');
    expect(serverLabelOf(undefined, 'sudoku-fight-prod.fly.dev')).toBe('production');
    expect(serverLabelOf(undefined, 'game.example.com')).toBe('game.example.com');
    // A label with odd characters is not trusted.
    expect(serverLabelOf('<b>', 'game.example.com')).toBe('game.example.com');
  });

  it("this app's: some version, from the native module or the config", () => {
    const info = appVersionInfo();
    expect(typeof info.server).toBe('string');
    expect(info.server.length).toBeGreaterThan(0);
  });

  it('a build without the ExpoApplication native module: the config’s version, no crash', () => {
    const missing = () => {
      throw new Error("Cannot find native module 'ExpoApplication'");
    };
    expect(nativeVersionOf(missing)).toBeNull();
    expect(nativeVersionOf(() => ({ nativeApplicationVersion: '1.0.1' }))).toBe('1.0.1');
    expect(nativeVersionOf(() => ({ nativeApplicationVersion: null }))).toBeNull();
    expect(appVersionInfo({ load: missing, configVersion: '1.0.0' }).version).toBe('1.0.0');
    expect(
      appVersionInfo({ load: () => ({ nativeApplicationVersion: '9.9.9' }), configVersion: '1.0.0' }).version,
    ).toBe('9.9.9');
  });
});

describe('VersionInfo', () => {
  it('"גרסה 1.0.0" over "build a1b2c3d · staging", each read as one label', async () => {
    await i18n.changeLanguage('he');
    await render(<VersionInfo info={{ version: '1.0.0', build: 'a1b2c3d', server: 'staging' }} />);
    expect(screen.getByTestId('app-version-version')).toHaveTextContent(`גרסה ${ltr('1.0.0')}`);
    expect(screen.getByTestId('app-version-details')).toHaveTextContent(ltr('build a1b2c3d · staging'));
    expect(screen.getByTestId('app-version')).toHaveProp(
      'accessibilityLabel',
      `גרסה ${ltr('1.0.0')}, build a1b2c3d · staging`,
    );
  });

  it('in English; nothing at all without a version', async () => {
    await i18n.changeLanguage('en');
    await render(<VersionInfo info={{ version: '2.3.4', build: null, server: 'local' }} engine={3} />);
    expect(screen.getByTestId('app-version-version')).toHaveTextContent(`Version ${ltr('2.3.4')}`);
    expect(screen.getByTestId('app-version-details')).toHaveTextContent(ltr('local · engine 3'));
    await render(<VersionInfo info={{ version: null, build: 'a1b2c3d', server: 'local' }} />);
    expect(screen.queryByTestId('app-version')).toBeNull();
    await i18n.changeLanguage('he');
  });
});
