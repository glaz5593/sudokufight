import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Spec §22 and CLAUDE.md: every animation honours Reduced Motion, and the player's own setting wins over the
 * phone's (theme/motion.ts useReduceMotion: "system" follows the phone, "on"/"off" override it). This reads
 * the source the way a grep would (work plan stage 13):
 *
 * - every file that starts an animation (Reanimated's withTiming/withSpring/…, layout animations, a frame
 *   callback, React Native's Animated) decides on reduced motion in its code: it calls useReduceMotion or
 *   reduceMotionFlag, or takes the decision as `reduce` / `reduced` / `still` from its parent. The few that
 *   move the same either way say why, below;
 * - nothing uses ReduceMotion.System, which follows the phone only and ignores the app's setting.
 */

const SRC = join(__dirname, '..');
const ROOTS = [join(SRC, 'components'), join(SRC, 'screens'), join(SRC, '..', 'app')];

/**
 * Files that animate without deciding themselves, and why: they move the same with reduced motion on purpose
 * (motion.md), or their caller decides and never runs them reduced.
 */
const EXCEPTIONS: Record<string, string> = {
  'components/player/TimerRing.tsx':
    "information, not decoration: the lock's time left keeps running (motion.md lockTimerRing)",
  'components/board/Keypad.tsx':
    'a 3 dp press and an opacity fade, the same with reduced motion (motion.md §4.1 key.press, keypad.arm)',
  'components/interference/hitClock.ts':
    "the game's clock for an interference's 5 s (spec §7.2), which the still variant reads too",
  'components/board/animation.ts':
    "the board's timing helpers (ReduceMotion.Never): Cell and Keypad pick the reduced variant themselves",
  'screens/game/FlightLayer.tsx':
    'the score chips: GameScreen mounts them only with full motion (reduced, the delta shows by the score)',
};

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

const ANIMATES =
  /\bwith(?:Timing|Spring|Repeat|Sequence|Delay|Decay)\(|\bAnimated\.(?:timing|spring|loop|decay|sequence)\(|\bLayoutAnimation\b|\b(?:entering|exiting|layout)=\{|\b(?:Fade|Slide|Zoom|Bounce|Flip|Stretch|Rotate|LightSpeed|Pinwheel|Roll)(?:In|Out)\w*\b|\buseFrameCallback\(/;
const DECIDES = /\buseReduceMotion\(|\breduceMotionFlag\(|\breduce\b|\breduced\b|\bstill\b/;

const files = ROOTS.flatMap(sourceFiles).map((path) => ({
  path,
  name: relative(SRC, path)
    .split('\\')
    .join('/')
    .replace(/^\.\.\//, ''),
  code: stripComments(readFileSync(path, 'utf8')),
}));
const animating = files.filter((f) => ANIMATES.test(f.code));

describe('reduced motion in every animation (spec §22)', () => {
  it('finds the animated components', () => {
    expect(animating.length).toBeGreaterThan(20);
    expect(animating.map((f) => f.name)).toEqual(
      expect.arrayContaining(['components/board/Cell.tsx', 'components/ui/Sheet.tsx']),
    );
  });

  it('each animating file decides on reduced motion, or says why it moves the same', () => {
    const undecided = animating
      .filter((f) => !DECIDES.test(f.code) && !(f.name in EXCEPTIONS))
      .map((f) => f.name);
    expect(undecided).toEqual([]);
  });

  it('the exceptions still exist and still animate', () => {
    for (const name of Object.keys(EXCEPTIONS)) {
      expect({ name, animates: animating.some((f) => f.name === name) }).toEqual({ name, animates: true });
    }
  });

  it('never follows the phone alone (ReduceMotion.System ignores the app’s setting)', () => {
    const system = files.filter((f) => /ReduceMotion\.System/.test(f.code)).map((f) => f.name);
    expect(system).toEqual([]);
  });

  it('would catch an animation with no decision', () => {
    const code = stripComments(
      '// reduce\nconst a = withTiming(1, { duration: 200 }); /* reduced */\nconst b = <View entering={FadeIn} />',
    );
    expect(ANIMATES.test(code)).toBe(true);
    expect(DECIDES.test(code)).toBe(false);
  });
});
