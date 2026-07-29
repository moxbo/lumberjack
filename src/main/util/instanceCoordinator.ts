/**
 * Instance coordinator
 *
 * Lumberjack can run multiple processes in parallel (see openWindowInNewProcess
 * in main.ts). Those processes share the same userData directory but are
 * otherwise independent – the built-in single-instance lock is bypassed for
 * multi-instance launches.
 *
 * This module provides the cross-process coordination needed to safely install
 * an update: before the installer replaces the application files, every *other*
 * running instance must exit (otherwise the files are locked / a second
 * installer could run concurrently).
 *
 * Mechanism:
 * - A registry file (instances.json) tracks the PIDs of all live instances.
 * - A quit-all signal file broadcasts a "please exit" request to every other
 *   instance. Each instance polls the signal and quits when it sees a request
 *   that was issued by a *different* instance after it started.
 * - waitForOthersToExit() lets the installing instance block until it is the
 *   last one standing (with a timeout).
 */

import { app } from "electron";
import log from "electron-log/main";
import * as fs from "fs";
import * as path from "path";

const REGISTRY_FILE = "instances.json";
const QUIT_SIGNAL_FILE = ".lj-quit-all";
const LOCK_STALE_MS = 5000;
const POLL_INTERVAL_MS = 400;

interface InstanceEntry {
  pid: number;
  ts: number;
}

interface QuitSignal {
  ts: number;
  requester: number;
}

function baseDir(): string {
  return app.getPath("userData");
}

function registryPath(): string {
  return path.join(baseDir(), REGISTRY_FILE);
}

function signalPath(): string {
  return path.join(baseDir(), QUIT_SIGNAL_FILE);
}

function lockPath(): string {
  return registryPath() + ".lock";
}

function isAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    // Signal 0 does not send a signal but performs error checking.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but we can't signal it → still alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* busy wait fallback */
    }
  }
}

function acquireLock(maxWaitMs = 1000): number | null {
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath(), "wx");
      try {
        fs.writeSync(fd, String(process.pid));
      } catch {
        /* ignore */
      }
      return fd;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null;
      try {
        const st = fs.statSync(lockPath());
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath());
          continue;
        }
      } catch {
        /* lock vanished – retry */
      }
      if (Date.now() - start > maxWaitMs) return null;
      sleepSync(15);
    }
  }
}

function releaseLock(fd: number | null): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(lockPath());
  } catch {
    /* ignore */
  }
}

function readRegistry(): InstanceEntry[] {
  try {
    const raw = fs.readFileSync(registryPath(), "utf8");
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      return arr.filter(
        (e): e is InstanceEntry =>
          !!e &&
          typeof (e as InstanceEntry).pid === "number" &&
          typeof (e as InstanceEntry).ts === "number",
      );
    }
  } catch {
    /* missing / corrupt → treated as empty */
  }
  return [];
}

function writeRegistry(entries: InstanceEntry[]): void {
  const dir = baseDir();
  const tmp = `${registryPath()}.tmp-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(entries), "utf8");
  fs.renameSync(tmp, registryPath());
}

function updateRegistry(
  mutate: (entries: InstanceEntry[]) => InstanceEntry[],
): void {
  const fd = acquireLock();
  try {
    // Drop dead instances on every mutation so the registry self-heals.
    const live = readRegistry().filter((e) => isAlive(e.pid));
    const next = mutate(live);
    writeRegistry(next);
  } catch (e) {
    log.warn(
      "[instances] Registry update failed:",
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    releaseLock(fd);
  }
}

/**
 * Register this process in the shared instance registry.
 */
export function registerInstance(): void {
  updateRegistry((entries) => {
    const others = entries.filter((e) => e.pid !== process.pid);
    others.push({ pid: process.pid, ts: Date.now() });
    return others;
  });
  log.info("[instances] Registered pid", process.pid);
}

/**
 * Remove this process from the shared instance registry.
 */
export function unregisterInstance(): void {
  updateRegistry((entries) => entries.filter((e) => e.pid !== process.pid));
}

/**
 * Number of *other* live instances currently registered.
 */
export function countOtherInstances(): number {
  return readRegistry().filter((e) => e.pid !== process.pid && isAlive(e.pid))
    .length;
}

/**
 * Broadcast a request for all other instances to quit.
 */
export function requestQuitAll(): void {
  try {
    const payload: QuitSignal = { ts: Date.now(), requester: process.pid };
    const tmp = `${signalPath()}.tmp-${process.pid}`;
    fs.mkdirSync(baseDir(), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
    fs.renameSync(tmp, signalPath());
    log.info("[instances] Requested quit-all (requester", process.pid, ")");
  } catch (e) {
    log.warn(
      "[instances] Failed to write quit-all signal:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function readQuitSignal(): QuitSignal | null {
  try {
    const raw = fs.readFileSync(signalPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<QuitSignal>;
    if (
      parsed &&
      typeof parsed.ts === "number" &&
      typeof parsed.requester === "number"
    ) {
      return parsed as QuitSignal;
    }
  } catch {
    /* no signal */
  }
  return null;
}

/**
 * Start watching for a quit-all request issued by another instance. The
 * callback fires at most once. Returns a disposer that stops the watcher.
 */
export function watchForQuitAll(onQuitRequested: () => void): () => void {
  // Only react to signals issued *after* we started, and never to our own.
  const startedAt = Date.now();
  let fired = false;

  const timer = setInterval(() => {
    if (fired) return;
    const sig = readQuitSignal();
    if (!sig) return;
    if (sig.requester === process.pid) return;
    if (sig.ts < startedAt) return;
    fired = true;
    log.info(
      "[instances] Quit-all received from pid",
      sig.requester,
      "→ quitting",
    );
    try {
      onQuitRequested();
    } catch (e) {
      log.warn(
        "[instances] Quit-all handler threw:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }, POLL_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}

/**
 * Block until this is the only live instance, or until timeout. Returns true if
 * all other instances exited, false on timeout.
 */
export async function waitForOthersToExit(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (countOtherInstances() === 0) return true;
    if (Date.now() - start > timeoutMs) {
      log.warn(
        "[instances] Timed out waiting for other instances to exit; proceeding",
      );
      return false;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
