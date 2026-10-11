import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Work plan stage 14, "בדיקת רישיונות": scripts/licenses.mjs (`npm run licenses`). It walks the production
 * dependency closures of apps/mobile and apps/server in package-lock.json, flags GPL / AGPL / LGPL / no license /
 * UNLICENSED / unknown licenses, and writes docs/store/LICENSES-REPORT.md and the JSON the app's "רישיונות"
 * screen shows. Checked here on a small made-up tree, and on the real one (its outputs must be up to date).
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'licenses.mjs');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function writeTree(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const MIT_TEXT = [
  'MIT License',
  '',
  'Copyright (c) 2020 Alice Example',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
  'documentation files (the "Software"), to deal in the Software without restriction, including without',
  'limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
].join('\n');

const fontLicense = (who: string) =>
  [
    `Copyright 2015 The ${who} Project Authors (https://github.com/googlefonts/${who.toLowerCase()})`,
    '',
    'This Font Software is licensed under the SIL Open Font License, Version 1.1.',
    '',
    '-----------------------------------------------------------',
    'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
    '-----------------------------------------------------------',
    '',
    'PREAMBLE',
    'The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font',
    'projects, to support the font creation efforts of academic and linguistic communities, and to provide a',
    'free and open framework in which fonts may be shared and improved in partnership with others.',
    '',
    'Each copy of the Font Software must contain the above copyright notice and this license.',
  ].join('\n');

/**
 * mobile → a (MIT, with a nested d: ISC), gpl-thing (GPL-3.0), the workspace @x/engine → dual (MIT OR GPL-2.0),
 * and the fonts; a dev dependency (dev-only, AGPL) and an optional peer that is not installed.
 * server → mystery (no license field at all), old (an old-style `licenses` array) and a (shared).
 */
const LOCK = {
  name: 'fixture',
  lockfileVersion: 3,
  packages: {
    '': { name: 'fixture', workspaces: ['apps/*', 'packages/*'] },
    'apps/mobile': {
      name: '@x/mobile',
      dependencies: {
        a: '^1.0.0',
        'gpl-thing': '^1.0.0',
        '@x/engine': '*',
        '@expo-google-fonts/rubik': '*',
        '@expo-google-fonts/teko': '*',
      },
      devDependencies: { 'dev-only': '^1.0.0' },
      peerDependencies: { 'not-there': '*' },
      peerDependenciesMeta: { 'not-there': { optional: true } },
    },
    'apps/server': { name: '@x/server', dependencies: { mystery: '^1.0.0', a: '^1.0.0', old: '^3.0.0' } },
    'packages/engine': { name: '@x/engine', dependencies: { dual: '^1.0.0' } },
    'node_modules/@x/engine': { resolved: 'packages/engine', link: true },
    'node_modules/a': { version: '1.2.3', license: 'MIT', dependencies: { d: '^2.0.0' } },
    'node_modules/a/node_modules/d': { version: '2.0.0', license: 'ISC' },
    'node_modules/d': { version: '1.0.0', license: 'MIT' },
    'node_modules/gpl-thing': { version: '1.0.0', license: 'GPL-3.0-only' },
    'node_modules/dual': { version: '1.0.0', license: '(MIT OR GPL-2.0)' },
    'node_modules/mystery': { version: '0.1.0' },
    'node_modules/old': { version: '3.0.0' },
    'node_modules/dev-only': { version: '1.0.0', dev: true, license: 'AGPL-3.0' },
    'node_modules/@expo-google-fonts/rubik': { version: '0.4.2', license: 'MIT AND OFL-1.1' },
    'node_modules/@expo-google-fonts/teko': { version: '0.4.1', license: 'MIT AND OFL-1.1' },
  },
};

function fixture(root: string) {
  writeTree(root, {
    'package-lock.json': LOCK,
    'node_modules/a/package.json': { name: 'a', version: '1.2.3', license: 'MIT' },
    'node_modules/a/LICENSE': MIT_TEXT,
    'node_modules/a/node_modules/d/package.json': { name: 'd', version: '2.0.0', license: 'ISC' },
    'node_modules/d/package.json': { name: 'd', version: '1.0.0', license: 'MIT' },
    'node_modules/gpl-thing/package.json': { name: 'gpl-thing', version: '1.0.0', license: 'GPL-3.0-only' },
    'node_modules/dual/package.json': { name: 'dual', version: '1.0.0', license: '(MIT OR GPL-2.0)' },
    'node_modules/mystery/package.json': { name: 'mystery', version: '0.1.0' },
    // The installed package.json wins over the lock, also in the old `licenses: [{ type }]` form.
    'node_modules/old/package.json': { name: 'old', version: '3.0.0', licenses: [{ type: 'BSD-2-Clause' }] },
    'node_modules/dev-only/package.json': { name: 'dev-only', version: '1.0.0', license: 'AGPL-3.0' },
    'node_modules/@expo-google-fonts/rubik/package.json': {
      name: '@expo-google-fonts/rubik',
      license: 'MIT AND OFL-1.1',
    },
    'node_modules/@expo-google-fonts/rubik/LICENSE_FONT': fontLicense('Rubik'),
    'node_modules/@expo-google-fonts/teko/package.json': {
      name: '@expo-google-fonts/teko',
      license: 'MIT AND OFL-1.1',
    },
    'node_modules/@expo-google-fonts/teko/LICENSE_FONT': fontLicense('Teko'),
  });
}

interface AppLicenses {
  fonts: { family: string; copyright: string[]; license: string }[];
  ofl: string;
  texts: Record<string, string>;
  packages: [string, string, string, string[]][];
}

describe('scripts/licenses.mjs', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'licenses-'));
    fixture(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const report = () => readFileSync(join(root, 'docs', 'store', 'LICENSES-REPORT.md'), 'utf8');
  const appJson = () =>
    JSON.parse(
      readFileSync(join(root, 'apps', 'mobile', 'src', 'legal', 'third-party-licenses.json'), 'utf8'),
    ) as AppLicenses;

  it('walks the production closures only, and flags GPL and a missing license', () => {
    const { code, out } = run('--root', root);
    expect(code).toBe(0);
    expect(out).toMatch(/flagged 2/);
    expect(out).toMatch(/flagged: gpl-thing@1\.0\.0 GPL-3\.0-only \[mobile\]/);
    expect(out).toMatch(/flagged: mystery@0\.1\.0 \(no license\) \[server\]/);

    const md = report();
    const flagged = md.slice(md.indexOf('## מסומנות'), md.indexOf('## דורשות'));
    expect(flagged).toContain('| gpl-thing | 1.0.0 | GPL-3.0-only |');
    expect(flagged).toContain('| mystery | 0.1.0 | — |');
    // How it got in.
    expect(flagged).toContain('gpl-thing ← apps/mobile');
    // A dev dependency is not in the app or on the server.
    expect(md).not.toContain('dev-only');
    // OR picks the permissive choice: listed, not flagged.
    expect(flagged).not.toContain('dual');
    expect(md).toContain('| dual | 1.0.0 | (MIT OR GPL-2.0) | mobile |');
    // a is in both; the nested d@2 (Node's resolution from a), not the top-level d@1.
    expect(md).toContain('| a | 1.2.3 | MIT | mobile, server |');
    expect(md).toContain('| d | 2.0.0 | ISC | mobile, server |');
    expect(md).not.toContain('| d | 1.0.0 |');
    expect(md).toContain('| old | 3.0.0 | BSD-2-Clause | server |');
  });

  it('writes what the app shows: the mobile closure, the fonts and the license texts', () => {
    expect(run('--root', root).code).toBe(0);
    const json = appJson();
    expect(json.packages.map(([name, version]) => `${name}@${version}`)).toEqual([
      '@expo-google-fonts/rubik@0.4.2',
      '@expo-google-fonts/teko@0.4.1',
      'a@1.2.3',
      'd@2.0.0',
      'dual@1.0.0',
      'gpl-thing@1.0.0',
    ]);
    expect(json.packages.find(([name]) => name === 'a')).toEqual([
      'a',
      '1.2.3',
      'MIT',
      ['Copyright (c) 2020 Alice Example'],
    ]);
    expect(json.fonts.map((f) => [f.family, f.license])).toEqual([
      ['Rubik', 'OFL-1.1'],
      ['Teko', 'OFL-1.1'],
    ]);
    expect(json.fonts[0]?.copyright).toEqual([
      'Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik)',
    ]);
    expect(json.ofl.startsWith('-----')).toBe(true);
    expect(json.ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
    // The MIT text comes from a's own file, without its copyright line.
    expect(json.texts.MIT).toContain('Permission is hereby granted, free of charge');
    expect(json.texts.MIT).not.toContain('Alice');
  });

  it('--check passes when the outputs are current and fails when they are stale', () => {
    expect(run('--root', root, '--check').code).toBe(1);
    expect(run('--root', root, '--quiet').code).toBe(0);
    expect(run('--root', root, '--check', '--quiet').code).toBe(0);
    writeFileSync(join(root, 'docs', 'store', 'LICENSES-REPORT.md'), 'edited by hand');
    const stale = run('--root', root, '--check');
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/out of date: .*LICENSES-REPORT\.md/);
  });

  it('--strict fails while something is flagged', () => {
    expect(run('--root', root, '--strict', '--quiet').code).toBe(1);
  });

  it('the real tree: the report and the app’s list are up to date (npm run licenses)', () => {
    const { code, out } = run('--check');
    expect({ code, out: code === 0 ? '' : out }).toEqual({ code: 0, out: '' });
  });
});
