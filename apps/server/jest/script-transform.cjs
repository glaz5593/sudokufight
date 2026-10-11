/**
 * A Jest transform for the monorepo's own Node scripts (scripts/lib/*.mjs: ES modules, plain JavaScript), so
 * the server's tests can import their pure parts (test/devLan.test.ts).
 *
 * ts-jest keeps the ESM syntax of an .mjs outside node_modules (TypeScript emits an .mjs as ESM whatever the
 * `module` setting), and Jest 29 runs CommonJS. The same call ts-jest makes for .mjs in node_modules: transpile
 * to CommonJS under a .js name. Inline source maps keep the stack traces on the script's own lines.
 */
const { createHash } = require('node:crypto');

const ts = require('typescript');

const VERSION = '1';

module.exports = {
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        allowJs: true,
        esModuleInterop: true,
        inlineSourceMap: true,
        inlineSources: true,
      },
      fileName: sourcePath.replace(/\.mjs$/, '.js'),
    });
    return { code: outputText };
  },
  getCacheKey(sourceText, sourcePath) {
    return createHash('sha1')
      .update(VERSION)
      .update(ts.version)
      .update(sourcePath)
      .update(sourceText)
      .digest('hex');
  },
};
