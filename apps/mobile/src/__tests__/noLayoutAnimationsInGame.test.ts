import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Moshe's black screens of 1.0.0 (15.10.2026): the game's end clears every lock at once, and the lock's ring and
 * pill used Reanimated layout animations (`exiting={FadeOut}`) that were still running when the results replaced
 * the game screen. The board, the cards, the interferences and the game screen fade what goes by themselves
 * (motion.md `lock.release`: a presence fade), never with a layout animation that the navigation can cut. This
 * reads their source the way a grep would.
 */

const SRC = join(__dirname, '..');
// Staged practice (1.0.2): its map, a stage and its result are one flow too (components.md §19.10).
const ROOTS = [
  'components/board',
  'components/player',
  'components/interference',
  'components/levels',
  'screens/game',
  'screens/levels',
].map((dir) => join(SRC, dir));

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
const stripComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/** A layout animation: the props, or Reanimated's ready-made entering, exiting and layout transitions. */
const LAYOUT_ANIMATION =
  /\b(?:entering|exiting|layout)\s*=\s*\{|\b(?:Fade|Slide|Zoom|Bounce|Flip|Stretch|Rotate|LightSpeed|Pinwheel|Roll)(?:In|Out)\w*\b|\b(?:Linear|Fading|Sequenced|Jumping|Curved|Entry|Exit)Transition\b|\bLayoutAnimation\b/;

const files = ROOTS.flatMap(sourceFiles).map((path) => ({
  name: relative(SRC, path).split('\\').join('/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

describe('no layout animations on the game screen (Moshe’s black screens of 1.0.0)', () => {
  it('reads the board, the cards, the interferences and the game screen', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'components/board/Cell.tsx',
        'screens/game/GameScreen.tsx',
        // [D46, D47] the board's dim and the new kinds
        'screens/game/hit/BoardHitLayer.tsx',
        'components/interference/Scramble.tsx',
        'components/interference/Ink.tsx',
        'components/board/Keypad.tsx',
        'components/levels/StarRow.tsx',
        'screens/levels/LevelResultView.tsx',
        'screens/levels/LevelNode.tsx',
      ]),
    );
  });

  it('none of them uses one', () => {
    expect(files.filter((f) => LAYOUT_ANIMATION.test(f.code)).map((f) => f.name)).toEqual([]);
  });

  it('would catch one', () => {
    for (const code of [
      '<Animated.View exiting={FadeOut.duration(240)} />',
      '<Animated.View entering={enter} />',
      '<Animated.View layout={LinearTransition} />',
      'import { FadeInDown } from "react-native-reanimated";',
    ])
      expect(LAYOUT_ANIMATION.test(stripComments(code))).toBe(true);
    expect(LAYOUT_ANIMATION.test(stripComments('// exiting={FadeOut}\nconst a = 1;'))).toBe(false);
  });
});
