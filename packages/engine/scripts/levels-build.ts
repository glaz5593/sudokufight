/**
 * Builds the 300 levels of staged practice (dev-plan §2ד, plan §5.6):
 *
 *   npm run levels:build [-- --runs 100] [--report <file.md>] [--no-sim] [--check] [--sim-only] [--out <file>]
 *
 * Writes packages/engine/data/levels.json (compact JSON, one line, with the bot-config fingerprint), prints
 * the build report (levels per kind, boards tried, draws refused), then simulates the three player profiles on
 * every level and prints the chapter report against the targets of plan §4.4 (it warns, it never fails). With
 * --report the simulation report is also written as Markdown. --check builds and compares with the stored file
 * instead of writing it (a second build must give the very same file). --no-sim skips the simulation;
 * --sim-only simulates the stored file without building.
 *
 * Deterministic: every level comes from its own seed (`${id}:r${rev}`), so the same config and engine give the
 * same file. No level uses the givens or the solution of a ranked puzzle, in the bank or retired from it.
 * Afterwards: `npm run levels -w @sudoku-fight/mobile` copies the app's part (AppLevel) into the app.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEVEL_KINDS, type LevelKind, type LevelSpec } from '../src';
import { PROFILE_IDS, type ProfileId, TARGET_TOLERANCE } from '../src/levels/builder/profiles';
import { buildLevels, type LevelBuild } from '../src/levels/builder/build';
import { type ChapterReport, chapterReport, DEFAULT_RUNS } from '../src/levels/builder/simulate';
import type { LevelsFile } from '../src/levels/builder/validate';
import { ENGINE_ROOT, parseArgs, readBank } from './bankFile';

const LEVELS_PATH = join(ENGINE_ROOT, 'data', 'levels.json');
const RETIRED_PATH = join(ENGINE_ROOT, 'data', 'ranked-retired-solutions.json');

/** The givens and solutions of every ranked puzzle, in the bank and retired (plan §1, principle 7). */
function rankedBoards(): Set<string> {
  const boards = new Set<string>();
  for (const p of readBank()) if (p.pool === 'ranked') boards.add(p.givens).add(p.solution);
  if (existsSync(RETIRED_PATH)) {
    const retired = JSON.parse(readFileSync(RETIRED_PATH, 'utf8')) as {
      puzzles: { givens: string; solution: string }[];
    };
    for (const p of retired.puzzles) boards.add(p.givens).add(p.solution);
  }
  return boards;
}

/** The file's text: compact JSON and a newline (the app copy is generated from it, byte for byte). */
const levelsText = (file: LevelsFile): string => JSON.stringify(file) + '\n';

function printBuild(builds: readonly LevelBuild[], seconds: number): void {
  const byKind = new Map<
    LevelKind,
    { levels: number; bosses: number; attempts: number; max: number; redraws: number }
  >();
  for (const k of LEVEL_KINDS) byKind.set(k, { levels: 0, bosses: 0, attempts: 0, max: 0, redraws: 0 });
  for (const b of builds) {
    const row = byKind.get(b.spec.kind)!;
    if (b.spec.boss) row.bosses++;
    else row.levels++;
    row.attempts += b.attempts;
    row.max = Math.max(row.max, b.attempts);
    row.redraws += b.redraws;
  }
  console.log(`\nBuilt ${builds.length} levels in ${seconds.toFixed(1)} s.\n`);
  console.log(
    `  ${'kind'.padEnd(12)}${'levels'.padStart(7)}${'bosses'.padStart(7)}${'boards'.padStart(8)}${'max'.padStart(6)}${'redraws'.padStart(9)}`,
  );
  for (const [kind, r] of byKind)
    console.log(
      `  ${kind.padEnd(12)}${String(r.levels).padStart(7)}${String(r.bosses).padStart(7)}` +
        `${String(r.attempts).padStart(8)}${String(r.max).padStart(6)}${String(r.redraws).padStart(9)}`,
    );
  const refused = builds.flatMap((b) => b.refused);
  if (refused.length) {
    console.log(`\n  ${refused.length} draws refused and drawn again:`);
    for (const r of refused.slice(0, 20)) console.log(`    ${r}`);
    if (refused.length > 20) console.log(`    … and ${refused.length - 20} more`);
  }
}

