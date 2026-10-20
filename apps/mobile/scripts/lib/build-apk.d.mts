// Types of build-apk.mjs, for the tests that import it (src/__tests__/buildApk.test.ts).

import type { Interfaces } from '../../../../scripts/lib/lan.mjs';

export declare const PACKAGE: string;
export declare const ABI: string;
export declare const KEEP_APKS: number;
export declare const LOCAL_PORT: number;
export declare const MIN_FREE_FULL: number;
export declare const MIN_FREE_INCREMENTAL: number;
export declare const ABORT_FREE: number;
export declare const EXIT: { ok: 0; failed: 1; usage: 2; preflight: 3; install: 4 };
export declare const USAGE: string;

export interface ApkOptions {
  server: string;
  install: boolean;
  installOnly: boolean;
  replace: boolean;
  clean: boolean;
  cleanOnly: boolean;
  cleanNative: boolean;
  verbose: boolean;
  dryRun: boolean;
}

export declare function parseApkArgs(
  argv: readonly string[],
): { kind: 'help' } | { kind: 'error'; error: string } | { kind: 'options'; options: ApkOptions };

export interface Server {
  /** In the APK's file name: staging, production, local, or the host. */
  label: string;
  host: string;
  port: number;
  secure: boolean;
  /** Where it came from, for the console: "eas.json preview", "this PC (Wi-Fi)", "command line". */
  source: string;
}

export declare function resolveServer(
  choice: string,
  easJson: unknown,
  interfaces: Interfaces,
): { kind: 'error'; error: string } | { kind: 'server'; server: Server };

export declare function serverEnv(server: Server): {
  EXPO_PUBLIC_SERVER_HOST: string;
  EXPO_PUBLIC_SERVER_PORT: string;
  EXPO_PUBLIC_SERVER_SECURE: 'true' | 'false';
};

export declare function describeServer(server: Server): string;

export declare function appServerLabel(server: Server): string;
export declare function buildInfoEnv(
  server: Server,
  git: { sha: string; dirty: boolean },
): { EXPO_PUBLIC_APP_BUILD: string; EXPO_PUBLIC_SERVER_LABEL: string };

export declare function apkFileName(info: {
  version: string;
  sha: string;
  dirty: boolean;
  label: string;
}): string;

export declare function apksToPrune(
  files: readonly { name: string; mtimeMs: number }[],
  keep?: number,
): string[];
export declare function newestApk(files: readonly { name: string; mtimeMs: number }[]): string | null;
export declare function staleConfigDirs(dirs: readonly { name: string; mtimeMs: number }[]): string[];

export declare function serverNativeInput(server: Pick<Server, 'host' | 'port' | 'secure'>): string;
export declare const PREBUILD_RULE: string;
export declare function nativeConfigHash(inputs: readonly (readonly [string, string | null])[]): string;
export declare function packageDeps(packageJsonText: string): string;
export declare const PREBUILD_PACKAGES: readonly string[];
export declare function installedVersions(
  packageJsonText: string,
  versionOf: (name: string) => string | null,
): [string, string | null][];
export declare function appJsonFiles(appJsonText: string): string[];
export declare function prebuildPlan(state: {
  androidExists: boolean;
  storedHash: string | null;
  currentHash: string;
  cleanNative: boolean;
}): { run: boolean; clean: boolean; reason: string };
export declare function releaseSigningConfig(gradleText: string): string | null;

export declare function javaMajorVersion(text: string): number | null;

export interface AdbDevice {
  serial: string;
  /** adb's word for it: device (ready), unauthorized, offline... */
  state: string;
  model: string | null;
}
export declare function parseAdbDevices(text: string): AdbDevice[];
export declare const REPLACEABLE: readonly string[];
export declare function installFailure(text: string): { code: string | null; hint: string } | null;
export declare function uninstallCommand(serial: string): string;

export declare const GRADLE_WORKERS: number;
export declare const BUNDLE_TASK: string;
export declare function gradleArgs(): string[];
export declare function gradleTask(line: string): string | null;
export declare function isOutOfMemory(logText: string): boolean;
export declare function isLockedError(error: unknown): boolean;
export declare function isFileLock(logText: string): boolean;
export declare function failureSummary(logText: string, lines?: number): string;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}
export declare function zipEntries(buf: Buffer): ZipEntry[];
export declare function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer;
export declare function hasApkSigningBlock(buf: Buffer): boolean;

export interface ApkReport {
  signed: boolean;
  abis: string[];
  bundleSize: number;
  hostInBundle: boolean;
}
export declare function inspectApk(buf: Buffer, host: string): ApkReport;
export declare function apkProblems(report: ApkReport, host: string): string[];

export declare function formatBytes(bytes: number): string;
export declare function formatDuration(ms: number): string;
