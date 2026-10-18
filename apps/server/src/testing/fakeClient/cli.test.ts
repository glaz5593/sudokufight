import { exitCodeOf, FAKE_CLIENT_USAGE, type FakeClientCli, formatSummary, parseFakeClientArgs } from './cli';
import type { FakeClientSummary, FakeMatchSummary } from './client';

const parse = (line: string) => parseFakeClientArgs(line.split(' ').filter(Boolean), () => 42);

function run(line: string): FakeClientCli {
  const r = parse(line);
  if (r.kind !== 'run') throw new Error(`expected options, got ${JSON.stringify(r)}`);
  return r.cli;
}

function error(line: string): string {
  const r = parse(line);
  if (r.kind !== 'error') throw new Error(`expected an error, got ${r.kind}`);
  return r.error;
}

describe('parseFakeClientArgs', () => {
  it('joins by code, as typed, with the defaults', () => {
    expect(run('--code xvg-wgd')).toEqual({
      options: {
        url: 'ws://localhost:2567',
        name: 'Fake142',
        id: 'fake-Fake142',
        code: 'XVGWGD',
        level: 3,
        thinkScale: 1,
        interfere: true,
        react: true,
        pingEveryMs: 1000,
        verbose: false,
      },
      json: false,
      quiet: false,
    });
  });

  it('creates a room with its own settings', () => {
    const { options } = run(
      '--create --code tst-234 --game-type hard --players 3 --grace 5 --rules {"thinkTimeMs":5000,"graceMs":1}',
    );
    expect(options.create).toEqual({
      gameType: 'hard',
      playerCount: 3,
      code: 'TST234',
      rules: { thinkTimeMs: 5000, graceMs: 5000 }, // --grace wins
    });
    expect(options.code).toBeUndefined();
    expect(run('--create').options.create).toEqual({ gameType: 'fast', playerCount: 2 });
  });

  it('--soft-grace: the soft phase of a lost connection [D42], in seconds (0 turns it off)', () => {
    expect(run('--create --soft-grace 2.5 --grace 3').options.create?.rules).toEqual({
      softGraceMs: 2500,
      graceMs: 3000,
    });
    expect(run('--create --soft-grace 0').options.create?.rules).toEqual({ softGraceMs: 0 });
    // It wins over --rules, as --grace does.
    expect(run('--create --rules {"softGraceMs":9000} --soft-grace=1').options.create?.rules).toEqual({
      softGraceMs: 1000,
    });
  });

  it('every option, also as --flag=value', () => {
    const cli = run(
      '--url=wss://staging.example.dev --code XVGWGD --name משה_1 --id moshe-1 --level=5 --speed 20 --seed 9 ' +
        '--ping-every 500 --no-interfere --no-react --json --quiet --verbose',
    );
    expect(cli).toEqual({
      options: {
        url: 'wss://staging.example.dev',
        name: 'משה_1',
        id: 'moshe-1',
        code: 'XVGWGD',
        level: 5,
        thinkScale: 0.05,
        seed: 9,
        interfere: false,
        react: false,
        pingEveryMs: 500,
        verbose: true,
      },
      json: true,
      quiet: true,
    });
  });

  it('--legacy-app: join as app 1.0.0, declaring no interference kinds [D47]', () => {
    expect(run('--queue fast-2p --legacy-app').options.legacyApp).toBe(true);
    expect(run('--code XVGWGD --legacy-app').options.legacyApp).toBe(true);
    expect(run('--create --legacy-app').options.legacyApp).toBe(true);
    // By default it declares every kind, as the app does (the option is left out).
    expect(run('--queue fast-2p').options).not.toHaveProperty('legacyApp');
    expect(parse('--code XVGWGD --legacy-app=yes')).toEqual({
      kind: 'error',
      error: '--legacy-app takes no value',
    });
  });

  it('trouble, in seconds from the start', () => {
    expect(
      run('--code XVGWGD --drop-after 10 --drop-for 2.5 --leave-after 30 --surrender-after 0.5').options
        .trouble,
    ).toEqual({ dropAfterMs: 10_000, dropForMs: 2500, leaveAfterMs: 30_000, surrenderAfterMs: 500 });
    expect(run('--code XVGWGD --drop-after 3').options.trouble).toEqual({ dropAfterMs: 3000 });
    expect(run('--code XVGWGD').options.trouble).toBeUndefined();
  });

  it('--queue: a ranked game with an account (dev token of --id by default), registered when new', () => {
    const { options } = run('--queue fast-2p --name Ana --speed 20');
    expect(options).toEqual({
      url: 'ws://localhost:2567',
      name: 'Ana',
      id: 'fake-Ana',
      queue: { queueKey: 'fast-2p' },
      level: 3,
      thinkScale: 0.05,
      interfere: true,
      react: true,
      pingEveryMs: 1000,
      verbose: false,
    });
    expect(options.code).toBeUndefined();
    expect(options.create).toBeUndefined();
  });

  it('--queue with its own options', () => {
    expect(
      run('--queue normal-2p --token eyJ.abc.def --avatar lava-lamp --country us --keep-searching').options
        .queue,
    ).toEqual({
      queueKey: 'normal-2p',
      token: 'eyJ.abc.def',
      avatarId: 'lava-lamp',
      country: 'US',
      keepSearching: true,
    });
    expect(run('--queue hard-2p --no-show').options.queue).toEqual({ queueKey: 'hard-2p', noShow: true });
    // Any queue key is taken: the server says which queues are open (all of them since stage 10).
    expect(run('--queue fast-4p').options.queue).toEqual({ queueKey: 'fast-4p' });
    expect(run('--queue fast-2p --drop-in-countdown 1.5').options.trouble).toEqual({
      dropInCountdownForMs: 1500,
    });
  });

  it('stage 10: --account plays a room as an account; --rated makes a rated room (accounts only)', () => {
    expect(run('--create --rated --players 4 --game-type normal').options).toMatchObject({
      create: { gameType: 'normal', playerCount: 4, rated: true },
      account: {},
    });
    expect(
      run('--code XVGWGD --account --token eyJ.abc.def --avatar lava-lamp --country us').options,
    ).toMatchObject({
      code: 'XVGWGD',
      account: { token: 'eyJ.abc.def', avatarId: 'lava-lamp', country: 'US' },
    });
    expect(run('--code XVGWGD').options.account).toBeUndefined();
  });

  it('a Hebrew name gets an id a dev user id can hold', () => {
    expect(run('--code XVGWGD --name משה').options.id).toBe('fake-___');
  });

  it.each([
    ['', 'give --code'],
    ['--code ABC123', 'not a room code'], // 1 is not in the alphabet
    ['--code XVGWGD --name ab', '--name'],
    ['--code XVGWGD --id a.b', '--id'],
    ['--code XVGWGD --level 6', '--level'],
    ['--code XVGWGD --level 2.5', '--level: a whole number'],
    ['--code XVGWGD --speed 0', '--speed'],
    ['--code XVGWGD --speed fast', '--speed'],
    ['--code XVGWGD --players 3', '--players goes with --create'],
    ['--code XVGWGD --rules {}', '--rules goes with --create'],
    ['--code XVGWGD --soft-grace 1', '--soft-grace goes with --create'],
    ['--create --soft-grace 61', '--soft-grace: a number from 0 to 60'],
    ['--create --soft-grace -1', '--soft-grace'],
    ['--create --rules nope', '--rules: not JSON'],
    ['--create --rules [1]', '--rules: a JSON object'],
    ['--create --game-type quick', '--game-type'],
    ['--create --players 5', '--players'],
    ['--code XVGWGD --drop-for 2', '--drop-for goes with --drop-after'],
    ['--code XVGWGD --drop-after -1', '--drop-after'],
    ['--code XVGWGD --ping-every 50', '--ping-every'],
    ['--code XVGWGD --url localhost:2567', '--url'],
    ['--code XVGWGD --colour red', 'unknown option --colour'],
    ['--code', '--code needs a value'],
    ['--name --create', '--name needs a value'],
    ['--create --json=yes', '--json takes no value'],
    ['--create ABC', 'unexpected argument'],
    ['--queue fast', '--queue: one of fast-2p'],
    ['--queue fast-5p', '--queue: one of'],
    ['--queue fast-2p --code XVGWGD', 'not with --code or --create'],
    ['--queue fast-2p --create', 'not with --code or --create'],
    ['--code XVGWGD --token abc', '--token goes with --queue or --account'],
    ['--code XVGWGD --rated', '--rated goes with --create'],
    ['--queue fast-2p --account', '--queue plays as an account already'],
    ['--code XVGWGD --keep-searching', '--keep-searching goes with --queue'],
    ['--create --no-show', '--no-show goes with --queue'],
    ['--create --drop-in-countdown 1', '--drop-in-countdown goes with --queue'],
    ['--queue fast-2p --avatar av36', '--avatar'],
    ['--queue fast-2p --country Israel', '--country'],
    ['--queue fast-2p --no-show --drop-in-countdown 1', 'a no-show never gets to the countdown'],
  ])('refuses %j', (line, message) => {
    expect(error(line)).toContain(message);
  });

  it('--help and -h', () => {
    expect(parse('--help')).toEqual({ kind: 'help' });
    expect(parse('--code XVGWGD -h')).toEqual({ kind: 'help' });
    for (const flag of [
      '--drop-after',
      '--surrender-after',
      '--leave-after',
      '--speed',
      '--level',
      '--json',
      '--queue',
      '--token',
      '--keep-searching',
      '--no-show',
      '--drop-in-countdown',
      '--soft-grace',
    ])
      expect(FAKE_CLIENT_USAGE).toContain(flag);
  });
});

