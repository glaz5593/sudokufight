import type {
  AdminAuditEntry,
  AdminFriendRooms,
  AdminGameDetail,
  AdminGameRow,
  AdminInstallDetail,
  AdminInstallRow,
  AdminLevels,
  AdminLevelStat,
  AdminOverview,
  AdminModerationResult,
  AdminPage,
  AdminQaItem,
  AdminQaRun,
  AdminQaRunDetail,
  AdminReport,
  AdminReportedPlayer,
  AdminScreens,
  AdminStealthOverview,
  AdminStealthSwitch,
  AdminUserDetail,
  AdminUserRow,
  QaCatalog,
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
    levels: { played: 42, stars: 97 },
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

// ---- Staged practice (1.0.2) ----

/** A level nobody played, as the server sends it. */
export function emptyLevel(n: number): AdminLevelStat {
  return {
    levelId: `L${String(n).padStart(3, '0')}`,
    chapter: Math.ceil(n / 10),
    boss: n % 10 === 0,
    kind: null,
    starts: 0,
    plays: 0,
    players: 0,
    stars: [0, 0, 0, 0],
    medianMs: null,
    replayRate: null,
    midQuitRate: null,
    quitRate: null,
    firstTries: 0,
    firstTryZeroRate: null,
  };
}

/**
 * GET /levels: 300 levels in 30 chapters, a few of them played. L001 and L014 are too hard (above 60%), L002
 * sits right at 60% (not above); the gate to chapter 3 needs softening (40%), the one to chapter 4 sits at 30%.
 * `count`: only the first levels (a lighter page, for the tests that need no more; the gates stay).
 */
export function levelsFixture(count = 300): AdminLevels {
  const played: Record<number, Partial<AdminLevelStat>> = {
    1: {
      kind: 'find',
      starts: 22,
      plays: 20,
      players: 12,
      stars: [8, 4, 6, 2],
      medianMs: 10_000,
      replayRate: 0.25,
      midQuitRate: 0.1,
      quitRate: 0.05,
      firstTries: 12,
      firstTryZeroRate: 0.75,
    },
    2: {
      kind: 'fillBox',
      starts: 12,
      plays: 10,
      players: 10,
      stars: [6, 0, 2, 2],
      medianMs: 12_500,
      replayRate: 0,
      midQuitRate: 0,
      quitRate: 0,
      firstTries: 10,
      firstTryZeroRate: 0.6,
    },
    10: {
      kind: 'fillBox',
      starts: 8,
      plays: 8,
      players: 7,
      stars: [1, 2, 3, 2],
      medianMs: 18_000,
      replayRate: 0.125,
      midQuitRate: 0,
      quitRate: 0,
      firstTries: 7,
      firstTryZeroRate: 1 / 7,
    },
    14: {
      kind: 'findDuel',
      starts: 6,
      plays: 5,
      players: 5,
      stars: [4, 1, 0, 0],
      medianMs: 21_000,
      replayRate: 0,
      midQuitRate: 1 / 6,
      quitRate: 0.2,
      firstTries: 5,
      firstTryZeroRate: 0.8,
    },
  };
  const levels = Array.from({ length: count }, (_, k) => ({ ...emptyLevel(k + 1), ...played[k + 1] }));
  const gates = Array.from({ length: 29 }, (_, k) => ({
    chapter: k + 2,
    reached: 0,
    opened: 0,
    stuck: 0,
    stuckAfter3: 0,
    stuckAfter3Rate: null as number | null,
  }));
  gates[0] = { chapter: 2, reached: 10, opened: 9, stuck: 1, stuckAfter3: 1, stuckAfter3Rate: 0.1 };
  gates[1] = { chapter: 3, reached: 5, opened: 2, stuck: 3, stuckAfter3: 2, stuckAfter3Rate: 0.4 };
  gates[2] = { chapter: 4, reached: 10, opened: 6, stuck: 4, stuckAfter3: 3, stuckAfter3Rate: 0.3 };
  return { days: 30, tooHardShare: 0.6, stuckShare: 0.3, stuckAttempts: 3, levels, gates };
}

/** GET /levels before anyone played: every level and gate, empty. */
export function emptyLevelsFixture(): AdminLevels {
  return {
    ...levelsFixture(),
    levels: Array.from({ length: 300 }, (_, k) => emptyLevel(k + 1)),
    gates: levelsFixture().gates.map((g) => ({
      ...g,
      reached: 0,
      opened: 0,
      stuck: 0,
      stuckAfter3: 0,
      stuckAfter3Rate: null,
    })),
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

/** GET /rooms (1.0.4): two open rooms (one waiting, one playing), and games with friends on two days. */
export function friendRoomsFixture(now = Date.now()): AdminFriendRooms {
  return {
    counts: { lobby: 2, playing: 1 },
    rooms: [
      {
        roomId: 'kQ3fZ9xLm',
        state: 'lobby',
        gameType: 'fast',
        players: 3,
        maxPlayers: 4,
        hostId: USER_A,
        hostName: 'Moshe',
        openedAt: now - 90 * 60_000,
        startedAt: null,
      },
      {
        roomId: 'Bv7pW2nHc',
        state: 'playing',
        gameType: 'hard',
        players: 2,
        maxPlayers: 4,
        hostId: USER_B,
        hostName: 'Dana',
        openedAt: now - 3 * HOUR,
        startedAt: now - 2 * HOUR,
      },
    ],
    days: 7,
    gamesPerDay: [
      { day: daysAgo(2, now), count: 4 },
      { day: daysAgo(0, now), count: 1 },
    ],
  };
}

// ---- the stealth bot (stealth-bot.md §8) ------------------------------------------------------------------------

export const PERSONA_A = 'b7e1c2d3-0000-4000-8000-0000000000a1';

/** The overview's stealth bot: 12 of 40 ranked games, 6 wins of 9 (67%: off the 45%–55% target). */
export function stealthOverview(now = Date.now()): AdminStealthOverview {
  return {
    personas: 3,
    rankedGames: 40,
    stealthGames: 12,
    stealthPerDay: [
      { day: daysAgo(2, now), count: 5 },
      { day: daysAgo(0, now), count: 7 },
    ],
    wins: 6,
    losses: 3,
    winRate: 6 / 9,
    wait: { stealth: { games: 10, avgSec: 14.2 }, people: { games: 20, avgSec: 6.5 } },
    reports: 3,
    blocks: 1,
    returned: { stealth: { games: 8, returned: 6 }, people: { games: 20, returned: 10 } },
    closeCalls: 2,
  };
}

/** GET /stealth: the switch on a server with the stealth bot. */
export function stealthSwitchFixture(over: Partial<AdminStealthSwitch> = {}): AdminStealthSwitch {
  return { enabled: true, on: false, changedAt: null, changedBy: null, ...over };
}

/** A persona as the users list shows it (kind=persona). */
export function personaRow(over: Partial<AdminUserRow> = {}, now = Date.now()): AdminUserRow {
  return userRow(
    {
      id: PERSONA_A,
      displayName: 'Noa_K',
      email: null,
      country: 'IL',
      avatarId: 'lava-lamp',
      createdAt: now - 5 * DAY,
      lastSeen: null,
      games: 9,
      bestRating: 1234,
      openReports: 1,
      persona: true,
      ...over,
    },
    now,
  );
}

// ---- The QA module (qa-module/plan.md) ------------------------------------------------------------------

/** GET /qa/catalog: two categories (friends, staged practice). */
export function qaCatalogFixture(): QaCatalog {
  const task = (id: string, title: string) => ({
    id,
    title,
    steps: ['פותחים את האפליקציה', 'לוחצים על הכפתור'],
    expected: ['המסך נפתח'],
    who: 'both' as const,
  });
  return {
    catalogVersion: 1,
    categories: [
      {
        id: 'friends',
        title: 'חברים',
        subcategories: [
          {
            id: 'rooms',
            title: 'חדרים',
            tasks: [task('friends-room-open', 'פתיחת חדר'), task('friends-join', 'הצטרפות')],
          },
        ],
      },
      {
        id: 'practice',
        title: 'אימון בשלבים',
        subcategories: [{ id: 'gates', title: 'שערים', tasks: [task('practice-gate', 'מעבר שער')] }],
      },
    ],
  };
}

/** A run of the runs list (GET /qa/runs). */
export function qaRunFixture(over: Partial<AdminQaRun> = {}, now = Date.now()): AdminQaRun {
  return {
    id: 7,
    title: 'Friends on the Pixel',
    appVersion: '1.0.5',
    device: 'Pixel 7',
    platform: 'android',
    engineVersion: '1.0.0',
    catalogVersion: 1,
    filter: { who: 'all', categories: null },
    status: 'open',
    createdBy: 'moshe@example.com',
    createdAt: now - 2 * HOUR,
    closedBy: null,
    closedAt: null,
    counts: { total: 12, untested: 4, pass: 5, partial: 1, fail: 2, openBugs: 2, handled: 1 },
    ...over,
  };
}

/** A task of a run, untested. */
export function qaItemFixture(over: Partial<AdminQaItem> = {}): AdminQaItem {
  return {
    taskId: 'friends-room-open',
    position: 0,
    categoryId: 'friends',
    categoryTitle: 'Friends',
    subcategoryId: 'rooms',
    subcategoryTitle: 'Rooms',
    title: 'Open a room',
    steps: ['Open the app', 'Tap "Play with friends"'],
    expected: ['A room code shows', 'The share button works'],
    who: 'moshe',
    source: null,
    result: 'untested',
    actual: null,
    note: null,
    testedBy: null,
    testedAt: null,
    bugStatus: null,
    fixNote: null,
    fixedIn: null,
    handledBy: null,
    handledAt: null,
    ...over,
  };
}

/**
 * GET /qa/runs/7: three tasks: one untested, one passed (another subcategory), and a bug Claude handled (another
 * category).
 */
export function qaRunDetailFixture(over: Partial<AdminQaRunDetail> = {}, now = Date.now()): AdminQaRunDetail {
  return {
    ...qaRunFixture(
      { counts: { total: 3, untested: 1, pass: 1, partial: 0, fail: 1, openBugs: 0, handled: 1 } },
      now,
    ),
    items: [
      qaItemFixture(),
      qaItemFixture({
        taskId: 'friends-join',
        position: 1,
        subcategoryId: 'joining',
        subcategoryTitle: 'Joining',
        title: 'Join by code',
        who: 'claude',
        result: 'pass',
        testedBy: 'claude',
        testedAt: now - HOUR,
      }),
      qaItemFixture({
        taskId: 'practice-gate',
        position: 2,
        categoryId: 'practice',
        categoryTitle: 'Staged practice',
        subcategoryId: 'gates',
        subcategoryTitle: 'Gates',
        title: 'Pass a gate',
        who: 'both',
        result: 'fail',
        actual: 'The gate stayed shut\nafter three stars',
        testedBy: 'moshe@example.com',
        testedAt: now - HOUR,
        bugStatus: 'handled',
        fixNote: 'Counted the stars again\non the server',
        fixedIn: '1.0.6',
        handledBy: 'claude',
        handledAt: now - 30 * 60_000,
      }),
    ],
    ...over,
  };
}
