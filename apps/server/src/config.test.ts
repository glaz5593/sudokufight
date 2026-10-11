import path from 'node:path';

import {
  ConfigError,
  DEFAULT_PGLITE_DIR,
  DEFAULT_TRACES_SAMPLE_RATE,
  DEV_ADMIN_PASSWORD,
  loadConfig,
  type LoadConfigOptions,
  parseTrustProxy,
  SERVER_VERSION,
  sentryRelease,
} from './config';

const SECRET = 's'.repeat(32);

function load(env: Record<string, string | undefined>, options: LoadConfigOptions = {}) {
  const warn = jest.fn<void, [string]>();
  const config = loadConfig(env, { warn, randomSecret: () => 'random-secret', ...options });
  return { config, warnings: warn.mock.calls.map(([m]) => m) };
}

function issuesOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env, { warn: () => {} });
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('defaults: development on port 2567, PGlite in apps/server/.data/pglite, the dev admin password', () => {
    const { config, warnings } = load({});
    expect(config).toEqual({
      nodeEnv: 'development',
      port: 2567,
      database: { kind: 'pglite', dataDir: DEFAULT_PGLITE_DIR },
      admin: {
        enabled: true,
        password: DEV_ADMIN_PASSWORD,
        sessionSecret: 'random-secret',
        devPassword: true,
      },
      adminTz: 'Asia/Jerusalem',
      trustProxy: false,
      firebaseProjectId: null,
      ratingOption: 'B',
      cheat: { thinkMs: 1200, moves: 20 },
      accountDeleteMaxAuthAgeMs: 300_000,
      progress: { practiceXpDailyCap: 1500, inviteUrl: null },
      sentry: null,
      legal: { contactEmail: null, operatorName: null },
    });
    expect(DEFAULT_PGLITE_DIR).toBe(path.resolve(__dirname, '..', '.data', 'pglite'));
    // The dev password comes with a loud warning.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ADMIN_PASSWORD is not set');
    expect(warnings[0]).toContain(DEV_ADMIN_PASSWORD);
  });

  it('treats blank values as unset', () => {
    const { config } = load({ NODE_ENV: ' ', PORT: '', DATABASE_URL: '', ADMIN_TZ: '', TRUST_PROXY: '' });
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(2567);
    expect(config.database.kind).toBe('pglite');
    expect(config.adminTz).toBe('Asia/Jerusalem');
  });

  it('under NODE_ENV=test: PGlite in memory, the dev password without the warning', () => {
    const { config, warnings } = load({ NODE_ENV: 'test' });
    expect(config.database).toEqual({ kind: 'pglite', dataDir: null });
    expect(config.admin).toMatchObject({ enabled: true, devPassword: true });
    expect(warnings).toEqual([]);
  });

  it('reads PORT', () => {
    expect(load({ PORT: '8080' }).config.port).toBe(8080);
    expect(issuesOf({ PORT: 'abc' })[0]).toMatch(/^PORT:/);
    expect(issuesOf({ PORT: '70000' })[0]).toMatch(/^PORT:/);
  });

  it('DATABASE_URL picks Postgres; it must be a postgres:// URL', () => {
    const url = 'postgres://u:p@db.internal:5432/sudoku';
    expect(load({ DATABASE_URL: url, ADMIN_PASSWORD: 'x' }).config.database).toEqual({
      kind: 'postgres',
      url,
    });
    expect(load({ DATABASE_URL: 'postgresql://h/db', ADMIN_PASSWORD: 'x' }).config.database.kind).toBe(
      'postgres',
    );
    expect(issuesOf({ DATABASE_URL: 'mysql://h/db' })[0]).toMatch(/^DATABASE_URL: must start with postgres/);
  });

  it('PGLITE_DIR: a folder (made absolute) or memory', () => {
    expect(load({ PGLITE_DIR: 'memory' }).config.database).toEqual({ kind: 'pglite', dataDir: null });
    expect(load({ PGLITE_DIR: 'memory://' }).config.database).toEqual({ kind: 'pglite', dataDir: null });
    expect(load({ PGLITE_DIR: 'tmp/db' }).config.database).toEqual({
      kind: 'pglite',
      dataDir: path.resolve('tmp/db'),
    });
  });

  describe('production', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://h/db',
      FIREBASE_PROJECT_ID: 'sudoku-fight',
      // The legal pages' contact details (stage 14; src/legal/legal.test.ts checks the warning without them).
      LEGAL_CONTACT_EMAIL: 'privacy@sudoku.example',
      LEGAL_OPERATOR_NAME: 'Sudoku Fight',
    };

    it('needs DATABASE_URL, unless PGLITE_DIR is set on purpose (with a warning)', () => {
      expect(issuesOf({ NODE_ENV: 'production' })[0]).toMatch(/^DATABASE_URL: required in production/);
      const { config, warnings } = load({ NODE_ENV: 'production', PGLITE_DIR: '/data/pglite' });
      expect(config.database).toEqual({ kind: 'pglite', dataDir: path.resolve('/data/pglite') });
      expect(warnings.some((w) => w.includes('production on PGlite'))).toBe(true);
    });

    it('enables the admin site only with a password of 12+ characters', () => {
      const ok = load({ ...prod, ADMIN_PASSWORD: 'correct horse', ADMIN_SESSION_SECRET: SECRET });
      expect(ok.config.admin).toEqual({
        enabled: true,
        password: 'correct horse',
        sessionSecret: SECRET,
        devPassword: false,
      });
      expect(ok.warnings).toEqual([]);

      const short = load({ ...prod, ADMIN_PASSWORD: 'short' });
      expect(short.config.admin).toEqual({
        enabled: false,
        reason: 'ADMIN_PASSWORD is shorter than 12 characters',
        sessionSecret: 'random-secret',
      });
      expect(short.warnings[0]).toContain('admin site disabled');

      const unset = load(prod);
      expect(unset.config.admin).toMatchObject({ enabled: false, reason: 'ADMIN_PASSWORD is not set' });
    });

    it('never falls back to the dev password', () => {
      expect(load(prod).config.admin.enabled).toBe(false);
      expect(load({ NODE_ENV: 'production', PGLITE_DIR: 'memory' }).config.admin.enabled).toBe(false);
    });

    it('refuses the dev password even when it is set on purpose: it is in the code', () => {
      const { config, warnings } = load({ ...prod, ADMIN_PASSWORD: DEV_ADMIN_PASSWORD });
      expect(config.admin).toEqual({
        enabled: false,
        reason: 'ADMIN_PASSWORD is the dev password, which is public (it is in the code)',
        sessionSecret: 'random-secret',
      });
      expect(warnings[0]).toContain('admin site disabled');
      // Outside production it is just a password.
      expect(load({ ADMIN_PASSWORD: DEV_ADMIN_PASSWORD }).config.admin).toMatchObject({
        enabled: true,
        devPassword: false,
      });
    });

    it('warns that a random session secret signs everyone out on restart', () => {
      const { config, warnings } = load({ ...prod, ADMIN_PASSWORD: 'long enough password' });
      expect(config.admin.sessionSecret).toBe('random-secret');
      expect(warnings.some((w) => w.includes('ADMIN_SESSION_SECRET is not set'))).toBe(true);
    });
  });

  it('outside production, the dev password works only with the local PGlite', () => {
    const { config, warnings } = load({ DATABASE_URL: 'postgres://h/db' });
    expect(config.admin).toMatchObject({ enabled: false });
    expect(warnings[0]).toContain('admin site disabled');
    // A password set by hand works with any database, and need not be long outside production.
    expect(load({ DATABASE_URL: 'postgres://h/db', ADMIN_PASSWORD: 'dev' }).config.admin).toMatchObject({
      enabled: true,
      password: 'dev',
    });
  });

  it('keeps spaces in the admin password', () => {
    expect(load({ ADMIN_PASSWORD: '  spaced out  ' }).config.admin).toMatchObject({
      password: '  spaced out  ',
    });
  });

  it('ADMIN_SESSION_SECRET: at least 32 characters; random when unset', () => {
    expect(load({ ADMIN_SESSION_SECRET: SECRET }).config.admin.sessionSecret).toBe(SECRET);
    expect(issuesOf({ ADMIN_SESSION_SECRET: 'short' })[0]).toMatch(
      /^ADMIN_SESSION_SECRET: must be at least 32/,
    );
    const a = loadConfig({ NODE_ENV: 'test' }).admin.sessionSecret;
    const b = loadConfig({ NODE_ENV: 'test' }).admin.sessionSecret;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('ADMIN_TZ must be an IANA time zone', () => {
    expect(load({ ADMIN_TZ: 'Europe/London' }).config.adminTz).toBe('Europe/London');
    expect(load({ ADMIN_TZ: 'UTC' }).config.adminTz).toBe('UTC');
    expect(issuesOf({ ADMIN_TZ: 'Mars/Olympus' })[0]).toBe('ADMIN_TZ: not an IANA time zone');
  });

  describe('accounts (stage 8)', () => {
    it('FIREBASE_PROJECT_ID: a Firebase project id, or unset', () => {
      expect(load({ FIREBASE_PROJECT_ID: 'sudoku-fight-1a2b3' }).config.firebaseProjectId).toBe(
        'sudoku-fight-1a2b3',
      );
      expect(load({ FIREBASE_PROJECT_ID: '  ' }).config.firebaseProjectId).toBeNull();
      for (const bad of [
        'Sudoku-Fight',
        'abc',
        '1sudoku-fight',
        'sudoku-fight-',
        'sudoku_fight',
        'a'.repeat(31),
      ]) {
        expect(issuesOf({ FIREBASE_PROJECT_ID: bad })[0]).toMatch(
          /^FIREBASE_PROJECT_ID: not a Firebase project id/,
        );
      }
    });

    it('production without FIREBASE_PROJECT_ID starts, with accounts off and a warning', () => {
      const { config, warnings } = load({ NODE_ENV: 'production', DATABASE_URL: 'postgres://h/db' });
      expect(config.firebaseProjectId).toBeNull();
      expect(warnings.some((w) => w.includes('accounts disabled: FIREBASE_PROJECT_ID is not set'))).toBe(
        true,
      );
      // Outside production nobody is warned: development tokens work there.
      expect(load({ NODE_ENV: 'test' }).warnings).toEqual([]);
    });

    it('RATING_OPTION: B by default, or A [D7]', () => {
      expect(load({}).config.ratingOption).toBe('B');
      expect(load({ RATING_OPTION: 'A' }).config.ratingOption).toBe('A');
      expect(load({ RATING_OPTION: ' a ' }).config.ratingOption).toBe('A');
      expect(load({ RATING_OPTION: '' }).config.ratingOption).toBe('B');
      expect(issuesOf({ RATING_OPTION: 'C' })[0]).toBe('RATING_OPTION: expected A or B');
    });

    it('CHEAT_FAST_THINK_MS and CHEAT_FAST_THINK_MOVES: 1200 ms over 20 moves by default (spec §21)', () => {
      expect(load({}).config.cheat).toEqual({ thinkMs: 1200, moves: 20 });
      expect(load({ CHEAT_FAST_THINK_MS: '900', CHEAT_FAST_THINK_MOVES: ' 15 ' }).config.cheat).toEqual({
        thinkMs: 900,
        moves: 15,
      });
      expect(load({ CHEAT_FAST_THINK_MS: '', CHEAT_FAST_THINK_MOVES: '' }).config.cheat).toEqual({
        thinkMs: 1200,
        moves: 20,
      });
      expect(
        issuesOf({ CHEAT_FAST_THINK_MS: '0', CHEAT_FAST_THINK_MOVES: '1' }).map((i) => i.split(':')[0]),
      ).toEqual(['CHEAT_FAST_THINK_MS', 'CHEAT_FAST_THINK_MOVES']);
    });

    it('ACCOUNT_DELETE_MAX_AUTH_AGE_MS: deleting an account wants a sign-in this fresh (default 5 minutes)', () => {
      expect(load({}).config.accountDeleteMaxAuthAgeMs).toBe(300_000);
      expect(load({ ACCOUNT_DELETE_MAX_AUTH_AGE_MS: '120000' }).config.accountDeleteMaxAuthAgeMs).toBe(
        120_000,
      );
      expect(load({ ACCOUNT_DELETE_MAX_AUTH_AGE_MS: ' ' }).config.accountDeleteMaxAuthAgeMs).toBe(300_000);
      for (const bad of ['0', '999', '86400001', '1.5', 'soon'])
        expect(issuesOf({ ACCOUNT_DELETE_MAX_AUTH_AGE_MS: bad })[0]).toMatch(
          /^ACCOUNT_DELETE_MAX_AUTH_AGE_MS: /,
        );
    });

    it('PRACTICE_XP_DAILY_CAP (default 1500, 0 = no practice XP) and INVITE_URL (stage 12)', () => {
      expect(load({}).config.progress).toEqual({ practiceXpDailyCap: 1500, inviteUrl: null });
      expect(
        load({ PRACTICE_XP_DAILY_CAP: ' 800 ', INVITE_URL: ' https://sudokufight.app/invite ' }).config
          .progress,
      ).toEqual({ practiceXpDailyCap: 800, inviteUrl: 'https://sudokufight.app/invite' });
      expect(load({ PRACTICE_XP_DAILY_CAP: '0', INVITE_URL: '' }).config.progress).toEqual({
        practiceXpDailyCap: 0,
        inviteUrl: null,
      });
      for (const bad of ['-1', '1.5', 'lots'])
        expect(issuesOf({ PRACTICE_XP_DAILY_CAP: bad })[0]).toMatch(/^PRACTICE_XP_DAILY_CAP: /);
      for (const bad of ['sudokufight.app/invite', 'javascript:alert(1)', 'ftp://x.example'])
        expect(issuesOf({ INVITE_URL: bad })[0]).toMatch(/^INVITE_URL: /);
    });
  });

  describe('Sentry (stage 14)', () => {
    const DSN = 'https://abc123@o42.ingest.de.sentry.io/4507';

    it('off without SENTRY_DSN (blank counts as unset)', () => {
      expect(load({}).config.sentry).toBeNull();
      expect(load({ SENTRY_DSN: '  ', SENTRY_ENVIRONMENT: 'staging' }).config.sentry).toBeNull();
    });

    it("with a DSN: environment NODE_ENV unless SENTRY_ENVIRONMENT, the server's version as release, 5% traces", () => {
      const { config, warnings } = load({ NODE_ENV: 'test', SENTRY_DSN: ` ${DSN} ` });
      expect(config.sentry).toEqual({
        dsn: DSN,
        environment: 'test',
        release: `sudoku-fight-server@${SERVER_VERSION}`,
        tracesSampleRate: DEFAULT_TRACES_SAMPLE_RATE,
      });
      expect(DEFAULT_TRACES_SAMPLE_RATE).toBe(0.05);
      expect(warnings).toEqual([]);
      expect(
        load({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging', SENTRY_TRACES_SAMPLE_RATE: '0' }).config
          .sentry,
      ).toMatchObject({ environment: 'staging', tracesSampleRate: 0 });
    });

    it('release: SENTRY_RELEASE, else the version with the commit, else with Fly’s deployment', () => {
      const base = `sudoku-fight-server@${SERVER_VERSION}`;
      expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
      expect(sentryRelease({})).toBe(base);
      expect(sentryRelease({ GIT_SHA: 'ABCDEF1234567890' })).toBe(`${base}+abcdef123456`);
      expect(sentryRelease({ FLY_IMAGE_REF: 'registry.fly.io/sudoku-fight-prod:deployment-01HABCDEF' })).toBe(
        `${base}+deployment-01HABCDEF`,
      );
      expect(sentryRelease({ FLY_IMAGE_REF: 'registry.fly.io/app:latest' })).toBe(base);
      expect(sentryRelease({ SENTRY_RELEASE: 'server-7', GIT_SHA: 'abcdef1' })).toBe('server-7');
      expect(load({ SENTRY_DSN: DSN, GIT_SHA: 'abcdef1' }).config.sentry?.release).toBe(`${base}+abcdef1`);
    });

    it('refuses what Sentry would refuse, each with its reason', () => {
      for (const bad of [
        'abc123@o42.ingest.sentry.io/4507',
        'https://o42.ingest.sentry.io/4507',
        'https://k@h/x',
      ])
        expect(issuesOf({ SENTRY_DSN: bad })[0]).toMatch(/^SENTRY_DSN: /);
      expect(issuesOf({ SENTRY_ENVIRONMENT: 'my env' })[0]).toMatch(/^SENTRY_ENVIRONMENT: /);
      expect(issuesOf({ SENTRY_RELEASE: 'a/b' })[0]).toMatch(/^SENTRY_RELEASE: /);
      expect(issuesOf({ SENTRY_RELEASE: '..' })[0]).toMatch(/^SENTRY_RELEASE: /);
      for (const bad of ['-0.1', '1.5', 'some'])
        expect(issuesOf({ SENTRY_TRACES_SAMPLE_RATE: bad })[0]).toMatch(/^SENTRY_TRACES_SAMPLE_RATE: /);
      expect(issuesOf({ GIT_SHA: 'main' })[0]).toMatch(/^GIT_SHA: /);
    });
  });

  it('lists every bad setting at once', () => {
    const issues = issuesOf({ NODE_ENV: 'staging', PORT: '-1', ADMIN_TZ: 'nowhere' });
    expect(issues.map((i) => i.split(':')[0])).toEqual(['NODE_ENV', 'PORT', 'ADMIN_TZ']);
    expect(() => loadConfig({ PORT: 'x' }, { warn: () => {} })).toThrow(
      /Invalid server settings:\n {2}- PORT/,
    );
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    ['2', 2],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%p → %p', (raw, expected) => {
    expect(parseTrustProxy(raw)).toBe(expected);
  });
});
