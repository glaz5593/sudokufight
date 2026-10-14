/**
 * The pure parts of `npm run apk` (scripts/build-apk.mjs): the command line, which game server the APK points
 * at (eas.json's profiles, this PC's LAN address, or a host), the APK's file name, which old APKs to delete,
 * when `expo prebuild` must start clean, and reading the output of adb, Java and Gradle, and of the APK itself
 * (a zip). No I/O here, so the tests (src/__tests__/buildApk.test.ts) run them on made-up data; types in
 * build-apk.d.mts.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { DEFAULT_PORT, isIPv4, pickLanAddress } from '../../../../scripts/lib/lan.mjs';

/** The app's Android package (app.json android.package). */
export const PACKAGE = 'com.mosheg.sudokufight';
/** The one ABI built: every phone from the last years is 64-bit ARM, and one ABI is a quarter of the disk. */
export const ABI = 'arm64-v8a';
/** APKs kept in apps/mobile/apk/ (the newest). */
export const KEEP_APKS = 3;
/** The server `--server local` points at: `npm run server` on this PC. */
export const LOCAL_PORT = DEFAULT_PORT;

const GB = 1024 ** 3;
/**
 * Free space a build needs before it starts: a first one (no library builds in node_modules yet)... A full build
 * writes about 4 GB (measured 2026-10-14: node_modules/*\/android/{build,.cxx} 3.0 GB, android/ 1.0 GB,
 * ~/.sudoku-fight 0.1 GB) and is stopped under ABORT_FREE: 6 GB leaves about 1 GB for the page file to grow.
 */
export const MIN_FREE_FULL = 6 * GB;
/** ...and one that reuses the libraries' builds from the last time. */
export const MIN_FREE_INCREMENTAL = 2 * GB;
/** Under this during the build, Gradle is stopped: a full drive C breaks Gradle, npm and Windows itself. */
export const ABORT_FREE = 1 * GB;

/** Exit codes. */
export const EXIT = { ok: 0, failed: 1, usage: 2, preflight: 3, install: 4 };

/** --server's names for eas.json's profiles, and the label each gets in the APK's file name. */
const PROFILES = {
  staging: { profile: 'preview', label: 'staging' },
  preview: { profile: 'preview', label: 'staging' },
  production: { profile: 'production', label: 'production' },
};

export const USAGE = `npm run apk [-- options]

Builds a release APK on this PC (arm64-v8a, signed with the debug key) into apps/mobile/apk/.

  --server <name>   the game server the app talks to:
                      staging (default)  eas.json's preview profile
                      production         eas.json's production profile
                      local              this PC on the Wi-Fi (npm run server), port ${LOCAL_PORT}, no TLS
                      <host>[:port]      any other; https://, wss://, http:// or ws:// set TLS;
                                         an IP address alone means port ${LOCAL_PORT}, no TLS
  --install         after the build, install on every phone adb sees (USB debugging)
  --install-only    no build: install the newest APK in apps/mobile/apk/
  --replace         with --install: if a phone has the app signed with another key (the cloud
                    build), uninstall it first. This deletes the app's data on that phone.
  --clean           after the build, delete the big build folders (the next build is slower)
  --clean-only      no build: only delete the big build folders
  --clean-native    regenerate the android folder from scratch (expo prebuild --clean)
  --verbose         show Gradle's full output (it always goes to apps/mobile/apk/last-build.log)
  --dry-run         print what would be built, build nothing (not with --install-only or --clean-only)
  --help            this text

Exit codes: 0 ok, 1 build failed, 2 bad option, 3 this PC is not ready, 4 install failed.`;

/**
 * @param {readonly string[]} argv process.argv.slice(2)
 */
