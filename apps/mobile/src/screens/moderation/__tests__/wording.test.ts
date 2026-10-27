import { ModerationApiError } from '../../../api/moderationApi';
import i18n from '../../../i18n';
import { blockErrorText, minutesUntil, type ModerationT, reportErrorText } from '../wording';

/** What a failed report or block says (spec §3.5), each case, in Hebrew and English. */

// Both languages' strings, whatever language the tests start in (a language loads when it is first used).
beforeAll(() => i18n.loadLanguages(['he', 'en']));

const NOW = 1_760_000_000_000;
const t = (lng: 'he' | 'en') => i18n.getFixedT(lng, 'moderation') as ModerationT;
const err = (
  code: ConstructorParameters<typeof ModerationApiError>[0],
  body: object = {},
  retryMs: number | null = null,
) => new ModerationApiError(code, 400, { error: code as never, ...body }, retryMs);

describe('minutesUntil', () => {
  it("rounds up, at least one; the body's retryAt first, else Retry-After", () => {
    expect(minutesUntil(err('rateLimited', { retryAt: NOW + 12 * 60_000 - 1 }), NOW)).toBe(12);
    expect(minutesUntil(err('rateLimited', { retryAt: NOW - 5 }), NOW)).toBe(1);
    expect(minutesUntil(err('rateLimited', {}, 90_000), NOW)).toBe(2);
    expect(minutesUntil(err('rateLimited'), NOW)).toBeNull();
    expect(minutesUntil(new Error('x'), NOW)).toBeNull();
  });
});

describe('reportErrorText', () => {
  it('Hebrew: the quota with its minutes (one, two, many), and each refusal', () => {
    const he = t('he');
    expect(reportErrorText(he, err('rateLimited', { retryAt: NOW + 60_000 }), NOW)).toBe(
      'שלחת הרבה דיווחים בשעה האחרונה. אפשר לשלוח עוד דיווח בעוד דקה.',
    );
    expect(reportErrorText(he, err('rateLimited', { retryAt: NOW + 2 * 60_000 }), NOW)).toMatch(
      /בעוד שתי דקות\.$/,
    );
    expect(reportErrorText(he, err('rateLimited', { retryAt: NOW + 40 * 60_000 }), NOW)).toMatch(
      /בעוד 40 דקות\.$/,
    );
    expect(reportErrorText(he, err('rateLimited'), NOW)).toBe('יותר מדי בקשות. חכה רגע ונסה שוב.');
    expect(reportErrorText(he, err('suspended'), NOW)).toBe(
      'החשבון שלך מושעה, ולכן אי אפשר לשלוח דיווחים כרגע.',
    );
    expect(reportErrorText(he, err('self'), NOW)).toBe('אי אפשר לדווח על עצמך.');
    expect(reportErrorText(he, err('notFound'), NOW)).toBe('השחקן הזה כבר לא נמצא במשחק.');
    expect(reportErrorText(he, new ModerationApiError('network'), NOW)).toBe(
      'אין חיבור לשרת, והדיווח לא נשלח. נסה שוב.',
    );
    expect(reportErrorText(he, err('badRequest'), NOW)).toBe('לא הצלחנו לשלוח את הדיווח. נסה שוב.');
    expect(reportErrorText(he, new Error('boom'), NOW)).toBe('לא הצלחנו לשלוח את הדיווח. נסה שוב.');
  });

  it('English', () => {
    expect(reportErrorText(t('en'), err('rateLimited', { retryAt: NOW + 5 * 60_000 }), NOW)).toBe(
      'You sent many reports in the last hour. You can send another in 5 minutes.',
    );
  });
});

describe('blockErrorText', () => {
  it('the limit with its number, yourself, a gone player, offline; unblocking says its own', () => {
    const he = t('he');
    expect(blockErrorText(he, err('limitReached', { max: 100 }), false)).toMatch(
      /^אפשר לחסום עד 100 שחקנים\./,
    );
    expect(blockErrorText(he, err('self'), false)).toBe('אי אפשר לחסום את עצמך.');
    expect(blockErrorText(he, err('notFound'), false)).toBe('השחקן הזה כבר לא נמצא במשחק.');
    expect(blockErrorText(he, new ModerationApiError('timeout'), false)).toBe(
      'אין חיבור לשרת, והחסימה לא נשמרה. נסה שוב.',
    );
    expect(blockErrorText(he, new ModerationApiError('timeout'), true)).toBe(
      'אין חיבור לשרת, והחסימה לא בוטלה. נסה שוב.',
    );
    expect(blockErrorText(he, err('badRequest'), true)).toBe('לא הצלחנו לבטל את החסימה. נסה שוב.');
    expect(blockErrorText(t('en'), err('limitReached', { max: 100 }), false)).toMatch(
      /^You can block up to 100 players\./,
    );
  });
});
