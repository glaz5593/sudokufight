/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Metro's part of what the app bundle ships (work plan stage 13, "ביצועים: גודל האפליקציה"; docs/PERF.md). In
 * Node: Expo's Metro config is a Node module.
 */
const MOBILE = join(__dirname, '..', '..');

interface Resolution {
  type: string;
  filePath?: string;
}
type Resolve = (context: unknown, moduleName: string, platform: string | null) => Resolution;

describe("Metro: Material Symbols (expo-router's native tabs) stay out", () => {
  // Expo's Metro config, as `expo export` and `expo start` read it.
  const config = jest.requireActual<{ resolver: { resolveRequest: Resolve } }>('../../metro.config.js');
  const upstream = jest.fn(() => ({ type: 'empty' }));
  const context = { resolveRequest: upstream };

  it('resolves the 948 KB font package to a stand-in', () => {
    const resolved = config.resolver.resolveRequest(
      context,
      '@expo-google-fonts/material-symbols/400Regular',
      'android',
    );
    expect(resolved.type).toBe('sourceFile');
    expect(relative(MOBILE, resolved.filePath!).split(sep).join('/')).toBe(
      'src/theme/no-material-symbols.js',
    );
    expect(upstream).not.toHaveBeenCalled();
  });

  it('…which is safe only while the app uses neither native tabs nor SymbolView', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
        return /\.tsx?$/.test(name) ? [path] : [];
      });
    const users = [...sources(join(MOBILE, 'app')), ...sources(join(MOBILE, 'src'))].filter((file) =>
      /expo-symbols|NativeTabs|native-tabs|SymbolView/.test(readFileSync(file, 'utf8')),
    );
    expect(users.map((f) => relative(MOBILE, f))).toEqual([]);
  });

  it('passes every other module on', () => {
    config.resolver.resolveRequest(context, 'react-native', 'android');
    expect(upstream).toHaveBeenCalledWith(context, 'react-native', 'android');
  });
});
