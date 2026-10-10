import {
  fillDays,
  formatDuration,
  formatOffset,
  formatPercent,
  formatRelative,
  formatSigned,
  formatWait,
  niceScale,
} from './format';

const DAY = 86_400_000;

describe('format', () => {
  it('relative times read naturally in both languages', () => {
    const now = Date.UTC(2026, 9, 9, 12);
    expect(formatRelative('he', now - 3 * DAY - 3_600_000, now)).toBe('לפני 3 ימים');
    expect(formatRelative('he', now - 3_600_000, now)).toBe('לפני שעה');
    expect(formatRelative('he', now - 2 * 3_600_000, now)).toBe('לפני שעתיים');
    expect(formatRelative('he', now - 14 * DAY, now)).toBe('לפני שבועיים');
    expect(formatRelative('en', now - 3 * DAY, now)).toBe('3 days ago');
    expect(formatRelative('en', now - 2 * 3_600_000, now)).toBe('2 hours ago');
    expect(formatRelative('en', now - 10_000, now)).toBe('now');
    expect(formatRelative('en', now - 10 * DAY, now)).toBe('last week');
  });

  it('durations and game offsets are clocks', () => {
    expect(formatDuration(245_000)).toBe('4:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatOffset(7_300)).toBe('0:07.3');
    expect(formatOffset(760_000)).toBe('12:40.0');
    expect(formatOffset(-4_294)).toBe('\u22120:04.3');
    expect(formatOffset(-20)).toBe('0:00.0');
  });

  it('signs and percents', () => {
    expect(formatSigned('en', 12)).toBe('+12');
    expect(formatSigned('en', -8)).toBe('\u22128');
    expect(formatSigned('en', 0)).toBe('0');
    expect(formatPercent('en', 0.4)).toBe('40%');
  });

  it('waits are in seconds, then whole minutes', () => {
    expect(formatWait('en', 12_000)).toBe('12 seconds');
    expect(formatWait('en', 100_000)).toBe('2 minutes');
    expect(formatWait('he', 60_000)).toBe('60 שניות');
  });

  it('fillDays lists every day of the period, oldest first, with 0 for the missing ones', () => {
    const filled = fillDays(
      [
        { day: '2026-10-07', count: 3 },
        { day: '2026-10-09', count: 1 },
      ],
      4,
      '2026-10-09',
    );
    expect(filled).toEqual([
      { day: '2026-10-06', count: 0 },
      { day: '2026-10-07', count: 3 },
      { day: '2026-10-08', count: 0 },
      { day: '2026-10-09', count: 1 },
    ]);
  });

  it('fillDays follows the server when its day is already ahead, and crosses months', () => {
    expect(fillDays([{ day: '2026-11-01', count: 5 }], 3, '2026-10-31').map((p) => p.day)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('niceScale picks a round top and a whole step', () => {
    expect(niceScale(37)).toEqual({ top: 40, step: 10 });
    expect(niceScale(3)).toEqual({ top: 3, step: 1 });
    expect(niceScale(0)).toEqual({ top: 1, step: 1 });
    expect(niceScale(1234)).toEqual({ top: 1500, step: 500 });
  });
});
