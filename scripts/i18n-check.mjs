#!/usr/bin/env node
/**
 * Translation check (work plan stage 13; localization plan 0ד, D120; CLAUDE.md: no hard-coded string).
 * `npm run i18n:check` at the root, in CI and in `npm run verify`; `npm run i18n:release` (--release) before a
 * store build.
 *
 * The app (apps/mobile/src/i18n/locales/<lang>/<namespace>.json, i18next): every language folder against English,
 * the source, by the rules in scripts/lib/i18n-locales.mjs (keys by a plural's base, each language's plural forms
 * by the app's own rules, services/pluralRules.ts, placeholders and tags, bidi by direction, and the warnings: the
 * same as English, lost spaces, Latin letters, French and Spanish punctuation). On top of them, here:
 *   errors   - an enabled language (apps/mobile/src/i18n/enabled-languages.json) without a folder
 *            - a namespace file not in NAMESPACES (where the list is written out: i18n/locales.generated.ts)
 *            - t('key') in the source, with a namespace known from useTranslation('ns') / TFunction<'ns'>,
 *              for a key English doesn't have (and t(`prefix.${x}`) that no key matches)
 *            - rule 21 (plan 0ה, 6.1 #21; scripts/lib/i18n-numbers.mjs): a number without a plural. English's
 *              value has a placeholder followed by a counted noun ("{{score}} points"), or a t() call passes a
 *              number (its TypeScript type, from a program of the app's sources) to a placeholder that is not the
 *              plural's count, unless NUMBER_OK allows it with the reason; and a t() call that reads a plural
 *              without { count } (i18next would show the key's name)
 * Two levels (D120: every day Hebrew and English; the other languages before a store build):
 *   - Hebrew and English: every error, every day.
 *   - An enabled translated language: every day, what breaks it on screen even with English as the fallback (a
 *     value that is not a string or empty, other placeholders, $t() references or tags, an isolate not closed);
 *     what only lags behind Hebrew and English (a namespace, key or plural form not translated yet, one English
 *     dropped, Arabic's isolation behind Hebrew's: `incomplete`) is a warning, as English shows there meanwhile.
 *   - A folder not enabled yet (one being translated): its errors are warnings.
 *   With --release every folder must pass every rule, and a value the same as English is an error too.
 *
 * The admin site (apps/admin/src/strings.ts, `{name}` placeholders, Hebrew and English only):
 *   errors   - a key in one language only, an empty or untrimmed value, different placeholders
 * Both:
 *   warnings - a key the source never mentions (not as a literal, a `ns:key`, a plural's base, a parent of
 *              returnObjects, under a t(`prefix.${x}`) / 'prefix.' + x, or nested by a value: $t(ns:key)).
 *              Unused keys are only reported: a key built in a way this scan can't see would be a false alarm.
 *          - a NUMBER_OK entry no key needs any more
 *
 * Exit code 1 on any error (with --strict, on warnings too). --root <dir> checks another tree (the tests).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  checkLanguage,
  DEFAULT_ENABLED,
  extraFormsSummary,
  flatten,
  isDevOnly,
  PLURAL_SUFFIX,
  REFERENCE,
  SOURCE_LANGUAGES,
} from './lib/i18n-locales.mjs';
import { allowListEntries, numberProblems } from './lib/i18n-numbers.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const release = args.includes('--release');
const rootArg = args.indexOf('--root');
const ROOT =
  rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MOBILE = join(ROOT, 'apps', 'mobile');
const I18N = join(MOBILE, 'src', 'i18n');
const LOCALES = join(I18N, 'locales');
/** Where NAMESPACES may be written out: the generated loader (localization plan 0ב), or index.ts before it. */
const NAMESPACE_LISTS = [join(I18N, 'locales.generated.ts'), join(I18N, 'index.ts')];
const ENABLED_LANGUAGES = join(I18N, 'enabled-languages.json');
const I18N_CONFIG = join(MOBILE, 'src', 'config', 'i18n.ts');
const MOBILE_SOURCES = [join(MOBILE, 'src'), join(MOBILE, 'app')];
const ADMIN_SRC = join(ROOT, 'apps', 'admin', 'src');
const ADMIN_STRINGS = join(ADMIN_SRC, 'strings.ts');

/** i18next's context forms (t('key', { context: gender }) reads key_female): the base key covers them. */
const CONTEXT_SUFFIX = /_(male|female)$/;
const errors = [];
const warnings = [];
const rel = (path) => relative(ROOT, path).split(sep).join('/');

// ---------------------------------------------------------------- reading

