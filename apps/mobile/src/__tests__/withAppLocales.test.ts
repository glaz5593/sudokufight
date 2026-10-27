import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';
import { XML } from 'expo/config-plugins';

import ENABLED from '../i18n/enabled-languages.json';
import { LANGUAGES, PSEUDO_LANGUAGES } from '../i18n/languages';

/**
 * plugins/withAppLocales.js (localization plan §1 and 0יא; D103, D118): the languages the system settings
 * offer for the app, from src/i18n/enabled-languages.json: res/xml/locales_config.xml and
 * `android:localeConfig` on Android, CFBundleLocalizations on iOS, and nothing else (no
 * `resourceConfigurations` filter in build.gradle, unlike expo-localization's `supportedLocales`). The mods run
 * here on a fake config, the dangerous one writing into a temporary android folder.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- the plugin is CommonJS, run by Node at prebuild */
const plugin = require('../../plugins/withAppLocales.js') as {
  (config: ExpoConfig, options?: { languagesFile?: string }): ExpoConfig;
  DEFAULT_LANGUAGES_FILE: string;
  LOCALES_CONFIG_RESOURCE: string;
  LOCALES_CONFIG_PATH: string[];
  parseLanguages: (json: unknown, source?: string) => string[];
  readLanguages: (projectRoot: string, file?: string) => string[];
  localesConfigXml: (languages: readonly string[]) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

type ModRequest = {
  projectRoot: string;
  platformProjectRoot: string;
  platform: 'android' | 'ios';
  modName: string;
  introspect: boolean;
};
type Mod = (config: ExpoConfig & { modResults: unknown; modRequest: ModRequest }) => Promise<{
  modResults: unknown;
}>;
type Mods = Record<'android' | 'ios', Record<string, Mod>>;

const modsOf = (config: ExpoConfig): Mods => (config as ExpoConfig & { mods: Mods }).mods;

/** A manifest as prebuild parses it, with the application element the plugin looks for. */
const manifest = () => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    application: [{ $: { 'android:name': '.MainApplication', 'android:supportsRtl': 'true' } }],
  },
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-locales-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project folder with a languages file, and the plugin applied to a fake config. */
function project(languages: unknown, file = 'langs.json') {
  writeFileSync(join(root, file), JSON.stringify(languages));
  const config = plugin({ name: 'Sudoku Fight', slug: 'sudoku-fight' }, { languagesFile: `./${file}` });
  const request = (platform: 'android' | 'ios', modName: string): ModRequest => ({
    projectRoot: root,
    platformProjectRoot: join(root, platform),
    platform,
    modName,
    introspect: false,
  });
  const run = (platform: 'android' | 'ios', modName: string, modResults: unknown) =>
    modsOf(config)[platform][modName]!({ ...config, modResults, modRequest: request(platform, modName) });
  return { config, run };
}

describe('the list of languages (src/i18n/enabled-languages.json)', () => {
  it("every one of the app's 19 languages is a tag the native projects take as it is", () => {
    expect(plugin.parseLanguages([...LANGUAGES])).toEqual([...LANGUAGES]);
  });

  it("today's list passes, and the default file is that list", () => {
    expect(plugin.parseLanguages(ENABLED)).toEqual(ENABLED);
    expect(plugin.readLanguages(join(__dirname, '..', '..'))).toEqual(ENABLED);
    expect(plugin.DEFAULT_LANGUAGES_FILE).toBe('./src/i18n/enabled-languages.json');
  });

  it('refuses anything a build must not get, naming the file and the tag', () => {
    const refuses = (json: unknown) =>
      expect(() => plugin.parseLanguages(json, 'list.json')).toThrow(/list\.json/);
    refuses({ he: true });
    refuses([]);
    refuses(['he', 7]);
    refuses(['he', 'not a tag']);
    // Not canonical: the old Android codes, or the wrong case.
    expect(() => plugin.parseLanguages(['iw'])).toThrow('write it as "he"');
    expect(() => plugin.parseLanguages(['in'])).toThrow('write it as "id"');
    expect(() => plugin.parseLanguages(['zh-hans'])).toThrow('write it as "zh-Hans"');
    expect(() => plugin.parseLanguages(['pt-br'])).toThrow('write it as "pt-BR"');
    // The pseudo-languages are JS only.
    for (const pseudo of PSEUDO_LANGUAGES)
      expect(() => plugin.parseLanguages(['en', pseudo])).toThrow('pseudo');
    expect(() => plugin.parseLanguages(['he', 'en', 'he'])).toThrow('"he" twice');
  });

  it('a missing or broken file stops the build, naming the file', () => {
    expect(() => plugin.readLanguages(root, './missing.json')).toThrow(/cannot read \.\/missing\.json/);
    writeFileSync(join(root, 'broken.json'), '["he",');
    expect(() => plugin.readLanguages(root, './broken.json')).toThrow(/cannot read \.\/broken\.json/);
  });
});

