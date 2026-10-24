/**
 * Claude's QA tools (QA module, stage 4): what scripts/qa.ts (the /admin/api/qa routes with the agent key) and
 * scripts/adb.ts (a phone over ADB) share, kept pure here so Jest checks it. Claude runs a test run only when
 * Moshe asks; how is in .claude/skills/qa-run/SKILL.md.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AdminQaBug, AdminQaItem, AdminQaRun } from '@sudoku-fight/protocol';

/** Where the agent key lives: outside the repo (it is public), never on a command line or in a transcript. */
export const DEFAULT_TOKEN_FILE = join(homedir(), '.sudoku-fight', 'qa-agent.token');

/** The servers a run can live on; anything else is taken as a base URL. */
export const QA_SERVERS = {
  local: 'http://localhost:2567',
  staging: 'https://sudoku-fight-staging.fly.dev',
} as const;

/** The base URL for `--server`: a known name, or a URL as it is (without a trailing slash). */
export function serverUrlOf(server: string): string {
  const known = (QA_SERVERS as Record<string, string>)[server];
  if (known !== undefined) return known;
  if (!/^https?:\/\/[^\s]+$/.test(server)) {
    throw new Error(`unknown server "${server}": local, staging or a URL`);
  }
  return server.replace(/\/+$/, '');
}

/** The key from its file, trimmed. The error names the file, never the content. */
export function readToken(
  file: string,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): string {
  let raw: string;
  try {
    raw = read(file);
  } catch {
    throw new Error(`no agent key in ${file} (see .claude/skills/qa-run/SKILL.md)`);
  }
  const token = raw.trim();
  if (token.length < 32) throw new Error(`the agent key in ${file} is shorter than 32 characters`);
  return token;
}

const RESULT_MARK = { untested: '·', pass: 'V', partial: '½', fail: 'X' } as const;

/** One run on one line: id, status, title, version, device, counts. */
export function formatRun(run: AdminQaRun): string {
  const c = run.counts;
  const where = [run.appVersion, run.platform, run.device].filter(Boolean).join(' · ');
  return (
    `#${run.id} [${run.status}] ${run.title} (${where}) ` +
    `V ${c.pass} · ½ ${c.partial} · X ${c.fail} · · ${c.untested} / ${c.total}; bugs open ${c.openBugs}, handled ${c.handled}`
  );
}

/** A task, short (its id, mark and title) or whole (with steps, expected, what happened and the fix). */
export function formatItem(item: AdminQaItem, whole = false): string {
  const head = `${RESULT_MARK[item.result]} ${item.taskId} [${item.who}] ${item.title}`;
  const bug = item.bugStatus === null ? '' : ` {${item.bugStatus}}`;
  if (!whole) return head + bug;
  const lines = [head + bug, `  ${item.categoryTitle} › ${item.subcategoryTitle}`];
  item.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  item.expected.forEach((e) => lines.push(`  ✓ ${e}`));
  if (item.actual !== null) lines.push(`  בפועל: ${item.actual}`);
  if (item.note !== null) lines.push(`  הערה: ${item.note}`);
  if (item.fixNote !== null) lines.push(`  טופל (${item.fixedIn ?? '?'}): ${item.fixNote}`);
  return lines.join('\n');
}

/** A bug with what it needs to be fixed: its run, the task, what happened, and any fix so far. */
export function formatBug(bug: AdminQaBug): string {
  const lines = [
    `${RESULT_MARK[bug.result]} ${bug.taskId} {${bug.bugStatus}} run #${bug.run.id} ${bug.run.title} (${bug.run.appVersion})`,
    `  ${bug.categoryTitle} › ${bug.subcategoryTitle} › ${bug.title}`,
  ];
  bug.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  bug.expected.forEach((e) => lines.push(`  ✓ ${e}`));
  if (bug.actual !== null) lines.push(`  בפועל: ${bug.actual}`);
  if (bug.note !== null) lines.push(`  הערה: ${bug.note}`);
  if (bug.fixNote !== null) lines.push(`  טופל (${bug.fixedIn ?? '?'}): ${bug.fixNote}`);
  return lines.join('\n');
}

/** A view on the screen, from `uiautomator dump`. React Native's testID is the resource-id. */
export interface UiNode {
  text: string;
  desc: string;
  id: string;
  clickable: boolean;
  bounds: [number, number, number, number];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

/** The views of a dump that carry something to find: a text, a description, an id, or a click. */
export function parseUiDump(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const tag of xml.match(/<node\b[^>]*>/g) ?? []) {
    const attr = (name: string) => unescapeXml(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '');
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr('bounds'));
    if (b === null) continue;
    const node: UiNode = {
      text: attr('text'),
      desc: attr('content-desc'),
      id: attr('resource-id'),
      clickable: attr('clickable') === 'true',
      bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])],
    };
    if (node.text || node.desc || node.id || node.clickable) nodes.push(node);
  }
  return nodes;
}

export function centerOf(node: UiNode): { x: number; y: number } {
  const [x1, y1, x2, y2] = node.bounds;
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

/** The view to tap: an exact text, description or id first, then one that contains it; null when none. */
export function findNode(nodes: UiNode[], query: string): UiNode | null {
  const q = query.trim();
  if (q === '') return null;
  const fields = (n: UiNode) => [n.text, n.desc, n.id, n.id.split('/').pop() ?? ''];
  return (
    nodes.find((n) => fields(n).some((f) => f === q)) ??
    nodes.find((n) => fields(n).some((f) => f !== '' && f.includes(q))) ??
    null
  );
}

/** The screen as lines to read instead of a screenshot (far fewer tokens): text, description, id, centre. */
export function describeNodes(nodes: UiNode[]): string[] {
  return nodes.map((n) => {
    const { x, y } = centerOf(n);
    const label = [
      n.text && `"${n.text}"`,
      n.desc && `desc="${n.desc}"`,
      n.id && `id=${n.id.split('/').pop()}`,
    ]
      .filter(Boolean)
      .join(' ');
    return `${label || '(no label)'} @${x},${y}${n.clickable ? ' [tap]' : ''}`;
  });
}
