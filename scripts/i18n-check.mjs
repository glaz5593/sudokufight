#!/usr/bin/env node
/**
 * Translation check (work plan stage 13; spec §22, CLAUDE.md: every string in Hebrew and English, none
 * hard-coded). `npm run i18n:check` at the root, in CI, and part of `npm run verify`.
 *
 * The app (apps/mobile/src/i18n/locales/<lang>/<namespace>.json, i18next):
 *   errors   - a namespace file in one language only, or not registered in i18n/index.ts
 *            - a key in one language only (both directions), an empty or non-string value
 *            - different {{placeholders}}, $t(nested) references or <tags> in the two languages
 *            - a plural key without a form its language needs (Intl.PluralRules: he one/two/other, en one/other)
 *            - a $t(nested) reference to a key that does not exist
 *            - t('key') in the source, with a namespace known from useTranslation('ns') / TFunction<'ns'>,
 *              for a key the namespace does not have (and t(`prefix.${x}`) that no key matches)
 * The admin site (apps/admin/src/strings.ts, `{name}` placeholders):
 *   errors   - a key in one language only, an empty or untrimmed value, different placeholders
 * Both:
 *   warnings - a key the source never mentions (not as a literal, a `ns:key`, a plural's base, a parent of
 *              returnObjects, or under a t(`prefix.${x}`) / 'prefix.' + x). Unused keys are only reported:
 *              a key built in a way this scan can't see would be a false alarm.
 *
 * Exit code 1 on any error (with --strict, on warnings too). --root <dir> checks another tree (the tests).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const rootArg = args.indexOf('--root');
const ROOT =
  rootArg >= 0 ? resolve(args[rootArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MOBILE = join(ROOT, 'apps', 'mobile');
const LOCALES = join(MOBILE, 'src', 'i18n', 'locales');
const I18N_INDEX = join(MOBILE, 'src', 'i18n', 'index.ts');
const MOBILE_SOURCES = [join(MOBILE, 'src'), join(MOBILE, 'app')];
const ADMIN_SRC = join(ROOT, 'apps', 'admin', 'src');
const ADMIN_STRINGS = join(ADMIN_SRC, 'strings.ts');

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
/** i18next's context forms (t('key', { context: gender }) reads key_female): the base key covers them. */
const CONTEXT_SUFFIX = /_(male|female)$/;
const errors = [];
const warnings = [];
const rel = (path) => relative(ROOT, path).split(sep).join('/');

// ---------------------------------------------------------------- reading

/** A JSON tree as [dotted key, value] pairs (leaves only). */
function flatten(tree, prefix = '') {
  return Object.entries(tree).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [[`${prefix}${k}`, v]],
  );
}

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

/**
 * What a source tree mentions: every string literal, every template with a static start, every literal that
 * ends in '.' (a key built by +), and, per file, the t() calls whose namespace is known.
 */
function scanSources(files, { tFunctions, groupCalls = [] }) {
  const literals = new Set();
  const patterns = [];
  const calls = [];
  // Type aliases of TFunction<'ns'> anywhere (wording.ts exports PlayerT, GameT…), by name.
  const aliasNs = new Map();
  const trees = files.map((file) => ({ file, tree: parse(file) }));
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
            pattern: templatePattern(node.arguments[0]),
          });
        }
      }
      // <Trans i18nKey="…" /> and components that pass one on (AccentTitle i18nKey="…").
      if (ts.isJsxAttribute(node) && node.name.getText() === 'i18nKey' && node.initializer) {
        const key = ts.isStringLiteral(node.initializer) ? node.initializer.text : null;
        const all = [...new Set([...tNames.values()].flat())];
        if (key && all.length) calls.push({ file, line: lineOf(node), ns: all, key, pattern: null });
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

const placeholdersOf = (s) =>
  [...s.matchAll(/{{\s*-?\s*([\w.]+)(?:\s*,[^}]*)?\s*}}/g)].map((m) => m[1]).sort();
