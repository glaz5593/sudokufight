import type {
  AdminAuditEntry,
  AdminGameDetail,
  AdminGameRow,
  AdminInstallDetail,
  AdminInstallRow,
  AdminOverview,
  AdminModerationResult,
  AdminPage,
  AdminReport,
  AdminReportedPlayer,
  AdminScreens,
  AdminUserDetail,
  AdminUserRow,
} from '@sudoku-fight/protocol';

import { dayToUtcMs, localDay, utcMsToDay } from '../format';

/** Known answers of the admin API, shaped by packages/protocol/src/admin.ts. Times are relative to now. */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** `n` days before today ('YYYY-MM-DD', browser zone). */
export function daysAgo(n: number, now = Date.now()): string {
  return utcMsToDay(dayToUtcMs(localDay(now)) - n * DAY);
}

export function overviewFixture(now = Date.now()): AdminOverview {
  return {
    days: 7,
    totals: { installs: 1234, users: 321, games: 87, practiceGames: 456, events: 98765 },
    // Days 5, 3 and 0 ago; the others are missing and count 0.
    installsPerDay: [
      { day: daysAgo(5, now), count: 4 },
      { day: daysAgo(3, now), count: 9 },
      { day: daysAgo(0, now), count: 2 },
    ],
    activePerDay: [0, 1, 2, 3, 4, 5, 6].map((n) => ({ day: daysAgo(6 - n, now), count: 10 + n })),
    activeToday: 16,
    activeThisWeek: 52,
    gamesPerDay: [{ day: daysAgo(1, now), count: 7 }],
    practicePerDay: [],
  };
}

export const INSTALL_A = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
export const INSTALL_B = 'a1b2c3d4-0000-4000-8000-000000000002';
export const USER_A = 'u-1111-2222';
export const GAME_A = 'g-7777-8888';
/** A reporter, and a second reported player (suspended, waiting for a new name). */
export const USER_B = 'u-3333-4444';
export const USER_C = 'u-5555-6666';

export function installRow(over: Partial<AdminInstallRow> = {}, now = Date.now()): AdminInstallRow {
  return {
    id: INSTALL_A,
    platform: 'android',
    appVersion: '0.1.0',
    firstSeen: now - 20 * DAY,
    lastSeen: now - 3 * DAY - HOUR,
    userId: USER_A,
    userName: 'Moshe',
    events: 140,
    ...over,
  };
}

export function installsPage(page = 1, total = 120, now = Date.now()): AdminPage<AdminInstallRow> {
  return {
    items: [
      installRow({}, now),
      installRow({ id: INSTALL_B, platform: 'ios', userId: null, userName: null, events: 3 }, now),
    ],
    page,
    pageSize: 50,
    total,
  };
}

export function installDetail(now = Date.now()): AdminInstallDetail {
  return {
    ...installRow({}, now),
    recentEvents: [
      { id: 'e2', name: 'screen_view', props: { screen: 'game' }, tClient: now - DAY, tServer: now - DAY },
      { id: 'e1', name: 'app_open', props: {}, tClient: now - DAY - 5000, tServer: now - DAY },
    ],
    sessions: [
      { startedAt: now - DAY - 5000, endedAt: now - DAY + 245_000, screens: ['home', 'lobby', 'game'] },
    ],
  };
}

export function userRow(over: Partial<AdminUserRow> = {}, now = Date.now()): AdminUserRow {
  return {
    id: USER_A,
    displayName: 'Moshe',
    email: 'moshe@example.com',
    country: 'IL',
    avatarId: 'lava-lamp',
    createdAt: now - 30 * DAY,
    deletedAt: null,
    lastSeen: now - 2 * HOUR,
    games: 12,
    bestRating: 1512,
    suspendedAt: null,
    nameResetRequired: false,
    openReports: 3,
    ...over,
  };
}

export function userDetail(now = Date.now()): AdminUserDetail {
  return {
    ...userRow({}, now),
    xp: 2350,
    level: 5,
    ratings: [{ key: 'fast', rating: 1512, games: 12, provisional: false, peak: 1530 }],
    stats: { games: 12, wins: 7, losses: 5, winRate: 7 / 12, avgMistakes: 1.25, avgScore: 64.5 },
    recentGames: [
      {
        gameId: GAME_A,
        mode: 'ranked',
        gameType: 'fast',
        playerCount: 2,
        startedAt: now - DAY,
        endedAt: now - DAY + 312_000,
        place: 1,
        finalScore: 71.5,
        mistakes: 1,
        status: 'active',
        ratingKey: 'fast',
        ratingBefore: 1500,
        ratingAfter: 1512,
      },
    ],
    installs: [installRow({}, now)],
    cheatFlags: [{ gameId: GAME_A, reason: 'fastThinking', value: 845.5, createdAt: now - DAY + 312_000 }],
  };
}

