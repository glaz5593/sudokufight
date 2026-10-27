import { readFileSync } from 'node:fs';
import path from 'node:path';

import i18n from '../../../i18n';
import { entryLabel, type ProgressT } from '../../../screens/leaderboard/leaderboardModel';
import { shownName, TEMPORARY_NAME_PREFIX, temporaryNameDigits } from '../temporaryName';
import { displayName, leadLabel, type PlayerT } from '../wording';

/**
 * Localization plan 0יב, D113: the temporary name of a reset player ("שחקן12345", spec §3.5) is stored in Hebrew
 * on the server; every viewer reads it in their own language.
 */

// Both languages' strings, whatever language the tests start in (a language loads when it is first used).
beforeAll(() => i18n.loadLanguages(['he', 'en']));

const heT = i18n.getFixedT('he', 'player') as PlayerT;
const enT = i18n.getFixedT('en', 'player') as PlayerT;

describe('a temporary name', () => {
  it('is the server’s: its prefix and five digits (apps/server/src/moderation/admin.ts)', () => {
    const admin = readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'server', 'src', 'moderation', 'admin.ts'),
      'utf8',
    );
    expect(admin).toContain(`export const TEMPORARY_NAME_PREFIX = '${TEMPORARY_NAME_PREFIX}';`);
    // 10 000 + 0…89 999: always five digits.
    expect(admin).toContain('`${TEMPORARY_NAME_PREFIX}${10_000 + random(90_000)}`');
  });

  it('is recognised by its exact shape only', () => {
    expect(temporaryNameDigits('שחקן12345')).toBe('12345');
    expect(temporaryNameDigits('שחקן10000')).toBe('10000');
    for (const other of [
      'שחקן1234',
      'שחקן123456',
      'שחקן 12345',
      'אשחקן12345',
      'Player12345',
      'MosheG',
      'שחקן',
    ])
      expect({ other, digits: temporaryNameDigits(other) }).toEqual({ other, digits: null });
  });

  it('shows in the viewer’s language; Hebrew exactly as stored; any other name as it is', () => {
    expect(shownName('שחקן48213', heT)).toBe('שחקן48213');
    expect(shownName('שחקן48213', enT)).toBe('Player48213');
    expect(shownName('MosheG', enT)).toBe('MosheG');
    expect(shownName('שחקן', enT)).toBe('שחקן');
  });

  it('wherever the player components name a player (displayName, the lead bar)', () => {
    expect(displayName({ name: 'שחקן48213', isBot: false }, enT)).toBe('Player48213');
    expect(displayName({ name: 'שחקן48213', isBot: false }, heT)).toBe('שחקן48213');
    expect(displayName({ name: null, isBot: false }, enT)).toBe('Player');
    expect(displayName({ name: null, isBot: true }, enT)).toBe('Bot');
    expect(displayName({ name: 'Dana', isBot: false }, heT)).toBe('Dana');
    const lead = {
      segments: [],
      splitShare: 0.5,
      leader: { playerId: 'p2', colorIndex: 1, name: 'שחקן48213', gap: 15.5 },
    } as unknown as Parameters<typeof leadLabel>[0];
    expect(leadLabel(lead, enT)).toContain('Player48213');
  });

  it('with any namespace’s t(): the leaderboard’s rows, a player’s card, "בחר שם חדש"', () => {
    const progressEn = i18n.getFixedT('en', 'progress') as ProgressT;
    const progressHe = i18n.getFixedT('he', 'progress') as ProgressT;
    expect(shownName('שחקן48213', i18n.getFixedT('en', 'moderation'))).toBe('Player48213');
    const entry = {
      rank: 7,
      displayName: 'שחקן48213',
      country: null,
      league: null,
      rating: 1200,
      level: 3,
      provisional: false,
    } as unknown as Parameters<typeof entryLabel>[0];
    expect(entryLabel(entry, progressEn, 'en', false)).toContain('Player48213');
    expect(entryLabel(entry, progressEn, 'en', false)).not.toContain('שחקן');
    expect(entryLabel(entry, progressHe, 'he', true)).toContain('שחקן48213');
  });
});
