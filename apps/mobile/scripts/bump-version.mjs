// `npm run version:bump`: the app's next version in apps/mobile/app.json (docs/BUILD-APK.md "גרסה").
//
//   npm run version:bump                 1.0.0 -> 1.0.1 (patch: before each APK handed to testers)
//   npm run version:bump -- minor        1.0.7 -> 1.1.0
//   npm run version:bump -- major        1.4.2 -> 2.0.0
//   npm run version:bump -- --dry-run    print it, write nothing
//
// Only expo.version changes. app.config.ts makes the build number from it (Android versionCode, iOS
// buildNumber: 1.0.1 -> 10001), so an APK built after the bump installs over the one on the phone. The pure
// parts (and their tests) are in lib/version.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUMP_USAGE, buildNumber, bumpVersion, parseBumpArgs, setAppJsonVersion } from './lib/version.mjs';

const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_JSON = join(MOBILE, 'app.json');

function main() {
  const parsed = parseBumpArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    console.log(BUMP_USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`npm run version:bump: ${parsed.error}\n\n${BUMP_USAGE}`);
    return 2;
  }
  const text = readFileSync(APP_JSON, 'utf8');
  const current = JSON.parse(text)?.expo?.version;
  const next = bumpVersion(current, parsed.part);
  const updated = setAppJsonVersion(text, next);
  if (!parsed.dryRun) writeFileSync(APP_JSON, updated.text);
  console.log(
    `${parsed.dryRun ? '(dry run) ' : ''}version ${updated.from} -> ${next}` +
      `  (build number ${buildNumber(updated.from)} -> ${buildNumber(next)})`,
  );
  if (!parsed.dryRun) console.log('apps/mobile/app.json updated. The next npm run apk builds this version.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`npm run version:bump: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
