// The size of the app's JS bundle and assets (work plan stage 13, "ביצועים: זמן פתיחה וגודל האפליקציה";
// docs/PERF.md). Reads an `expo export` made with source maps and prints:
//   - the bundle's size (Hermes bytecode, or JS with --no-bytecode),
//   - the bytes each package or app folder takes in it (top N), and the largest single files,
//   - the assets: fonts, sounds, SVGs, images.
// No dependencies: the source map's VLQ mappings are decoded here.
//
//   cd apps/mobile
//   npx expo export --platform android --output-dir %TEMP%\sf-perf --source-maps --dump-assetmap
//   node scripts/bundle-report.mjs %TEMP%\sf-perf [--top 30] [--json report.json] [--compare before.json]
//
// A segment's bytes are the generated span up to the next segment (on its line; a line's last segment runs
// to the line's end in a JS bundle). In Hermes bytecode the map's one "line" is the bytecode, its columns
// byte offsets, so the spans count instructions; string tables, JSON and headers aren't attributed (the
// report prints the attributed total under the bundle's size).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_VALUE = new Map([...B64].map((c, i) => [c, i]));

/** Decodes one VLQ-encoded segment ("AAgBC") into its numbers. */
export function decodeVlq(text) {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const c of text) {
    const digit = B64_VALUE.get(c);
    if (digit === undefined) throw new Error(`Bad VLQ character: ${c}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>>= 1;
    out.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return out;
}

/**
 * The mappings as lines of segments: each { col, source } (source is the index into `sources`, or -1 for a
 * segment that maps to nothing). Columns and sources are absolute, decoded from the map's deltas.
 */
export function decodeMappings(mappings) {
  const lines = [];
  let source = 0;
  for (const line of mappings.split(';')) {
    const segments = [];
    let col = 0;
    if (line) {
      for (const raw of line.split(',')) {
        if (!raw) continue;
        const fields = decodeVlq(raw);
        col += fields[0];
        if (fields.length >= 4) {
          source += fields[1];
          segments.push({ col, source });
        } else {
          segments.push({ col, source: -1 });
        }
      }
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Bytes per source index. `lineLengths[i]` is the generated line's length (a JS bundle), so its last
 * segment runs to the end; without it (Hermes bytecode) the last segment of a line counts nothing.
 */
export function bytesPerSource(lines, lineLengths) {
  const bytes = new Map();
  lines.forEach((segments, i) => {
    const sorted = [...segments].sort((a, b) => a.col - b.col);
    sorted.forEach((seg, j) => {
      const end = j + 1 < sorted.length ? sorted[j + 1].col : (lineLengths?.[i] ?? seg.col);
      const span = Math.max(0, end - seg.col);
      bytes.set(seg.source, (bytes.get(seg.source) ?? 0) + span);
    });
  });
  return bytes;
}

/** Folders in the app that are worth one row each (two levels under src/). */
const APP_DEEP = new Set(['screens', 'components']);

/**
 * The row a source file counts towards: an npm package ("react-native", "@expo/ui"), a folder of the app
 * ("app src/screens/game", "app routes"), a folder of a workspace package ("@sudoku-fight/engine src/bot"),
 * or "(virtual)" for Metro's polyfills.
 */
export function groupOf(source) {
  const path = source.replace(/\\/g, '/');
  if (path.startsWith('\0') || !path.includes('/')) return '(virtual)';
  const nm = path.lastIndexOf('/node_modules/');
  if (nm >= 0 || path.startsWith('node_modules/')) {
    const rest = nm >= 0 ? path.slice(nm + '/node_modules/'.length) : path.slice('node_modules/'.length);
    const parts = rest.split('/');
    const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    // The workspace packages are linked into node_modules; name them as the app does.
    if (name.startsWith('@sudoku-fight/')) return workspaceRow(name, parts.slice(2));
    return name;
  }
  const mobile = path.match(/apps\/mobile\/(.*)$/);
  if (mobile) {
    const parts = mobile[1].split('/');
    if (parts[0] === 'app') return 'app routes (app/)';
    if (parts[0] === 'src') {
      const depth = APP_DEEP.has(parts[1]) && parts.length > 3 ? 3 : 2;
      return `app ${parts.slice(0, Math.min(depth, parts.length - 1)).join('/')}`;
    }
    return `app ${parts[0]}`;
  }
  const pkg = path.match(/packages\/([^/]+)\/(.*)$/);
  if (pkg) return workspaceRow(`@sudoku-fight/${pkg[1]}`, pkg[2].split('/'));
  const assets = path.match(/(?:^|\/)assets\/([^/]+)\//);
  if (assets) return `assets/${assets[1]}`;
  return '(other)';
}

function workspaceRow(name, parts) {
  // src/bot/foo.ts -> "src/bot"; src/index.ts -> "src".
  const dirs = parts.slice(0, -1);
  return `${name} ${dirs.slice(0, 2).join('/') || '.'}`;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const size = (n) => (n >= 1024 * 1024 ? mb(n) : kb(n));

/** The bundles in an export folder: [{ platform, file, map }]. */
export function findBundles(dir) {
  const root = join(dir, '_expo', 'static', 'js');
  if (!existsSync(root)) throw new Error(`No bundles in ${root}: was it exported with expo export?`);
  const out = [];
  for (const platform of readdirSync(root)) {
    for (const file of readdirSync(join(root, platform))) {
      if (!/\.(hbc|js)$/.test(file)) continue;
      const map = join(root, platform, `${file}.map`);
      out.push({ platform, file: join(root, platform, file), map: existsSync(map) ? map : null });
    }
  }
  return out;
}

/** The bundle's rows: { total, attributed, groups: [{ name, bytes }], files: [{ name, bytes }] }. */
export function analyzeBundle({ file, map }) {
  const total = statSync(file).size;
  if (!map) return { total, attributed: 0, groups: [], files: [] };
  const sm = JSON.parse(readFileSync(map, 'utf8'));
  const lines = decodeMappings(sm.mappings);
  const lineLengths = file.endsWith('.js')
    ? readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.length)
    : null;
  const perSource = bytesPerSource(lines, lineLengths);
  const groups = new Map();
  const files = [];
  let attributed = 0;
  for (const [index, bytes] of perSource) {
    if (index < 0) continue;
    const source = sm.sources[index] ?? '(unknown)';
    attributed += bytes;
    const name = groupOf(source);
    groups.set(name, (groups.get(name) ?? 0) + bytes);
    files.push({ name: source.replace(/^\/+/, ''), bytes });
  }
  const sortDesc = (a, b) => b.bytes - a.bytes;
  return {
    total,
    attributed,
    groups: [...groups].map(([name, bytes]) => ({ name, bytes })).sort(sortDesc),
    files: files.sort(sortDesc),
  };
}

/** The exported assets, by kind: { fonts, sounds, svgs, images, other } each [{ name, bytes }]. */
export function analyzeAssets(dir) {
  const mapPath = join(dir, 'assetmap.json');
  if (!existsSync(mapPath)) return null;
  const assetMap = JSON.parse(readFileSync(mapPath, 'utf8'));
  const kinds = { fonts: [], sounds: [], svgs: [], images: [], other: [] };
  const kindOf = (type) =>
    ['ttf', 'otf'].includes(type)
      ? 'fonts'
      : ['wav', 'mp3', 'm4a', 'aac', 'ogg'].includes(type)
        ? 'sounds'
        : type === 'svg'
          ? 'svgs'
          : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(type)
            ? 'images'
            : 'other';
  for (const asset of Object.values(assetMap)) {
    let bytes = 0;
    for (const hash of asset.fileHashes ?? []) {
      const path = join(dir, 'assets', hash);
      if (existsSync(path)) bytes += statSync(path).size;
    }
    kinds[kindOf(asset.type)].push({ name: `${asset.name}.${asset.type}`, bytes });
  }
  for (const list of Object.values(kinds)) list.sort((a, b) => b.bytes - a.bytes);
  return kinds;
}

const sum = (list) => list.reduce((n, x) => n + x.bytes, 0);

/** The whole report as data (also what --json writes). */
export function buildReport(dir, top = 30) {
  const bundles = findBundles(dir).map((b) => {
    const a = analyzeBundle(b);
    return {
      platform: b.platform,
      file: basename(b.file),
      total: a.total,
      attributed: a.attributed,
      groups: a.groups.slice(0, top),
      files: a.files.slice(0, top),
    };
  });
  const assets = analyzeAssets(dir);
  const assetTotals = assets
    ? Object.fromEntries(
        Object.entries(assets).map(([k, list]) => [k, { count: list.length, bytes: sum(list) }]),
      )
    : null;
  return { bundles, assets, assetTotals };
}

function table(rows, compare) {
  const width = Math.max(10, ...rows.map((r) => r.name.length));
  return rows
    .map((r) => {
      const before = compare?.get(r.name);
      const delta =
        before === undefined ? '' : `  (${r.bytes - before >= 0 ? '+' : ''}${kb(r.bytes - before)})`;
      return `  ${r.name.padEnd(width)}  ${size(r.bytes).padStart(10)}${delta}`;
    })
    .join('\n');
}

/** The report as text, with deltas against an earlier report when given. */
export function formatReport(report, before = null) {
  const out = [];
  for (const b of report.bundles) {
    const prev = before?.bundles.find((x) => x.platform === b.platform);
    const delta = prev ? `  (${b.total - prev.total >= 0 ? '+' : ''}${kb(b.total - prev.total)})` : '';
    out.push(`Bundle ${b.platform}: ${b.file}  ${size(b.total)}${delta}`);
    if (b.attributed) {
      out.push(`  attributed by the source map: ${size(b.attributed)} (the rest: headers, string tables)`);
      out.push(`\nTop ${b.groups.length} packages / folders:`);
      out.push(table(b.groups, prev && new Map(prev.groups.map((g) => [g.name, g.bytes]))));
      out.push(`\nTop ${b.files.length} files:`);
      out.push(table(b.files, prev && new Map(prev.files.map((g) => [g.name, g.bytes]))));
    }
    out.push('');
  }
  if (report.assets) {
    out.push('Assets:');
    for (const [kind, t] of Object.entries(report.assetTotals)) {
      const prev = before?.assetTotals?.[kind];
      const delta = prev ? `  (${t.bytes - prev.bytes >= 0 ? '+' : ''}${kb(t.bytes - prev.bytes)})` : '';
      out.push(
        `  ${kind.padEnd(7)} ${String(t.count).padStart(3)} files  ${size(t.bytes).padStart(10)}${delta}`,
      );
    }
    out.push('\nFonts:');
    out.push(table(report.assets.fonts));
    out.push('\nLargest sounds:');
    out.push(table(report.assets.sounds.slice(0, 5)));
    out.push('\nLargest SVGs:');
    out.push(table(report.assets.svgs.slice(0, 5)));
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const args = { dir: null, top: 30, json: null, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--compare') args.compare = argv[++i];
    else args.dir = a;
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error(
      'Usage: node scripts/bundle-report.mjs <export dir> [--top 30] [--json out] [--compare in]',
    );
    process.exit(1);
  }
  const report = buildReport(args.dir, args.top);
  const before = args.compare ? JSON.parse(readFileSync(args.compare, 'utf8')) : null;
  console.log(formatReport(report, before));
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2));
}
