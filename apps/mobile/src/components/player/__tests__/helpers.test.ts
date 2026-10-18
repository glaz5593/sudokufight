import i18n from '../../../i18n';
import en from '../../../i18n/locales/en/player.json';
import he from '../../../i18n/locales/he/player.json';
import { size } from '../../../theme';
import { fourPlayerView, NOW, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import { cardModel, leadModel, lockModel } from '../cardModel';
import { countryName, flagEmoji } from '../countryFlag';
import { formatScore, formatSigned, ltr, scoreText, secondsOf, signedText, withAlpha } from '../format';
import { LEAGUE_THRESHOLDS, leagueFor } from '../league';
import { compactCardGap, compactCardWidth } from '../metrics';
import {
  activityPhrase,
  cardLabel,
  interferenceLabel,
  leadLabel,
  lockStripLabel,
  mistakesShort,
  type PlayerT,
} from '../wording';

const heT = i18n.getFixedT('he', 'player') as PlayerT;
const enT = i18n.getFixedT('en', 'player') as PlayerT;

describe('leagueFor (spec §11.3) [D38]', () => {
  it.each([
    [0, 'bronze'],
    [1099, 'bronze'],
    [1099.9, 'bronze'],
    [1100, 'silver'],
    [1200, 'silver'],
    [1249, 'silver'],
    [1250, 'gold'],
    [1399, 'gold'],
    [1400, 'diamond'],
    [1599, 'diamond'],
    [1600, 'legend'],
    [2400, 'legend'],
  ])('%d → %s', (rating, league) => {
    expect(leagueFor(rating)).toBe(league);
  });

  it('takes other thresholds, since D38 is still open', () => {
    expect(leagueFor(1100, { ...LEAGUE_THRESHOLDS, silver: 1150 })).toBe('bronze');
  });
});

describe('number formatting (components.md §0.4)', () => {
  it('shows halves with one decimal, wholes without, and U+2212 for a minus', () => {
    expect(formatScore(55)).toBe('55');
    expect(formatScore(39.5)).toBe('39.5');
    expect(formatScore(-2)).toBe('−2');
    expect(formatScore(-0)).toBe('0');
    expect(formatSigned(3.5)).toBe('+3.5');
    expect(formatSigned(-8)).toBe('−8');
    expect(formatSigned(0)).toBe('0');
  });

  it('isolates LTR runs and rounds seconds up', () => {
    expect(ltr('A8')).toBe('⁦A8⁩');
    expect(secondsOf(6200)).toBe(7);
    expect(secondsOf(7000)).toBe(7);
    expect(secondsOf(-5)).toBe(0);
  });

  it('keeps a sign before its number in Hebrew: signed screen text is an LTR isolate (CLAUDE.md)', () => {
    expect(signedText(3.5)).toBe(ltr('+3.5'));
    expect(signedText(-8)).toBe(ltr('−8'));
    expect(scoreText(-2)).toBe(ltr('−2'));
    // A score without a sign needs no isolate.
    expect(scoreText(55)).toBe('55');
    expect(scoreText(0)).toBe('0');
  });

  it('turns a token colour into a translucent fill', () => {
    expect(withAlpha('#36c9f0', 0.16)).toBe('rgba(54,201,240,0.16)');
  });
});

describe('compact card widths (components.md §7.1)', () => {
  it('3 players: 114 each, gap 8; 4 players: 106 for me and 78 for the others, gap 6', () => {
    expect(compactCardWidth(3, true)).toBe(114);
    expect(compactCardWidth(3, false)).toBe(114);
    expect(compactCardWidth(4, true)).toBe(106);
    expect(compactCardWidth(4, false)).toBe(78);
    expect(compactCardGap(3)).toBe(8);
    expect(compactCardGap(4)).toBe(6);
    // One row as wide as the board either way.
    expect(3 * compactCardWidth(3, false) + 2 * compactCardGap(3)).toBe(size.board);
    expect(compactCardWidth(4, true) + 3 * compactCardWidth(4, false) + 3 * compactCardGap(4)).toBe(
      size.board,
    );
  });
});

describe('flags (components.md §4)', () => {
  it('builds the emoji from regional indicators', () => {
    expect(flagEmoji('IL')).toBe('🇮🇱');
    expect(flagEmoji('de')).toBe('🇩🇪');
    expect(flagEmoji('ISR')).toBeNull();
    expect(flagEmoji('')).toBeNull();
    expect(flagEmoji(null)).toBeNull();
  });

  it('names the country in the app language, or falls back to the code', () => {
    expect(countryName('IL', 'he')).toBe('ישראל');
    expect(countryName('de', 'en')).toBe('Germany');
    expect(countryName('qq', 'en')).toBe('QQ');
  });
});

describe('wording (namespace "player")', () => {
  it('words my card as Dir-C-Game does', () => {
    const me = cardModel(twoPlayerView(), 'moshe', 0, NOW);
    expect(mistakesShort(1, heT)).toBe('1 טעות');
    expect(mistakesShort(2, heT)).toBe('2 טעויות');
    expect(mistakesShort(0, heT)).toBe('אין טעויות');
    expect(cardLabel(me, heT)).toBe('MosheG · 55 נקודות · טעות אחת, דירוג 1287');
    expect(cardLabel(me, enT)).toBe('MosheG · 55 points · One mistake, Rating 1287');
  });

  it("words the opponent's activity, in the feminine when asked (§17.8)", () => {
    const nina = cardModel(twoPlayerView(), 'nina', 0, NOW);
    expect(activityPhrase(nina.activity, heT)).toBe('בוחר A8');
    expect(activityPhrase(nina.activity, heT, 'female')).toBe('בוחרת A8');
    expect(cardLabel(nina, heT, { gender: 'female' })).toBe(
      'NinaVolt · 39.5 נקודות · בוחרת A8, אין טעויות, דירוג 1305, מחוברת',
    );
    expect(cardLabel(nina, enT)).toBe(
      'NinaVolt · 39.5 points · Choosing A8, No mistakes, Rating 1305, Online',
    );
  });

  it('words a disconnected opponent with the grace seconds', () => {
    const view = withPlayer(twoPlayerView(), 'nina', {
      connected: false,
      graceEndsAt: NOW + 12_000,
      lock: null,
    });
    const nina = cardModel(view, 'nina', 0, NOW);
    expect(activityPhrase(nina.activity, heT, 'female')).toBe('מתנתקת, 12 שניות');
    expect(cardLabel(nina, heT)).toBe('NinaVolt · 39.5 נקודות · מתנתק, 12 שניות, אין טעויות, דירוג 1305');
  });

  it('keeps a negative score in order inside Hebrew', () => {
    const view = withPlayer(twoPlayerView(), 'nina', { score: -2 });
    expect(cardLabel(cardModel(view, 'nina', 0, NOW), heT)).toContain('⁦−2⁩ נקודות');
  });

  it('labels the compact card with the place (§7.4)', () => {
    const aiko = cardModel(fourPlayerView(), 'aiko', 0, NOW);
    expect(cardLabel(aiko, heT, { compact: true, gender: 'female' })).toBe(
      'Aiko_M · מקום 1 · 39 נקודות · בוחרת D4, אין טעויות, דירוג 1318, מחוברת',
    );
  });

  it('labels the "הפרעה" button in every state (§8.1)', () => {
    expect(interferenceLabel('NinaVolt', { kind: 'available', cost: 2 }, heT)).toBe(
      'הפרעה ל־NinaVolt · עלות 2 נק׳',
    );
    expect(interferenceLabel('NinaVolt', { kind: 'points', cost: 8, missing: 3 }, heT)).toBe(
      'הפרעה ל־NinaVolt · חסרות 3 נק׳',
    );
    expect(interferenceLabel('NinaVolt', { kind: 'busy', cost: 2, secondsLeft: 3 }, heT)).toBe(
      'הפרעה ל־NinaVolt לא זמינה, כבר תחת הפרעה',
    );
    expect(interferenceLabel('NinaVolt', { kind: 'available', cost: 2 }, heT, true)).toBe(
      'סגירת חלון ההפרעות',
    );
  });

  it('labels the lock strip and the lead bar', () => {
    expect(lockStripLabel(lockModel(twoPlayerView(), NOW), heT)).toBe('המשבצת שלך F8, נותרו 7 שניות');
    expect(lockStripLabel(lockModel(twoPlayerView(), NOW + 5300), heT)).toBe(
      'המשבצת שלך F8, נותרה שנייה אחת',
    );
    expect(lockStripLabel({ kind: 'none' }, heT)).toBe('בחר משבצת');
    expect(leadLabel(leadModel(twoPlayerView(), 0), heT)).toBe('MosheG מוביל ב־15.5 נקודות');
    expect(leadLabel(leadModel(fourPlayerView(), 0), heT, 'female')).toBe('Aiko_M מובילה ב־2.5 נקודות');
    const tie = withPlayer(twoPlayerView(), 'nina', { score: 55, isLeader: true, place: 1 });
    expect(leadLabel(leadModel(tie, 0), enT)).toBe('Scores are tied');
  });
});

/** Every key of one language file exists in the other (spec §22: Hebrew and English). */
function keys(o: object, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

it('has the same keys in Hebrew and English', () => {
  expect(keys(he).sort()).toEqual(keys(en).sort());
});
