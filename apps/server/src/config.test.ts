import path from 'node:path';

import {
  canonicalSha256,
  ConfigError,
  DEFAULT_FRIENDS_LIMITS,
  DEFAULT_PGLITE_DIR,
  DEFAULT_TRACES_SAMPLE_RATE,
  describeAdmin,
  describeQa,
  DEV_ADMIN_PASSWORD,
  loadConfig,
  type LoadConfigOptions,
  MIN_ADMIN_PASSWORD_LENGTH,
  parseTrustProxy,
  SERVER_VERSION,
  sentryRelease,
  splitAdminEmails,
  TEMPLATE_DEBUG_KEY_SHA256,
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
        devPassword: true,
        google: null,
        sessionSecret: 'random-secret',
      },
      adminTz: 'Asia/Jerusalem',
      trustProxy: false,
      firebaseProjectId: null,
      ratingOption: 'B',
      cheat: { thinkMs: 1200, moves: 20 },
      accountDeleteMaxAuthAgeMs: 300_000,
      rankedRequiresVerifiedEmail: true,
      progress: { practiceXpDailyCap: 1500, inviteUrl: null },
      sentry: null,
      legal: { contactEmail: null, operatorName: null },
      friends: {
        links: { androidSha256: [], iosAppId: null, storeUrls: { android: null, ios: null } },
        limits: DEFAULT_FRIENDS_LIMITS,
      },
      // The stealth bot: off [D90].
      stealth: {
        enabled: false,
        queues: ['fast-2p', 'normal-2p', 'hard-2p'],
        afterMs: { min: 8000, max: 20_000 },
        hideNobody: true,
        personaPoolMax: 1000,
        readyAfterMs: { min: 300, max: 1500 },
        secret: 'random-secret',
      },
      // The QA module: off, no agent key.
      qa: { enabled: false, agentToken: null, open: false },
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

    it('a password alone enables the admin site, with 8+ characters', () => {
      expect(MIN_ADMIN_PASSWORD_LENGTH).toBe(8);
      const ok = load({ ...prod, ADMIN_PASSWORD: 'eight ch', ADMIN_SESSION_SECRET: SECRET });
      expect(ok.config.admin).toEqual({
        enabled: true,
        password: 'eight ch',
        devPassword: false,
        google: null,
        sessionSecret: SECRET,
      });
      expect(ok.warnings).toEqual([]);

      const short = load({ ...prod, ADMIN_PASSWORD: 'seven c' });
      expect(short.config.admin).toEqual({
        enabled: false,
        reason:
          'no sign-in method: Google sign-in needs FIREBASE_WEB_API_KEY, ADMIN_EMAILS; ' +
          'ADMIN_PASSWORD is shorter than 8 characters',
        sessionSecret: 'random-secret',
      });
      expect(short.warnings[0]).toContain('admin site disabled');

      const unset = load(prod);
      expect(unset.config.admin).toMatchObject({
        enabled: false,
        reason: expect.stringContaining('ADMIN_PASSWORD is not set'),
      });
    });

    it('never falls back to the dev password', () => {
      expect(load(prod).config.admin.enabled).toBe(false);
      expect(load({ NODE_ENV: 'production', PGLITE_DIR: 'memory' }).config.admin.enabled).toBe(false);
    });

    it('refuses the dev password even when it is set on purpose: it is in the code', () => {
      const { config, warnings } = load({ ...prod, ADMIN_PASSWORD: DEV_ADMIN_PASSWORD });
      expect(config.admin).toEqual({
        enabled: false,
        reason:
          'no sign-in method: Google sign-in needs FIREBASE_WEB_API_KEY, ADMIN_EMAILS; ' +
          'ADMIN_PASSWORD is the dev password, which is public (it is in the code)',
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

  describe("the admin site's sign-in: Google for ADMIN_EMAILS, and/or a password", () => {
    // Made up, of the right shape; built here, so no key-like text sits in the repo.
    const API_KEY = `AIza${'k'.repeat(30)}_-K9x`;
    const APP_ID = '1:123456789012:web:0a1b2c3d4e5f';
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://h/db', ADMIN_SESSION_SECRET: SECRET };
    const googleSettings = {
      FIREBASE_PROJECT_ID: 'sudoku-fight-1a2b3',
      FIREBASE_WEB_API_KEY: API_KEY,
      FIREBASE_WEB_APP_ID: APP_ID,
      ADMIN_EMAILS: 'first@example.com, second@example.org',
    };
    const web = {
      apiKey: API_KEY,
      authDomain: 'sudoku-fight-1a2b3.firebaseapp.com',
      projectId: 'sudoku-fight-1a2b3',
      appId: APP_ID,
    };
    const adminWarnings = (warnings: string[]) => warnings.filter((w) => /admin|ADMIN/.test(w));

    it('Google only: the web config from the Firebase settings, and the allowed addresses', () => {
      const { config, warnings } = load({ ...prod, ...googleSettings });
      expect(config.admin).toEqual({
        enabled: true,
        password: null,
        devPassword: false,
        google: { web, allowedEmails: ['first@example.com', 'second@example.org'] },
        sessionSecret: SECRET,
      });
      expect(adminWarnings(warnings)).toEqual([]);
      expect(describeAdmin(config.admin)).toBe('on (Google sign-in for 2 addresses)');
    });

    it('Google without FIREBASE_WEB_APP_ID: appId null (sign-in works without it)', () => {
      const { config } = load({ ...prod, ...googleSettings, FIREBASE_WEB_APP_ID: '' });
      expect(config.admin).toMatchObject({ enabled: true, google: { web: { ...web, appId: null } } });
    });

    it('password only, in production', () => {
      const { config, warnings } = load({ ...prod, ADMIN_PASSWORD: 'a long password' });
      expect(config.admin).toMatchObject({ enabled: true, password: 'a long password', google: null });
      expect(adminWarnings(warnings)).toEqual([]);
      expect(describeAdmin(config.admin)).toBe('on (password)');
    });

    it('both', () => {
      const { config } = load({ ...prod, ...googleSettings, ADMIN_PASSWORD: 'a long password' });
      expect(config.admin).toMatchObject({
        enabled: true,
        password: 'a long password',
        google: { web, allowedEmails: ['first@example.com', 'second@example.org'] },
      });
      expect(describeAdmin(config.admin)).toBe('on (Google sign-in for 2 addresses, password)');
    });

    it('none: the admin site is off, and the warning says what to set', () => {
      const { config, warnings } = load(prod);
      expect(config.admin).toEqual({
        enabled: false,
        reason:
          'no sign-in method: Google sign-in needs FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, ADMIN_EMAILS; ' +
          'ADMIN_PASSWORD is not set',
        sessionSecret: SECRET,
      });
      expect(adminWarnings(warnings)).toEqual([
        expect.stringMatching(/^\[config\] admin site disabled: no sign-in method: Google sign-in needs /),
      ]);
      expect(describeAdmin(config.admin)).toMatch(/^off: no sign-in method/);
    });

    it.each([
      ['no API key', { FIREBASE_WEB_API_KEY: undefined }, 'FIREBASE_WEB_API_KEY'],
      ['no addresses', { ADMIN_EMAILS: undefined }, 'ADMIN_EMAILS'],
      ['no project', { FIREBASE_PROJECT_ID: undefined }, 'FIREBASE_PROJECT_ID'],
      [
        'only the app id',
        { FIREBASE_WEB_API_KEY: undefined, ADMIN_EMAILS: undefined },
        'FIREBASE_WEB_API_KEY, ADMIN_EMAILS',
      ],
    ])(
      'part of the Google settings (%s): Google off, with a warning naming what is missing',
      (_why, change, missing) => {
        const { config, warnings } = load({
          ...prod,
          ...googleSettings,
          ...change,
          ADMIN_PASSWORD: 'a long password',
        });
        expect(config.admin).toMatchObject({ enabled: true, google: null, password: 'a long password' });
        expect(warnings).toContain(`[config] admin Google sign-in off: ${missing} not set`);
        // Outside production too: a half-set Google sign-in is a mistake anywhere.
        expect(load({ ...googleSettings, ...change }).warnings).toContain(
          `[config] admin Google sign-in off: ${missing} not set`,
        );
      },
    );

    it('FIREBASE_PROJECT_ID alone is the app’s accounts, not a half-set admin sign-in: no Google warning', () => {
      const { warnings } = load({
        ...prod,
        FIREBASE_PROJECT_ID: 'sudoku-fight-1a2b3',
        ADMIN_PASSWORD: 'a long password',
      });
      expect(warnings.filter((w) => w.includes('Google'))).toEqual([]);
    });

    it('ADMIN_EMAILS: separated by commas, semicolons or spaces; trimmed, lower case, each once', () => {
      const of = (raw: string) => load({ ...prod, ...googleSettings, ADMIN_EMAILS: raw }).config.admin;
      expect(
        of(' First@Example.com;second@example.org\n  THIRD@example.net , first@example.com ,; '),
      ).toMatchObject({
        google: { allowedEmails: ['first@example.com', 'second@example.org', 'third@example.net'] },
      });
      expect(of('only@example.com')).toMatchObject({ google: { allowedEmails: ['only@example.com'] } });
      expect(splitAdminEmails('a@one.example  b@two.example,A@ONE.example')).toEqual([
        'a@one.example',
        'b@two.example',
      ]);
    });

    it('ADMIN_EMAILS: a bad entry turns Google sign-in off, named in the warning; the server still starts', () => {
      // A typo on the live server: "b@example,com" for "b@example.com". The game must keep running.
      const typo = load({ ...prod, ...googleSettings, ADMIN_EMAILS: 'first@example.com, b@example,com' });
      expect(typo.config.admin).toEqual({
        enabled: false,
        reason:
          'no sign-in method: Google sign-in is off: ADMIN_EMAILS: "b@example" is not an email address; ' +
          'ADMIN_EMAILS: "com" is not an email address; ADMIN_PASSWORD is not set',
        sessionSecret: SECRET,
      });
      expect(adminWarnings(typo.warnings)).toEqual([
        '[config] admin Google sign-in off: ADMIN_EMAILS: "b@example" is not an email address; ' +
          'ADMIN_EMAILS: "com" is not an email address',
        expect.stringMatching(/^\[config\] admin site disabled: no sign-in method: Google sign-in is off: /),
      ]);
      // With a password, the admin site stays on through it.
      const withPassword = load({
        ...prod,
        ...googleSettings,
        ADMIN_EMAILS: 'x@y',
        ADMIN_PASSWORD: 'a long password',
      });
      expect(withPassword.config.admin).toMatchObject({
        enabled: true,
        google: null,
        password: 'a long password',
      });
      expect(withPassword.warnings).toContain(
        '[config] admin Google sign-in off: ADMIN_EMAILS: "x@y" is not an email address',
      );
      // A list of no address; outside production too.
      expect(load({ ...googleSettings, ADMIN_EMAILS: ' , ; ' }).warnings).toContain(
        '[config] admin Google sign-in off: ADMIN_EMAILS: no email address in it',
      );
      // Blank is unset: no warning, and no half-set Google sign-in.
      expect(load({ NODE_ENV: 'test', ADMIN_EMAILS: '   ' }).warnings).toEqual([]);
    });

    it('FIREBASE_WEB_API_KEY and FIREBASE_WEB_APP_ID must look like what Firebase shows, else Google is off', () => {
      const googleOff = (change: Record<string, string>) => {
        const { config, warnings } = load({ ...prod, ...googleSettings, ...change });
        expect(config.admin).toMatchObject({ enabled: false });
        return warnings.filter((w) => w.startsWith('[config] admin Google sign-in off: '));
      };
      for (const bad of [
        'key',
        `AIza${'k'.repeat(34)}`,
        `AIza${'k'.repeat(36)}`,
        `BIza${'k'.repeat(35)}`,
        APP_ID,
      ])
        expect(googleOff({ FIREBASE_WEB_API_KEY: bad })).toEqual([
          '[config] admin Google sign-in off: FIREBASE_WEB_API_KEY: not a Firebase web API key ' +
            '(apiKey: "AIza" and 35 more characters)',
        ]);
      for (const bad of ['web-app', '1:123:android:abc', API_KEY, '1:123:web:XYZ'])
        expect(googleOff({ FIREBASE_WEB_APP_ID: bad })).toEqual([
          '[config] admin Google sign-in off: FIREBASE_WEB_APP_ID: not a Firebase web app id ' +
            '(appId: 1:<number>:web:<hex>)',
        ]);
      // A bad value and a missing one: both said.
      expect(googleOff({ FIREBASE_WEB_API_KEY: 'key', FIREBASE_PROJECT_ID: '' })).toEqual([
        '[config] admin Google sign-in off: FIREBASE_WEB_API_KEY: not a Firebase web API key ' +
          '(apiKey: "AIza" and 35 more characters); FIREBASE_PROJECT_ID not set',
      ]);
      // Never a ConfigError: the server starts.
      expect(() =>
        loadConfig({ ...prod, ...googleSettings, FIREBASE_WEB_API_KEY: 'key' }, { warn: () => {} }),
      ).not.toThrow();
      expect(load({ FIREBASE_WEB_API_KEY: ` ${API_KEY} ` }).config.admin.enabled).toBe(true);
      expect(load({ ...googleSettings, FIREBASE_WEB_API_KEY: ` ${API_KEY} ` }).config.admin).toMatchObject({
        google: { web: { apiKey: API_KEY } },
      });
    });

    it('production: a password shorter than 8, or the dev password, is off; Google still signs in (with a warning)', () => {
      for (const [password, why] of [
        ['seven c', 'ADMIN_PASSWORD is shorter than 8 characters'],
        [DEV_ADMIN_PASSWORD, 'ADMIN_PASSWORD is the dev password, which is public (it is in the code)'],
      ] as const) {
        const { config, warnings } = load({ ...prod, ...googleSettings, ADMIN_PASSWORD: password });
        expect(config.admin).toMatchObject({ enabled: true, password: null, google: { web } });
        expect(warnings).toContain(`[config] admin password sign-in off: ${why}`);
      }
    });

    it('development: the dev password keeps working next to Google sign-in', () => {
      const { config } = load(googleSettings);
      expect(config.admin).toMatchObject({
        enabled: true,
        password: DEV_ADMIN_PASSWORD,
        devPassword: true,
        google: { web },
      });
      expect(describeAdmin(config.admin)).toBe('on (Google sign-in for 2 addresses, dev password)');
      expect(describeAdmin(load({ NODE_ENV: 'test' }).config.admin)).toBe('on (dev password)');
    });

    it('the start-up line never shows the addresses or the key', () => {
      const { config } = load({ ...prod, ...googleSettings, ADMIN_EMAILS: 'solo@example.com' });
      const line = describeAdmin(config.admin);
      expect(line).toBe('on (Google sign-in for 1 address)');
      expect(line).not.toMatch(/@|AIza/);
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

    it('RANKED_REQUIRES_VERIFIED_EMAIL: on by default [D22]; true/false or 1/0', () => {
      const of = (v: string | undefined) => load({ RANKED_REQUIRES_VERIFIED_EMAIL: v }).config;
      expect(of(undefined).rankedRequiresVerifiedEmail).toBe(true);
      expect(of(' ').rankedRequiresVerifiedEmail).toBe(true);
      for (const on of ['true', 'TRUE', ' 1 ']) expect(of(on).rankedRequiresVerifiedEmail).toBe(true);
      for (const off of ['false', 'False', '0']) expect(of(off).rankedRequiresVerifiedEmail).toBe(false);
      for (const bad of ['yes', 'off', '2'])
        expect(issuesOf({ RANKED_REQUIRES_VERIFIED_EMAIL: bad })[0]).toMatch(
          /^RANKED_REQUIRES_VERIFIED_EMAIL: expected true or false/,
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

  describe('playing with friends (1.0.4): room links and rate limits', () => {
    const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgres://h/db', ADMIN_PASSWORD: 'eight ch' };
    /** A made-up key's fingerprint (not a real key's). */
    const EAS = Array.from({ length: 32 }, (_, i) => (i * 7 + 16).toString(16).toUpperCase()).join(':');

    it('the defaults: no app-link files, no stores, 10 rooms an hour, 20 joins in 10 minutes (60 per IP)', () => {
      expect(DEFAULT_FRIENDS_LIMITS).toEqual({
        create: { limit: 10, windowMs: 3_600_000 },
        joinPerAccount: { limit: 20, windowMs: 600_000 },
        joinPerIp: { limit: 60, windowMs: 600_000 },
      });
      expect(load({ NODE_ENV: 'test' }).config.friends).toEqual({
        links: { androidSha256: [], iosAppId: null, storeUrls: { android: null, ios: null } },
        limits: DEFAULT_FRIENDS_LIMITS,
      });
    });

    it('ANDROID_APP_LINK_SHA256: fingerprints as assetlinks.json wants them, from what keytool or Play shows', () => {
      expect(canonicalSha256(EAS.replace(/:/g, '').toLowerCase())).toBe(EAS);
      expect(canonicalSha256(` ${EAS.toLowerCase()} `)).toBe(EAS);
      expect(canonicalSha256(EAS.slice(3))).toBeNull(); // 31 bytes
      expect(canonicalSha256('5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25')).toBeNull(); // a SHA-1
      const raw = `${TEMPLATE_DEBUG_KEY_SHA256.toLowerCase()}, ${EAS.replace(/:/g, '')};${EAS}\n`;
      expect(load({ ANDROID_APP_LINK_SHA256: raw }).config.friends?.links.androidSha256).toEqual([
        TEMPLATE_DEBUG_KEY_SHA256,
        EAS,
      ]);
      expect(load({ ANDROID_APP_LINK_SHA256: '  ' }).config.friends?.links.androidSha256).toEqual([]);
      expect(issuesOf({ ANDROID_APP_LINK_SHA256: `${EAS}, not-a-key` })[0]).toMatch(
        /^ANDROID_APP_LINK_SHA256: "not-a-key" is not a SHA-256 fingerprint/,
      );
      const many = Array.from(
        { length: 11 },
        (_, i) => `${i.toString(16).padStart(2, '0')}${'0'.repeat(62)}`,
      );
      expect(issuesOf({ ANDROID_APP_LINK_SHA256: many.join(',') })[0]).toMatch(
        /^ANDROID_APP_LINK_SHA256: at most 10 fingerprints/,
      );
    });

    it("the public debug key: production refuses to start with it, unless it says it's a test server (staging)", () => {
      // TEMPLATE_DEBUG_KEY_SHA256 is React Native's template key: the SHA-256 next to app.config.ts's SHA-1.
      expect(TEMPLATE_DEBUG_KEY_SHA256).toBe(
        'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
      );
      const withDebug = { ...PROD, ANDROID_APP_LINK_SHA256: `${EAS},${TEMPLATE_DEBUG_KEY_SHA256}` };
      const issues = issuesOf(withDebug);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^ANDROID_APP_LINK_SHA256: lists the public debug key of React Native/);
      expect(issues[0]).toMatch(/ANDROID_APP_LINK_ALLOW_DEBUG_KEY=true/);
      // Also written without colons, in lower case.
      expect(
        issuesOf({
          ...PROD,
          ANDROID_APP_LINK_SHA256: TEMPLATE_DEBUG_KEY_SHA256.replace(/:/g, '').toLowerCase(),
        }),
      ).toHaveLength(1);
      expect(issuesOf({ ...withDebug, ANDROID_APP_LINK_ALLOW_DEBUG_KEY: 'false' })).toHaveLength(1);

      const staging = load({ ...withDebug, ANDROID_APP_LINK_ALLOW_DEBUG_KEY: ' TRUE ' });
      expect(staging.config.friends?.links.androidSha256).toEqual([EAS, TEMPLATE_DEBUG_KEY_SHA256]);
      expect(staging.warnings.filter((w) => w.includes('public debug key'))).toHaveLength(1);
      // Production without the debug key: no word about it.
      const prod = load({ ...PROD, ANDROID_APP_LINK_SHA256: EAS });
      expect(prod.config.friends?.links.androidSha256).toEqual([EAS]);
      expect(prod.warnings.some((w) => w.includes('debug key'))).toBe(false);
      // Outside production it's the PC's own test server: fine, quietly.
      const dev = load({ NODE_ENV: 'test', ANDROID_APP_LINK_SHA256: TEMPLATE_DEBUG_KEY_SHA256 });
      expect(dev.config.friends?.links.androidSha256).toEqual([TEMPLATE_DEBUG_KEY_SHA256]);
      expect(dev.warnings).toEqual([]);
      for (const bad of ['yes', '2'])
        expect(issuesOf({ ANDROID_APP_LINK_ALLOW_DEBUG_KEY: bad })[0]).toMatch(
          /^ANDROID_APP_LINK_ALLOW_DEBUG_KEY: expected true or false/,
        );
    });

    it('IOS_APP_ID: "<Team ID>.<bundle id>", or unset', () => {
      expect(load({ IOS_APP_ID: ' ABCDE12345.com.mosheg.sudokufight ' }).config.friends?.links.iosAppId).toBe(
        'ABCDE12345.com.mosheg.sudokufight',
      );
      expect(load({ IOS_APP_ID: '' }).config.friends?.links.iosAppId).toBeNull();
      for (const bad of [
        'com.mosheg.sudokufight',
        'abcde12345.com.mosheg.sudokufight',
        'ABCDE1234.com.x',
        'ABCDE12345',
      ])
        expect(issuesOf({ IOS_APP_ID: bad })[0]).toMatch(/^IOS_APP_ID: not an iOS app id/);
    });

    it('STORE_URL_ANDROID and STORE_URL_IOS: https store pages, or unset', () => {
      const play = 'https://play.google.com/store/apps/details?id=com.mosheg.sudokufight';
      const apple = 'https://apps.apple.com/app/id1234567890';
      expect(
        load({ STORE_URL_ANDROID: ` ${play} `, STORE_URL_IOS: apple }).config.friends?.links.storeUrls,
      ).toEqual({ android: play, ios: apple });
      expect(load({ STORE_URL_ANDROID: '', STORE_URL_IOS: ' ' }).config.friends?.links.storeUrls).toEqual({
        android: null,
        ios: null,
      });
      for (const bad of ['http://play.google.com/x', 'play.google.com/x', 'javascript:alert(1)'])
        expect(issuesOf({ STORE_URL_ANDROID: bad })[0]).toMatch(/^STORE_URL_ANDROID: /);
      expect(issuesOf({ STORE_URL_IOS: 'intent://x' })[0]).toMatch(/^STORE_URL_IOS: /);
    });

    it('FRIENDS_*: the limits of friends-room.md §5, each a whole number of tries', () => {
      const { limits } = load({
        FRIENDS_CREATES_PER_HOUR: '3',
        FRIENDS_JOINS_PER_10_MIN: ' 5 ',
        FRIENDS_JOINS_PER_10_MIN_PER_IP: '500',
      }).config.friends!;
      expect(limits).toEqual({
        create: { limit: 3, windowMs: 3_600_000 },
        joinPerAccount: { limit: 5, windowMs: 600_000 },
        joinPerIp: { limit: 500, windowMs: 600_000 },
      });
      for (const name of [
        'FRIENDS_CREATES_PER_HOUR',
        'FRIENDS_JOINS_PER_10_MIN',
        'FRIENDS_JOINS_PER_10_MIN_PER_IP',
      ])
        for (const bad of ['0', '-1', '1.5', 'many'])
          expect(issuesOf({ [name]: bad })[0]).toMatch(new RegExp(`^${name}: `));
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

describe('the stealth bot (STEALTH_BOT_*, stealth-bot.md §8) [D90, D94, D95]', () => {
  it('is off by default, in every environment', () => {
    for (const NODE_ENV of ['development', 'test', 'production'])
      expect(
        load({ NODE_ENV, DATABASE_URL: 'postgres://h/db', ADMIN_PASSWORD: 'p'.repeat(12) }).config.stealth,
      ).toMatchObject({ enabled: false });
    // The shipped settings files say nothing of it: off on staging and production alike.
  });

  it('reads the master switch, the queues, the wait, the notice and the pool size', () => {
    const { config } = load({
      STEALTH_BOT_ENABLED: ' TRUE ',
      STEALTH_BOT_QUEUES: 'fast-2p; HARD-2p, fast-2p',
      STEALTH_BOT_AFTER_MS: '3000 - 8000',
      STEALTH_BOT_HIDE_NOBODY: '0',
      STEALTH_PERSONA_POOL_MAX: '50',
      STEALTH_BOT_SECRET: 'k'.repeat(40),
    });
    expect(config.stealth).toEqual({
      enabled: true,
      queues: ['fast-2p', 'hard-2p'],
      afterMs: { min: 3000, max: 8000 },
      hideNobody: false,
      personaPoolMax: 50,
      readyAfterMs: { min: 300, max: 1500 },
      secret: 'k'.repeat(40),
    });
    expect(load({ STEALTH_BOT_AFTER_MS: '5000' }).config.stealth?.afterMs).toEqual({ min: 5000, max: 5000 });
    expect(load({ STEALTH_BOT_ENABLED: '1', STEALTH_BOT_QUEUES: ' ' }).config.stealth?.queues).toEqual([
      'fast-2p',
      'normal-2p',
      'hard-2p',
    ]);
  });

  it('refuses a 3–4 player queue, a bad wait, a bad switch and a short secret', () => {
    expect(issuesOf({ STEALTH_BOT_QUEUES: 'fast-2p,normal-3p' })[0]).toMatch(
      /^STEALTH_BOT_QUEUES: .*two-player/,
    );
    expect(issuesOf({ STEALTH_BOT_QUEUES: 'fast' })[0]).toMatch(/^STEALTH_BOT_QUEUES: /);
    for (const bad of ['20000-8000', 'soon', '-5', '1-700000'])
      expect(issuesOf({ STEALTH_BOT_AFTER_MS: bad })[0]).toMatch(/^STEALTH_BOT_AFTER_MS: /);
    expect(issuesOf({ STEALTH_BOT_ENABLED: 'yes' })[0]).toMatch(/^STEALTH_BOT_ENABLED: /);
    expect(issuesOf({ STEALTH_BOT_HIDE_NOBODY: 'maybe' })[0]).toMatch(/^STEALTH_BOT_HIDE_NOBODY: /);
    expect(issuesOf({ STEALTH_PERSONA_POOL_MAX: '0' })[0]).toMatch(/^STEALTH_PERSONA_POOL_MAX: /);
    expect(issuesOf({ STEALTH_BOT_SECRET: 'short' })[0]).toMatch(/^STEALTH_BOT_SECRET: /);
  });

  it('without STEALTH_BOT_SECRET, a random secret per start', () => {
    let n = 0;
    const secretOf = () =>
      loadConfig({}, { warn: () => {}, randomSecret: () => `secret-${++n}` }).stealth?.secret;
    expect(secretOf()).not.toBe(secretOf());
  });
});

describe('the QA module (QA_ENABLED, QA_AGENT_TOKEN; docs/handoff/2026-10-23/qa-module/plan.md)', () => {
  const KEY = 'q'.repeat(31) + ' k';

  it('is off by default, without a key, in every environment', () => {
    for (const NODE_ENV of ['development', 'test', 'production'])
      expect(
        load({ NODE_ENV, DATABASE_URL: 'postgres://h/db', ADMIN_PASSWORD: 'p'.repeat(12) }).config.qa,
      ).toEqual({ enabled: false, agentToken: null, open: false });
  });

  it('reads the switch and the key, the key as written (not trimmed); blank is unset', () => {
    expect(load({ QA_ENABLED: ' True ', QA_AGENT_TOKEN: KEY }).config.qa).toEqual({
      enabled: true,
      agentToken: KEY,
      open: false,
    });
    expect(load({ QA_ENABLED: '1', QA_AGENT_TOKEN: '', QA_OPEN: 'true' }).config.qa).toEqual({
      enabled: true,
      agentToken: null,
      open: true,
    });
    expect(load({ QA_ENABLED: '0', QA_AGENT_TOKEN: KEY }).config.qa).toEqual({
      enabled: false,
      agentToken: KEY,
      open: false,
    });
  });

  it('a key shorter than 32 characters, or a bad switch, is a settings error that never shows the key', () => {
    const issues = issuesOf({ QA_AGENT_TOKEN: 'short-key-31-characters-long-xx' });
    expect(issues).toEqual(['QA_AGENT_TOKEN: must be at least 32 characters']);
    expect(issuesOf({ QA_ENABLED: 'yes' })[0]).toMatch(/^QA_ENABLED: /);
  });

  it('the start-up line says whether the key is set, never the key', () => {
    expect(describeQa(undefined)).toBe('QA module off (QA_ENABLED=false)');
    expect(describeQa({ enabled: false, agentToken: KEY })).toBe('QA module off (QA_ENABLED=false)');
    expect(describeQa({ enabled: true, agentToken: null })).toBe(
      'QA module on (no agent key: admin sign-in only)',
    );
    const on = describeQa({ enabled: true, agentToken: KEY });
    expect(on).toBe('QA module on (agent key set)');
    expect(on).not.toContain(KEY);
    expect(describeQa({ enabled: true, agentToken: null, open: true })).toBe(
      'QA module on (open: no sign-in needed)',
    );
  });
});