const nestingOf = (s) => [...s.matchAll(/\$t\(\s*([^,)\s]+)/g)].map((m) => m[1]).sort();
const tagsOf = (s) => [...s.matchAll(/<\/?\s*([\w-]+)\s*\/?>/g)].map((m) => m[0].replace(/\s/g, '')).sort();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function checkMobile() {
  if (!existsSync(LOCALES)) {
    errors.push(`${rel(LOCALES)}: no locales folder`);
    return;
  }
  const languages = readdirSync(LOCALES).filter((d) => statSync(join(LOCALES, d)).isDirectory());
  const filesOf = (lang) =>
    readdirSync(join(LOCALES, lang))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  const namespaces = [...new Set(languages.flatMap(filesOf))].sort();

  // The registered namespaces (NAMESPACES in i18n/index.ts).
  if (existsSync(I18N_INDEX)) {
    const match = readFileSync(I18N_INDEX, 'utf8').match(/NAMESPACES\s*=\s*\[([^\]]*)\]/);
    const registered = match ? [...match[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]) : [];
    for (const ns of namespaces) {
      if (!registered.includes(ns)) errors.push(`${rel(I18N_INDEX)}: namespace "${ns}" is not in NAMESPACES`);
    }
    for (const ns of registered) {
      if (!namespaces.includes(ns)) errors.push(`${rel(I18N_INDEX)}: NAMESPACES has "${ns}", with no file`);
    }
  }

  /** lang → ns → Map(key → value) */
  const dict = {};
  for (const lang of languages) {
    dict[lang] = {};
    for (const ns of namespaces) {
      const path = join(LOCALES, lang, `${ns}.json`);
      if (!existsSync(path)) {
        errors.push(`${rel(path)}: missing (the namespace exists in another language)`);
        dict[lang][ns] = new Map();
        continue;
      }
      try {
        dict[lang][ns] = new Map(flatten(JSON.parse(readFileSync(path, 'utf8'))));
      } catch (e) {
        errors.push(`${rel(path)}: not valid JSON (${e.message})`);
        dict[lang][ns] = new Map();
      }
    }
  }

  for (const ns of namespaces) {
    for (const lang of languages) {
      const here = dict[lang][ns];
      const where = `${lang}/${ns}.json`;
      for (const [key, value] of here) {
        if (typeof value !== 'string') errors.push(`${where}: "${key}" is not a string`);
        else if (!/\S/.test(value)) errors.push(`${where}: "${key}" is empty`);
        for (const other of languages) {
          if (other !== lang && !dict[other][ns].has(key)) {
            errors.push(`${where}: "${key}" is missing in ${other}/${ns}.json`);
          }
        }
        if (typeof value === 'string') {
          for (const ref of nestingOf(value)) {
            const [refNs, refKey] = ref.includes(':') ? ref.split(':') : [ns, ref];
            if (!dict[lang][refNs]?.has(refKey))
              errors.push(`${where}: "${key}" nests $t(${ref}), which doesn't exist`);
          }
        }
      }
      // Plurals: each language needs its own forms (Hebrew: one, two, other; English: one, other).
      const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const bases = new Set(
        [...here.keys()].filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')),
      );
      for (const base of bases) {
        for (const form of needed) {
          if (!here.has(`${base}_${form}`)) errors.push(`${where}: plural "${base}" has no "_${form}" form`);
        }
      }
    }
    // The same placeholders, nesting and tags in every language, key by key.
    const [first, ...rest] = languages;
    for (const [key, value] of dict[first][ns]) {
      for (const lang of rest) {
        const other = dict[lang][ns].get(key);
        if (typeof value !== 'string' || typeof other !== 'string') continue;
        for (const [what, read] of [
          ['placeholders', placeholdersOf],
          ['$t() references', nestingOf],
          ['tags', tagsOf],
        ]) {
          const a = read(value);
          const b = read(other);
          if (!same(a, b)) {
            errors.push(
              `${ns}: "${key}" has different ${what}: ${first} [${a.join(', ')}], ${lang} [${b.join(', ')}]`,
            );
          }
        }
      }
    }
  }

  // The source: keys that t() asks for, and keys nobody mentions.
  const files = MOBILE_SOURCES.flatMap(sourceFiles);
  const scan = scanSources(files, { tFunctions: true });
  const reference = dict[languages.includes('he') ? 'he' : languages[0]] ?? {};
  const known = (ns, key) => {
    const keys = reference[ns];
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
        [...(reference[n]?.keys() ?? [])].some((k) =>
          [k, k.replace(PLURAL_SUFFIX, '')].some((x) => re.test(x) || re.test(`${n}:${x}`)),
        ),
      );
      if (!any) errors.push(`${where}: t(\`${call.pattern.head}…\`) - no key in ${ns.join(' / ')} matches`);
    }
  }
  for (const ns of namespaces) {
    for (const key of reference[ns]?.keys() ?? []) {
      if (!isUsed(key, ns, scan)) warnings.push(`${ns}: "${key}" is not used in the app's source`);
    }
  }
  return {
    namespaces: namespaces.length,
    keys: namespaces.reduce((n, ns) => n + (reference[ns]?.size ?? 0), 0),
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
    mobile ? `app: ${mobile.namespaces} namespaces, ${mobile.keys} keys` : null,
    admin ? `admin: ${admin.keys} keys` : 'admin: no strings.ts',
    `${errors.length} error(s), ${warnings.length} warning(s) (unused keys)`,
  ]
    .filter(Boolean)
    .join(' · '),
);
process.exit(failed ? 1 : 0);