/** Source files under `dir`: .ts/.tsx, not tests, fixtures or test helpers. */
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ['__tests__', '__fixtures__', 'testing', 'node_modules'].includes(name) ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) ? [path] : [];
  });
}

const parse = (file) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of a string literal, or of a + chain of them; null for anything else. */
function stringOf(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return stringOf(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = stringOf(node.left);
    const b = stringOf(node.right);
    return a !== null && b !== null ? a + b : null;
  }
  return null;
}

/** A template `a.${x}.b` as a pattern for the keys it can build (null without a static start). */
function templatePattern(node) {
  if (!ts.isTemplateExpression(node) || node.head.text === '') return null;
  const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  return { head: node.head.text, re: new RegExp(`^${parts.map(escapeRe).join('.+?')}$`) };
}

/** The keys a t() call's first argument can be: a literal, or each branch of a ?: of literals. */
function keysOf(node) {
  const key = stringOf(node);
  if (key !== null) return [key];
  if (node && ts.isParenthesizedExpression(node)) return keysOf(node.expression);
  if (node && ts.isConditionalExpression(node)) {
    const a = keysOf(node.whenTrue);
    const b = keysOf(node.whenFalse);
    return a.length && b.length ? [...a, ...b] : [];
  }
  return [];
}

/**
 * What a source tree mentions: every string literal, every template with a static start, every literal that
 * ends in '.' (a key built by +), and, per file, the t() calls whose namespace is known (with their options, for
 * rule 21). With a TypeScript program, its trees are scanned, so the checker can tell the options' types.
 */
function scanSources(files, { tFunctions, groupCalls = [], program = null }) {
  const literals = new Set();
  const patterns = [];
  const calls = [];
  // Type aliases of TFunction<'ns'> anywhere (wording.ts exports PlayerT, GameT…), by name.
  const aliasNs = new Map();
  const trees = files.map((file) => ({ file, tree: program?.getSourceFile(file) ?? parse(file) }));
  if (tFunctions) {
    for (const { tree } of trees) {
      tree.forEachChild(function visit(node) {
        if (ts.isTypeAliasDeclaration(node)) {
          const ns = namespacesOfType(node.type, new Map());
          if (ns.length) aliasNs.set(node.name.text, [...(aliasNs.get(node.name.text) ?? []), ...ns]);
        }
        node.forEachChild(visit);
      });
    }
  }

  for (const { file, tree } of trees) {
    /** Name of a t function in this file → the namespaces it reads. */
    const tNames = new Map();
    const bind = (name, ns) => tNames.set(name, [...new Set([...(tNames.get(name) ?? []), ...ns])]);
    /** The same for a property typed as one ({ t: ExplainT }), read as words.t('…'). */
    const tProps = new Map();

    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.add(node.text);
      const pattern = templatePattern(node);
      if (pattern) patterns.push(pattern);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const head = stringOf(node.left);
        if (head && head.endsWith('.')) patterns.push({ head, re: new RegExp(`^${escapeRe(head)}.+$`) });
      }
      // A helper that reads `${group}.${value}` (the admin site's label('mode', m)).
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        groupCalls.includes(node.expression.text) &&
        stringOf(node.arguments[0])
      ) {
        const head = `${stringOf(node.arguments[0])}.`;
        patterns.push({ head, re: new RegExp(`^${escapeRe(head)}.+$`) });
      }

      if (tFunctions) {
        // const { t } = useTranslation('ns') / const { t: tp } = useTranslation(['a', 'b'])
        if (
          ts.isVariableDeclaration(node) &&
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === 'useTranslation' &&
          ts.isObjectBindingPattern(node.name)
        ) {
          const arg = node.initializer.arguments[0];
          const ns = !arg
            ? ['common']
            : ts.isArrayLiteralExpression(arg)
              ? arg.elements.map(stringOf).filter(Boolean)
              : [stringOf(arg)].filter(Boolean);
          for (const el of node.name.elements) {
            const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : null;
            if (
              (prop ?? (ts.isIdentifier(el.name) ? el.name.text : null)) === 't' &&
              ts.isIdentifier(el.name)
            ) {
              bind(el.name.text, ns);
            }
          }
        }
        // t: TFunction<'ns'> / t: GameT (a parameter, a property, a variable)
        if (
          (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) &&
          node.type &&
          ts.isIdentifier(node.name)
        ) {
          const ns = namespacesOfType(node.type, aliasNs);
          if (ns.length) bind(node.name.text, ns);
          if (ns.length && ts.isPropertySignature(node))
            tProps.set(node.name.text, tNames.get(node.name.text));
        }
      }
      node.forEachChild(visit);
    };
    visit(tree);

    if (!tFunctions) continue;
    tree.forEachChild(function findCalls(node) {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        let ns = null;
        if (ts.isIdentifier(callee) && tNames.has(callee.text)) ns = tNames.get(callee.text);
        if (ts.isPropertyAccessExpression(callee) && tProps.has(callee.name.text))
          ns = tProps.get(callee.name.text);
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 't' &&
          ts.isIdentifier(callee.expression) &&
          ['i18n', 'i18next'].includes(callee.expression.text)
        ) {
          ns = ['common'];
        }
        if (ns) {
          const options = node.arguments[1];
          const nsOption =
            options && ts.isObjectLiteralExpression(options)
              ? options.properties.find(
                  (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'ns',
                )
              : null;
          const fixedNs = nsOption ? stringOf(nsOption.initializer) : null;
          calls.push({
            file,
            line: lineOf(node),
            ns: fixedNs ? [fixedNs] : ns,
            key: stringOf(node.arguments[0]),
            keys: keysOf(node.arguments[0]),
            pattern: templatePattern(node.arguments[0]),
            keyNode: node.arguments[0],
            options: options ?? null,
          });
        }
      }
      // <Trans i18nKey="…" values={{ … }} /> and components that pass one on (AccentTitle i18nKey="…").
      if (ts.isJsxAttribute(node) && node.name.getText() === 'i18nKey' && node.initializer) {
        const key = ts.isStringLiteral(node.initializer) ? node.initializer.text : null;
        const all = [...new Set([...tNames.values()].flat())];
        const values = node.parent.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText() === 'values' && p.initializer,
        );
        const options =
          values && ts.isJsxExpression(values.initializer) ? (values.initializer.expression ?? null) : null;
        // <Trans count={n}> passes the plural's count as its own prop, not in values.
        const jsxCount = node.parent.properties.some(
          (p) => ts.isJsxAttribute(p) && p.name.getText() === 'count',
        );
        if (key && all.length)
          calls.push({
            file,
            line: lineOf(node),
            ns: all,
            key,
            keys: [key],
            pattern: null,
            options,
            jsxCount,
          });
      }
      node.forEachChild(findCalls);
    });
  }
  return { literals, patterns, calls };
}