const PROFILE_HE: Record<ProfileId, string> = { casual: 'מזדמן', good: 'טוב', excellent: 'מעולה' };
const KIND_HE: Record<LevelKind, string> = {
  find: 'מציאה',
  findDuel: 'מרוץ',
  fillBox: 'ריבוע',
  duel: 'דו־קרב',
  spotError: 'מצא את הטעות',
  pointHunter: 'צייד הנקודות',
  chain: 'שרשרת',
};
const LRI = '⁦';
const PDI = '⁩';
/** A number with a sign, isolated (LRI…PDI) so it reads right inside Hebrew text. */
const signed = (x: number): string => `${LRI}${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x)}${PDI}`;

/** The later chapters to time for the calibration: act 4's first that needs an elimination, and act 6's first. */
const CALIBRATION_CHAPTERS = [17, 26] as const;
/** The kinds the gap comes from in those chapters (the report's kind×act table). */
const CALIBRATION_KINDS: readonly LevelKind[] = ['fillBox', 'findDuel', 'duel'];

/**
 * The levels to play once and time for the calibration (dev-plan §2ד): the first of each kind, then the gap's
 * kinds in the later chapters (no boss: a boss is a step harder than its chapter).
 */
function calibrationLevels(levels: readonly LevelSpec[]): { first: LevelSpec[]; later: LevelSpec[] } {
  const found = (list: (LevelSpec | undefined)[]) => list.filter((l): l is LevelSpec => l !== undefined);
  return {
    first: found(LEVEL_KINDS.map((kind) => levels.find((l) => l.kind === kind))).sort(
      (a, b) => a.chapter - b.chapter || a.slot - b.slot,
    ),
    later: found(
      CALIBRATION_CHAPTERS.flatMap((chapter) =>
        CALIBRATION_KINDS.map((kind) =>
          levels.find((l) => l.chapter === chapter && l.kind === kind && !l.boss),
        ),
      ),
    ),
  };
}

