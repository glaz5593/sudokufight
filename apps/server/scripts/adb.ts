/**
 * Claude's hands on a phone (QA module, stage 4): thin ADB commands for a test run, which Claude runs only when
 * Moshe asks (.claude/skills/qa-run/SKILL.md). Read the screen with `ui` (text, far cheaper than a screenshot);
 * take a `shot` only when the look itself is what a task checks.
 *
 *   npm run adb -- devices
 *   npm run adb -- ui                          # the screen as lines: "label" id=testID @x,y [tap]
 *   npm run adb -- tap "משחק חדש"              # by text, description or testID; or: tap 540 1200
 *   npm run adb -- swipe 540 1800 540 600 [ms]
 *   npm run adb -- type "Fake1"                # ASCII only: adb cannot type Hebrew
 *   npm run adb -- key back|home|enter
 *   npm run adb -- shot [file.png]             # default: the temp folder sudoku-fight-qa
 *   npm run adb -- launch | stop
 *   npm run adb -- link "sudokufight://levels"
 *   npm run adb -- version                     # the installed app's versionName, for a run's --app-version
 *   npm run adb -- reset                       # font scale, animations, colour correction, airplane mode back
 *
 * `--device <serial>` picks a phone (or ANDROID_SERIAL). Never uninstalls or clears data: those need Moshe's OK.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { centerOf, describeNodes, findNode, parseUiDump } from '../src/testing/qaAgent';

const PACKAGE = 'com.mosheg.sudokufight';
const DUMP_PATH = '/sdcard/qa-ui.xml';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { device: { type: 'string' } },
});

function adbPath(): string {
  const sdks = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
  ];
  for (const sdk of sdks) {
    if (!sdk) continue;
    const exe = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (existsSync(exe)) return exe;
  }
  return 'adb';
}

const ADB = adbPath();

function adb(args: string[]): Buffer {
  const all = values.device === undefined ? args : ['-s', values.device, ...args];
  const out = spawnSync(ADB, all, { maxBuffer: 64 * 1024 * 1024 });
  if (out.error !== undefined) throw out.error;
  if (out.status !== 0)
    throw new Error(`adb ${args.join(' ')}: ${out.stderr.toString().trim() || `exit ${out.status}`}`);
  return out.stdout;
}

const shell = (...args: string[]) =>
  adb(['shell', ...args])
    .toString()
    .trim();

function usage(message: string): never {
  console.error(`${message}\n(see the comment at the top of apps/server/scripts/adb.ts)`);
  process.exit(2);
}

function screen() {
  shell('uiautomator', 'dump', DUMP_PATH);
  return parseUiDump(adb(['exec-out', 'cat', DUMP_PATH]).toString('utf8'));
}

function main(): void {
  const [command, ...rest] = positionals;
  switch (command) {
    case 'devices':
      console.log(adb(['devices', '-l']).toString().trim());
      return;
    case 'ui':
      describeNodes(screen()).forEach((line) => console.log(line));
      return;
    case 'tap': {
      if (rest.length === 2 && rest.every((r) => /^\d+$/.test(r))) {
        shell('input', 'tap', rest[0]!, rest[1]!);
        return;
      }
      const query = rest.join(' ');
      const node = findNode(screen(), query);
      if (node === null) {
        console.error(`nothing on the screen matches "${query}"`);
        process.exit(1);
      }
      const { x, y } = centerOf(node);
      shell('input', 'tap', String(x), String(y));
      console.log(`tapped ${node.text || node.desc || node.id} @${x},${y}`);
      return;
    }
    case 'swipe':
      if (rest.length < 4) usage('swipe x1 y1 x2 y2 [ms]');
      shell('input', 'swipe', ...rest.slice(0, 5));
      return;
    case 'type': {
      const text = rest.join(' ');
      if (!/^[\x20-\x7e]+$/.test(text)) usage('type takes printable ASCII only (adb cannot type Hebrew)');
      shell('input', 'text', text.replace(/ /g, '%s').replace(/(["'`\\$&|;<>()])/g, '\\$1'));
      return;
    }
    case 'key': {
      const keys: Record<string, string> = {
        back: 'KEYCODE_BACK',
        home: 'KEYCODE_HOME',
        enter: 'KEYCODE_ENTER',
      };
      const key = keys[rest[0] ?? ''];
      if (key === undefined) usage('key back|home|enter');
      shell('input', 'keyevent', key);
      return;
    }
    case 'shot': {
      const dir = join(tmpdir(), 'sudoku-fight-qa');
      mkdirSync(dir, { recursive: true });
      const file = rest[0] ?? join(dir, `shot-${Date.now()}.png`);
      writeFileSync(file, adb(['exec-out', 'screencap', '-p']));
      console.log(file);
      return;
    }
    case 'launch':
      shell('monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
      return;
    case 'stop':
      shell('am', 'force-stop', PACKAGE);
      return;
    case 'link':
      if (rest[0] === undefined) usage('link <url>');
      shell('am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${rest[0]}'`, PACKAGE);
      return;
    case 'version': {
      const name = /versionName=(\S+)/.exec(shell('dumpsys', 'package', PACKAGE))?.[1];
      console.log(name ?? `${PACKAGE} is not installed`);
      return;
    }
    case 'reset':
      shell('settings', 'put', 'system', 'font_scale', '1.0');
      for (const scale of [
        'window_animation_scale',
        'transition_animation_scale',
        'animator_duration_scale',
      ]) {
        shell('settings', 'put', 'global', scale, '1');
      }
      shell('settings', 'put', 'secure', 'accessibility_display_daltonizer_enabled', '0');
      shell('cmd', 'connectivity', 'airplane-mode', 'disable');
      console.log('font scale 1, animations 1, colour correction off, airplane mode off');
      return;
    default:
      usage(`unknown command "${command ?? ''}"`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
