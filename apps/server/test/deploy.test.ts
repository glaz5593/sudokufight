import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

import { build, type BuildOptions, type Metafile } from 'esbuild';

import { DEFAULT_PORT } from '../src/config';

/**
 * The deployment files (Dockerfile, .dockerignore, fly.toml at the repo root) against the code, without Docker:
 * - the build context lets in every file the two builds read, and keeps out the app, local data and secrets;
 * - what the bundle requires at run time is a production dependency that the image's `npm ci` installs;
 * - the runtime stage has what the bundle looks for next to itself;
 * - fly.toml runs one machine that stays up, on the server's port, checked on /health.
 *
 * The builds run here with esbuild (the server's build, and the admin site's import graph); nothing is written.
 */

const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');
const toPosix = (p: string) => p.split(path.sep).join('/');
const fromRepo = (abs: string) => toPosix(path.relative(REPO, abs));

// ---- .dockerignore, read as Docker reads it (moby/patternmatcher) ------------------------------------------

interface IgnoreRule {
  pattern: string;
  exclude: boolean;
  re: RegExp;
}

// `*` and `?` stay within a path segment; `**` crosses segments (`**/x` matches x at the top too).
function patternRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') i++;
      re += i + 1 === pattern.length ? '.*' : '(.*/)?';
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function parseDockerignore(text: string): IgnoreRule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const exclude = !line.startsWith('!');
      const pattern = path.posix.normalize((exclude ? line : line.slice(1)).replace(/^\/+/, ''));
      return { pattern, exclude, re: patternRegExp(pattern) };
    });
}

/** Docker's rule: the last pattern that matches the path, or one of its parent folders, decides. */
function inContext(rules: readonly IgnoreRule[], file: string): boolean {
  const parts = file.split('/');
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let excluded = false;
  for (const rule of rules) if (paths.some((p) => rule.re.test(p))) excluded = rule.exclude;
  return !excluded;
}

// ---- Dockerfile -------------------------------------------------------------------------------------------

/** The instructions of each stage (`FROM … AS name`), continuation lines joined, comments dropped. */
function dockerStages(text: string): Map<string, string[]> {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line !== '');
  const stages = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines) {
    const from = /^FROM \S+ AS (\S+)$/i.exec(line);
    if (from) stages.set(from[1]!, (current = []));
    else current?.push(line);
  }
  return stages;
}

/** COPY instructions as [sources, destination]; `--from=x` ones only with from, else only the context ones. */
function copies(stage: readonly string[], from?: string): [string[], string][] {
  return stage
    .filter((line) => line.startsWith('COPY '))
    .map((line) => line.split(' ').slice(1))
    .filter((args) => (args[0]?.startsWith('--from=') ? args[0] === `--from=${from}` : from === undefined))
    .map((args) => {
      const paths = args.filter((a) => !a.startsWith('--'));
      return [paths.slice(0, -1), paths.at(-1)!];
    });
}

const stages = dockerStages(read('Dockerfile'));
const stage = (name: string) => {
  const s = stages.get(name);
  if (s === undefined) throw new Error(`The Dockerfile has no stage "${name}"`);
  return s;
};

// ---- the builds -------------------------------------------------------------------------------------------

const serverPkg = JSON.parse(read('apps/server/package.json')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** The server's `build` script (esbuild's command line) as build options. */
function serverBuildOptions(): BuildOptions & { entryPoints: string[]; outfile: string } {
  const args = serverPkg.scripts.build!.split(/\s+/);
  expect(args[0]).toBe('esbuild');
  const flags = new Map<string, string[]>();
  const entryPoints: string[] = [];
  for (const arg of args.slice(1)) {
    const m = /^--([\w-]+)(?:[=:](.*))?$/.exec(arg);
    if (!m) entryPoints.push(arg);
    else flags.set(m[1]!, [...(flags.get(m[1]!) ?? []), m[2] ?? 'true']);
  }
  const one = (name: string) => flags.get(name)?.[0];
  return {
    entryPoints,
    bundle: one('bundle') === 'true',
    platform: one('platform') as BuildOptions['platform'],
    target: one('target'),
    format: one('format') as BuildOptions['format'],
    external: flags.get('external') ?? [],
    outfile: one('outfile')!,
  };
}

