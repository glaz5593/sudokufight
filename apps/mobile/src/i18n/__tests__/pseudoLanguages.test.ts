import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useSettings } from '../../state/settings';
import i18n, { localeBundle } from '../index';
import { installPseudoLanguages, pseudoLanguagesAllowed } from '../pseudoLanguages';

/**
 * Where the pseudo languages exist (localization plan 0יג): development and staging builds, the builds with the
 * settings' "בדיקה" section (config/testing.ts), and never a store build: there they are not registered, the
 * plural check screen sends Home, and a pseudo language a staging build saved on the same phone goes back to
 * "שפת המכשיר". The order of the tests matters: nothing registers them before the production case.
 */

const STAGING = { server: 'staging', dev: false };
const DEVELOPMENT = { server: 'local', dev: true };
const PRODUCTION = { server: 'production', dev: false };
const DEVELOPMENT_ON_PRODUCTION = { server: 'production', dev: true };

afterAll(async () => {
  useSettings.setState({ language: 'system', languageSource: 'default' });
  await i18n.changeLanguage('he');
});

describe('which builds have them', () => {
  it('staging and development builds; never production, also from a development build', () => {
    expect(pseudoLanguagesAllowed(STAGING)).toBe(true);
    expect(pseudoLanguagesAllowed(DEVELOPMENT)).toBe(true);
    expect(pseudoLanguagesAllowed(PRODUCTION)).toBe(false);
    expect(pseudoLanguagesAllowed(DEVELOPMENT_ON_PRODUCTION)).toBe(false);
  });
});

describe('at launch (installPseudoLanguages, from the root layout)', () => {
  it('a production build: they do not exist, and a saved one goes back to "שפת המכשיר"', () => {
    for (const build of [PRODUCTION, DEVELOPMENT_ON_PRODUCTION]) {
      useSettings.setState({ language: 'ar-XB', languageSource: 'app' });
      installPseudoLanguages(build);
      expect(localeBundle('en-XA')).toBeNull();
      expect(localeBundle('ar-XB')).toBeNull();
      expect(useSettings.getState()).toMatchObject({ language: 'system', languageSource: 'default' });
    }
  });

  it('a production build keeps any other setting', () => {
    useSettings.setState({ language: 'he', languageSource: 'app' });
    installPseudoLanguages(PRODUCTION);
    expect(useSettings.getState()).toMatchObject({ language: 'he', languageSource: 'app' });
  });

  it('a staging build: registered, and a pseudo language the app started in is read again at once', async () => {
    // Saved before: i18n started in it before its strings existed, so English shows.
    useSettings.setState({ language: 'en-XA', languageSource: 'app' });
    await i18n.changeLanguage('en-XA');
    expect(i18n.t('ui:sheet.close')).toBe('Close');
    installPseudoLanguages(STAGING);
    expect(localeBundle('en-XA')).not.toBeNull();
    expect(localeBundle('ar-XB')).not.toBeNull();
    expect(i18n.t('ui:sheet.close')).toBe('[Çļöšé]');
    expect(useSettings.getState()).toMatchObject({ language: 'en-XA', languageSource: 'app' });
  });

  it('the root layout installs them before it applies the language', () => {
    const layout = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');
    const install = layout.indexOf('installPseudoLanguages();');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(layout.indexOf('void i18n.changeLanguage(syncLanguageWithSystem());'));
  });
});
