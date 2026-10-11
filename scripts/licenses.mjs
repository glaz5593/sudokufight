#!/usr/bin/env node
/**
 * Third-party licenses (work plan stage 14; spec §23 "רישיונות"). `npm run licenses` at the root.
 *
 * Walks the PRODUCTION dependency closure of apps/mobile and apps/server in package-lock.json (dependencies,
 * optionalDependencies and peerDependencies, followed the way Node resolves them: the nearest node_modules
 * first; never devDependencies), reads each package's license from its installed package.json (the lock's
 * copy when it is not installed here, e.g. another platform's binary), and classifies it:
 *   flagged   - GPL / AGPL / LGPL, no license at all, UNLICENSED, or a license this script doesn't know
 *               (custom, "SEE LICENSE IN …"). For Moshe to look at before the stores.
 *   attention - weak copyleft (MPL, EPL, CDDL) or attribution (CC-BY): fine in an app, with duties.
 *   ok        - permissive (MIT, ISC, BSD, Apache-2.0, …).
 * An SPDX expression counts as its best choice for OR ("BSD-3-Clause OR GPL-2.0" is BSD) and its worst part for
 * AND.
 *
 * Writes:
 *   docs/store/LICENSES-REPORT.md                      - both closures, flagged first, then every package
 *   apps/mobile/src/legal/third-party-licenses.json    - what the app's "רישיונות" screen shows: the mobile
 *       closure (name, version, license, copyright lines from its license file), the fonts (Rubik and Teko,
 *       from @expo-google-fonts' LICENSE_FONT) and the full text of each common license, taken verbatim from
 *       an installed package's license file.
 * Both outputs are deterministic (no dates), so `--check` can tell when they are stale.
 *
 * Options: --check (write nothing; exit 1 when an output is out of date), --strict (exit 1 when something is
 * flagged), --root <dir> (another tree: the tests), --quiet.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const rootArg = args.indexOf('--root');
const ROOT =
  rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The workspaces whose production closures count, and the short tag each gets in the report. */
const APPS = [
  { tag: 'mobile', path: 'apps/mobile' },
  { tag: 'server', path: 'apps/server' },
];
const REPORT = join(ROOT, 'docs', 'store', 'LICENSES-REPORT.md');
const APP_JSON = join(ROOT, 'apps', 'mobile', 'src', 'legal', 'third-party-licenses.json');
/** The fonts the app embeds (app.json's expo-font plugin), and the package each comes from. */
const FONTS = [
  { family: 'Rubik', pkg: '@expo-google-fonts/rubik' },
  { family: 'Teko', pkg: '@expo-google-fonts/teko' },
];

// ---- licenses ------------------------------------------------------------------------------------------------

/** Severity, low to high. OR takes the lowest of its choices, AND the highest of its parts. */
const RANK = {
  permissive: 0,
  attribution: 1,
  weakCopyleft: 2,
  lgpl: 3,
  custom: 4,
  unknown: 5,
  unlicensed: 6,
  copyleft: 7,
};
const FLAGGED = new Set(['lgpl', 'custom', 'unknown', 'unlicensed', 'copyleft']);
const ATTENTION = new Set(['attribution', 'weakCopyleft']);

const PERMISSIVE = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-3-Clause-Clear',
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
  'Zlib',
  'WTFPL',
  'Artistic-2.0',
  'BSL-1.0',
  'PostgreSQL',
  'X11',
]);
/** Spellings seen in package.json files, as their SPDX id. */
const ALIASES = {
  'Apache-2': 'Apache-2.0',
  'Apache 2.0': 'Apache-2.0',
  BSD: 'BSD-3-Clause',
  'MIT/X11': 'MIT',
};

/** One SPDX id's class. */
export function classifyId(raw) {
  const id = ALIASES[raw] ?? raw;
  if (PERMISSIVE.has(id)) return 'permissive';
  if (/^A?GPL-/i.test(id)) return 'copyleft';
  if (/^LGPL-/i.test(id)) return 'lgpl';
  if (/^(MPL|EPL|CDDL)-/i.test(id)) return 'weakCopyleft';
  if (/^CC-BY-(\d|SA)/i.test(id)) return 'attribution';
  if (/^OFL-1\.1/i.test(id)) return 'attribution';
  if (/^UNLICENSED$/i.test(id)) return 'unlicensed';
  return 'custom';
}

