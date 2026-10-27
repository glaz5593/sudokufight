/* Test-only: every text of the app that must stay on one line, and the translation keys it shows (plan 6.1 #10). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

/**
 * The automatic width budget's list (localization plan 6.1 #10): read from the code the way the compiler reads
 * it, not kept by hand.
 * - A Text (React Native's, Animated's, the base one) with numberOfLines={1} (or a ?: with a 1) or
 *   adjustsFontSizeToFit: what it shows, when the code says it.
 * - A toast's message (useToast().show({ message }), and a screen's own toast(…) helper): one line, 40 high
 *   (components.md §15.1, Toast.tsx).
 * - A sheet's title and its text subtitle (<Sheet title subtitle>): one line each (Sheet.tsx).
 * Its keys come from t('…') calls in what it shows, directly or through a const in the same function: the
 * namespace from the nearest useTranslation('…') (or 'ns:' in the key, or { ns }), a template key
 * (t(`modes.${key}.title`)) as a pattern. Anything else (a name, a helper's result) is "not checked".
 */

export type SingleLineKind = 'text' | 'toast' | 'sheetTitle' | 'sheetSubtitle';

export interface SingleLineText {
  /** apps/mobile-relative path, "/" separators. */
  file: string;
  line: number;
  kind: SingleLineKind;
  /** "ns:key" for an exact key; "ns:" + a regular expression's source for a template key (pattern: true). */
  keys: { key: string; pattern: boolean }[];
}

const MOBILE = join(__dirname, '..', '..');
/** The developer screens are not translated (D109): left out, as hardcodedText.test.ts does. */
const SKIP_DIRS = new Set(['__tests__', '__fixtures__', 'testing', 'dev', 'node_modules']);
const DEV_FILE =
  /(AvatarLabScreen|DesignSystemScreen|HelloScreen|SoundAuditionScreen|DevMetrics\w*|DevOnlineScreen|NetMetricsPanel)\.tsx$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sourceFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) && !DEV_FILE.test(name))
      out.push(path);
  }
  return out;
}

const TEXT_TAG = /^(Animated\.)?Text$|^NativeText$/;

/** numberOfLines={1}, a ?: with a 1, or adjustsFontSizeToFit (not ={false}). */
function singleLine(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some((p) => {
    if (!ts.isJsxAttribute(p)) return false;
    const name = p.name.getText();
    const value = p.initializer && ts.isJsxExpression(p.initializer) ? p.initializer.expression : undefined;
    if (name === 'adjustsFontSizeToFit') return value?.kind !== ts.SyntaxKind.FalseKeyword;
    if (name !== 'numberOfLines' || !value) return false;
    const one = (e: ts.Expression): boolean =>
      (ts.isNumericLiteral(e) && e.text === '1') ||
      (ts.isConditionalExpression(e) && (one(e.whenTrue) || one(e.whenFalse))) ||
      (ts.isParenthesizedExpression(e) && one(e.expression));
    return one(value);
  });
}

/** The namespace `t` translates in at `node`: the nearest `const { t } = useTranslation('ns')` around it. */
function namespaceAt(node: ts.Node, callee: string): string | null {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (!(ts.isFunctionLike(at) || ts.isSourceFile(at))) continue;
    let found: string | null | undefined;
    const visit = (n: ts.Node): void => {
      if (found !== undefined) return;
      if (n !== at && ts.isFunctionLike(n)) return;
      if (
        ts.isVariableDeclaration(n) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        n.initializer.expression.getText() === 'useTranslation' &&
        ts.isObjectBindingPattern(n.name) &&
        n.name.elements.some((e) => e.name.getText() === callee)
      ) {
        const arg = n.initializer.arguments[0];
        if (!arg) found = 'common';
        else if (ts.isStringLiteral(arg)) found = arg.text;
        else if (ts.isArrayLiteralExpression(arg) && arg.elements[0] && ts.isStringLiteral(arg.elements[0]))
          found = arg.elements[0].text;
        else found = null;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(at);
    if (found !== undefined) return found;
  }
  return null;
}

/** A t() call's key: "ns:key", with the namespace from the key, its { ns } option or its `t`. */
function keyOf(call: ts.CallExpression): { key: string; pattern: boolean } | null {
  const callee = call.expression;
  const isI18n = ts.isPropertyAccessExpression(callee) && callee.name.text === 't';
  const isT = ts.isIdentifier(callee) && callee.text === 't';
  if (!isI18n && !isT) return null;
  const [arg, options] = call.arguments;
  if (!arg) return null;
  let key: string;
  let pattern = false;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) key = arg.text;
  else if (ts.isTemplateExpression(arg)) {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    key = escape(arg.head.text) + arg.templateSpans.map((s) => `[\\w-]+${escape(s.literal.text)}`).join('');
    pattern = true;
  } else return null;
  let ns: string | null = null;
  const colon = key.indexOf(':');
  if (colon > 0 && /^\w+$/.test(key.slice(0, colon))) {
    ns = key.slice(0, colon);
    key = key.slice(colon + 1);
  } else if (options && ts.isObjectLiteralExpression(options)) {
    for (const p of options.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'ns' && ts.isStringLiteral(p.initializer))
        ns = p.initializer.text;
    }
  }
  ns ??= isT ? namespaceAt(call, 't') : 'common';
  return ns ? { key: `${ns}:${key}`, pattern } : null;
}