export function parseApkArgs(argv) {
  const options = {
    server: 'staging',
    install: false,
    installOnly: false,
    replace: false,
    clean: false,
    cleanOnly: false,
    cleanNative: false,
    verbose: false,
    dryRun: false,
  };
  /** @type {Record<string, keyof typeof options>} */
  const flags = {
    '--install': 'install',
    '--install-only': 'installOnly',
    '--replace': 'replace',
    '--clean': 'clean',
    '--clean-only': 'cleanOnly',
    '--clean-native': 'cleanNative',
    '--verbose': 'verbose',
    '--dry-run': 'dryRun',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const [flag, inline] =
      arg.startsWith('--') && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null];
    if (flag === '--help' || flag === '-h') return { kind: 'help' };
    if (flag === '--server') {
      let value = inline;
      if (value === null && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) value = argv[++i];
      if (value === null || value.trim() === '')
        return { kind: 'error', error: '--server needs a value: staging, production, local or a host' };
      options.server = value.trim();
      continue;
    }
    const key = flags[flag];
    if (key === undefined)
      return { kind: 'error', error: arg.startsWith('-') ? `unknown option ${arg}` : `unexpected ${arg}` };
    if (inline !== null) return { kind: 'error', error: `${flag} takes no value` };
    options[key] = true;
  }
  if (options.replace && !options.install && !options.installOnly)
    return { kind: 'error', error: '--replace works with --install or --install-only' };
  if (options.installOnly && options.cleanOnly)
    return { kind: 'error', error: '--install-only and --clean-only do different things: pick one' };
  // Those two build nothing: with --dry-run they would still install (uninstall, with --replace) or delete.
  if (options.dryRun && (options.installOnly || options.cleanOnly))
    return {
      kind: 'error',
      error: `--dry-run previews a build only; ${options.installOnly ? '--install-only' : '--clean-only'} would still run`,
    };
  return { kind: 'options', options };
}

// ---------------------------------------------------------------- the game server

const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/** A file-name-safe label for a host: `192.168.1.20` → `192-168-1-20`. */
const hostLabel = (host) =>
  host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * `[scheme://]host[:port]` → the server, or an error. TLS: the scheme says; without one, port 443 (also when no
 * port is given) means TLS, any other port plain (a server on a desk, like `npm run server`). An IP address with
 * neither is that server on a desk too (LOCAL_PORT, plain), as with --server local: no certificate names an IP.
 */
function parseHost(text) {
  const match = /^(?:(https|wss|http|ws):\/\/)?([^/:]+)(?::(\d{1,5}))?\/?$/i.exec(text);
  if (!match || !HOST_NAME.test(match[2]))
    return { kind: 'error', error: `--server ${text}: expected staging, production, local, or host[:port]` };
  const scheme = match[1]?.toLowerCase();
  const secureScheme = scheme === 'https' || scheme === 'wss';
  const desk = !scheme && isIPv4(match[2]);
  const port =
    match[3] !== undefined ? Number(match[3]) : (scheme && !secureScheme) || desk ? LOCAL_PORT : 443;
  if (port < 1 || port > 65535) return { kind: 'error', error: `--server ${text}: bad port` };
  const secure = scheme ? secureScheme : port === 443;
  const host = match[2].toLowerCase();
  return {
    kind: 'server',
    server: {
      label: port === 443 ? hostLabel(host) : `${hostLabel(host)}-${port}`,
      host,
      port,
      secure,
      source: 'command line',
    },
  };
}

/**
 * Which game server the APK talks to: an eas.json profile's `env` (so a local APK and the cloud build of the
 * same profile never point at different servers), this PC's LAN address, or a host.
 *
 * @param {string} choice --server's value
 * @param {any} easJson apps/mobile/eas.json, parsed
 * @param {import('../../../../scripts/lib/lan.d.mts').Interfaces} interfaces os.networkInterfaces()
 */
export function resolveServer(choice, easJson, interfaces) {
  const named = PROFILES[choice.toLowerCase()];
  if (named) {
    const env = easJson?.build?.[named.profile]?.env ?? {};
    const host = env.EXPO_PUBLIC_SERVER_HOST;
    const port = Number(env.EXPO_PUBLIC_SERVER_PORT);
    const secure = env.EXPO_PUBLIC_SERVER_SECURE;
    if (typeof host !== 'string' || host === '' || !Number.isInteger(port) || port < 1 || port > 65535)
      return {
        kind: 'error',
        error:
          `eas.json's ${named.profile} profile has no EXPO_PUBLIC_SERVER_HOST and EXPO_PUBLIC_SERVER_PORT ` +
          'in its env',
      };
    return {
      kind: 'server',
      server: {
        label: named.label,
        host,
        port,
        secure: secure === 'true',
        source: `eas.json ${named.profile}`,
      },
    };
  }
  if (choice.toLowerCase() === 'local') {
    const lan = pickLanAddress(interfaces);
    if (!lan)
      return {
        kind: 'error',
        error: 'no Wi-Fi or Ethernet address found on this PC: connect it, or pass --server <its IP>',
      };
    return {
      kind: 'server',
      server: {
        label: 'local',
        host: lan.address,
        port: LOCAL_PORT,
        secure: false,
        source: `this PC (${lan.name})`,
      },
    };
  }
  return parseHost(choice);
}

