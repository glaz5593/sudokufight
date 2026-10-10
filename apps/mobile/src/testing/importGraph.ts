/* Test-only: the static import graph Metro walks from a set of entry files (docs/PERF.md). */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/** The monorepo's root (apps/mobile/src/testing → four levels up). */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx', '/index.js'];

export interface ImportGraph {
  /** Every source file reached (repo-relative, "/" separators), with the file that first imported it. */
  files: Map<string, string>;
  /** Every npm package reached, with the file that first imported it. */
  packages: Map<string, string>;
}

const posix = (path: string) => relative(REPO_ROOT, path).split(sep).join('/');
const packageName = (spec: string) =>
  spec
    .split('/')
    .slice(0, spec.startsWith('@') ? 2 : 1)
    .join('/');

function resolveFile(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else if (spec.startsWith('@sudoku-fight/')) {
    // The workspace packages: their main is src/index.ts (package.json), a sub-path is under the package.
    const [, name, ...rest] = spec.split('/');
    base = join(REPO_ROOT, 'packages', name!, rest.length ? rest.join('/') : 'src/index.ts');
  } else return null;
  for (const ext of EXTENSIONS) {
    const path = base + ext;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  throw new Error(`Cannot resolve ${spec} from ${posix(from)}`);
}

const onlyTypes = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
  elements.length > 0 && elements.every((e) => e.isTypeOnly);

/**
 * What a module loads when it runs: its value imports and re-exports (Babel drops the type-only ones), and the
 * require() calls outside any function. A require() inside a function is lazy: it runs only when called.
 */
export function eagerImports(file: string): string[] {
  if (!/\.[jt]sx?$/.test(file)) return [];
  const kind = file.endsWith('x')
    ? ts.ScriptKind.TSX
    : file.endsWith('.js')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visitRequires = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      out.push(node.arguments[0].text);
    ts.forEachChild(node, visitRequires);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      if (clause && !clause.name && named && ts.isNamedImports(named) && onlyTypes(named.elements)) continue;
      out.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause) && onlyTypes(clause.elements)) continue;
      out.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else {
      visitRequires(statement);
    }
  }
  return out;
}

/** The files and packages that run when the entries run (paths relative to apps/mobile). */
export function importGraph(entries: readonly string[]): ImportGraph {
  const files = new Map<string, string>();
  const packages = new Map<string, string>();
  const mobile = join(REPO_ROOT, 'apps', 'mobile');
  const queue: [string, string][] = entries.map((e) => [join(mobile, e), '(entry)']);
  while (queue.length) {
    const [file, by] = queue.shift()!;
    const key = posix(file);
    if (files.has(key)) continue;
    files.set(key, by);
    for (const spec of eagerImports(file)) {
      const target = resolveFile(file, spec);
      if (target) queue.push([target, key]);
      else if (!packages.has(packageName(spec))) packages.set(packageName(spec), key);
    }
  }
  return { files, packages };
}

/** The chain of imports from an entry to `file` ("app/_layout.tsx → src/auth/index.ts → …"). */
export function importChain(graph: ImportGraph, file: string): string {
  const chain = [file];
  let by = graph.files.get(file) ?? graph.packages.get(file);
  while (by && by !== '(entry)') {
    chain.unshift(by);
    by = graph.files.get(by);
  }
  return chain.join(' → ');
}