/** The namespaces of TFunction<'ns'> / TFunction<['a', 'b']> / an alias of one. */
function namespacesOfType(type, aliases) {
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    if (name === 'TFunction' && type.typeArguments?.length) {
      const arg = type.typeArguments[0];
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) return [arg.literal.text];
      if (ts.isTupleTypeNode(arg)) {
        return arg.elements
          .map((e) => (ts.isLiteralTypeNode(e) && ts.isStringLiteral(e.literal) ? e.literal.text : null))
          .filter(Boolean);
      }
      return [];
    }
    return aliases.get(name) ?? [];
  }
  return [];
}

// ---------------------------------------------------------------- rule 21: numbers through plurals

/** i18next's own options, not placeholders. */
const T_OPTIONS = new Set([
  'ns',
  'context',
  'defaultValue',
  'lng',
  'lngs',
  'fallbackLng',
  'returnObjects',
  'returnDetails',
  'joinArrays',
  'postProcess',
  'interpolation',
  'keySeparator',
  'nsSeparator',
  'ordinal',
  'replace',
  'skipInterpolation',
]);

/**
 * A TypeScript program of the app's sources, so the checker can tell what t() calls pass (rule 21). The app's
 * tsconfig.json when there is one; otherwise (the tests' small trees) plain strict options.
 */
function typeProgram(files) {
  const config = join(MOBILE, 'tsconfig.json');
  let options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
  };
  if (existsSync(config)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
    );
    if (parsed) options = { ...parsed.options, noEmit: true };
  }
  return ts.createProgram({ rootNames: files, options });
}

/** number, a number literal or a union of them (undefined and null aside). */
function isNumberType(type) {
  if (type.isUnion()) {
    const real = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)));
    return real.length > 0 && real.every(isNumberType);
  }
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

/** The object literal an options argument is: itself, or a const it names (`const gap = { … }; t(k, gap)`). */
function objectLiteralOf(node, checker) {
  if (ts.isParenthesizedExpression(node)) return objectLiteralOf(node.expression, checker);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return null;
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    ? objectLiteralOf(declaration.initializer, checker)
    : null;
}

