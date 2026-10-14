import {
  ACCOUNT_ERROR_CODES,
  ADMIN_ACTION_ERRORS,
  ADMIN_AUDIT_ACTIONS,
  ADMIN_REPORT_FILTERS,
  blockPath,
  DISMISSED_REPORT_COOLDOWN_DAYS,
  GAME_ROOM_ERRORS,
  gameRoomErrorOf,
  isReportReason,
  MATCHMAKING_ERRORS,
  matchmakingErrorOf,
  MAX_BLOCKS,
  MODERATION_ERROR_CODES,
  MODERATION_PATHS,
  MUTED_REACTION_EMOJI,
  PLAYER_ID_PATTERN,
  REPORT_REASONS,
  REPORT_RESPONSE_HOURS,
  REPORT_STATUSES,
  REPORTS_PER_HOUR,
  TELEMETRY_EVENT_NAMES,
} from './index';

/** Spec §3.5: report a player and block (UGC-PROPOSAL option A, approved 2026-10-12). */
describe('the moderation contract', () => {
  it('has the three report reasons of the proposal, and nothing else', () => {
    expect(REPORT_REASONS).toEqual(['offensiveName', 'cheating', 'other']);
    for (const r of REPORT_REASONS) expect(isReportReason(r)).toBe(true);
    for (const bad of ['spam', 'OffensiveName', '', null, undefined, 1])
      expect(isReportReason(bad)).toBe(false);
    expect(REPORT_STATUSES).toEqual(['open', 'resolved', 'dismissed']);
  });

  it('keeps the approved numbers: 48 hours, 10 reports an hour, 100 blocks; a dismissed report waits 7 days', () => {
    expect(REPORT_RESPONSE_HOURS).toBe(48);
    expect(REPORTS_PER_HOUR).toBe(10);
    expect(MAX_BLOCKS).toBe(100);
    expect(DISMISSED_REPORT_COOLDOWN_DAYS).toBe(7);
  });

  it('names the routes, and encodes a player id in a block path', () => {
    expect(MODERATION_PATHS).toEqual({
      reports: '/v1/reports',
      blocks: '/v1/me/blocks',
      block: '/v1/me/blocks/:playerId',
    });
    expect(blockPath('a b/c')).toBe('/v1/me/blocks/a%20b%2Fc');
    expect(PLAYER_ID_PATTERN.test('0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab')).toBe(true);
    expect(PLAYER_ID_PATTERN.test('../me')).toBe(false);
  });

  it('lists each error code once, with the ones the clients act on', () => {
    expect(new Set(MODERATION_ERROR_CODES).size).toBe(MODERATION_ERROR_CODES.length);
    expect(MODERATION_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'self',
        'notFound',
        'duplicate',
        'rateLimited',
        'unauthorized',
        'suspended',
        'limitReached',
      ]),
    );
  });

  it('a suspended account is a refusal of its own in the account routes, matchmaking and the game rooms', () => {
    expect(ACCOUNT_ERROR_CODES).toContain('suspended');
    expect(MATCHMAKING_ERRORS).toContain('suspended');
    expect(matchmakingErrorOf('suspended: this account is suspended')).toBe('suspended');
    expect(GAME_ROOM_ERRORS).toContain('suspended');
    expect(gameRoomErrorOf('suspended: this account is suspended')).toBe('suspended');
  });

  it('a muted reaction carries no emoji', () => {
    expect(MUTED_REACTION_EMOJI).toBe('');
  });

  it('report_sent is a telemetry event', () => {
    expect(TELEMETRY_EVENT_NAMES).toContain('report_sent');
  });

  it('has the admin filters, actions and refusals', () => {
    expect(ADMIN_REPORT_FILTERS).toEqual(['open', 'resolved', 'dismissed', 'all']);
    expect(ADMIN_AUDIT_ACTIONS).toEqual([
      'resetName',
      'suspend',
      'unsuspend',
      'resolveReport',
      'dismissReport',
    ]);
    expect(ADMIN_ACTION_ERRORS).toEqual(['notOpen', 'accountDeleted', 'googleRequired']);
  });
});
