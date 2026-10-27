import { LANGUAGES } from '../../i18n/languages';
import { accountConfig } from '../account';
import { I18N_CONFIG } from '../i18n';
import { legalBaseUrl, legalLanguage, legalUrl } from '../legal';
import { httpBaseUrl } from '../server';

/** Stage 14: the legal pages the app links to (the game server's /legal/…, or EXPO_PUBLIC_LEGAL_BASE_URL). */
describe('legal URLs', () => {
  it('are the game server’s /legal by default', () => {
    expect(accountConfig.legal.baseUrl).toBeNull();
    expect(legalBaseUrl()).toBe(`${httpBaseUrl()}/legal`);
    expect(legalBaseUrl(null, 'https://play.example.com:443')).toBe('https://play.example.com:443/legal');
    expect(legalBaseUrl('  ', 'http://localhost:2567')).toBe('http://localhost:2567/legal');
  });

  it('take EXPO_PUBLIC_LEGAL_BASE_URL when it is set, without a trailing slash', () => {
    expect(legalBaseUrl('https://sudoku.example/legal/', 'http://ignored')).toBe(
      'https://sudoku.example/legal',
    );
    expect(legalBaseUrl(' https://sudoku.example/legal ', 'http://ignored')).toBe(
      'https://sudoku.example/legal',
    );
  });

  it('[D112] open a page in the app’s language: each language its own version (the server shows English while it has none)', () => {
    const base = 'https://play.example.com:443/legal';
    expect(legalUrl('privacy', 'he', base)).toBe(`${base}/privacy?lang=he`);
    expect(legalUrl('terms', 'en', base)).toBe(`${base}/terms?lang=en`);
    expect(legalUrl('delete-account', 'fr', base)).toBe(`${base}/delete-account?lang=fr`);
    expect(legalUrl('terms', 'pt-BR', base)).toBe(`${base}/terms?lang=pt-BR`);
    expect(legalUrl('privacy', 'zh-Hant', base)).toBe(`${base}/privacy?lang=zh-Hant`);
    expect(legalUrl('privacy', 'en')).toBe(`${httpBaseUrl()}/legal/privacy?lang=en`);
    for (const lang of LANGUAGES) expect(legalLanguage(lang)).toBe(lang);
    // Not a language of the app (a pseudo language, an unknown code): English (D101).
    expect(legalLanguage('ar-XB')).toBe('en');
    expect(legalLanguage('en-XA')).toBe('en');
    expect(legalLanguage('xx')).toBe('en');
  });

  it('[D112] the alternative: English for every language but Hebrew', () => {
    expect(I18N_CONFIG.legalLanguageFor).toBe('own');
    const english = jest.replaceProperty(I18N_CONFIG, 'legalLanguageFor', 'english');
    try {
      expect(legalLanguage('he')).toBe('he');
      expect(legalLanguage('en')).toBe('en');
      expect(legalLanguage('ar')).toBe('en');
      expect(legalUrl('terms', 'fr', 'https://x.example/legal')).toBe(
        'https://x.example/legal/terms?lang=en',
      );
    } finally {
      english.restore();
    }
  });
});