export function gameRow(now = Date.now()): AdminGameRow {
  return {
    id: GAME_A,
    mode: 'ranked',
    gameType: 'fast',
    playerCount: 2,
    puzzleId: 'pz-42',
    startedAt: now - DAY,
    endedAt: now - DAY + 312_000,
    endReason: 'boardComplete',
    players: [
      {
        userId: null,
        displayName: null,
        seat: 1,
        finalScore: 40,
        mistakes: 3,
        place: 2,
        status: 'active',
        ratingKey: null,
        ratingBefore: null,
        ratingAfter: null,
      },
      {
        userId: USER_A,
        displayName: 'Moshe',
        seat: 0,
        finalScore: 71.5,
        mistakes: 1,
        place: 1,
        status: 'active',
        ratingKey: 'fast',
        ratingBefore: 1500,
        ratingAfter: 1512,
      },
    ],
  };
}

export function gameDetail(now = Date.now()): AdminGameDetail {
  const row = gameRow(now);
  return {
    ...row,
    rules: { mode: 'ranked', thinkTimeMs: 8000 },
    // Wall-clock times, as the server stores them; the countdown comes before the start.
    events: [
      { seq: 1, tMs: row.startedAt - 4300, type: 'gameCreated', payload: { config: 'x'.repeat(200) } },
      { seq: 2, tMs: row.startedAt, type: 'gameStarted', payload: {} },
      { seq: 3, tMs: row.startedAt + 7300, type: 'placed', payload: { cell: 'D5', digit: 7 } },
    ],
  };
}

export function screensFixture(): AdminScreens {
  return {
    days: 30,
    sessionGapMinutes: 30,
    goneAfterDays: 7,
    sessions: 200,
    screens: [
      { screen: 'home', views: 500, installs: 120, exits: 40, exitRate: 0.2, lastScreenOfGone: 5 },
      { screen: 'game', views: 300, installs: 90, exits: 80, exitRate: 0.5, lastScreenOfGone: 12 },
      { screen: 'register', views: 150, installs: 110, exits: 90, exitRate: 0.75, lastScreenOfGone: 30 },
      { screen: 'lobby', views: 400, installs: 100, exits: 10, exitRate: 0.05, lastScreenOfGone: 1 },
    ],
  };
}

// ---- Moderation (spec §3.5) ----

export function report(over: Partial<AdminReport> = {}, now = Date.now()): AdminReport {
  return {
    id: 'r-1',
    playerId: USER_A,
    reason: 'offensiveName',
    status: 'open',
    gameId: GAME_A,
    createdAt: now - 3 * HOUR,
    resolvedAt: null,
    resolvedBy: null,
    reporter: { id: USER_B, displayName: 'Dana' },
    ...over,
  };
}

/**
 * Moshe: three open reports, the oldest 50 hours old (past the 48-hour promise), one from a deleted account.
 * Rude: suspended, waiting for a new name, one open report.
 */
export function reportedPlayers(now = Date.now()): AdminReportedPlayer[] {
  return [
    {
      player: {
        id: USER_A,
        displayName: 'Moshe',
        avatarId: 'lava-lamp',
        country: 'IL',
        deletedAt: null,
        suspendedAt: null,
        nameResetRequired: false,
      },
      counts: { offensiveName: 2, cheating: 1, other: 0, total: 3, reporters: 3 },
      open: 3,
      oldestOpenAt: now - 50 * HOUR,
      lastReportedAt: now - 3 * HOUR,
      reports: [
        report({}, now),
        report(
          {
            id: 'r-3',
            reason: 'cheating',
            gameId: null,
            createdAt: now - 5 * HOUR,
            reporter: { id: 'u-gone', displayName: null },
          },
          now,
        ),
        report({ id: 'r-2', createdAt: now - 50 * HOUR, reporter: { id: 'u-gil', displayName: 'Gil' } }, now),
      ],
    },
    {
      player: {
        id: USER_C,
        displayName: 'Rude',
        avatarId: null,
        country: null,
        deletedAt: null,
        suspendedAt: now - DAY,
        nameResetRequired: true,
      },
      counts: { offensiveName: 0, cheating: 0, other: 1, total: 1, reporters: 1 },
      open: 1,
      oldestOpenAt: now - HOUR,
      lastReportedAt: now - HOUR,
      reports: [
        report({ id: 'r-4', playerId: USER_C, reason: 'other', gameId: null, createdAt: now - HOUR }, now),
      ],
    },
  ];
}

export function reportsPage(
  items: AdminReportedPlayer[] = reportedPlayers(),
  page = 1,
  total = items.length,
): AdminPage<AdminReportedPlayer> {
  return { items, page, pageSize: 20, total };
}

export function auditEntry(over: Partial<AdminAuditEntry> = {}, now = Date.now()): AdminAuditEntry {
  return {
    id: 'a-1',
    adminEmail: 'moshe@example.com',
    action: 'suspend',
    targetUserId: USER_A,
    details: {},
    createdAt: now - HOUR,
    ...over,
  };
}

/** What reset-name, suspend and unsuspend answer. */
export function moderationResult(
  user: Partial<AdminUserRow>,
  audit: Partial<AdminAuditEntry> | null,
  now = Date.now(),
): AdminModerationResult {
  return { user: userRow(user, now), audit: audit === null ? null : auditEntry(audit, now) };
}
