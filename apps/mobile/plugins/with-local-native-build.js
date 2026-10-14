/**
 * A config plugin for Android builds on this PC (`npm run apk`, `expo run:android`; app.config.ts leaves it out
 * of EAS builds, which stay as they were).
 *
 * android/build.gradle, for the library modules:
 * 1. Every library that names no NDK gets the project's, React Native's `ndkVersion` (the one in the Android SDK
 *    here). expo-updates and expo-sqlite build C++ but name none, so the Android Gradle Plugin would fall back
 *    to its own default, a minor release older, and download it during the build: about 2.5 GB more on a nearly
 *    full drive.
 * 2. On Windows, at most 2 C++ compilers at once per module (CMake job pools; ninja otherwise runs one per
 *    processor, each taking hundreds of MB). When memory runs short, Windows grows its page file on drive C by
 *    gigabytes, on a drive that is nearly full.
 *
 * android/app/build.gradle, for the app (React Native's root project plugin configures the app before the end
 * of android/build.gradle, so this part can't live there):
 * 3. On Windows, the same 2 compilers, and the app's own C++ (React Native's autolinked codegen for the
 *    libraries) builds in a short folder, ~/.sudoku-fight/cxx, instead of android/app/.cxx. Those object files
 *    sit outside the app's CMake project, so CMake names each one after the full path of its source in
 *    node_modules, under a folder per library: under android/app/.cxx/RelWithDebInfo/<hash>/arm64-v8a/ that
 *    passes Windows' 260-character path limit (react-native-safe-area-context's ComponentDescriptors.cpp.o:
 *    about 400), which ninja can't open. CMake shortens such names with a hash, but only when the folder leaves
 *    room for one; the short folder does.
 * 4. On Windows, Metro bundles the JS with 2 workers instead of one per processor (memory again: the bundle
 *    step comes last, while Gradle and Kotlin still hold theirs).
 */
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const WHY = 'Why: apps/mobile/plugins/with-local-native-build.js';
const COMPILE_JOBS = '"-DCMAKE_JOB_POOLS=compile=2", "-DCMAKE_JOB_POOL_COMPILE=compile"';
const ON_WINDOWS = 'System.getProperty("os.name").toLowerCase().contains("windows")';

const ROOT_BEGIN = '// @generated begin sudoku-fight local-native-build';
const ROOT_END = '// @generated end sudoku-fight local-native-build';
const ROOT_BLOCK = [
  ROOT_BEGIN,
  `// Builds on this PC: every library gets the project's NDK, and on Windows 2 C++ compilers at once. ${WHY}`,
  'subprojects { subproject ->',
  '  subproject.plugins.withId("com.android.library") {',
  '    if (rootProject.ext.has("ndkVersion")) {',
  '      subproject.android.ndkVersion = rootProject.ext.ndkVersion',
  '    }',
  `    if (${ON_WINDOWS}) {`,
  `      subproject.android.defaultConfig.externalNativeBuild.cmake.arguments(${COMPILE_JOBS})`,
  '    }',
  '  }',
  '}',
  ROOT_END,
].join('\n');

const APP_BEGIN = '// @generated begin sudoku-fight local-native-build-app';
const APP_END = '// @generated end sudoku-fight local-native-build-app';
const APP_BLOCK = [
  APP_BEGIN,
  `// Builds on this PC, on Windows: the app's C++ in a short folder (the 260-character path limit), and less`,
  `// memory: 2 C++ compilers, 2 Metro workers. ${WHY}`,
  `if (${ON_WINDOWS}) {`,
  '  android.externalNativeBuild.cmake.buildStagingDirectory =',
  '    new File(System.getProperty("user.home"), ".sudoku-fight/cxx")',
  `  android.defaultConfig.externalNativeBuild.cmake.arguments(${COMPILE_JOBS})`,
  '  react {',
  '    extraPackagerArgs = ["--max-workers", "2"]',
  '  }',
  '}',
  APP_END,
].join('\n');

/** The root plugins' line, before which the library block goes (so it is registered before any module). */
const ROOT_PLUGINS = 'apply plugin: "expo-root-project"';

/** android/build.gradle with the library block, once: before the root plugins, or at the end. */
function addRootBlock(contents) {
  if (contents.includes(ROOT_BEGIN)) return contents;
  const at = contents.indexOf(ROOT_PLUGINS);
  if (at < 0) return `${contents.trimEnd()}\n\n${ROOT_BLOCK}\n`;
  return `${contents.slice(0, at)}${ROOT_BLOCK}\n\n${contents.slice(at)}`;
}

/** android/app/build.gradle with the app block at its end, once. */
function addAppBlock(contents) {
  if (contents.includes(APP_BEGIN)) return contents;
  return `${contents.trimEnd()}\n\n${APP_BLOCK}\n`;
}

const groovy = (mod, file) => {
  if (mod.modResults.language !== 'groovy') throw new Error(`with-local-native-build: ${file} is not Groovy`);
};

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withLocalNativeBuild = (config) =>
  withAppBuildGradle(
    withProjectBuildGradle(config, (mod) => {
      groovy(mod, 'android/build.gradle');
      mod.modResults.contents = addRootBlock(mod.modResults.contents);
      return mod;
    }),
    (mod) => {
      groovy(mod, 'android/app/build.gradle');
      mod.modResults.contents = addAppBlock(mod.modResults.contents);
      return mod;
    },
  );

module.exports = withLocalNativeBuild;
module.exports.addRootBlock = addRootBlock;
module.exports.addAppBlock = addAppBlock;
