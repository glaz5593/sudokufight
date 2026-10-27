import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

/**
 * CLAUDE.md: no hard-coded strings in the UI, everything through t() (localization plan 0ה, "שמירה לעתיד"). This
 * reads every component, screen and route the way the compiler does and fails on letters written in the code
 * where a player would see or hear them:
 * - text between JSX tags (`<Text>VS</Text>`) and a literal as a child (`{'VS'}`, `{`${n} points`}`);
 * - the props a screen reader says or a field shows: accessibilityLabel, accessibilityHint, aria-label,
 *   placeholder, title, and the text props of our own components (label, hint, message, caption, subtitle, body,
 *   note), as a literal, a template's fixed parts, either branch of a ?: or a part of a + .
 * Symbols, digits and punctuation pass ("—", "·", "0:30"): no language reads them differently. Letters inside an
 * expression the code computes (t(), a name, a cell's "D5") are not literals and pass too. The developer screens
 * are left out (D109: the dev namespace is not translated).
 */

const SRC = join(__dirname, '..');
const ROOTS = [
  join(SRC, 'components'),
  join(SRC, 'screens'),
  join(SRC, 'avatars'),
  join(SRC, 'auth'),
  join(SRC, '..', 'app'),
];

/** The developer screens (D109), by folder and by file. */
const DEV_FOLDERS = [join(SRC, 'components', 'dev'), join(SRC, '..', 'app', 'dev')];
const DEV_FILES = [
  'screens/AvatarLabScreen.tsx',
  'screens/DesignSystemScreen.tsx',
  'screens/HelloScreen.tsx',
  'screens/SoundAuditionScreen.tsx',
  'screens/game/online/DevMetricsScreen.tsx',
  'screens/game/online/DevMetricsToggle.tsx',
  'screens/game/online/DevOnlineScreen.tsx',
  'screens/game/online/NetMetricsPanel.tsx',
].map((f) => join(SRC, ...f.split('/')));

const SPOKEN_PROPS = new Set([
  'accessibilityLabel',
  'accessibilityHint',
  'aria-label',
  'placeholder',
  'title',
  'label',
  'hint',
  'message',
  'caption',
  'subtitle',
  'body',
  'note',
]);

const LETTER = /\p{L}/u;

function sourceFiles(dir: string): string[] {
  if (DEV_FOLDERS.includes(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__fixtures__' || name === 'testing' ? [] : sourceFiles(path);
    }
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') && !DEV_FILES.includes(path) ? [path] : [];
  });
}

/** Whether an expression holds letters written in the code (not computed). */
function literalLetters(e: ts.Expression | undefined): boolean {
  if (!e) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return LETTER.test(e.text);
  if (ts.isTemplateExpression(e))
    return LETTER.test(e.head.text) || e.templateSpans.some((s) => LETTER.test(s.literal.text));
  if (ts.isConditionalExpression(e)) return literalLetters(e.whenTrue) || literalLetters(e.whenFalse);
  if (ts.isBinaryExpression(e)) return literalLetters(e.left) || literalLetters(e.right);
  if (ts.isParenthesizedExpression(e)) return literalLetters(e.expression);
  return false;
}

/** Every hard-coded text in a .tsx source, as "where:line: kind: code". */
function hardcodedText(code: string, where: string): string[] {
  const file = ts.createSourceFile(where, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, kind: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${where}:${line + 1}: ${kind}: ${node.getText().replace(/\s+/g, ' ').slice(0, 80)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && LETTER.test(node.text)) report(node, 'text');
    else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      literalLetters(node.expression)
    )
      report(node, 'text');
    else if (ts.isJsxAttribute(node) && SPOKEN_PROPS.has(node.name.getText())) {
      const value = node.initializer;
      if (
        value &&
        ((ts.isStringLiteral(value) && LETTER.test(value.text)) ||
          (ts.isJsxExpression(value) && literalLetters(value.expression)))
      )
        report(node, node.name.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('no hard-coded text on screen (plan 0ה)', () => {
  it('finds letters in text, in a literal child and in the spoken props', () => {
    const code = [
      'const a = <Text style={s}>VS</Text>;',
      "const b = <Text>{'VS'}</Text>;",
      'const c = <Text>{`${n} points`}</Text>;',
      'const d = <View accessibilityLabel="Close" />;',
      "const e = <TextInput placeholder={on ? 'Name' : t('x')} />;",
      "const f = <Modal title={'A ' + name} />;",
      'const g = <Button label={`Go ${n}`} />;',
      "const h = <View accessibilityHint={('הבא')} />;",
    ].join('\n');
    expect(hardcodedText(code, 'sample.tsx').map((l) => l.split(': ')[1])).toEqual([
      'text',
      'text',
      'text',
      'accessibilityLabel',
      'placeholder',
      'title',
      'label',
      'accessibilityHint',
    ]);
  });

  it('lets through t(), computed text, symbols, digits, icon names and comments', () => {
    const code = [
      "const a = <Text>{t('player:vs')}</Text>;",
      'const b = <Text>{`${a} · ${b}`}</Text>;',
      'const c = <Text>— · 0:30 ★ ?</Text>;',
      'const d = <Icon name="check" testID="ok-button" />;',
      'const e = <View>{/* the Hebrew text goes here */}</View>;',
      "const f = <View accessibilityLabel={labelValue(t('a'), name, t)} />;",
      'const g = <Text>{name}</Text>;',
    ].join('\n');
    expect(hardcodedText(code, 'sample.tsx')).toEqual([]);
  });

  const files = ROOTS.flatMap(sourceFiles);

  it('reads the components, screens and routes, without the developer screens', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(`${sep}RaceHud.tsx`))).toBe(true);
    for (const dev of [...DEV_FOLDERS, ...DEV_FILES])
      expect({ dev, exists: existsSync(dev) }).toEqual({ dev, exists: true });
    expect(files.filter((f) => DEV_FILES.includes(f) || DEV_FOLDERS.some((d) => f.startsWith(d)))).toEqual(
      [],
    );
  });

  it('finds none: every visible or spoken word goes through t()', () => {
    const found = files.flatMap((f) => hardcodedText(readFileSync(f, 'utf8'), relative(SRC, f)));
    expect(found).toEqual([]);
  });
});