const buildInMemory = (options: BuildOptions) =>
  build({ ...options, write: false, metafile: true, logLevel: 'silent' });
const metafile = async (options: BuildOptions): Promise<Metafile> => (await buildInMemory(options)).metafile;

let serverMeta: Metafile;
/** The server bundle's code (dist/index.cjs). */
let serverBundle: string;
let adminMeta: Metafile;

beforeAll(async () => {
  const serverDir = path.join(REPO, 'apps', 'server');
  const server = await buildInMemory({ ...serverBuildOptions(), absWorkingDir: serverDir });
  serverMeta = server.metafile;
  serverBundle = server.outputFiles.map((file) => file.text).join('\n');
  // The admin site's import graph from its entry (Vite builds it; esbuild only follows the imports here).
  adminMeta = await metafile({
    absWorkingDir: path.join(REPO, 'apps', 'admin'),
    entryPoints: ['src/main.tsx'],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    outdir: 'out',
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff2': 'empty' },
  });
}, 60_000);

/** The repo's own files a build read (not node_modules), as repo paths. */
const sourceInputs = (meta: Metafile, workingDir: string) =>
  Object.keys(meta.inputs)
    .filter((input) => !input.includes('node_modules/'))
    .map((input) => fromRepo(path.resolve(REPO, workingDir, input)));

/** The tsconfig.json nearest each file, and what it extends: esbuild and Vite read them. */
function tsconfigsOf(files: readonly string[]): Set<string> {
  const found = new Set<string>();
  const follow = (file: string) => {
    if (found.has(file) || !existsSync(path.join(REPO, file))) return;
    found.add(file);
    const ext = (JSON.parse(read(file)) as { extends?: string }).extends;
    if (ext !== undefined) follow(path.posix.join(path.posix.dirname(file), ext));
  };
  for (const file of files) {
    for (let dir = path.posix.dirname(file); dir !== '.'; dir = path.posix.dirname(dir)) {
      const candidate = `${dir}/tsconfig.json`;
      if (existsSync(path.join(REPO, candidate))) {
        follow(candidate);
        break;
      }
    }
  }
  return found;
}

// ---- package-lock.json --------------------------------------------------------------------------------------