/** The simulation report for Moshe, in Hebrew (Markdown): what each profile gets, against plan §4.4. */
function reportMarkdown(r: ChapterReport, levels: readonly LevelSpec[]): string {
  const lines: string[] = [];
  const off = (c: ChapterReport['chapters'][number], id: ProfileId) => {
    const d = Math.round((c.stars[id] - c.target[id]) * 10) / 10;
    return `${c.stars[id]} (יעד ${c.target[id]}, ${signed(d)})${Math.abs(d) > TARGET_TOLERANCE ? ' ⚠' : ''}`;
  };
  lines.push('<div dir="rtl">', '', '# אימון בשלבים: דוח הסימולציה של שלושת הפרופילים', '');
  lines.push(
    `> **מה זה:** כמה כוכבים מקבל שחקן מזדמן, טוב ומעולה **בניסיון הראשון** בכל פרק (מתוך 30), מול היעד של התוכנית (סעיף 4.4). ${r.runs} ריצות לכל שלב ולכל פרופיל.`,
    '>',
    '> **חשוב:** כל המספרים של הפרופילים הם **הנחה**, ועוד לא כוילו מול משחק אמיתי (הטבלה בסוף). לפני שמקבעים ספים, צריך לכייל אותם: למשל הזמנים שלך בכמה שלבים לדוגמה, או נתוני זמן החשיבה באימונים.',
    '>',
    `> **⚠** מסמן פרק שרחוק מהיעד ביותר מ־${TARGET_TOLERANCE} כוכבים. הדוח מזהיר, ולא עוצר את הבנייה.`,
    '',
    '## לפי פרק',
    '',
    `| פרק | מערכה | ${PROFILE_IDS.map((id) => PROFILE_HE[id]).join(' | ')} |`,
    '|---|---|---|---|---|',
  );
  for (const c of r.chapters)
    lines.push(
      `| ${c.chapter} | ${c.act} | ${off(c, 'casual')} | ${off(c, 'good')} | ${off(c, 'excellent')} |`,
    );
  lines.push(
    '',
    '## לפי מערכה (ממוצע לפרק)',
    '',
    `| מערכה | פרקים | ${PROFILE_IDS.map((id) => PROFILE_HE[id]).join(' | ')} |`,
    '|---|---|---|---|---|',
  );
  for (let act = 1; act <= 6; act++) {
    const cs = r.chapters.filter((c) => c.act === act);
    const avg = (id: ProfileId) =>
      Math.round((cs.reduce((s, c) => s + c.stars[id], 0) / cs.length) * 10) / 10;
    lines.push(
      `| ${act} | ${(act - 1) * 5 + 1}–${act * 5} | ${PROFILE_IDS.map((id) => `${avg(id)} (יעד ${cs[0]!.target[id]})`).join(' | ')} |`,
    );
  }
  // Which kind makes the gap: the mean stars of a level, by kind and act (bosses with their kind).
  lines.push(
    '',
    '## לפי סוג ומערכה (ממוצע כוכבים לשלב: מזדמן / טוב / מעולה)',
    '',
    `| סוג | ${[1, 2, 3, 4, 5, 6].map((a) => `מערכה ${a}`).join(' | ')} |`,
    '|---|---|---|---|---|---|---|',
  );
  for (const kind of LEVEL_KINDS) {
    const cells = [1, 2, 3, 4, 5, 6].map((act) => {
      const rows = r.levels.filter(
        (row, k) => row.kind === kind && Math.ceil(levels[k]!.chapter / 5) === act,
      );
      if (!rows.length) return '—';
      const mean = (id: ProfileId) =>
        (rows.reduce((s, x) => s + x.byProfile[id].mean, 0) / rows.length).toFixed(1);
      return `${LRI}${PROFILE_IDS.map(mean).join(' / ')}${PDI}`;
    });
    lines.push(`| ${KIND_HE[kind]} | ${cells.join(' | ')} |`);
  }
  const hard = r.warnings.filter((w) => w.type === 'tooHard');
  const order = r.warnings.filter((w) => w.type === 'order');
  lines.push('', '## אזהרות', '');
  const offCount = r.warnings.filter((w) => w.type === 'offTarget').length;
  lines.push(`- **פרקים רחוקים מהיעד:** ${offCount} (פרק ופרופיל; מסומנים ב־⚠ בטבלה).`);
  lines.push(
    order.length
      ? `- **סדר הפרופילים נשבר** (מעולה ≥ טוב ≥ מזדמן) בפרקים: ${order.map((w) => (w.type === 'order' ? w.chapter : '')).join(', ')}.`
      : '- **סדר הפרופילים** (מעולה ≥ טוב ≥ מזדמן) נשמר בכל הפרקים.',
  );
  if (hard.length) {
    lines.push(
      `- **שלבים קשים מדי** (שחקן "טוב" מקבל 0 כוכבים ביותר מ־60% מהריצות, לפי הכלל של סעיף 5.5): ${hard.length}`,
    );
    for (const w of hard)
      if (w.type === 'tooHard')
        lines.push(`  - ${w.id}, ${KIND_HE[w.kind]}: 0 כוכבים ב־${Math.round(w.zeroShare * 100)}%`);
  } else lines.push('- **אין שלב קשה מדי** לשחקן "טוב" (0 כוכבים ביותר מ־60%).');
  lines.push(
    '',
    '## לפי שלב (ממוצע כוכבים, ובסוגריים אחוז ה־0 כוכבים)',
    '',
    `| שלב | פרק | סוג | ${PROFILE_IDS.map((id) => PROFILE_HE[id]).join(' | ')} |`,
    '|---|---|---|---|---|---|',
  );
  r.levels.forEach((row, k) => {
    const spec = levels[k]!;
    const cell = (id: ProfileId) => {
      const x = row.byProfile[id];
      return `${x.mean.toFixed(2)} (${Math.round((100 * x.counts[0]) / r.runs)}%)`;
    };
    lines.push(
      `| ${row.id}${spec.boss ? ' 👑' : ''} | ${spec.chapter} | ${KIND_HE[row.kind]} | ${cell('casual')} | ${cell('good')} | ${cell('excellent')} |`,
    );
  });
  const named = (list: readonly LevelSpec[]) =>
    list.map((l) => `${l.id} ${KIND_HE[l.kind]} (פרק ${l.chapter})`).join(', ');
  const { first, later } = calibrationLevels(levels);
  lines.push(
    '',
    '## איך מכיילים',
    '',
    '- משחקים פעם אחת כל שלב ברשימה, בבילד Release, ורושמים את הזמן ואת הטעויות:',
    `  - הראשון מכל סוג: ${named(first)}.`,
    `  - ובפרקים ${CALIBRATION_CHAPTERS.join(' ו־')}, שבהם הפער הכי גדול: ${named(later)}.`,
    '- את הזמנים מכניסים ל־`packages/engine/src/levels/builder/profiles.ts`, ומסמנים אותם שם ככאלה שכוילו.',
    '- ואז מריצים שוב את הסימולציה: `npm run levels:build -- --sim-only --report <קובץ>`.',
  );
  const allAssumed = r.assumptions.every((a) => !a.calibrated);
  lines.push(
    '',
    `## המספרים של המודל: ${allAssumed ? 'כולם עדיין הנחה' : 'מה כויל ומה עדיין הנחה'}`,
    '',
    '| מספר | ערך | כויל? |',
    '|---|---|---|',
  );
  for (const a of r.assumptions)
    lines.push(`| \`${a.name}\` | ${LRI}${a.value}${PDI} | ${a.calibrated ? 'כן' : '**לא, הנחה**'} |`);
  lines.push('', '</div>', '');
  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const bare = new Set(['--no-sim', '--check', '--sim-only']);
  const { flags } = parseArgs(argv.filter((a) => !bare.has(a)));
  const check = argv.includes('--check');
  const simulate = !argv.includes('--no-sim');
  const runs = Number(flags.get('runs') ?? DEFAULT_RUNS);
  if (!(Number.isInteger(runs) && runs > 0)) throw new Error('--runs must be a positive whole number');
  const out = flags.get('out') ?? LEVELS_PATH;

  if (argv.includes('--sim-only')) {
    simulateAndReport(JSON.parse(readFileSync(out, 'utf8')) as LevelsFile, runs, flags.get('report'));
    return;
  }
  const ranked = rankedBoards();
  console.log(`Building the levels (${ranked.size / 2} ranked boards kept out)…`);
  const started = Date.now();
  let done = 0;
  const { file, builds } = buildLevels({
    avoid: (spec: LevelSpec) =>
      ranked.has(spec.board.grid) || ranked.has(spec.board.solution) ? 'a ranked board' : null,
    onLevel: (b) => {
      done++;
      if (done % 10 === 0)
        process.stdout.write(`  ${b.spec.id} (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
    },
  });
  printBuild(builds, (Date.now() - started) / 1000);

  const text = levelsText(file);
  if (check) {
    const stored = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (stored !== text) {
      console.error(`\n${out} differs from a fresh build.`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n${out} is the same as a fresh build.`);
  } else {
    writeFileSync(out, text);
    console.log(`\nWrote ${out} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB).`);
    console.log('Next: npm run levels -w @sudoku-fight/mobile (the app copy).');
  }

  if (simulate) simulateAndReport(file, runs, flags.get('report'));
}

function simulateAndReport(file: LevelsFile, runs: number, reportPath: string | undefined): void {
  console.log(`\nSimulating the profiles, ${runs} runs a level…`);
  const simStarted = Date.now();
  const report = chapterReport(file.levels, { runs });
  const markdown = reportMarkdown(report, file.levels);
  for (const c of report.chapters)
    console.log(
      `  chapter ${String(c.chapter).padStart(2)}  ` +
        PROFILE_IDS.map((id) => `${id} ${c.stars[id].toFixed(1).padStart(4)} / ${c.target[id]}`).join('   '),
    );
  console.log(`\n  ${report.warnings.length} warnings:`);
  for (const w of report.warnings) console.log(`    ${w.text}`);
  console.log(`(${((Date.now() - simStarted) / 1000).toFixed(0)} s)`);
  if (reportPath) {
    writeFileSync(reportPath, markdown);
    console.log(`Wrote the simulation report to ${reportPath}.`);
  }
}

main();