describe('Android: locales_config.xml and android:localeConfig', () => {
  it('the XML lists each language, in the order of the list', async () => {
    const xml = plugin.localesConfigXml(['he', 'en', 'zh-Hans', 'pt-BR']);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<!-- Generated by plugins/withAppLocales.js from src/i18n/enabled-languages.json. -->',
        '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <locale android:name="he"/>',
        '  <locale android:name="en"/>',
        '  <locale android:name="zh-Hans"/>',
        '  <locale android:name="pt-BR"/>',
        '</locale-config>',
        '',
      ].join('\n'),
    );
    const parsed = (await XML.parseXMLAsync(xml)) as unknown as {
      'locale-config': { locale: { $: { 'android:name': string } }[] };
    };
    expect(parsed['locale-config'].locale.map((l) => l.$['android:name'])).toEqual([
      'he',
      'en',
      'zh-Hans',
      'pt-BR',
    ]);
  });

  it('prebuild writes res/xml/locales_config.xml from the list, and the manifest points at it', async () => {
    const { run } = project(['he', 'en', 'ar']);
    await run('android', 'dangerous', undefined);
    const written = readFileSync(join(root, 'android', ...plugin.LOCALES_CONFIG_PATH), 'utf8');
    expect(written).toBe(plugin.localesConfigXml(['he', 'en', 'ar']));
    expect(plugin.LOCALES_CONFIG_PATH.join('/')).toBe('app/src/main/res/xml/locales_config.xml');

    const { modResults } = await run('android', 'manifest', manifest());
    const application = (modResults as ReturnType<typeof manifest>).manifest.application[0]!;
    expect(application.$).toEqual({
      'android:name': '.MainApplication',
      'android:supportsRtl': 'true',
      'android:localeConfig': '@xml/locales_config',
    });
    expect(plugin.LOCALES_CONFIG_RESOURCE).toBe('@xml/locales_config');
  });

  it('writes again over an older file (a language added since the last prebuild)', async () => {
    mkdirSync(join(root, 'android', 'app', 'src', 'main', 'res', 'xml'), { recursive: true });
    writeFileSync(join(root, 'android', ...plugin.LOCALES_CONFIG_PATH), plugin.localesConfigXml(['he']));
    const { run } = project(['he', 'en']);
    await run('android', 'dangerous', undefined);
    expect(readFileSync(join(root, 'android', ...plugin.LOCALES_CONFIG_PATH), 'utf8')).toContain(
      '<locale android:name="en"/>',
    );
  });

  it('touches nothing else: no build.gradle mod, so no resourceConfigurations filter (plan 0יא)', () => {
    const { config } = project(['he', 'en']);
    expect(Object.keys(modsOf(config).android).sort()).toEqual(['dangerous', 'manifest']);
    expect(Object.keys(modsOf(config).ios)).toEqual(['infoPlist']);
  });

  it('a bad list fails the prebuild, not a phone', async () => {
    const { run } = project(['he', 'iw']);
    await expect(run('android', 'dangerous', undefined)).rejects.toThrow('write it as "he"');
  });
});

describe('iOS: CFBundleLocalizations', () => {
  it("Info.plist lists the languages as the app's localizations, keeping its other keys", async () => {
    const { run } = project(['he', 'en', 'zh-Hant']);
    const { modResults } = await run('ios', 'infoPlist', { CFBundleDisplayName: 'Sudoku Fight' });
    expect(modResults).toEqual({
      CFBundleDisplayName: 'Sudoku Fight',
      CFBundleLocalizations: ['he', 'en', 'zh-Hant'],
    });
  });
});