/** The class of a license field (an id or an SPDX expression); null, empty or UNKNOWN is 'unknown'. */
export function classify(license) {
  if (typeof license !== 'string' || license.trim() === '' || /^unknown$/i.test(license.trim()))
    return 'unknown';
  const text = license.trim();
  if (/^SEE LICEN[CS]E IN /i.test(text)) return 'custom';
  return expression(text);
}

function expression(text) {
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);
  const better = (a, b) => (RANK[a] <= RANK[b] ? a : b);
  function primary() {
    const token = tokens[pos++];
    if (token === '(') {
      const value = or();
      pos++; // ')'
      return value;
    }
    return classifyId((token ?? '').replace(/\+$/, ''));
  }
  function with_() {
    const value = primary();
    // "Apache-2.0 WITH LLVM-exception": an exception only adds permissions.
    if (/^with$/i.test(tokens[pos] ?? '')) pos += 2;
    return value;
  }
  function and() {
    let value = with_();
    while (/^and$/i.test(tokens[pos] ?? '')) {
      pos++;
      value = worse(value, with_());
    }
    return value;
  }
  function or() {
    let value = and();
    while (/^or$/i.test(tokens[pos] ?? '')) {
      pos++;
      value = better(value, and());
    }
    return value;
  }
  return or();
}

/** A package.json's license, as one string: `license`, or the old `licenses: [{ type }]`. */
export function licenseOf(manifest) {
  if (!manifest) return null;
  const { license, licenses } = manifest;
  if (typeof license === 'string') return license;
  if (license && typeof license.type === 'string') return license.type;
  if (Array.isArray(licenses) && licenses.length > 0) {
    const types = licenses.map((l) => (typeof l === 'string' ? l : l?.type)).filter(Boolean);
    if (types.length > 0) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return null;
}

// ---- the closure ---------------------------------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const tryJson = (file) => {
  try {
    return readJson(file);
  } catch {
    return null;
  }
};

/** The package's name from its lock path: the part after the last node_modules/. */
export function nameFromPath(path) {
  const i = path.lastIndexOf('node_modules/');
  return i < 0 ? path : path.slice(i + 'node_modules/'.length);
}

/** Where Node would find `name` when required from the package at lock path `from` ('' is the root). */
export function resolveIn(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i >= 0 ? base.slice(0, i) : '';
  }
}

/**
 * The production closure of the workspace at `start`: lock path → { name, version, license, installed, via }.
 * Workspace links are followed (their own production dependencies count) but not listed: they are ours.
 */
export function closure(lock, start, root = ROOT) {
  const packages = lock.packages ?? {};
  const found = new Map();
  const seen = new Set();
  const queue = [{ path: start, via: null }];
  while (queue.length > 0) {
    const { path, via } = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    let entry = packages[path];
    let location = path;
    if (entry?.link) {
      location = entry.resolved;
      entry = packages[location];
      if (seen.has(location)) continue;
      seen.add(location);
    }
    if (!entry) continue;
    const isWorkspace = !location.includes('node_modules/');
    if (!isWorkspace) {
      const manifest = tryJson(join(root, location, 'package.json'));
      found.set(location, {
        name: entry.name ?? nameFromPath(location),
        version: entry.version ?? manifest?.version ?? '?',
        license: licenseOf(manifest) ?? entry.license ?? null,
        installed: manifest !== null,
        // A binary for one OS/CPU (lightningcss-win32-x64-msvc…): installed only where it runs, so nothing read
        // from its files may depend on this machine.
        platform: Boolean(entry.os || entry.cpu),
        via,
      });
    }
    const optionalPeers = new Set(
      Object.entries(entry.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional)
        .map(([name]) => name),
    );
    const deps = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}).filter((name) => !optionalPeers.has(name)),
    ];
    for (const name of deps) {
      const target = resolveIn(packages, location, name);
      if (target && !seen.has(target)) queue.push({ path: target, via: location });
    }
  }
  return found;
}

/** "a ← b ← apps/mobile": how a package got into the closure. */
function chain(found, path, start) {
  const names = [];
  let at = path;
  for (let i = 0; at && found.has(at) && i < 20; i++) {
    names.push(found.get(at).name);
    at = found.get(at).via;
  }
  return [...names, start].join(' ← ');
}

// ---- license files -------------------------------------------------------------------------------------------

