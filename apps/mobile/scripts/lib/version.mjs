/**
 * The pure parts of `npm run version:bump` (scripts/bump-version.mjs; docs/BUILD-APK.md "גרסה"): the app's
 * version in app.json (`expo.version`, major.minor.patch) and the next one. The build number Android and iOS
 * need is made from it in app.config.ts (versionCodeOf: major·10000 + minor·100 + patch), so minor and patch
 * stay at most MAX_PART. No I/O here: the tests (src/__tests__/version.test.ts) run them on made-up text; types
 * in version.d.mts.
 */

/** Minor and patch take two digits each of the build number (app.config.ts VERSION_PART_MAX). */
export const MAX_PART = 99;

export const PARTS = ['patch', 'minor', 'major'];

export const BUMP_USAGE = `npm run version:bump [-- patch | minor | major] [--dry-run]

Raises the app's version in apps/mobile/app.json (expo.version) and prints old -> new:
  patch (default)  1.0.0 -> 1.0.1   every APK handed to testers
  minor            1.0.7 -> 1.1.0
  major            1.4.2 -> 2.0.0
  --dry-run        print the change, write nothing
The build number (Android versionCode, iOS buildNumber) follows from it: 1.0.1 -> 10001.`;

/**
 * "1.2.3" → { major: 1, minor: 2, patch: 3 }, or null when it isn't major.minor.patch (no "v", no "-beta").
 *
 * @param {unknown} text
 */
export function parseVersion(text) {
  if (typeof text !== 'string') return null;
  const match = /^(\d{1,5})\.(\d+)\.(\d+)$/.exec(text);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch };
}

/**
 * The build number of a version, as app.config.ts makes it (versionCodeOf; a test checks they agree): for the
 * script's message only.
 *
 * @param {string} version
 */
export function buildNumber(version) {
  const v = parseVersion(version);
  if (!v) throw new Error(`"${version}" is not a version like 1.0.0`);
  return v.major * 10_000 + v.minor * 100 + v.patch;
}

/**
 * The next version: patch 1.0.0 → 1.0.1, minor 1.0.7 → 1.1.0, major 1.4.2 → 2.0.0. Throws when the version
 * can't be read, or when the next one would not fit the build number (a minor or patch over MAX_PART).
 *
 * @param {string} version
 * @param {'patch' | 'minor' | 'major'} part
 */
export function bumpVersion(version, part = 'patch') {
  const v = parseVersion(version);
  if (!v) throw new Error(`"${version}" is not a version like 1.0.0`);
  const next =
    part === 'major'
      ? { major: v.major + 1, minor: 0, patch: 0 }
      : part === 'minor'
        ? { major: v.major, minor: v.minor + 1, patch: 0 }
        : { major: v.major, minor: v.minor, patch: v.patch + 1 };
  if (next.minor > MAX_PART || next.patch > MAX_PART)
    throw new Error(
      `${version} -> ${next.major}.${next.minor}.${next.patch}: minor and patch go up to ${MAX_PART} ` +
        '(the build number is made of them). Bump the next part instead: npm run version:bump -- minor (or major)',
    );
  return `${next.major}.${next.minor}.${next.patch}`;
}

/**
 * app.json's text with `expo.version` set to `next`, everything else exactly as it was (no reformatting: another
 * tool's edits and the file's layout stay). Throws when app.json has no expo.version, or when the old value
 * can't be found exactly once.
 *
 * @param {string} text app.json
 * @param {string} next
 * @returns {{ text: string; from: string }}
 */
export function setAppJsonVersion(text, next) {
  if (!parseVersion(next)) throw new Error(`"${next}" is not a version like 1.0.0`);
  const json = JSON.parse(text);
  const from = json?.expo?.version;
  if (typeof from !== 'string') throw new Error('app.json has no expo.version');
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`("version"\\s*:\\s*")${escaped}(")`, 'g');
  const found = text.match(pattern) ?? [];
  if (found.length !== 1)
    throw new Error(`app.json: expected one "version": "${from}", found ${found.length}; edit it by hand`);
  const updated = text.replace(pattern, `$1${next}$2`);
  const check = JSON.parse(updated);
  if (check?.expo?.version !== next)
    throw new Error('app.json: the version that changed is not expo.version');
  return { text: updated, from };
}

/**
 * @param {readonly string[]} argv process.argv.slice(2)
 */
export function parseBumpArgs(argv) {
  let part = 'patch';
  let dryRun = false;
  let named = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (PARTS.includes(arg) && !named) {
      part = arg;
      named = true;
      continue;
    }
    return {
      kind: 'error',
      error: PARTS.includes(arg) ? 'one of patch, minor or major, not two' : `unknown argument ${arg}`,
    };
  }
  return { kind: 'bump', part, dryRun };
}