interface LockEntry {
  link?: boolean;
  resolved?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * The packages `npm ci --workspace <dir> --omit=dev --omit=optional` installs for a workspace, from the
 * lockfile: its dependencies and required peers, transitively, found as Node finds them.
 */
function productionClosure(workspace: string): Set<string> {
  const lock = (JSON.parse(read('package-lock.json')) as { packages: Record<string, LockEntry> }).packages;
  const locate = (from: string, name: string): string | undefined => {
    for (let dir = from; ;) {
      const candidate = `${dir === '' ? '' : `${dir}/`}node_modules/${name}`;
      if (lock[candidate] !== undefined) return candidate;
      if (dir === '') return undefined;
      const nested = dir.lastIndexOf('/node_modules/');
      dir = nested >= 0 ? dir.slice(0, nested) : dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
  };
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (location: string) => {
    if (seen.has(location)) return;
    seen.add(location);
    const entry = lock[location]!;
    if (location.includes('node_modules/'))
      names.add(location.slice(location.lastIndexOf('node_modules/') + 13));
    if (entry.link === true && entry.resolved !== undefined) return visit(entry.resolved);
    const peers = Object.keys(entry.peerDependencies ?? {}).filter(
      (name) => entry.peerDependenciesMeta?.[name]?.optional !== true,
    );
    for (const name of [...Object.keys(entry.dependencies ?? {}), ...peers]) {
      const found = locate(location, name);
      if (found === undefined)
        throw new Error(`${location} needs ${name}, which is not in package-lock.json`);
      visit(found);
    }
  };
  visit(workspace);
  return names;
}

const packageName = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

// ---- the tests ----------------------------------------------------------------------------------------------

describe('the Docker build context (.dockerignore)', () => {
  const rules = parseDockerignore(read('.dockerignore'));
  const buildSources = copies(stage('build')).flatMap(([sources]) => sources);
  const manifestSources = copies(stage('manifests')).flatMap(([sources]) => sources);
  const copied = (file: string) =>
    [...manifestSources, ...buildSources].some((src) => file === src || file.startsWith(`${src}/`));

  it('reads its patterns the way Docker does', () => {
    const r = parseDockerignore('*\n!src\nsrc/**/*.test.ts\n**/.env\n');
    expect(inContext(r, 'README.md')).toBe(false);
    expect(inContext(r, 'docs/a/b.md')).toBe(false);
    expect(inContext(r, 'src/a/b.ts')).toBe(true);
    expect(inContext(r, 'src/a/b.test.ts')).toBe(false);
    expect(inContext(r, 'src/b.test.ts')).toBe(false); // ** matches no folder too
    expect(inContext(r, '.env')).toBe(false);
    expect(inContext(r, 'src/deep/.env')).toBe(false);
  });

  it('has every file the server bundle is built from, and the build stage copies it', () => {
    const inputs = sourceInputs(serverMeta, 'apps/server');
    expect(inputs).toContain('apps/server/src/index.ts');
    expect(inputs).toContain('packages/engine/src/index.ts');
    for (const file of [...inputs, ...tsconfigsOf(inputs)]) {
      expect({ file, inContext: inContext(rules, file), copied: copied(file) }).toEqual({
        file,
        inContext: true,
        copied: true,
      });
    }
  });

  it("has every file of the admin site's build, and the build stage copies it", () => {
    const inputs = sourceInputs(adminMeta, 'apps/admin');
    expect(inputs).toContain('apps/admin/src/main.tsx');
    const site = ['apps/admin/index.html', 'apps/admin/vite.config.ts', 'apps/admin/public/favicon.svg'];
    for (const file of [...inputs, ...site, ...tsconfigsOf(inputs), 'apps/admin/tsconfig.app.json']) {
      expect({ file, inContext: inContext(rules, file), copied: copied(file) }).toEqual({
        file,
        inContext: true,
        copied: true,
      });
    }
  });

  it('has the files `npm ci` and the runtime need: manifests, lockfile, migrations, puzzle bank', () => {
    for (const file of [
      'package.json',
      'package-lock.json',
      'packages/engine/package.json',
      'packages/protocol/package.json',
      'apps/server/package.json',
      'apps/admin/package.json',
      'apps/server/drizzle/meta/_journal.json',
      'packages/engine/data/puzzles.json',
    ]) {
      expect({ file, inContext: inContext(rules, file) }).toEqual({ file, inContext: true });
    }
  });

  it('keeps out the app (its package.json would make `npm ci` install Expo), builds, local data and secrets', () => {
    for (const file of [
      'apps/mobile/package.json',
      'apps/mobile/src/config/server.ts',
      'apps/mobile/config/firebase/google-services.json',
      'apps/mobile/config/firebase/GoogleService-Info.plist',
      'apps/admin/dist/index.html',
      'apps/server/dist/index.cjs',
      'apps/server/.env',
      'apps/server/.env.production',
      'apps/server/.data/pglite/PG_VERSION',
      'node_modules/express/package.json',
      'apps/server/node_modules/x/index.js',
      'packages/engine/src/rules/scoring.test.ts',
      'apps/admin/src/App.test.tsx',
      'apps/server/src/service-account-prod.json',
      'apps/server/src/keys/server.pem',
      'packages/engine/data/upload.keystore',
      'release.jks',
      '.git/config',
      'docs/01-SPEC.md',
      'archive/old.ts',
      'assets-src/avatars/a.svg',
      'assets/puzzles/sudoku-bank-690.csv',
      'CLAUDE.md',
    ]) {
      expect({ file, inContext: inContext(rules, file) }).toEqual({ file, inContext: false });
    }
  });
});

describe('the server image (Dockerfile)', () => {
  it("installs what the bundle requires at run time: production dependencies of the server, in npm ci's set", () => {
    const externals = new Set<string>();
    for (const output of Object.values(serverMeta.outputs)) {
      for (const imp of output.imports) {
        if (imp.external && !isBuiltin(imp.path)) externals.add(packageName(imp.path));
      }
    }
    expect([...externals].sort()).toEqual(
      expect.arrayContaining(['@colyseus/core', '@colyseus/ws-transport', '@electric-sql/pglite', 'express']),
    );

    const installed = productionClosure('apps/server');
    for (const name of externals) {
      expect({ name, dependency: name in serverPkg.dependencies, installed: installed.has(name) }).toEqual({
        name,
        dependency: true,
        installed: true,
      });
    }
    // The closure is the server's: nothing of the app's, which drizzle-orm's optional peers would reach.
    expect(installed.has('react-native')).toBe(false);
    expect(installed.has('expo-sqlite')).toBe(false);

    const npmCi = stage('prod-deps').find((line) => line.includes('npm ci'));
    expect(npmCi).toMatch(/--workspace @sudoku-fight\/server /);
    expect(npmCi).toMatch(/--omit=dev --omit=optional/);
  });

  it('what the code finds with require.resolve() at run time (the puzzle bank) is in the image too', () => {
    const installed = productionClosure('apps/server');
    const lock = (JSON.parse(read('package-lock.json')) as { packages: Record<string, LockEntry> }).packages;
    const runtimeDirs = copies(stage('runtime'), 'build').map(([, dest]) => dest.replace(/\/$/, ''));
    for (const [, specifier] of serverBundle.matchAll(/require\.resolve\(\s*["']([^"']+)["']/g)) {
      const name = packageName(specifier!);
      expect({ specifier, installed: installed.has(name) }).toEqual({ specifier, installed: true });
      // A workspace package is a link to its folder: the runtime stage must copy its package.json there.
      const entry = lock[`node_modules/${name}`];
      if (entry?.link === true) expect(runtimeDirs).toContain(entry.resolved);
    }
  });

  it('the runtime stage has the bundle, and what the bundle looks for next to itself', () => {
    const runtime = stage('runtime');
    const destinations = copies(runtime, 'build').map(([, dest]) => dest.replace(/\/$/, ''));
    const bundle = path.posix.join('apps/server', serverBuildOptions().outfile);
    const dist = path.posix.dirname(bundle);
    expect(destinations).toEqual(
      expect.arrayContaining([
        dist,
        path.posix.join(dist, '..', 'drizzle'), // src/db findMigrationsFolder(), from the bundle
        path.posix.join(dist, '..', '..', 'admin', 'dist'), // src/admin/site.ts findAdminSiteDir()
        'packages/engine/data',
      ]),
    );
    expect(copies(runtime, 'prod-deps').map(([, dest]) => dest)).toContain('node_modules');
    expect(runtime).toContain(`CMD ["node", "${bundle}"]`);
  });

  it('runs as a non-root user, in production, on the default port, with a health check on /health', () => {
    const runtime = stage('runtime');
    expect(runtime).toContain('USER node');
    expect(runtime.find((line) => line.startsWith('ENV '))).toMatch(/\bNODE_ENV=production\b/);
    expect(runtime).toContain(`EXPOSE ${DEFAULT_PORT}`);
    expect(runtime.find((line) => line.startsWith('HEALTHCHECK '))).toContain("'/health'");
  });
});

describe('fly.toml (staging)', () => {
  const fly = read('fly.toml');
  const value = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(fly)?.[1];

  it('one machine in fra that stays up, on the server port, behind HTTPS', () => {
    expect(value('primary_region')).toBe('"fra"');
    expect(value('internal_port')).toBe(String(DEFAULT_PORT));
    expect(value('force_https')).toBe('true');
    expect(value('auto_stop_machines')).toMatch(/^("off"|false)$/);
    expect(value('min_machines_running')).toBe('1');
    expect(value('NODE_ENV')).toBe('"production"');
    expect(value('TRUST_PROXY')).toBe('"1"');
  });

  it('checks /health, allows many WebSockets, and holds no secret', () => {
    expect(value('path')).toBe('"/health"');
    expect(value('type')).toBe('"connections"');
    expect(Number(value('hard_limit'))).toBeGreaterThanOrEqual(500);
    for (const secret of ['DATABASE_URL', 'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET']) {
      expect(value(secret)).toBeUndefined();
    }
  });
});
