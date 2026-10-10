import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * One PGlite folder, one process. PGlite works on the folder's files directly, with no server in between, so
 * two processes on one folder (the dev server and `npm run seed`, or two dev servers) overwrite each other's
 * pages: the data goes quietly wrong (seen in testing: totals of 0 next to 565 practice games, then 500s).
 *
 * So whoever opens a folder first writes `<folder>.lock` with its pid, and anyone else is refused while that
 * process is alive. A lock left by a process that died (a crash, a killed terminal) is taken over.
 */

export class DataDirLockedError extends Error {
  constructor(
    readonly dataDir: string,
    readonly ownerPid: number,
  ) {
    super(
      `The PGlite folder ${dataDir} is open in another process (pid ${ownerPid}). Only one process can use ` +
        `it: stop the other one first (the dev server, or npm run seed). If no such process is running, ` +
        `delete ${lockFileOf(dataDir)}.`,
    );
    this.name = 'DataDirLockedError';
  }
}

export const lockFileOf = (dataDir: string) => `${dataDir}.lock`;

/** Whether a process with this pid is running (signal 0 only checks; EPERM means it exists). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function ownerOf(lockFile: string): number | null {
  try {
    const pid = Number(readFileSync(lockFile, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // gone in between, or unreadable: treat as stale
  }
}

/**
 * Takes the folder's lock for this process, or throws DataDirLockedError. Returns the release function
 * (idempotent; it removes the lock only while it is still ours). Opening the same folder twice in one
 * process is refused too: that corrupts it just the same.
 */
export function lockDataDir(dataDir: string): () => void {
  const lockFile = lockFileOf(dataDir);
  const mine = String(process.pid);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(lockFile, mine, { flag: 'wx' });
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        if (ownerOf(lockFile) === process.pid) unlinkSync(lockFile);
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const owner = ownerOf(lockFile);
      if (owner !== null && isRunning(owner)) throw new DataDirLockedError(dataDir, owner);
      try {
        unlinkSync(lockFile); // stale: its process is gone
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  throw new Error(`Could not take the lock ${lockFile}`);
}