const LICENSE_FILE = /^(licen[cs]e|copying)([.-].*)?$/i;

function licenseFileText(root, location) {
  const dir = join(root, location);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const file = names.filter((n) => LICENSE_FILE.test(n)).sort()[0];
  if (!file) return null;
  try {
    return readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

/**
 * A line that names who holds the copyright ("Copyright (c) 2015 Meta"), not a line of the license's own
 * words that happens to start with the word (a BSD disclaimer's "COPYRIGHT HOLDERS AND CONTRIBUTORS …", ISC's
 * "copyright notice and …", Apache's template "Copyright [yyyy] [name of copyright owner]").
 */
export function isCopyrightLine(line) {
  const l = line.trim();
  // A notice starts with a capital: "copyright license to reproduce…" is Apache's own words.
  if (!/^(Copyright\b|COPYRIGHT\b|\([cC]\)\s|©)/.test(l)) return false;
  // "(c) …" and "© …" count only with a year: MPL-2.0's own text has "(c) under Patent Claims infringed by…".
  if (!/^(Copyright|COPYRIGHT)\b/.test(l) && !/\b(1[89]|20)\d{2}\b/.test(l)) return false;
  return !/^copyright (holders?|owners?|notices?|statements?|and related rights)\b|\[yyyy\]|\{yyyy\}|<year>|\[year\]|copyright (notice|statement)/i.test(
    l,
  );
}

/** The "Copyright …" lines of a license file (at most 3, each at most 160 characters). */
export function copyrightLines(text) {
  if (!text) return [];
  const lines = text
    .split('\n')
    .filter(isCopyrightLine)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .map((l) => (l.length > 160 ? `${l.slice(0, 159)}…` : l));
  return [...new Set(lines)].slice(0, 3);
}

/** How to recognize the canonical text of a license inside a license file, and where it ends. */
const CANONICAL = {
  MIT: { has: [/Permission is hereby granted, free of charge/], not: [] },
  ISC: { has: [/Permission to use, copy, modify, and\/?or distribute this software for any/], not: [] },
  '0BSD': { has: [/Permission to use, copy, modify, and\/?or distribute this software for any/], not: [] },
  'BSD-2-Clause': { has: [/Redistribution and use in source and binary forms/], not: [/Neither the name/] },
  'BSD-3-Clause': { has: [/Redistribution and use in source and binary forms/, /Neither the name/], not: [] },
  'Apache-2.0': {
    has: [/Apache License/, /Version 2\.0, January 2004/, /END OF TERMS AND CONDITIONS/],
    not: [],
    end: /END OF TERMS AND CONDITIONS/,
  },
  'BlueOak-1.0.0': { has: [/Blue Oak Model License/], not: [], start: /^#* ?Blue Oak Model License/m },
};

/** The license's own words from a package's file: copyright lines out, cut after the end marker. */
function canonicalText(id, text) {
  const rule = CANONICAL[id];
  if (!rule || !text) return null;
  if (!rule.has.every((r) => r.test(text)) || rule.not.some((r) => r.test(text))) return null;
  let body = text;
  if (rule.end) {
    const m = rule.end.exec(body);
    if (m) body = body.slice(0, m.index + m[0].length);
    // Apache: from its title (a file may start with a NOTICE or another license).
    const start = body.search(/^\s*Apache License\s*$/m);
    if (start > 0) body = body.slice(start);
  }
  if (rule.start) {
    const at = body.search(rule.start);
    if (at < 0) return null;
    body = body.slice(at);
  }
  body = body
    .split('\n')
    .filter((l) => !isCopyrightLine(l) && !/^\s*All rights reserved\.?\s*$/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body.length >= 200 ? body : null;
}

// ---- outputs -------------------------------------------------------------------------------------------------

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1);

/** Every package of every closure, once per name@version, with the closures it is in. */
export function collect(lock, root = ROOT, apps = APPS) {
  const all = new Map();
  for (const app of apps) {
    const found = closure(lock, app.path, root);
    for (const [path, pkg] of found) {
      const key = `${pkg.name}@${pkg.version}`;
      const entry = all.get(key) ?? {
        ...pkg,
        path,
        apps: [],
        category: classify(pkg.license),
        via: chain(found, path, app.path),
      };
      if (!entry.apps.includes(app.tag)) entry.apps.push(app.tag);
      all.set(key, entry);
    }
  }
  return [...all.values()].sort(byName);
}

function fontsOf(root) {
  const fonts = [];
  let ofl = null;
  for (const { family, pkg } of FONTS) {
    const text = readFileSync(join(root, 'node_modules', pkg, 'LICENSE_FONT'), 'utf8').replace(
      /\r\n?/g,
      '\n',
    );
    const copyright = copyrightLines(text);
    fonts.push({ family, copyright, license: 'OFL-1.1' });
    // The license itself, from its banner on: the same words for both fonts.
    const start = text.indexOf(
      '-----------------------------------------------------------\nSIL OPEN FONT LICENSE',
    );
    if (start >= 0 && ofl === null) ofl = text.slice(start).trim();
  }
  if (ofl === null) throw new Error('The SIL Open Font License text was not found in LICENSE_FONT');
  return { fonts, ofl };
}

export function appJson(packages, root = ROOT) {
  const mobile = packages.filter((p) => p.apps.includes('mobile'));
  const texts = {};
  for (const id of Object.keys(CANONICAL)) {
    if (!mobile.some((p) => typeof p.license === 'string' && p.license.includes(id))) continue;
    for (const p of mobile) {
      if (p.license !== id) continue;
      const text = canonicalText(id, licenseFileText(root, p.path));
      if (text) {
        texts[id] = text;
        break;
      }
    }
  }
  const { fonts, ofl } = fontsOf(root);
  return {
    fonts,
    ofl,
    texts,
    // [name, version, license, copyright lines]
    packages: mobile.map((p) => [
      p.name,
      p.version,
      p.license ?? 'UNKNOWN',
      p.platform ? [] : copyrightLines(licenseFileText(root, p.path)),
    ]),
  };
}

const CATEGORY_HE = {
  permissive: 'מתירני',
  attribution: 'ייחוס (Attribution)',
  weakCopyleft: 'Copyleft חלש',
  lgpl: 'LGPL',
  custom: 'לא מוכר / מותאם',
  unknown: 'אין רישיון',
  unlicensed: 'UNLICENSED',
  copyleft: 'GPL / AGPL',
};

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');

/**
 * What was checked about a flagged or attention package (by name), so the report says why it is fine or what
 * to do. A package that is flagged without a note here is new: someone has to look at it.
 */
const NOTES = [
  [
    /^sentry$/,
    'Functional Source License: מותר כל שימוש חוץ מבניית מוצר שמתחרה ב־Sentry, והופך ל־Apache-2.0 שנתיים אחרי כל גרסה. רק בשרת, לא מופץ באפליקציה. **תקין לשימוש שלנו.**',
  ],
  [
    /^lightningcss/,
    'כלי בנייה של CSS (דרך ה־Metro של Expo). לא נכנס לקובץ האפליקציה. ‏MPL מחייב רק מי שמשנה את הקבצים שלו.',
  ],
  [/^caniuse-lite$/, 'נתונים לכלי הבנייה (browserslist). לא נכנס לקובץ האפליקציה.'],
  [
    /^@expo-google-fonts\//,
    'הגופנים (OFL-1.1): הודעת זכויות היוצרים והרישיון מוצגים במסך "רישיונות" באפליקציה.',
  ],
];
const noteOf = (name) => NOTES.find(([re]) => re.test(name))?.[1] ?? '';

export function report(packages) {
  const flagged = packages.filter((p) => FLAGGED.has(p.category));
  const attention = packages.filter((p) => ATTENTION.has(p.category));
  const choices = packages.filter(
    (p) => typeof p.license === 'string' && / OR /i.test(p.license) && !FLAGGED.has(p.category),
  );
  const count = (tag) => packages.filter((p) => p.apps.includes(tag)).length;
  const byLicense = new Map();
  for (const p of packages)
    byLicense.set(p.license ?? '(none)', (byLicense.get(p.license ?? '(none)') ?? 0) + 1);

  const lines = [
    '<div dir="rtl">',
    '',
    '# דוח רישיונות של חבילות צד שלישי',
    '',
    '> **קובץ שנוצר אוטומטית** על ידי `npm run licenses` (‏`scripts/licenses.mjs`). לא לערוך ידנית.',
    '> הרצה מחדש אחרי כל שינוי בתלויות. `npm run licenses -- --check` נכשל כשהקובץ לא מעודכן.',
    '',
    '**מה נבדק:** סגור התלויות של **Production** בלבד (בלי devDependencies) של `apps/mobile` ושל `apps/server`, לפי `package-lock.json`, כפי ש־Node פותר אותן.',
    'הרישיון נקרא מהשדה `license` ב־`package.json` של כל חבילה מותקנת (ואם היא לא מותקנת במחשב הזה, מה־lock).',
    '',
    '**הסתייגות:** סגור התלויות של `expo` כולל גם כלי בנייה (‏Metro, ‏Babel, ‏@expo/cli) שלא נכנסים לקובץ האפליקציה. הרשימה רחבה מהנדרש, וזה בכוונה.',
    '',
    '## סיכום',
    '',
    `- חבילות באפליקציה (mobile): **${count('mobile')}**`,
    `- חבילות בשרת (server): **${count('server')}**`,
    `- סה״כ שונות (שם@גרסה): **${packages.length}**`,
    `- **מסומנות לבדיקה: ${flagged.length}**`,
    `- דורשות תשומת לב (ייחוס / copyleft חלש): ${attention.length}`,
    '',
    '| רישיון | חבילות |',
    '|---|---|',
    ...[...byLicense.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([l, n]) => `| ${cell(l)} | ${n} |`),
    '',
    '## מסומנות לבדיקה (GPL / AGPL / LGPL / בלי רישיון / UNLICENSED / לא מוכר)',
    '',
  ];
  if (flagged.length === 0) lines.push('אין.', '');
  else {
    lines.push('| חבילה | גרסה | רישיון | סוג | איפה | איך נכנסה | הערה |', '|---|---|---|---|---|---|---|');
    for (const p of flagged)
      lines.push(
        `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license ?? '—')} | ${CATEGORY_HE[p.category]} | ${p.apps.join(', ')} | ${cell(p.via)} | ${cell(noteOf(p.name) || 'לבדוק')} |`,
      );
    lines.push('');
  }
  lines.push('## דורשות תשומת לב', '');
  if (attention.length === 0) lines.push('אין.', '');
  else {
    lines.push('| חבילה | גרסה | רישיון | סוג | איפה | הערה |', '|---|---|---|---|---|---|');
    for (const p of attention)
      lines.push(
        `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${CATEGORY_HE[p.category]} | ${p.apps.join(', ')} | ${cell(noteOf(p.name))} |`,
      );
    lines.push('');
  }
  lines.push('## רישיון כפול (OR): נבחרה האפשרות המתירנית', '');
  if (choices.length === 0) lines.push('אין.', '');
  else {
    lines.push('| חבילה | גרסה | רישיון | איפה |', '|---|---|---|---|');
    for (const p of choices)
      lines.push(`| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${p.apps.join(', ')} |`);
    lines.push('');
  }
  lines.push('## כל החבילות', '', '| חבילה | גרסה | רישיון | איפה |', '|---|---|---|---|');
  for (const p of packages)
    lines.push(`| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license ?? '—')} | ${p.apps.join(', ')} |`);
  lines.push('', '</div>', '');
  return lines.join('\n');
}

// ---- main ----------------------------------------------------------------------------------------------------

function main() {
  const lock = readJson(join(ROOT, 'package-lock.json'));
  const packages = collect(lock, ROOT);
  const outputs = [
    { file: REPORT, text: report(packages) },
    { file: APP_JSON, text: `${JSON.stringify(appJson(packages, ROOT))}\n` },
  ];
  const flagged = packages.filter((p) => FLAGGED.has(p.category));
  const log = has('--quiet') ? () => {} : (m) => console.log(m);

  let stale = false;
  for (const { file, text } of outputs) {
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (has('--check')) {
      if (current !== text) {
        stale = true;
        console.error(`out of date: ${file} (run npm run licenses)`);
      }
    } else if (current !== text) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      log(`wrote ${file}`);
    }
  }
  log(
    `${packages.length} packages (mobile ${packages.filter((p) => p.apps.includes('mobile')).length}, ` +
      `server ${packages.filter((p) => p.apps.includes('server')).length}); flagged ${flagged.length}`,
  );
  for (const p of flagged)
    log(`  flagged: ${p.name}@${p.version} ${p.license ?? '(no license)'} [${p.apps.join(', ')}]`);
  if (stale || (has('--strict') && flagged.length > 0)) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
