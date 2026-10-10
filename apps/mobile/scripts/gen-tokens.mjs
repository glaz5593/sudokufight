// Builds src/theme/tokens.generated.ts from docs/design/tokens.json (the design of direction C, D30).
// Keys that start with "_" (notes, contrast tables) stay in the design file and out of the app.
//   npm run tokens -w @sudoku-fight/mobile
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'docs', 'design', 'tokens.json');
const target = join(here, '..', 'src', 'theme', 'tokens.generated.ts');

const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, x]) => [k, strip(x)]),
    );
  return v;
};

export function generate() {
  const tokens = strip(JSON.parse(readFileSync(source, 'utf8')));
  return (
    '// Generated from docs/design/tokens.json by scripts/gen-tokens.mjs. Do not edit by hand.\n' +
    `export const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(target, generate());
  console.log(`Wrote ${target}`);
}