/** The expression an object literal gives a property (`{ n }` gives `n`; spreads of literals too), or null. */
function initializerOf(literal, name, checker) {
  for (const p of [...literal.properties].reverse()) {
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
    )
      return p.initializer;
    if (ts.isSpreadAssignment(p)) {
      const spread = objectLiteralOf(p.expression, checker);
      const found = spread ? initializerOf(spread, name, checker) : null;
      if (found) return found;
    }
  }
  return null;
}

/** The count without a change of unit: `ms / 1000` is `ms` in seconds. */
function countCore(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.SlashToken, ts.SyntaxKind.AsteriskToken].includes(node.operatorToken.kind)
  ) {
    if (ts.isNumericLiteral(node.right)) return countCore(node.left);
    if (ts.isNumericLiteral(node.left)) return countCore(node.right);
  }
  return node;
}

/**
 * Whether a placeholder's value shows the plural's count another way: the count itself, or the count formatted
 * (`scoreText(o.score, decimal)`, ltr() of a template with it), also through a const (`const to =
 * secondsText(ms)`). A number worked out from it (`need - stars`) is another number.
 */
function showsTheCount(value, count, checker) {
  const targets = new Set([count.getText(), countCore(count).getText()]);
  const visit = (n, depth) => {
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))
      n = n.expression;
    if (targets.has(n.getText())) return true;
    if (ts.isIdentifier(n) && depth < 2) {
      const symbol = ts.isShorthandPropertyAssignment(n.parent)
        ? checker.getShorthandAssignmentValueSymbol(n.parent)
        : checker.getSymbolAtLocation(n);
      const declaration = symbol?.valueDeclaration;
      return Boolean(
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        visit(declaration.initializer, depth + 1),
      );
    }
    if (ts.isCallExpression(n)) return n.arguments.some((a) => visit(a, depth));
    if (ts.isTemplateExpression(n)) return n.templateSpans.some((span) => visit(span.expression, depth));
    return false;
  };
  return visit(value, 0);
}

/**
 * What the t() calls pass, per key: 'ns:base' → placeholder → { numberAt: where a number is passed that is not the
 * plural's count, showsCount: a call shows the count with it another way ({ count: n, score: scoreText(n) }) }.
 * `resolve(call)` gives the [ns, base] keys a call can read.
 */
function numbersPassed(calls, checker, resolve) {
  const passed = new Map();
  for (const call of calls) {
    if (!call.options) continue;
    const keys = resolve(call);
    if (!keys.length) continue;
    const type = checker.getTypeAtLocation(call.options);
    const literal = objectLiteralOf(call.options, checker);
    const count = literal ? initializerOf(literal, 'count', checker) : null;
    for (const prop of type.getProperties()) {
      if (T_OPTIONS.has(prop.name)) continue;
      const number = isNumberType(checker.getTypeOfSymbolAtLocation(prop, call.options));
      const value = literal ? initializerOf(literal, prop.name, checker) : null;
      const showsCount =
        prop.name === 'count' || (count !== null && value !== null && showsTheCount(value, count, checker));
      for (const [ns, base] of keys) {
        const id = `${ns}:${base}`;
        if (!passed.has(id)) passed.set(id, new Map());
        const entry = passed.get(id).get(prop.name) ?? { numberAt: [], showsCount: false };
        if (showsCount) entry.showsCount = true;
        if (number && (prop.name === 'count' || !showsCount))
          entry.numberAt.push(`${rel(call.file)}:${call.line}`);
        passed.get(id).set(prop.name, entry);
      }
    }
  }
  return passed;
}

/**
 * Rule 21 (localization plan 0ה, 6.1 #21) over English's keys: a number without a plural is an error (see
 * scripts/lib/i18n-numbers.mjs), and a NUMBER_OK entry nothing needs is a warning.
 */
