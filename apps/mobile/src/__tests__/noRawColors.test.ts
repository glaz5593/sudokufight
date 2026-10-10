import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CLAUDE.md and components.md: no raw colours in components or screens. Every colour comes from the theme
 * (src/theme, generated from docs/design/tokens.json). This reads the source files the way a grep would.
 * Tests and their fixtures may name colours (to check them); comments may quote the design's hex codes.
 */

const SRC = join(__dirname, '..');
const ROOTS = [join(SRC, 'components'), join(SRC, 'screens'), join(SRC, '..', 'app')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__fixtures__' || name === 'testing' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without its comments (a `//` after a colon is a URL, not a comment). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const RAW = [
  { name: 'hex colour', pattern: /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i },
  { name: 'rgb()/hsl() literal', pattern: /\b(?:rgba?|hsla?)\(\s*\d/i },
  {
    name: 'named colour',
    pattern:
      /\b(?:color|backgroundColor|borderColor|tintColor|thumbColor|fill|stroke|shadowColor)\s*[:=]\s*\{?\s*['"](?:white|black|red|green|blue|yellow|gray|grey|orange|purple|pink)['"]/,
  },
];

/** Every raw colour in the given files, as "path:line: text". */
function rawColours(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .flatMap((line, i) =>
        RAW.filter((r) => r.pattern.test(line)).map(
          (r) => `${relative(SRC, file)}:${i + 1}: ${r.name}: ${line.trim()}`,
        ),
      ),
  );
}

describe('no raw colours outside the theme', () => {
  const files = ROOTS.flatMap(sourceFiles);

  it('reads the component, screen and route files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith('DesignSystemScreen.tsx'))).toBe(true);
  });

  it('finds none', () => {
    expect(rawColours(files)).toEqual([]);
  });

  it('would catch one', () => {
    const lines = ["const a = { color: '#ff0000' };", 'const b = "rgba(0, 0, 0, 0.5)";', "fill: 'white'"];
    expect(RAW.map((r) => lines.some((l) => r.pattern.test(l)))).toEqual([true, true, true]);
    expect(stripComments("// '#123456'\nconst u = 'https://x.y'; /* #abcdef */")).not.toMatch(/#[0-9a-f]{6}/);
  });
});
