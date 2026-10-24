/**
 * Claude's QA client (QA module, stage 4): the /admin/api/qa routes. Staging is open (QA_OPEN): no key needed.
 * A key file, if there is one (~/.sudoku-fight/qa-agent.token; never on a command line, never printed), is
 * sent. Claude runs a test run only when Moshe asks: .claude/skills/qa-run/SKILL.md.
 *
 *   npm run qa -- runs                                          # the runs, newest first
 *   npm run qa -- open --title "בדיקת חברים" --app-version 1.0.5 --device "Pixel 7" --platform android \
 *                      --who claude [--categories friends,levels]
 *   npm run qa -- run 3 [--todo] [--bugs] [--who claude] [--category friends] [--whole]
 *   npm run qa -- task 3 friends-room-create                    # one task, whole
 *   npm run qa -- mark 3 friends-room-create pass [--note "..."]
 *   npm run qa -- mark 3 friends-room-create fail --actual "..." [--note "..."]   # also partial, untested
 *   npm run qa -- fix 3 friends-room-create --fix-note "..." --fixed-in "1.0.5 (abc1234)"
 *   npm run qa -- bugs [--status active|open|handled|verified|reopened|all] [--short]
 *   npm run qa -- close 3
 *   npm run qa -- catalog
 *
 * `--server local|staging|<url>` (staging by default), `--token-file <path>`. Long Hebrew texts may come from a
 * UTF-8 file instead: `--actual-file`, `--note-file`, `--fix-note-file`. Exit code 1 on an API error (its code
 * and message printed), 2 on bad arguments.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  ADMIN_API_PREFIX,
  ADMIN_QA_BUGS_PATH,
  ADMIN_QA_CATALOG_PATH,
  ADMIN_QA_RUNS_PATH,
  type AdminPage,
  type AdminQaBug,
  type AdminQaItem,
  type AdminQaRun,
  type AdminQaRunDetail,
  adminQaItemPath,
  adminQaRunPath,
  type QaCatalog,
} from '@sudoku-fight/protocol';

import {
  DEFAULT_TOKEN_FILE,
  formatBug,
  formatItem,
  formatRun,
  readToken,
  serverUrlOf,
} from '../src/testing/qaAgent';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string', default: 'staging' },
    'token-file': { type: 'string', default: DEFAULT_TOKEN_FILE },
    title: { type: 'string' },
    'app-version': { type: 'string' },
    device: { type: 'string' },
    platform: { type: 'string' },
    who: { type: 'string' },
    categories: { type: 'string' },
    category: { type: 'string' },
    todo: { type: 'boolean' },
    bugs: { type: 'boolean' },
    whole: { type: 'boolean' },
    short: { type: 'boolean' },
    status: { type: 'string' },
    actual: { type: 'string' },
    'actual-file': { type: 'string' },
    note: { type: 'string' },
    'note-file': { type: 'string' },
    'fix-note': { type: 'string' },
    'fix-note-file': { type: 'string' },
    'fixed-in': { type: 'string' },
  },
});

function usage(message: string): never {
  console.error(`${message}\n(see the comment at the top of apps/server/scripts/qa.ts)`);
  process.exit(2);
}

/** A text option, or the UTF-8 file named by its `-file` twin. */
function textOf(name: 'actual' | 'note' | 'fix-note'): string | undefined {
  const file = values[`${name}-file`];
  return file !== undefined ? readFileSync(file, 'utf8') : values[name];
}

function runIdOf(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) usage('a run id (a number) is needed');
  return Number(raw);
}

const base = `${serverUrlOf(values.server)}${ADMIN_API_PREFIX}`;
// No key file: no key sent (staging is open, QA_OPEN).
const token = existsSync(values['token-file']) ? readToken(values['token-file']) : null;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const [command, a, b, c] = positionals;
  switch (command) {
    case 'runs': {
      const page = await api<AdminPage<AdminQaRun>>(`${ADMIN_QA_RUNS_PATH}?pageSize=50`);
      page.items.forEach((run) => console.log(formatRun(run)));
      if (page.items.length === 0) console.log('(no runs)');
      return;
    }
    case 'open': {
      if (values.title === undefined || values['app-version'] === undefined) {
        usage('open needs --title and --app-version');
      }
      const run = await api<AdminQaRun>(ADMIN_QA_RUNS_PATH, {
        title: values.title,
        appVersion: values['app-version'],
        device: values.device ?? null,
        platform: values.platform ?? null,
        who: values.who ?? 'all',
        ...(values.categories === undefined ? {} : { categories: values.categories.split(',') }),
      });
      console.log(formatRun(run));
      return;
    }
    case 'run': {
      const query = new URLSearchParams();
      if (values.todo) query.set('result', 'untested');
      if (values.bugs) query.set('bugs', '1');
      if (values.who !== undefined) query.set('who', values.who);
      if (values.category !== undefined) query.set('category', values.category);
      const q = query.toString();
      const run = await api<AdminQaRunDetail>(adminQaRunPath(runIdOf(a)) + (q ? `?${q}` : ''));
      console.log(formatRun(run));
      run.items.forEach((item) => console.log(formatItem(item, values.whole)));
      return;
    }
    case 'task': {
      if (b === undefined) usage('task needs a run id and a task id');
      const run = await api<AdminQaRunDetail>(adminQaRunPath(runIdOf(a)));
      const item = run.items.find((i) => i.taskId === b);
      if (item === undefined) usage(`no task ${b} in run #${run.id}`);
      console.log(formatItem(item, true));
      return;
    }
    case 'mark': {
      if (b === undefined || c === undefined) usage('mark needs a run id, a task id and a result');
      const item = await api<AdminQaItem>(adminQaItemPath(runIdOf(a), b, 'result'), {
        result: c,
        actual: textOf('actual') ?? null,
        note: textOf('note') ?? null,
      });
      console.log(formatItem(item, true));
      return;
    }
    case 'fix': {
      if (b === undefined) usage('fix needs a run id and a task id');
      const item = await api<AdminQaItem>(adminQaItemPath(runIdOf(a), b, 'fix'), {
        fixNote: textOf('fix-note'),
        fixedIn: values['fixed-in'],
      });
      console.log(formatItem(item, true));
      return;
    }
    case 'bugs': {
      const status = values.status ?? 'active';
      const page = await api<AdminPage<AdminQaBug>>(`${ADMIN_QA_BUGS_PATH}?status=${status}&pageSize=200`);
      page.items.forEach((bug) =>
        console.log(values.short ? formatBug(bug).split('\n').slice(0, 2).join('\n') : formatBug(bug)),
      );
      console.log(`(${page.items.length} of ${page.total})`);
      return;
    }
    case 'close': {
      console.log(formatRun(await api<AdminQaRun>(adminQaRunPath(runIdOf(a), 'close'), {})));
      return;
    }
    case 'catalog': {
      const catalog = await api<QaCatalog>(ADMIN_QA_CATALOG_PATH);
      for (const cat of catalog.categories) {
        const tasks = cat.subcategories.flatMap((s) => s.tasks);
        const mine = tasks.filter((t) => t.who !== 'moshe').length;
        console.log(`${cat.id}: ${cat.title} — ${tasks.length} tasks (${mine} for Claude)`);
      }
      return;
    }
    default:
      usage(`unknown command "${command ?? ''}"`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