function checkNumbers(en, namespaces, passed) {
  const used = new Set();
  // The plurals other values nest with a count ($t(ns:key, {"count": {{x}} })): their numbers come from there.
  const nested = new Set();
  for (const ns of namespaces) {
    for (const value of en[ns]?.values() ?? []) {
      if (typeof value !== 'string') continue;
      for (const [, ref, rest] of value.matchAll(/\$t\(\s*([^,)\s]+)\s*,([^)]*)\)/g)) {
        if (/["']count["']\s*:/.test(rest)) nested.add(ref.includes(':') ? ref : `${ns}:${ref}`);
      }
    }
  }
  for (const ns of namespaces) {
    for (const [key, value] of en[ns] ?? []) {
      if (typeof value !== 'string' || isDevOnly(ns, key)) continue;
      const suffix = key.match(PLURAL_SUFFIX);
      // A plural is checked once, by its "other" form; i18next's context forms (_female) by their base's calls.
      if (suffix && suffix[1] !== 'other') continue;
      const base = (suffix ? key.slice(0, -suffix[0].length) : key).replace(CONTEXT_SUFFIX, '');
      const { problems, allowed } = numberProblems({
        ns,
        base,
        value,
        isPlural: Boolean(suffix),
        nested: nested.has(`${ns}:${base}`),
        code: passed.get(`${ns}:${base}`),
      });
      for (const entry of allowed) used.add(entry);
      for (const { placeholder, noun, numberAt } of problems) {
        const what = noun
          ? `counts "${noun}"`
          : `gets a number (${numberAt[0]}${numberAt.length > 1 ? ` and ${numberAt.length - 1} more` : ''})`;
        errors.push(
          `en/${ns}.json: "${key}" {{${placeholder}}} ${what} without a plural: pass { count } and split it into ` +
            `plural forms (another number: $t(ns:key, {"count": {{${placeholder}}} })), or allow it in NUMBER_OK ` +
            `(scripts/lib/i18n-numbers.mjs) with the reason`,
        );
      }
    }
  }
  // Stale entries (by name, they are generic): one for a key that no longer needs it, and, in the app's own tree
  // (not a --root test tree, which has other keys), one for a key English doesn't have.
  const has = (id) => {
    const [ns, key] = id.split(':');
    return [...(en[ns]?.keys() ?? [])].some(
      (k) => k.replace(PLURAL_SUFFIX, '').replace(CONTEXT_SUFFIX, '') === key,
    );
  };
  for (const entry of allowListEntries()) {
    if (entry.startsWith('*#') || used.has(entry)) continue;
    const key = entry.split('#')[0];
    if (has(key))
      warnings.push(`scripts/lib/i18n-numbers.mjs: NUMBER_OK allows ${entry}, which no longer needs it`);
    else if (rootArg < 0)
      warnings.push(`scripts/lib/i18n-numbers.mjs: NUMBER_OK allows ${entry}, a key English doesn't have`);
  }
}

/** A plural form's base ('lead.label' for lead.label_female_one), or null for a key that is not a plural form. */
function pluralBaseOf(key) {
  const suffix = key.match(PLURAL_SUFFIX);
  return suffix ? key.slice(0, -suffix[0].length).replace(CONTEXT_SUFFIX, '') : null;
}

/** Whether a t() call's options pass a property (by its TypeScript type, so spreads and consts count too). */
function passesOption(call, name, checker) {
  if (call.jsxCount && name === 'count') return true;
  if (!call.options) return false;
  return Boolean(checker.getTypeAtLocation(call.options).getProperty(name));
}

/**
 * The keys a template t(`a.${x}`) can build, from the literal types of its parts (narrowed where it stands:
 * after `if (tip === 'lock') return …`, tip is the other tips); null when a part is not a union of literals.
 */
function templateKeys(node, checker) {
  if (!node || !ts.isTemplateExpression(node)) return null;
  let keys = [node.head.text];
  for (const span of node.templateSpans) {
    const type = checker.getTypeAtLocation(span.expression);
    const parts = (type.isUnion() ? type.types : [type]).map((t) =>
      t.isStringLiteral() || t.isNumberLiteral() ? String(t.value) : null,
    );
    if (parts.includes(null)) return null;
    keys = keys.flatMap((k) => parts.map((p) => `${k}${p}${span.literal.text}`));
    if (keys.length > 1000) return null;
  }
  return keys;
}

/**
 * Rule 21, the code half: a t() call that reads a plural (a key English has only in plural forms) must pass
 * { count }. Without it i18next looks for the plain key, finds none, and shows the key's name on the screen.
 * A call that reads the forms whole (returnObjects) is not reading one string. A template t(`a.${x}`) reads the
 * keys its parts' types allow; when they are not literals, it is an error only if every key it matches is a
 * plural.
 */
