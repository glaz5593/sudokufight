// `npm run apk`: a release APK for the test phones, built on this PC whenever Moshe likes (docs/BUILD-APK.md).
// EAS (the cloud, 15 Android builds a month on the free plan) stays for the store versions.
//
//   npm run apk                          staging server (eas.json's preview profile)
//   npm run apk -- --install             ... and install it on every phone adb sees
//   npm run apk -- --server local        a server on this PC (npm run server), for phones on the same Wi-Fi
//   npm run apk -- --help                every option
//
// Steps: checks (disk, Java, Android SDK, Firebase file) → `expo prebuild` (android/, from app.json and
// app.config.ts; only when they changed, since every prebuild writes android/ anew) → `gradlew assembleRelease`
// for arm64-v8a only, the JS bundled every time, with the server's EXPO_PUBLIC_* set (Metro inlines them into
// the bundle) → a look inside the APK (signed, one ABI, the server's host in the bundle) → apps/mobile/apk/ (the
// newest 3 kept) → optional install.
//
// Release builds are signed with the debug keystore that Expo's template puts in android/app (checked in
// android/app/build.gradle before every build). EAS signs with its own key, so an APK from here and one from
// the cloud can't update each other: a phone switching between them uninstalls the app once.
//
// The pure parts (and their tests) are in lib/build-apk.mjs. Gradle's output goes to apps/mobile/apk/last-build.log.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ABI,
  ABORT_FREE,
  apkFileName,
  apkProblems,
  apksToPrune,
  describeServer,
  EXIT,
  failureSummary,
  formatBytes,
  formatDuration,
  gradleArgs,
  gradleTask,
  inspectApk,
  installedVersions,
  installFailure,
  isFileLock,
  isLockedError,
  isOutOfMemory,
  javaMajorVersion,
  appJsonFiles,
  MIN_FREE_FULL,
  MIN_FREE_INCREMENTAL,
  nativeConfigHash,
  newestApk,
  PACKAGE,
  packageDeps,
  parseAdbDevices,
  parseApkArgs,
  prebuildPlan,
  releaseSigningConfig,
  REPLACEABLE,
  resolveServer,
  serverEnv,
  staleConfigDirs,
  uninstallCommand,
  USAGE,
} from './lib/build-apk.mjs';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(MOBILE, '..', '..');
const ANDROID = join(MOBILE, 'android');
const APK_DIR = join(MOBILE, 'apk');
const LOG_FILE = join(APK_DIR, 'last-build.log');
const HASH_FILE = join(ANDROID, '.sf-prebuild-hash');
const FIREBASE_FILE = join(MOBILE, 'config', 'firebase', 'google-services.json');
const BUILT_APK = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const WINDOWS = process.platform === 'win32';
const GRADLEW = join(ANDROID, WINDOWS ? 'gradlew.bat' : 'gradlew');
const requireFromApp = createRequire(join(MOBILE, 'package.json'));

/** How often the console hears from a long Gradle run, and how often the free space is checked. */
const HEARTBEAT_MS = 60_000;
const DISK_CHECK_MS = 15_000;

const rel = (path) => relative(REPO, path) || '.';
const say = (text = '') => console.log(text);