describe('formatSummary', () => {
  const base: FakeClientSummary = {
    playerId: 'fake-Fake1',
    name: 'Fake1',
    code: 'XVGWGD',
    outcome: 'over',
    error: null,
    endReason: 'boardComplete',
    place: 1,
    players: 2,
    status: 'active',
    score: 45.5,
    mistakes: 1,
    correct: 24,
    ranking: [
      { playerId: 'fake-Fake1', seat: 0, place: 1, score: 45.5, mistakes: 1, correct: 24, status: 'active' },
      { playerId: 'moshe', seat: 1, place: 2, score: 30, mistakes: 3, correct: 21, status: 'active' },
    ],
    rtt: { count: 210, p50Ms: 31, p95Ms: 62, maxMs: 140 },
    actions: { count: 52, p50Ms: 35, p95Ms: 70, maxMs: 90 },
    actionsLost: 0,
    clockOffsetMs: -12,
    resyncs: [
      { via: 'reconnect', downMs: 5012, reconnectMs: 120, syncMs: 160, seq: 40, startedAt: 0, syncedAt: 160 },
    ],
    solveMs: 2.1,
    solutionMatches: true,
    seqGaps: 0,
    duplicates: 0,
    leaks: 0,
    rejected: { cellTaken: 2 },
    level: 3,
    seed: 77,
    match: null,
  };

  it('the result, the ranking, the measures (spec §18) and the returns', () => {
    expect(formatSummary(base)).toEqual([
      'result: place 1 of 2 (boardComplete), score 45.5, 24 correct, 1 mistake',
      'ranking: 1. fake-Fake1 45.5 (active), 2. moshe 30 (active)',
      'RTT: p50 31 ms, p95 62 ms, max 140 ms (210 pings; target p95 <= 150 ms)',
      'actions answered: p50 35 ms, p95 70 ms, max 90 ms (52 actions, 0 lost)',
      'clock offset (server - here): -12 ms',
      'return 1 (reconnect): down 5.0 s, reconnected in 120 ms, in sync in 160 ms (target <= 2000 ms)',
      "solution: worked out from the givens in 2.1 ms, the same as the server's",
      'refused: cellTaken 2',
      'outcome: over; room XVGWGD, level 3, seed 77',
    ]);
  });

  it('without a result, and when something is wrong', () => {
    const lines = formatSummary({
      ...base,
      outcome: 'lostConnection',
      error: 'could not come back',
      place: null,
      ranking: null,
      endReason: null,
      rtt: { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      actions: { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      clockOffsetMs: null,
      resyncs: [],
      solutionMatches: false,
      seqGaps: 1,
      rejected: {},
    });
    expect(lines).toEqual([
      'no result (lostConnection): last seen with score 45.5, 1 mistake',
      'RTT: no pongs',
      'solution: NOT the same as the server revealed',
      'PROBLEM: 1 seq gaps, 0 snapshots with the solution',
      'outcome: lostConnection (could not come back); room XVGWGD, level 3, seed 77',
    ]);
  });
});

describe('a ranked run (--queue)', () => {
  const match: FakeMatchSummary = {
    queueKey: 'fast-2p',
    ranges: [50, 75, 100],
    searchedMs: 10_400,
    timeouts: 0,
    matchId: 'm-1',
    rematch: false,
    opponents: [
      { id: 'u-ben', name: 'Ben', avatarId: 'balloon', country: 'IL', rating: 1216, provisional: true },
    ],
    cancelled: null,
    registered: false,
    ratingBefore: { key: 'fast', rating: 1200, games: 0, provisional: true, peak: 1200 },
    rating: { key: 'fast', before: 1200, after: 1233, delta: 33, provisional: true },
    ratingAfter: { key: 'fast', rating: 1233, games: 1, provisional: true, peak: 1233 },
  };
  const summary: FakeClientSummary = {
    playerId: 'u-ana',
    name: 'Ana',
    code: 'K7M2PQ',
    outcome: 'over',
    error: null,
    endReason: 'boardComplete',
    place: 1,
    players: 2,
    status: 'active',
    score: 12,
    mistakes: 0,
    correct: 3,
    ranking: null,
    rtt: { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
    actions: { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
    actionsLost: 0,
    clockOffsetMs: null,
    resyncs: [],
    solveMs: null,
    solutionMatches: null,
    seqGaps: 0,
    duplicates: 0,
    leaks: 0,
    rejected: {},
    level: 3,
    seed: 5,
    match,
  };

  it('prints the match, the rating by the result, and the rating before and after (GET /v1/me)', () => {
    const ranking = [
      { playerId: 'u-ana', seat: 0, place: 1, score: 12, mistakes: 0, correct: 3, status: 'active' as const },
      { playerId: 'u-ben', seat: 1, place: 2, score: 4, mistakes: 1, correct: 1, status: 'active' as const },
    ];
    // The ranking by name (the ids are users.id).
    expect(formatSummary({ ...summary, ranking })[4]).toBe('ranking: 1. Ana 12 (active), 2. Ben 4 (active)');
    expect(formatSummary(summary).slice(0, 4)).toEqual([
      'match fast-2p: vs Ben (1216, provisional) after 10.4 s, range ±50 to ±100',
      'rating fast by the result: 1200 -> 1233 (+33, provisional: K doubled)',
      'account signed in: fast 1200 (0 games, provisional); stored after the game: 1233 (1 game, provisional)',
      'result: place 1 of 2 (boardComplete), score 12, 3 correct, 0 mistakes',
    ]);
  });

  it('a search that timed out, and a match called off', () => {
    const lonely: FakeClientSummary = {
      ...summary,
      outcome: 'timeout',
      code: '',
      place: null,
      score: null,
      endReason: null,
      match: {
        ...match,
        ranges: [50, 75, 300],
        searchedMs: 60_000,
        timeouts: 1,
        matchId: null,
        opponents: [],
        registered: true,
        rating: null,
        ratingAfter: null,
      },
    };
    const lines = formatSummary(lonely);
    expect(lines[0]).toBe('search fast-2p: no game after 60.0 s, range ±50 to ±300, 1 timeout');
    expect(lines[1]).toBe('account registered now: fast 1200 (0 games, provisional)');
    expect(lines.at(-1)).toBe('outcome: timeout; level 3, seed 5');

    const off = formatSummary({
      ...summary,
      outcome: 'cancelled',
      place: null,
      ranking: null,
      match: { ...match, cancelled: 'noShow', rating: null, ratingAfter: null },
    });
    expect(off.slice(0, 2)).toEqual([
      'search fast-2p: no game after 10.4 s, range ±50 to ±100',
      'the match vs Ben (1216, provisional) was called off (noShow)',
    ]);
  });

  it('exit codes: 0 when it ended as asked', () => {
    const queue = { queueKey: 'fast-2p' as const };
    const code = (outcome: FakeClientSummary['outcome'], noShow = false) =>
      exitCodeOf({ ...summary, outcome }, { url: 'ws://x', name: 'Ana', queue: { ...queue, noShow } });
    expect(code('over')).toBe(0);
    expect(code('left')).toBe(0);
    expect(code('timeout')).toBe(0);
    expect(code('cancelled', true)).toBe(0); // --no-show: the match was meant to fall through
    expect(code('cancelled')).toBe(1); // this player missed the ready check
    for (const outcome of ['error', 'lostConnection', 'closed', 'stopped'] as const)
      expect(code(outcome)).toBe(1);
  });
});