function checkPluralCalls(calls, checker, en, resolve) {
  const pluralOnly = ([ns, base]) =>
    !en[ns]?.has(base) && [...(en[ns]?.keys() ?? [])].some((k) => pluralBaseOf(k) === base);
  for (const call of calls) {
    if (passesOption(call, 'count', checker) || passesOption(call, 'returnObjects', checker)) continue;
    const exact = call.keys.length ? null : templateKeys(call.keyNode, checker);
    const read = resolve(exact ? { ...call, keys: exact, pattern: null } : call);
    const plurals = read.filter(pluralOnly);
    if (!plurals.length || (!exact && !call.keys.length && plurals.length < read.length)) continue;
    const what =
      call.key ?? (exact?.length === 1 ? exact[0] : call.pattern ? `${call.pattern.head}…` : plurals[0][1]);
    errors.push(
      `${rel(call.file)}:${call.line}: t('${what}') reads a plural (${plurals.map((k) => k.join(':')).join(', ')}) ` +
        `without { count }: i18next would show the key's name. Pass the number as count (rule 21)`,
    );
  }
}

/** Whether a key is mentioned by the scanned source. */
function isUsed(key, ns, { literals, patterns }) {
  const base = key.replace(PLURAL_SUFFIX, '').replace(CONTEXT_SUFFIX, '');
  const names = new Set([key, key.replace(PLURAL_SUFFIX, ''), base]);
  for (const n of names) {
    if (literals.has(n) || (ns && literals.has(`${ns}:${n}`))) return true;
  }
  // A parent of the key, read whole (returnObjects) or passed on: only dotted literals count, so a word like
  // "title" doesn't cover every "*.title".
  const segments = base.split('.');
  for (let i = segments.length - 1; i > 1; i--) {
    const parent = segments.slice(0, i).join('.');
    if (literals.has(parent) || (ns && literals.has(`${ns}:${parent}`))) return true;
  }
  for (const { re } of patterns) {
    for (const n of names) if (re.test(n) || (ns && re.test(`${ns}:${n}`))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the app

/** The enabled languages (C2), Hebrew and English when the file isn't there. */
function enabledLanguages() {
  if (!existsSync(ENABLED_LANGUAGES)) return [...DEFAULT_ENABLED];
  try {
    const list = JSON.parse(readFileSync(ENABLED_LANGUAGES, 'utf8'));
    if (Array.isArray(list) && list.every((x) => typeof x === 'string')) return list;
  } catch {
    // reported below
  }
  errors.push(`${rel(ENABLED_LANGUAGES)}: not a JSON array of language codes`);
  return [...DEFAULT_ENABLED];
}

/** D109 the other way round (config/i18n.ts devNamespacesTranslated: true): the dev strings translated too. */
const devTranslated = () =>
  existsSync(I18N_CONFIG) && /devNamespacesTranslated\s*:\s*true\b/.test(readFileSync(I18N_CONFIG, 'utf8'));

/**
 * The app's own plural rules (apps/mobile/src/services/pluralRules.ts, what the phone runs: D123), transpiled
 * here, so the check, the tests and the phone pick the same forms (CLDR's but Hebrew 0.x, which Node's ICU would
 * put in "one"). Code, not the checked tree's data: always this repository's, also with --root.
 */
const APP_PLURAL_RULES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'mobile',
  'src',
  'services',
  'pluralRules.ts',
);
const appPlurals = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(readFileSync(APP_PLURAL_RULES, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ).toString('base64')}`
);

/** A language's plural rules, the app's own. */
function pluralRulesOf(lang) {
  return { categories: appPlurals.pluralCategories(lang), select: (n) => appPlurals.pluralCategory(lang, n) };
}

function checkMobile() {
  if (!existsSync(join(LOCALES, REFERENCE))) {
    errors.push(
      `${rel(join(LOCALES, REFERENCE))}: no English folder (the source every language is checked against)`,
    );
    return null;
  }
  const languages = readdirSync(LOCALES).filter((d) => statSync(join(LOCALES, d)).isDirectory());
  const enabled = enabledLanguages();
  for (const lang of enabled) {
    if (!languages.includes(lang))
      errors.push(
        `${rel(ENABLED_LANGUAGES)}: "${lang}" is enabled, with no folder ${rel(join(LOCALES, lang))}`,
      );
  }

  /** lang → ns → Map(key → value) */
  const dicts = {};
  for (const lang of languages) {
    dicts[lang] = {};
    for (const file of readdirSync(join(LOCALES, lang)).filter((f) => f.endsWith('.json'))) {
      const path = join(LOCALES, lang, file);
      try {
        dicts[lang][file.replace(/\.json$/, '')] = new Map(flatten(JSON.parse(readFileSync(path, 'utf8'))));
      } catch (e) {
        errors.push(`${rel(path)}: not valid JSON (${e.message})`);
      }
    }
  }
  const en = dicts[REFERENCE];
  const namespaces = [...new Set(languages.flatMap((lang) => Object.keys(dicts[lang])))].sort();

  // The registered namespaces, where NAMESPACES is written out.
  const listFile = NAMESPACE_LISTS.find(
    (f) => existsSync(f) && /NAMESPACES\s*=\s*\[/.test(readFileSync(f, 'utf8')),
  );
  if (listFile) {
    const match = readFileSync(listFile, 'utf8').match(/NAMESPACES\s*=\s*\[([^\]]*)\]/);
    const registered = [...match[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]);
    for (const ns of namespaces) {
      if (!registered.includes(ns)) errors.push(`${rel(listFile)}: namespace "${ns}" is not in NAMESPACES`);
    }
    for (const ns of registered) {
      if (!namespaces.includes(ns)) errors.push(`${rel(listFile)}: NAMESPACES has "${ns}", with no file`);
    }
  }

  const translatedDev = devTranslated();
  for (const lang of languages) {
    const result = checkLanguage({
      lang,
      dict: dicts[lang],
      en,
      he: dicts.he,
      plural: pluralRulesOf(lang),
      release,
      devTranslated: translatedDev,
    });
    if (release || SOURCE_LANGUAGES.includes(lang)) errors.push(...result.errors);
    else if (enabled.includes(lang)) {
      const lagging = new Set(result.incomplete);
      errors.push(...result.errors.filter((e) => !lagging.has(e)));
      warnings.push(...result.incomplete.map((e) => `${e} [not translated yet: an error with --release]`));
    } else
      warnings.push(...result.errors.map((e) => `${e} [${lang} is not enabled: an error with --release]`));
    warnings.push(...result.warnings);
    if (result.extraForms.length) warnings.push(extraFormsSummary(lang, result.extraForms));
  }

  // The source: keys that t() asks for, and keys nobody mentions (English has every key).
  const files = MOBILE_SOURCES.flatMap(sourceFiles);
  const program = typeProgram(files);
  const checker = program.getTypeChecker(); // binds the trees: their nodes get parents
  const scan = scanSources(files, { tFunctions: true, program });
  const known = (ns, key) => {
    const keys = en[ns];
    if (!keys) return false;
    if (keys.has(key)) return true;
    for (const k of keys.keys()) {
      if (k.startsWith(`${key}.`) || k.replace(PLURAL_SUFFIX, '') === key) return true;
    }
    return false;
  };
  for (const call of scan.calls) {
    const where = `${rel(call.file)}:${call.line}`;
    if (call.key !== null) {
      const [ns, key] = splitNs(call.key, call.ns, namespaces);
      if (!ns.some((n) => known(n, key)))
        errors.push(`${where}: t('${call.key}') - no such key in ${ns.join(' / ')}`);
    } else if (call.pattern) {
      const [ns] = splitNs(call.pattern.head, call.ns, namespaces);
      const { re } = call.pattern;
      const any = ns.some((n) =>
        [...(en[n]?.keys() ?? [])].some((k) =>
          [k, k.replace(PLURAL_SUFFIX, '')].some((x) => re.test(x) || re.test(`${n}:${x}`)),
        ),
      );
      if (!any) errors.push(`${where}: t(\`${call.pattern.head}…\`) - no key in ${ns.join(' / ')} matches`);
    }
  }
  // A key another value nests ($t(ns:key, …)) is used through it.
  const nestedKeys = new Set();
  for (const ns of namespaces) {
    for (const value of en[ns]?.values() ?? []) {
      if (typeof value !== 'string') continue;
      for (const [, ref] of value.matchAll(/\$t\(\s*([^,)\s]+)/g))
        nestedKeys.add(ref.includes(':') ? ref : `${ns}:${ref}`);
    }
  }
  for (const ns of namespaces) {
    for (const key of en[ns]?.keys() ?? []) {
      if (nestedKeys.has(`${ns}:${key.replace(PLURAL_SUFFIX, '')}`)) continue;
      if (!isUsed(key, ns, scan)) warnings.push(`${ns}: "${key}" is not used in the app's source`);
    }
  }

  // Rule 21: the [ns, base] keys a call reads (each branch of a ?:, every key a t(`prefix.${x}`) matches).
  const resolveKeys = (call) => {
    const found = new Map();
    const add = (ns, base) => found.set(`${ns}:${base}`, [ns, base]);
    for (const k of call.keys) {
      const [ns, key] = splitNs(k, call.ns, namespaces);
      const n = ns.find((x) => known(x, key));
      if (n) add(n, key);
    }
    if (!call.keys.length && call.pattern) {
      const [ns] = splitNs(call.pattern.head, call.ns, namespaces);
      for (const n of ns) {
        for (const k of en[n]?.keys() ?? []) {
          const base = k.replace(PLURAL_SUFFIX, '');
          if (call.pattern.re.test(base) || call.pattern.re.test(`${n}:${base}`)) add(n, base);
        }
      }
    }
    return [...found.values()];
  };
  checkNumbers(en, namespaces, numbersPassed(scan.calls, checker, resolveKeys));
  checkPluralCalls(scan.calls, checker, en, resolveKeys);

  return {
    namespaces: namespaces.length,
    keys: namespaces.reduce((n, ns) => n + (en[ns]?.size ?? 0), 0),
    languages: languages.sort(),
    enabled: enabled.filter((lang) => languages.includes(lang)),
  };
}

