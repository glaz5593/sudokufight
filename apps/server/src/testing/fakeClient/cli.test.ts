import { FAKE_CLIENT_USAGE, type FakeClientCli, formatSummary, parseFakeClientArgs } from './cli';
import type { FakeClientSummary } from './client';

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

  it('trouble, in seconds from the start', () => {
    expect(
      run('--code XVGWGD --drop-after 10 --drop-for 2.5 --leave-after 30 --surrender-after 0.5').options
        .trouble,
    ).toEqual({ dropAfterMs: 10_000, dropForMs: 2500, leaveAfterMs: 30_000, surrenderAfterMs: 500 });
    expect(run('--code XVGWGD --drop-after 3').options.trouble).toEqual({ dropAfterMs: 3000 });
    expect(run('--code XVGWGD').options.trouble).toBeUndefined();
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
  ])('refuses %j', (line, message) => {
    expect(error(line)).toContain(message);
  });

  it('--help and -h', () => {
    expect(parse('--help')).toEqual({ kind: 'help' });
    expect(parse('--code XVGWGD -h')).toEqual({ kind: 'help' });
    for (const flag of ['--drop-after', '--surrender-after', '--leave-after', '--speed', '--level', '--json'])
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