/** The keys an expression shows: its t() calls, and those of a const it names (declared in its function). */
function keysIn(expression: ts.Node, depth = 0): { key: string; pattern: boolean }[] {
  const keys: { key: string; pattern: boolean }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const key = keyOf(n);
      if (key) {
        keys.push(key);
        return;
      }
    }
    if (
      ts.isIdentifier(n) &&
      depth < 2 &&
      !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)
    ) {
      const declaration = constNamed(n);
      if (declaration?.initializer) keys.push(...keysIn(declaration.initializer, depth + 1));
    }
    ts.forEachChild(n, visit);
  };
  visit(expression);
  return keys;
}

/** The `const name = …` an identifier refers to, in a function around it (or the file). */
function constNamed(id: ts.Identifier): ts.VariableDeclaration | null {
  for (let at: ts.Node | undefined = id.parent; at; at = at.parent) {
    if (!(ts.isFunctionLike(at) || ts.isSourceFile(at) || ts.isBlock(at))) continue;
    let found: ts.VariableDeclaration | null = null;
    const visit = (n: ts.Node): void => {
      if (found || (n !== at && ts.isFunctionLike(n))) return;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === id.text && n.initializer)
        found = n;
      else ts.forEachChild(n, visit);
    };
    visit(at);
    if (found) return found;
  }
  return null;
}

function scan(path: string): SingleLineText[] {
  const source = readFileSync(path, 'utf8');
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const file = relative(MOBILE, path).split(sep).join('/');
  const out: SingleLineText[] = [];
  const add = (node: ts.Node, kind: SingleLineKind, shown: readonly ts.Node[]) =>
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      keys: shown.flatMap((n) => keysIn(n)),
    });

  const visit = (n: ts.Node): void => {
    // <Text numberOfLines={1}>…</Text>
    if (
      ts.isJsxElement(n) &&
      TEXT_TAG.test(n.openingElement.tagName.getText()) &&
      singleLine(n.openingElement.attributes)
    )
      add(n, 'text', n.children);
    // <Sheet title={…} subtitle={…}>
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (opening && opening.tagName.getText() === 'Sheet') {
      for (const p of opening.attributes.properties) {
        if (!ts.isJsxAttribute(p) || !p.initializer) continue;
        const name = p.name.getText();
        if (name === 'title' || name === 'subtitle')
          add(p, name === 'title' ? 'sheetTitle' : 'sheetSubtitle', [p.initializer]);
      }
    }
    // show({ message: … }) and toast(…)
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
      const [arg] = n.arguments;
      if ((name === 'show' || name === 'showToast') && arg && ts.isObjectLiteralExpression(arg)) {
        const message = arg.properties.find(
          (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'message',
        );
        if (message && ts.isPropertyAssignment(message)) add(message, 'toast', [message.initializer]);
      } else if (name === 'toast' && arg && !ts.isObjectLiteralExpression(arg)) add(n, 'toast', [arg]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every single-line text of the app (src/ and app/, without tests, test helpers and the developer screens). */
export function singleLineTexts(): SingleLineText[] {
  return [...sourceFiles(join(MOBILE, 'src')), ...sourceFiles(join(MOBILE, 'app'))].flatMap(scan);
}
