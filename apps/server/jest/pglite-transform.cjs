/**
 * A Jest transform for PGlite's CommonJS build (@electric-sql/pglite/dist/*.cjs).
 *
 * PGlite loads Node built-ins with `await import("fs")`. Jest 29 runs tests in a VM that refuses dynamic
 * import() without --experimental-vm-modules, and down-levelling with ts-jest breaks too: the bundle declares
 * its own `var require` in the same scope, so a rewritten `require("fs")` calls that one before it is set.
 *
 * So: `import("x")` → `Promise.resolve(module.require("x"))`. Only built-ins are loaded this way, and every
 * call site reads named exports (never `.default`), so a CommonJS module object is a faithful stand-in.
 */
const { createHash } = require('node:crypto');

const VERSION = '1';
const DYNAMIC_IMPORT = /\bimport\((["'][\w:/.-]+["'])\)/g;

module.exports = {
  process(sourceText) {
    return { code: sourceText.replace(DYNAMIC_IMPORT, 'Promise.resolve(module.require($1))') };
  },
  getCacheKey(sourceText, sourcePath) {
    return createHash('sha1').update(VERSION).update(sourcePath).update(sourceText).digest('hex');
  },
};