class Failure extends Error {
  /** @param {string} message @param {number} code */
  constructor(message, code = EXIT.failed) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------- this PC

function freeBytes() {
  try {
    const stats = statfsSync(MOBILE);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function androidSdk() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv) return fromEnv;
  if (WINDOWS && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Android', 'sdk')
    : join(homedir(), 'Android', 'Sdk');
}

function adbPath() {
  const inSdk = join(androidSdk(), 'platform-tools', WINDOWS ? 'adb.exe' : 'adb');
  return existsSync(inSdk) ? inSdk : 'adb';
}

/** React Native's NDK (what the build uses), from its version catalog. */
function requiredNdk() {
  try {
    const toml = readFileSync(
      join(dirname(requireFromApp.resolve('react-native/package.json')), 'gradle', 'libs.versions.toml'),
      'utf8',
    );
    return /^ndkVersion\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The version of a package as installed: apps/mobile/node_modules first, then the root's (npm workspaces hoist
 * most there). By path, since a package whose `exports` leaves out package.json can't be require.resolve'd.
 */
function installedVersion(name) {
  for (const nodeModules of [join(MOBILE, 'node_modules'), join(REPO, 'node_modules')]) {
    try {
      return JSON.parse(readFileSync(join(nodeModules, name, 'package.json'), 'utf8')).version;
    } catch {
      // not here
    }
  }
  return null;
}

function gitInfo() {
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  if (sha.status !== 0) return { sha: 'nogit', dirty: false };
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  return { sha: sha.stdout.trim(), dirty: status.status !== 0 || status.stdout.trim() !== '' };
}

/** Java, the Android SDK, the NDK and the Firebase file: problems stop the build, warnings don't. */
function checkTools() {
  const problems = [];
  const warnings = [];
  const info = [];

  const javaHome = process.env.JAVA_HOME;
  const java = javaHome ? join(javaHome, 'bin', WINDOWS ? 'java.exe' : 'java') : 'java';
  const run = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const major = run.error ? null : javaMajorVersion(`${run.stderr}${run.stdout}`);
  if (major === null)
    problems.push(
      javaHome
        ? `Java not found in JAVA_HOME (${javaHome}): install JDK 17 and point JAVA_HOME at it`
        : 'Java not found: install JDK 17 and set JAVA_HOME',
    );
  else if (major < 17) problems.push(`Java ${major} found, Gradle needs JDK 17 (set JAVA_HOME)`);
  else info.push(`java     ${major}${javaHome ? ` (${javaHome})` : ' (from PATH)'}`);

  const sdk = androidSdk();
  if (!existsSync(join(sdk, 'platforms')) && !existsSync(join(sdk, 'build-tools')))
    problems.push(`Android SDK not found at ${sdk}: install Android Studio's SDK, or set ANDROID_HOME`);
  else {
    info.push(`sdk      ${sdk}`);
    const ndk = requiredNdk();
    if (ndk && !existsSync(join(sdk, 'ndk', ndk)))
      warnings.push(`NDK ${ndk} is not installed: Gradle downloads it now (about 2.5 GB on disk)`);
  }

  if (WINDOWS) {
    const studio = spawnSync('tasklist', ['/FI', 'IMAGENAME eq studio64.exe', '/NH'], { encoding: 'utf8' });
    if (/studio64\.exe/i.test(studio.stdout ?? ''))
      warnings.push(
        'Android Studio is open: it holds gigabytes of memory, and when memory runs short Windows grows its',
        'page file on drive C. If the build stops for disk space, close Android Studio and run it again.',
      );
  }

  if (existsSync(FIREBASE_FILE)) info.push('firebase google-services.json found');
  else
    warnings.push(
      '!!! google-services.json is MISSING (apps/mobile/config/firebase/).',
      '!!! The APK will have no Firebase: sign-in will NOT work against the staging or production server.',
    );
  return { problems, warnings, info };
}

// ---------------------------------------------------------------- running things

/** The log every child process writes to (Gradle's output is long; the console gets a summary). */
let log = null;

function openLog() {
  mkdirSync(APK_DIR, { recursive: true });
  log = createWriteStream(LOG_FILE, { flags: 'w' });
  log.write(`npm run apk ${process.argv.slice(2).join(' ')}\n${new Date().toISOString()}\n\n`);
}

function closeLog() {
  const stream = log;
  log = null;
  return new Promise((done) => (stream ? stream.end(done) : done()));
}

/**
 * Runs a command, its output to the log (and the console with --verbose), each line to `onLine`.
 * Resolves with the exit code.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string; env: NodeJS.ProcessEnv; shell?: boolean; verbose?: boolean; onLine?: (line: string) => void; onStart?: (child: import('node:child_process').ChildProcess) => void }} options
 */
function run(command, args, { cwd, env, shell = false, verbose = false, onLine, onStart }) {
  return new Promise((done) => {
    log?.write(`\n$ ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    onStart?.(child);
    for (const stream of [child.stdout, child.stderr]) {
      let partial = '';
      stream.on('data', (chunk) => {
        log?.write(chunk);
        if (verbose) process.stdout.write(chunk);
        if (!onLine) return;
        const lines = (partial + chunk.toString('utf8')).split(/\r?\n/);
        partial = lines.pop() ?? '';
        for (const line of lines) onLine(line);
      });
    }
    child.on('error', (error) => {
      log?.write(`\n${error.message}\n`);
      done(127);
    });
    child.on('close', (code) => done(code ?? 1));
  });
}

/**
 * gradlew. A .bat needs cmd.exe (Node won't start one directly), and its full path: shells on this PC may set
 * NoDefaultCurrentDirectoryInExePath, which hides gradlew.bat in the current folder from cmd.
 */
const gradle = (args, options) =>
  WINDOWS
    ? run(`"${GRADLEW}" ${args.join(' ')}`, [], { ...options, shell: true })
    : run(GRADLEW, args, options);

/** Stops the Gradle daemon, which keeps files in android/ and node_modules/*\/android/build open. */
async function stopGradle(env) {
  if (existsSync(GRADLEW)) await gradle(['--stop'], { cwd: ANDROID, env });
}

function killTree(child) {
  if (child.pid === undefined) return;
  if (WINDOWS) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

/** Everything a build step runs with: the server, production, no .env files, never "CI", never "EAS". */
function buildEnv(server) {
  const env = { ...process.env, ...serverEnv(server), NODE_ENV: 'production' };
  // apps/mobile/.env.local (npm run dev:lan writes a LAN address there) must not decide the APK's server.
  env.EXPO_NO_DOTENV = '1';
  // android/ is gitignored: prebuild --clean needn't ask about uncommitted changes.
  env.EXPO_NO_GIT_STATUS = '1';
  // React Native's Gradle plugin resets Metro's cache for each release bundle, except when CI is set. A kept
  // cache could keep EXPO_PUBLIC_* values from the last build (another server) in the bundle.
  delete env.CI;
  // app.config.ts gives builds on this PC their own plugins, and never lets an EAS build allow cleartext.
  delete env.EAS_BUILD;
  // The APK is signed with the template debug key: app.config.ts shows "המשך עם Google" only while Firebase
  // lists that key's SHA-1 (it can't work otherwise).
  env.SF_LOCAL_APK = '1';
  if (server.secure) delete env.SF_ALLOW_CLEARTEXT;
  else env.SF_ALLOW_CLEARTEXT = '1';
  if (!env.ANDROID_HOME) env.ANDROID_HOME = androidSdk();
  return env;
}

// ---------------------------------------------------------------- prebuild

function listFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Whether an earlier build's library outputs are still here (`--clean` deletes them). */
function librariesBuilt() {
  try {
    const core = dirname(requireFromApp.resolve('expo-modules-core/package.json'));
    return existsSync(join(core, 'android', 'build'));
  } catch {
    return false;
  }
}

/** What android/ is generated from (lib: nativeConfigHash). */
function nativeInputs(server) {
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const appJson = read(join(MOBILE, 'app.json')) ?? '{}';
  const packageJson = readFileSync(join(MOBILE, 'package.json'), 'utf8');
  /** @type {[string, string | null][]} */
  const inputs = [
    ['package.json dependencies', packageDeps(packageJson)],
    ['app.json', appJson],
    ['app.config.ts', read(join(MOBILE, 'app.config.ts'))],
    ['google-services.json', read(FIREBASE_FILE)],
    ['cleartext', server.secure ? 'no' : 'yes'],
    ...installedVersions(packageJson, installedVersion),
  ];
  for (const name of listFiles(join(MOBILE, 'plugins')))
    inputs.push([`plugins/${name}`, read(join(MOBILE, 'plugins', name))]);
  // Icons, the splash image, fonts: binary, so by their own hash.
  for (const path of appJsonFiles(appJson)) {
    const full = resolve(MOBILE, path);
    const digest = existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null;
    inputs.push([`app.json file ${path}`, digest]);
  }
  return inputs;
}

/**
 * Gradle's task history (android/.gradle) set aside during a prebuild, which writes android/ anew. Without it
 * Gradle can't tell the libraries' outputs in node_modules (kept) are up to date, and builds everything again:
 * 20 minutes and more instead of a few. Gradle checks each output against its inputs, so a history that no
 * longer fits only means those tasks run.
 */
const GRADLE_HISTORY = join(ANDROID, '.gradle');
const GRADLE_HISTORY_ASIDE = join(APK_DIR, '.android-gradle');

/** The release signing in android/app/build.gradle (lib: releaseSigningConfig); throws when there is none. */
function releaseSigning() {
  const signing = releaseSigningConfig(readFileSync(join(ANDROID, 'app', 'build.gradle'), 'utf8'));
  if (signing === null)
    throw new Failure(
      'android/app/build.gradle signs no release build: the APK would be unsigned and no phone would install it',
    );
  return signing;
}

/** A file call that another program's open file can make fail on Windows: a Failure that says so. */
function inUse(error, what) {
  log?.write(`\n${what}: ${error.message}\n`);
  return isLockedError(error)
    ? new Failure(
        `${what}: another program has its files open (Android Studio, or an antivirus scan). ` +
          'Close Android Studio and run the build again.',
      )
    : new Failure(`${what}: ${error.message}`);
}

async function prebuild(plan, hash, env) {
  if (existsSync(GRADLE_HISTORY)) {
    // The daemon holds files in android/: Windows can't delete or move them while it runs.
    await stopGradle(env);
    try {
      rmSync(GRADLE_HISTORY_ASIDE, { recursive: true, force: true });
      mkdirSync(APK_DIR, { recursive: true });
      renameSync(GRADLE_HISTORY, GRADLE_HISTORY_ASIDE);
    } catch (error) {
      // Nothing has moved yet: android/ is as it was. Prebuild would fail on the same open files.
      throw inUse(error, 'Could not move android/.gradle aside for expo prebuild');
    }
  }
  const cli = requireFromApp.resolve('expo/bin/cli');
  const args = [cli, 'prebuild', '--platform', 'android', '--no-install', ...(plan.clean ? ['--clean'] : [])];
  const code = await run(process.execPath, args, { cwd: MOBILE, env });
  if (existsSync(GRADLE_HISTORY_ASIDE) && existsSync(ANDROID) && !existsSync(GRADLE_HISTORY)) {
    try {
      renameSync(GRADLE_HISTORY_ASIDE, GRADLE_HISTORY);
    } catch (error) {
      // Only time is lost: the libraries are checked again (the next prebuild deletes the copy in apk/).
      log?.write(`\ncould not put android/.gradle back: ${error.message}\n`);
      say("      note: Gradle's history could not be put back, so this build takes longer");
    }
  }
  if (code !== 0) throw new Failure(`expo prebuild failed (exit ${code}). Its output: ${rel(LOG_FILE)}`);
  writeFileSync(HASH_FILE, `${hash}\n`);
}

// ---------------------------------------------------------------- gradle

/** Gradle's output lines kept for the summary of a failure (all of it is in the log). */
const TAIL_LINES = 3000;

/** One Gradle run: its exit code, the end of its output, and whether the disk watchdog stopped it. */
async function gradleRun(env, verbose) {
  const started = Date.now();
  let lastTask = null;
  let child = null;
  let lowDisk = null;
  const tail = [];
  const heartbeat = setInterval(() => {
    const free = freeBytes();
    say(
      `      ${formatDuration(Date.now() - started)}  ${lastTask ?? 'starting'}` +
        (free === null ? '' : `  (${formatBytes(free)} free)`),
    );
  }, HEARTBEAT_MS);
  const watchdog = setInterval(() => {
    const free = freeBytes();
    if (free !== null && free < ABORT_FREE && child && lowDisk === null) {
      lowDisk = free;
      killTree(child);
    }
  }, DISK_CHECK_MS);

  const code = await gradle(gradleArgs(), {
    cwd: ANDROID,
    env,
    verbose,
    onStart: (spawned) => (child = spawned),
    onLine: (line) => {
      lastTask = gradleTask(line) ?? lastTask;
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
    },
  });
  clearInterval(heartbeat);
  clearInterval(watchdog);
  return { code, text: tail.join('\n'), lowDisk };
}

/** gradlew assembleRelease (lib: gradleArgs; the JS is bundled on every run, so it is never an old one). */
async function assemble(env, verbose) {
  let attempt = await gradleRun(env, verbose);
  // A file Windows keeps open for a moment (an antivirus scan, Android Studio's indexer) fails a task that
  // replaces it. Once more, after the daemon is gone, usually goes through.
  if (attempt.code !== 0 && attempt.lowDisk === null && isFileLock(attempt.text)) {
    say('      a file was in use by another program; trying once more');
    await stopGradle(env);
    attempt = await gradleRun(env, verbose);
  }
  if (attempt.lowDisk !== null) {
    await stopGradle(env);
    throw new Failure(
      `Stopped: drive C is almost full (${formatBytes(attempt.lowDisk)} free). Free some space ` +
        '(empty the Recycle Bin, close Android Studio), or run: npm run apk -- --clean-only',
    );
  }
  if (attempt.code !== 0) {
    await stopGradle(env);
    say(failureSummary(attempt.text));
    const hint = isOutOfMemory(attempt.text)
      ? 'Gradle ran out of memory: close other programs (Android Studio) and run it again.'
      : 'If the error mentions a stale or missing file, try: npm run apk -- --clean-native';
    throw new Failure(`Gradle failed (exit ${attempt.code}). ${hint} Full log: ${rel(LOG_FILE)}`);
  }
  if (!existsSync(BUILT_APK)) throw new Failure(`Gradle finished but ${rel(BUILT_APK)} is missing`);
}

// ---------------------------------------------------------------- the APK

function apkFiles() {
  return listFiles(APK_DIR)
    .filter((name) => name.toLowerCase().endsWith('.apk'))
    .map((name) => ({ name, mtimeMs: statSync(join(APK_DIR, name)).mtimeMs }));
}

function checkApk(server) {
  const report = inspectApk(readFileSync(BUILT_APK), server.host);
  const problems = apkProblems(report, server.host);
  if (problems.length > 0)
    throw new Failure(
      `The APK is not right: ${problems.join('; ')}. Try once more from scratch: npm run apk -- --clean-native`,
    );
  say(`      signed; native code for ${report.abis.join(', ')}; ${server.host} is in the JS bundle`);
}

function keepApk(server, version, git) {
  mkdirSync(APK_DIR, { recursive: true });
  const target = join(APK_DIR, apkFileName({ version, ...git, label: server.label }));
  copyFileSync(BUILT_APK, target);
  for (const old of apksToPrune(apkFiles())) rmSync(join(APK_DIR, old), { force: true });
  return target;
}

// ---------------------------------------------------------------- phones

const STATE_HINTS = {
  unauthorized: 'unlock the phone and accept "Allow USB debugging?"',
  offline: 'replug the cable, or restart USB debugging on the phone',
};

/** Installs on every phone adb lists, one after the other. True when all of them got it. */
function installOnPhones(apk, replace) {
  const adb = adbPath();
  const list = spawnSync(adb, ['devices', '-l'], { encoding: 'utf8' });
  if (list.error) {
    say('  adb not found: install Android SDK Platform-Tools (Android Studio > SDK Manager).');
    return false;
  }
  const devices = parseAdbDevices(list.stdout);
  if (devices.length === 0) {
    say('  No phone found. Connect one with USB debugging on (docs/BUILD-APK.md),');
    say('  or copy the APK file to the phone and open it there.');
    return false;
  }
  let allOk = true;
  for (const device of devices) {
    const name = device.model ? `${device.serial} (${device.model})` : device.serial;
    if (device.state !== 'device') {
      say(`  ${name}: ${device.state}: ${STATE_HINTS[device.state] ?? 'not ready'}`);
      allOk = false;
      continue;
    }
    const install = () => {
      const result = spawnSync(adb, ['-s', device.serial, 'install', '-r', apk], {
        encoding: 'utf8',
        timeout: 5 * 60_000,
      });
      log?.write(`\n$ adb -s ${device.serial} install -r ${apk}\n${result.stdout}${result.stderr}\n`);
      return installFailure(
        `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? result.error.message : ''}`,
      );
    };
    say(`  ${name}: installing...`);
    let failure = install();
    if (failure?.code && REPLACEABLE.includes(failure.code) && replace) {
      say(`  ${name}: the app there has another signature; uninstalling it first (--replace)`);
      spawnSync(adb, ['-s', device.serial, 'uninstall', PACKAGE], { encoding: 'utf8' });
      failure = install();
    }
    if (failure === null) {
      say(`  ${name}: installed`);
      continue;
    }
    allOk = false;
    say(`  ${name}: FAILED${failure.code ? ` ${failure.code}` : ''}: ${failure.hint}`);
    if (failure.code && REPLACEABLE.includes(failure.code)) {
      say('    Uninstall it once (this deletes the app and its data on that phone):');
      say(`      ${uninstallCommand(device.serial)}`);
      say(
        '    then: npm run apk -- --install-only   (or both at once: npm run apk -- --install-only --replace)',
      );
    }
  }
  return allOk;
}

// ---------------------------------------------------------------- --clean

/** Package folders in a node_modules (scoped ones too). */
function packageDirs(nodeModules) {
  const dirs = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(path, { withFileTypes: true }))
        if (scoped.isDirectory()) dirs.push(join(path, scoped.name));
    } else dirs.push(path);
  }
  return dirs;
}

/** .cxx folders (CMake's) under android/, a few levels deep. */
function cxxDirs(dir, depth) {
  if (depth < 0 || !existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'build' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.name === '.cxx') found.push(path);
    else found.push(...cxxDirs(path, depth - 1));
  }
  return found;
}

/**
 * The big folders a build leaves: compiled C++ and Java/Kotlin of the app and of every library. The app's C++
 * builds in ~/.sudoku-fight/cxx on Windows (plugins/with-local-native-build.js).
 */
function heavyFolders() {
  const found = [
    join(ANDROID, 'app', 'build', 'intermediates'),
    ...cxxDirs(ANDROID, 3),
    join(homedir(), '.sudoku-fight', 'cxx'),
  ];
  for (const nodeModules of [join(REPO, 'node_modules'), join(MOBILE, 'node_modules')]) {
    if (!existsSync(nodeModules)) continue;
    for (const pkg of packageDirs(nodeModules))
      found.push(join(pkg, 'android', '.cxx'), join(pkg, 'android', 'build'));
  }
  return found.filter((path) => existsSync(path));
}

function folderSize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      try {
        for (const name of readdirSync(current)) stack.push(join(current, name));
      } catch {
        // unreadable: not counted
      }
    } else total += stats.size;
  }
  return total;
}

/** The folders where CMake keeps one folder per configuration of a module (lib: staleConfigDirs). */
function cxxConfigParents() {
  const parents = [join(homedir(), '.sudoku-fight', 'cxx', 'RelWithDebInfo')];
  for (const nodeModules of [join(REPO, 'node_modules'), join(MOBILE, 'node_modules')]) {
    if (!existsSync(nodeModules)) continue;
    for (const pkg of packageDirs(nodeModules)) {
      const android = join(pkg, 'android');
      parents.push(
        join(android, '.cxx', 'RelWithDebInfo'),
        join(android, 'build', 'intermediates', 'cxx', 'RelWithDebInfo'),
      );
    }
  }
  return parents.filter((path) => existsSync(path));
}

/** Deletes the C++ build folders of earlier configurations; returns the bytes freed. */
function pruneStaleCxx() {
  let freed = 0;
  for (const parent of cxxConfigParents()) {
    const dirs = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, mtimeMs: statSync(join(parent, entry.name)).mtimeMs }));
    for (const name of staleConfigDirs(dirs)) {
      const path = join(parent, name);
      const size = folderSize(path);
      try {
        rmSync(path, { recursive: true, force: true, maxRetries: 3 });
        freed += size;
        log?.write(`removed old C++ configuration ${path}\n`);
      } catch (error) {
        log?.write(`could not delete ${path}: ${error.message}\n`);
      }
    }
  }
  return freed;
}

async function clean(env) {
  await stopGradle(env);
  let freed = 0;
  let failed = 0;
  for (const folder of heavyFolders()) {
    const size = folderSize(folder);
    try {
      rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
      freed += size;
    } catch (error) {
      failed++;
      log?.write(`could not delete ${folder}: ${error.message}\n`);
    }
  }
  say(`      freed ${formatBytes(freed)}${failed ? ` (${failed} folders in use, kept)` : ''}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const parsed = parseApkArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    say(USAGE);
    return EXIT.ok;
  }
  if (parsed.kind === 'error') {
    console.error(`npm run apk: ${parsed.error}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const options = parsed.options;
  const started = Date.now();
  /** @type {[string, number][]} */
  const timings = [];
  const phase = async (name, fn) => {
    const start = Date.now();
    say(`[${name}]`);
    const result = await fn();
    const took = Date.now() - start;
    timings.push([name, took]);
    say(`      ${name} took ${formatDuration(took)}`);
    return result;
  };
  const freeAtStart = freeBytes();

  if (options.installOnly) {
    const newest = newestApk(apkFiles());
    if (!newest) throw new Failure(`No APK in ${rel(APK_DIR)} yet: run npm run apk first`, EXIT.preflight);
    say(`Installing ${rel(join(APK_DIR, newest))}`);
    return installOnPhones(join(APK_DIR, newest), options.replace) ? EXIT.ok : EXIT.install;
  }
  if (options.cleanOnly) {
    await phase('clean', () => clean({ ...process.env }));
    const free = freeBytes();
    if (free !== null) say(`Free on drive C: ${formatBytes(free)}`);
    return EXIT.ok;
  }

  const easJson = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8'));
  const resolved = resolveServer(options.server, easJson, networkInterfaces());
  if (resolved.kind === 'error') {
    console.error(`npm run apk: ${resolved.error}`);
    return EXIT.usage;
  }
  const server = resolved.server;
  const version = JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')).expo.version;
  const git = gitInfo();
  const hash = nativeConfigHash(nativeInputs(server));
  const plan = prebuildPlan({
    androidExists: existsSync(ANDROID),
    storedHash: existsSync(HASH_FILE) ? readFileSync(HASH_FILE, 'utf8').trim() : null,
    currentHash: hash,
    cleanNative: options.cleanNative,
  });
  // The libraries (node_modules/*/android/build) are most of a build: without them it starts from nothing.
  const full = !librariesBuilt();
  const apkName = apkFileName({ version, ...git, label: server.label });

  say('Sudoku Fight: release APK on this PC');
  say(`  server   ${describeServer(server)}  [${server.source}]`);
  say(`  apk      ${rel(join(APK_DIR, apkName))}`);
  say(`  prebuild ${plan.run ? 'yes' : 'no'} (${plan.reason})`);
  if (freeAtStart !== null) say(`  disk     ${formatBytes(freeAtStart)} free on drive C`);
  if (!server.secure)
    say('  note     plain ws:// (no TLS): the APK allows cleartext traffic; for testing on your Wi-Fi only');
  if (options.dryRun) return EXIT.ok;

  const tools = checkTools();
  for (const line of tools.info) say(`  ${line}`);
  for (const line of tools.warnings) say(line);
  const needed = full ? MIN_FREE_FULL : MIN_FREE_INCREMENTAL;
  if (freeAtStart !== null && freeAtStart < needed)
    tools.problems.push(
      `only ${formatBytes(freeAtStart)} free on drive C; ${full ? 'a first' : 'this'} build needs ${formatBytes(needed)}. ` +
        'Free some space (Recycle Bin, Downloads), or: npm run apk -- --clean-only',
    );
  if (tools.problems.length > 0) {
    for (const problem of tools.problems) console.error(`  cannot build: ${problem}`);
    return EXIT.preflight;
  }

  openLog();
  say(`  log      ${rel(LOG_FILE)}`);
  const env = buildEnv(server);
  if (plan.run) await phase('prebuild', () => prebuild(plan, hash, env));
  else say(`[prebuild] skipped: ${plan.reason}`);
  const signing = releaseSigning();
  say(`      release builds are signed with the ${signing} key (android/app/build.gradle)`);
  say(`[gradle] assembleRelease for ${ABI}${full ? ': everything from the start, 30 to 45 minutes' : ''}`);
  const stale = pruneStaleCxx();
  if (stale > 0) say(`      deleted old C++ build folders: ${formatBytes(stale)}`);
  const gradleStart = Date.now();
  await assemble(env, options.verbose);
  // An idle daemon keeps its memory for hours, and on Windows memory in use keeps the page file on drive C big.
  await stopGradle(env);
  timings.push(['gradle', Date.now() - gradleStart]);
  say(`      gradle took ${formatDuration(Date.now() - gradleStart)}`);
  await phase('check', () => checkApk(server));
  const target = await phase('copy', () => keepApk(server, version, git));
  // A configuration this build replaced (a new NDK, other C++ arguments) leaves its C++ folders behind.
  const replaced = pruneStaleCxx();
  if (replaced > 0) say(`      deleted old C++ build folders: ${formatBytes(replaced)}`);

  let code = EXIT.ok;
  if (options.install) {
    const ok = await phase('install', () => installOnPhones(target, options.replace));
    if (!ok) code = EXIT.install;
  }
  if (options.clean) await phase('clean', () => clean(env));

  const free = freeBytes();
  say('');
  say(`APK: ${target}`);
  say(`     ${formatBytes(statSync(target).size)}, built in ${formatDuration(Date.now() - started)}`);
  say(`     ${timings.map(([name, ms]) => `${name} ${formatDuration(ms)}`).join(', ')}`);
  if (free !== null) say(`Free on drive C: ${formatBytes(free)}`);
  if (!options.install)
    say('Install: npm run apk -- --install-only  (phones on USB), or copy the file to the phone.');
  return code;
}

main()
  .catch((error) => {
    if (error instanceof Failure) {
      console.error(`\nnpm run apk: ${error.message}`);
      return error.code;
    }
    console.error(error);
    return EXIT.failed;
  })
  .then(async (code) => {
    await closeLog();
    process.exit(code);
  });