/** `ns:key` → [[ns], key] when ns is a namespace; else [the call's namespaces, key]. */
function splitNs(key, callNs, namespaces) {
  const colon = key.indexOf(':');
  if (colon > 0 && namespaces.includes(key.slice(0, colon)))
    return [[key.slice(0, colon)], key.slice(colon + 1)];
  return [callNs, key];
}

// ---------------------------------------------------------------- the admin site

/** The object literal assigned to `const <name>` in strings.ts, as a Map of key → text. */
function adminDictionary(tree, name) {
  let found = null;
  tree.forEachChild(function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      let init = node.initializer;
      while (
        ts.isSatisfiesExpression(init) ||
        ts.isAsExpression(init) ||
        ts.isParenthesizedExpression(init)
      ) {
        init = init.expression;
      }
      if (ts.isObjectLiteralExpression(init)) {
        found = new Map();
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : p.name.getText();
          found.set(key, stringOf(p.initializer));
        }
      }
    }
    node.forEachChild(visit);
  });
  return found;
}

function checkAdmin() {
  if (!existsSync(ADMIN_STRINGS)) return null;
  const tree = parse(ADMIN_STRINGS);
  const where = rel(ADMIN_STRINGS);
  const langs = { he: adminDictionary(tree, 'he'), en: adminDictionary(tree, 'en') };
  for (const [lang, d] of Object.entries(langs)) {
    if (!d) errors.push(`${where}: no \`const ${lang} = { … }\` dictionary`);
  }
  if (!langs.he || !langs.en) return null;
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  for (const [lang, d] of Object.entries(langs)) {
    const other = lang === 'he' ? langs.en : langs.he;
    for (const [key, value] of d) {
      if (value === null) errors.push(`${where}: ${lang} "${key}" is not a plain string`);
      else if (!/\S/.test(value)) errors.push(`${where}: ${lang} "${key}" is empty`);
      else if (value !== value.trim()) errors.push(`${where}: ${lang} "${key}" has spaces at an end`);
      if (!other.has(key))
        errors.push(`${where}: "${key}" is in ${lang} but not in ${lang === 'he' ? 'en' : 'he'}`);
    }
  }
  for (const [key, value] of langs.he) {
    const other = langs.en.get(key);
    if (typeof value !== 'string' || typeof other !== 'string') continue;
    const a = placeholders(value);
    const b = placeholders(other);
    if (!same(a, b))
      errors.push(
        `${where}: "${key}" has different placeholders: he [${a.join(', ')}], en [${b.join(', ')}]`,
      );
  }
  const files = sourceFiles(ADMIN_SRC).filter((f) => f !== ADMIN_STRINGS);
  const scan = scanSources(files, { tFunctions: false, groupCalls: ['label'] });
  for (const key of langs.he.keys()) {
    if (!isUsed(key, null, scan)) warnings.push(`admin: "${key}" is not used in the admin site's source`);
  }
  return { keys: langs.he.size };
}

// ---------------------------------------------------------------- report

const mobile = checkMobile();
const admin = checkAdmin();

for (const w of warnings) console.warn(`warning  ${w}`);
for (const e of errors) console.error(`error    ${e}`);
const failed = errors.length > 0 || (strict && warnings.length > 0);
console.log(
  [
    mobile
      ? `app: ${mobile.namespaces} namespaces, ${mobile.keys} keys, ${mobile.languages.length} languages ` +
        `(${mobile.languages.join(' ')}; enabled: ${mobile.enabled.join(' ')})`
      : null,
    admin ? `admin: ${admin.keys} keys` : 'admin: no strings.ts',
    release ? 'release: every language' : null,
    `${errors.length} error(s), ${warnings.length} warning(s)`,
  ]
    .filter(Boolean)
    .join(' · '),
);
process.exit(failed ? 1 : 0);