/** The variables Metro inlines into the bundle (src/config/server.ts reads them). */
export function serverEnv(server) {
  return {
    EXPO_PUBLIC_SERVER_HOST: server.host,
    EXPO_PUBLIC_SERVER_PORT: String(server.port),
    EXPO_PUBLIC_SERVER_SECURE: server.secure ? 'true' : 'false',
  };
}

/** `host:port (TLS)`, for the console. */
export const describeServer = (server) =>
  `${server.host}:${server.port} ${server.secure ? '(TLS)' : '(no TLS)'}`;

// ---------------------------------------------------------------- the APK file

/**
 * `sudoku-fight-<version>-<git sha>[-dirty]-<server>.apk`: which code (a commit, and whether files had changed
 * since) and which server. `dirty`: the build had uncommitted changes, so the sha alone can't reproduce it.
 */
export function apkFileName({ version, sha, dirty, label }) {
  return `sudoku-fight-${version}-${sha}${dirty ? '-dirty' : ''}-${label}.apk`;
}

const APK_NAME = /^sudoku-fight-.+\.apk$/i;

/**
 * The APKs to delete so the newest `keep` stay (by modification time; files that aren't ours are left alone).
 *
 * @param {readonly { name: string; mtimeMs: number }[]} files
 */
export function apksToPrune(files, keep = KEEP_APKS) {
  return files
    .filter((f) => APK_NAME.test(f.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(keep)
    .map((f) => f.name);
}

/** The newest of our APKs, or null. */
export function newestApk(files) {
  const [newest] = files
    .filter((f) => APK_NAME.test(f.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  return newest?.name ?? null;
}

/**
 * C++ build folders of earlier configurations, to delete. CMake builds each configuration of a module (its
 * arguments, the NDK, the ABIs) in a folder named by a hash of it (.cxx/RelWithDebInfo/<hash>, and
 * build/intermediates/cxx/RelWithDebInfo/<hash>), and a new configuration leaves the old folder behind: 50 to
 * 400 MB each. All but the newest go; at worst, a configuration that comes back is compiled again.
 *
 * @param {readonly { name: string; mtimeMs: number }[]} dirs the hash folders of one module and build type
 */
export function staleConfigDirs(dirs) {
  return [...dirs]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(1)
    .map((d) => d.name);
}

// ---------------------------------------------------------------- expo prebuild

/** Bump when what goes into the hash changes, so the next build starts clean. */
export const PREBUILD_RULE = '1';

/**
 * A fingerprint of everything the android folder is generated from: the app's dependencies, app.json and
 * app.config.ts, local config plugins, the Firebase file, the installed version of each dependency, and
 * whether the APK allows plain http (--server local). Stored in android/.sf-prebuild-hash after a prebuild.
 *
 * @param {readonly [name: string, content: string | null][]} inputs a missing file is null
 */
export function nativeConfigHash(inputs) {
  const hash = createHash('sha256').update(`rule ${PREBUILD_RULE}\n`);
  for (const [name, content] of [...inputs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(`${name}\n${content === null ? '(missing)' : `${content.length}\n${content}`}\n`);
  }
  return hash.digest('hex');
}

/** The part of package.json the native project depends on: the packages, not the scripts. */
export function packageDeps(packageJsonText) {
  const pkg = JSON.parse(packageJsonText);
  return JSON.stringify({ dependencies: pkg.dependencies ?? {}, devDependencies: pkg.devDependencies ?? {} });
}

/** Prebuild's own machinery, installed with expo (within its version ranges, package-lock.json can move it). */
export const PREBUILD_PACKAGES = ['@expo/prebuild-config', '@expo/config-plugins'];

/**
 * The installed version of each of the app's dependencies (and of prebuild itself), as nativeConfigHash inputs.
 * The ranges in package.json are not enough: `npm install` with a new package-lock.json can move
 * expo-splash-screen or expo-build-properties to a newer patch, and their config plugins write into android/.
 *
 * @param {string} packageJsonText apps/mobile/package.json
 * @param {(name: string) => string | null} versionOf the installed version, null when not installed
 * @returns {[string, string | null][]}
 */
export function installedVersions(packageJsonText, versionOf) {
  const names = Object.keys(JSON.parse(packageJsonText).dependencies ?? {});
  return [...new Set([...names, ...PREBUILD_PACKAGES])]
    .sort()
    .map((name) => [`installed ${name}`, versionOf(name)]);
}

/**
 * The files app.json points at (icons, splash image, fonts, local plugins): every string value that is a
 * relative path. Prebuild copies or reads them, so a changed icon is a changed native config.
 */
export function appJsonFiles(appJsonText) {
  const found = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (/^\.\.?\//.test(value)) found.add(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(JSON.parse(appJsonText));
  return [...found].sort();
}

/**
 * Whether `expo prebuild` runs. In Expo 57 every prebuild, with or without --clean, writes the android folder
 * anew: the app's build outputs and Gradle's task history (android/.gradle, which build-apk.mjs sets aside and
 * puts back) go with it. So it runs only when the folder is missing, when asked, when the folder wasn't made by
 * this script, or when what it is generated from changed (nativeConfigHash); then with --clean, so a plugin or
 * a permission taken out goes too. Otherwise the android folder from last time is used as it is.
 */
export function prebuildPlan({ androidExists, storedHash, currentHash, cleanNative }) {
  if (!androidExists) return { run: true, clean: false, reason: 'first prebuild' };
  if (cleanNative) return { run: true, clean: true, reason: 'asked (--clean-native)' };
  if (storedHash === null)
    return { run: true, clean: true, reason: 'android folder not made by this script' };
  if (storedHash !== currentHash) return { run: true, clean: true, reason: 'native config changed' };
  return { run: false, clean: false, reason: 'native config unchanged' };
}

/**
 * The signing config of the release build type in android/app/build.gradle (Expo's template: `debug`, the
 * debug keystore it ships), or null when release builds would come out unsigned.
 */
export function releaseSigningConfig(gradleText) {
  const text = gradleText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const block = (source, name) => {
    const start = new RegExp(`(^|[\\s{])${name}\\s*\\{`, 'm').exec(source);
    if (!start) return null;
    let depth = 0;
    for (let i = start.index + start[0].length - 1; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) return source.slice(start.index + start[0].length, i);
    }
    return null;
  };
  const buildTypes = block(text, 'buildTypes');
  const release = buildTypes === null ? null : block(buildTypes, 'release');
  if (release === null) return null;
  return /signingConfig\s*(?:=\s*)?signingConfigs\.(\w+)/.exec(release)?.[1] ?? null;
}

// ---------------------------------------------------------------- the tools' output

/** The major version from `java -version` (its stderr): 17, 21; 8 for "1.8.0_381"; null if unreadable. */
export function javaMajorVersion(text) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  return first === 1 && match[2] !== undefined ? Number(match[2]) : first;
}

/** A line of `adb devices -l`: the serial, then one of adb's states (`no permissions` is two words). */
const ADB_LINE =
  /^(.+?)\s+(device|unauthorized|offline|authorizing|connecting|recovery|rescue|sideload|bootloader|host|unknown|no permissions)(?:\s+(.*))?$/;

/**
 * `adb devices -l` → the phones, with their state (device, unauthorized, offline...) and model. A serial can
 * hold a space: on wireless debugging a phone is named after its mDNS service, and a name already taken gets
 * ` (2)` (`adb-R58N12ABCDE-AbCdEf (2)._adb-tls-connect._tcp`). So the serial is all that comes before the state.
 */
export function parseAdbDevices(text) {
  const devices = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const known = ADB_LINE.exec(line);
    const words = line.split(/\s+/);
    const [serial, state, rest] = known
      ? [known[1], known[2], known[3] ?? '']
      : [words[0], words[1], words.slice(2).join(' ')];
    if (!serial || !state) continue;
    const model = /(?:^|\s)model:(\S+)/.exec(rest)?.[1] ?? null;
    devices.push({ serial, state, model });
  }
  return devices;
}

/** What to tell Moshe for each install failure adb reports (the code in `Failure [CODE: ...]`). */
const INSTALL_HINTS = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE:
    'the phone has the app signed with another key (the cloud build, or an old Development Build)',
  INSTALL_FAILED_VERSION_DOWNGRADE: 'the phone has a newer version of the app (from another build)',
  INSTALL_FAILED_NO_MATCHING_ABIS: `this phone is not 64-bit ARM; the APK has only ${ABI}`,
  INSTALL_FAILED_INSUFFICIENT_STORAGE: 'not enough free space on the phone',
  INSTALL_FAILED_USER_RESTRICTED:
    'the phone blocked it: unlock it and accept; Xiaomi: turn on "Install via USB"; Samsung: Auto Blocker off',
  INSTALL_FAILED_ABORTED: 'cancelled on the phone (the prompt was declined or timed out)',
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: 'the APK is not signed',
};

/** Failures that uninstalling the installed app fixes (with --replace). */
export const REPLACEABLE = ['INSTALL_FAILED_UPDATE_INCOMPATIBLE', 'INSTALL_FAILED_VERSION_DOWNGRADE'];

/**
 * `adb install`'s output → null when it succeeded, else the failure: its code (or null when adb said none)
 * and a short explanation.
 */
export function installFailure(text) {
  if (/^Success\s*$/m.test(text)) return null;
  const code = /\b(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)/.exec(text)?.[1] ?? null;
  if (code) return { code, hint: INSTALL_HINTS[code] ?? "see adb's message above" };
  if (/unauthorized/i.test(text))
    return { code: null, hint: 'unlock the phone and accept "Allow USB debugging?"' };
  if (/offline|not found/i.test(text))
    return { code: null, hint: 'the phone disconnected: replug the cable' };
  const last = text.trim().split(/\r?\n/).pop() ?? '';
  return { code: null, hint: last || 'adb failed without a message' };
}

/** The uninstall command for a phone, to paste into PowerShell (a serial with a space in quotes). */
export const uninstallCommand = (serial) =>
  `adb -s ${/\s/.test(serial) ? `"${serial}"` : serial} uninstall ${PACKAGE}`;

/** Gradle's parallel workers: each can run a compiler, a C++ build of its own, or a dexer. */
export const GRADLE_WORKERS = 2;

/** React Native's Gradle task that bundles the JS (Metro, then Hermes) and its assets into the APK. */
export const BUNDLE_TASK = ':app:createBundleReleaseJsAndAssets';

/**
 * Gradle's command line for the release APK.
 *
 * The JS is bundled again on every build (`--rerun`, about a minute). Left to itself Gradle would call the bundle
 * up to date, because the task's only inputs are the .js/.ts files under apps/mobile: not packages/* (the
 * engine, the protocol, the avatars), not JSON (the texts in src/i18n), images or sounds, not a JS package
 * updated in package-lock.json, and not the server's EXPO_PUBLIC_* variables. The APK would keep the old JS.
 *
 * Three things keep its memory down, because on Windows memory that runs short grows the page file on drive C
 * by gigabytes: 2 parallel workers (with 2 C++ compilers each, plugins/with-local-native-build.js), Kotlin
 * compiled inside Gradle's own process (not in a second Java process of up to 2.5 GB), and no "lint vital"
 * (lint's release check, the hungriest step). Lint guards store builds, which EAS still makes with it.
 */
export function gradleArgs() {
  return [
    'assembleRelease',
    BUNDLE_TASK,
    '--rerun',
    `-PreactNativeArchitectures=${ABI}`,
    `--max-workers=${GRADLE_WORKERS}`,
    '-Pkotlin.compiler.execution.strategy=in-process',
    '-x',
    'lintVitalRelease',
    '-x',
    'lintVitalAnalyzeRelease',
    '--console=plain',
  ];
}

/** A line of Gradle's plain console output → the task it started (`:app:bundleReleaseJsAndAssets`), or null. */
export function gradleTask(line) {
  return /^> Task (:\S+)/.exec(line)?.[1] ?? null;
}

/** Whether Gradle (or the Kotlin daemon, or D8) ran out of memory. */
export function isOutOfMemory(logText) {
  return /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Could not reserve enough space/.test(
    logText,
  );
}

/** Whether a rename or delete failed because another program has the file open (Windows: EPERM, EBUSY). */
export function isLockedError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

/** Whether Gradle failed because Windows kept a file open (another program had it for a moment). */
export function isFileLock(logText) {
  return /Unable to delete (?:directory|file)|being used by another process|Failed to delete some children/.test(
    logText,
  );
}

/** Gradle's own summary of a failure ("* What went wrong:" up to "* Try:"), or the log's last lines. */
export function failureSummary(logText, lines = 25) {
  const start = logText.lastIndexOf('* What went wrong:');
  if (start >= 0) {
    const end = logText.indexOf('* Try:', start);
    return logText
      .slice(start, end > start ? end : undefined)
      .trim()
      .split(/\r?\n/)
      .slice(0, lines)
      .join('\n');
  }
  return logText.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

// ---------------------------------------------------------------- the APK (a zip)

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The zip's central directory: { name, method, compressedSize, size, offset } per entry. */
export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== CENTRAL) throw new Error('broken zip central directory');
    const nameLength = buf.readUInt16LE(pos + 28);
    entries.push({
      name: buf.toString('utf8', pos + 46, pos + 46 + nameLength),
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      size: buf.readUInt32LE(pos + 24),
      offset: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLength + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return entries;
}

/** One entry's bytes (stored, or deflated). */
export function readZipEntry(buf, entry) {
  if (buf.readUInt32LE(entry.offset) !== LOCAL) throw new Error(`broken zip entry ${entry.name}`);
  const start = entry.offset + 30 + buf.readUInt16LE(entry.offset + 26) + buf.readUInt16LE(entry.offset + 28);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`zip entry ${entry.name}: compression method ${entry.method}`);
}

/**
 * Whether the APK has an APK Signing Block (v2/v3 signature: what Android checks since 7.0, and the only one
 * AGP writes for minSdk 24). It sits right before the central directory and ends with its magic.
 */
export function hasApkSigningBlock(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const centralStart = buf.readUInt32LE(eocd + 16);
  return centralStart >= 16 && buf.toString('latin1', centralStart - 16, centralStart) === 'APK Sig Block 42';
}

/**
 * What the build must have produced: a signed APK, native libraries for one ABI, and a JS bundle that has
 * the server's host in it (Metro inlines EXPO_PUBLIC_*, so a wrong env would show here).
 */
export function inspectApk(buf, host) {
  const entries = zipEntries(buf);
  const abis = [
    ...new Set(
      entries.map((e) => /^lib\/([^/]+)\/[^/]+\.so$/.exec(e.name)?.[1]).filter((abi) => abi !== undefined),
    ),
  ].sort();
  const bundleEntry = entries.find((e) => e.name === 'assets/index.android.bundle');
  const bundle = bundleEntry ? readZipEntry(buf, bundleEntry) : null;
  return {
    signed: hasApkSigningBlock(buf),
    abis,
    bundleSize: bundle?.length ?? 0,
    hostInBundle: bundle !== null && bundle.includes(Buffer.from(host, 'utf8')),
  };
}

/** The problems inspectApk found, as sentences (empty: the APK is fine). */
export function apkProblems(report, host) {
  const problems = [];
  if (!report.signed) problems.push('the APK is not signed');
  if (report.abis.length !== 1 || report.abis[0] !== ABI)
    problems.push(`native libraries for ${report.abis.join(', ') || 'no ABI'}, expected ${ABI} only`);
  if (report.bundleSize === 0) problems.push('no JS bundle (assets/index.android.bundle) in the APK');
  else if (!report.hostInBundle) problems.push(`the JS bundle does not contain the server host ${host}`);
  return problems;
}

// ---------------------------------------------------------------- the console

export function formatBytes(bytes) {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${String(s).padStart(2, '0')}s`;
}
