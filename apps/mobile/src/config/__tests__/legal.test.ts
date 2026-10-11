import { accountConfig } from '../account';
import { legalBaseUrl, legalUrl } from '../legal';
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

  it('open a page in the app’s language: Hebrew unless the app is in English', () => {
    const base = 'https://play.example.com:443/legal';
    expect(legalUrl('privacy', 'he', base)).toBe(`${base}/privacy?lang=he`);
    expect(legalUrl('terms', 'en', base)).toBe(`${base}/terms?lang=en`);
    expect(legalUrl('delete-account', 'fr', base)).toBe(`${base}/delete-account?lang=he`);
    expect(legalUrl('privacy', 'en')).toBe(`${httpBaseUrl()}/legal/privacy?lang=en`);
  });
});
