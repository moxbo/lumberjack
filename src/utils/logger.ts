// Unified logger using electron-log everywhere (renderer-safe)
// We start with a console backend and try to upgrade to electron-log dynamically.
interface LogBackend {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

let _backend: LogBackend = {
  info: (...args: unknown[]) => console.info("[lj]", ...args),
  warn: (...args: unknown[]) => console.warn("[lj]", ...args),
  error: (...args: unknown[]) => console.error("[lj]", ...args),
  debug: (...args: unknown[]) => console.debug("[lj]", ...args),
};

function configureTransports(el: LogBackend): void {
  const meta = import.meta as unknown as Record<string, unknown>;
  const env = (meta?.env as Record<string, unknown>) || {};
  const lvl = String(
    (env.VITE_LOG_CONSOLE_LEVEL as string | undefined) ||
      (env.LOG_CONSOLE_LEVEL as string | undefined) ||
      "error",
  );
  const transports = el as unknown as Record<string, unknown>;

  if (transports.console && typeof transports.console === "object") {
    (transports.console as Record<string, unknown>).level = lvl;
  }
  if (transports.remote && typeof transports.remote === "object") {
    (transports.remote as Record<string, unknown>).level = false;
  }

  const procObj =
    typeof process !== "undefined"
      ? (process as unknown as Record<string, unknown>)
      : {};
  const procEnv = (procObj?.env as Record<string, string>) || {};
  const isDev = !!env?.DEV || procEnv?.NODE_ENV === "development";

  if (transports.file && typeof transports.file === "object") {
    (transports.file as Record<string, unknown>).level = isDev
      ? false
      : "silly";
  }
}

function adoptBackend(mod: unknown): void {
  const modObj = mod as Record<string, unknown>;
  const el =
    (modObj.default as LogBackend | undefined) ||
    (modObj as unknown as LogBackend | undefined);

  if (!el || typeof el !== "object" || !("error" in el)) return;

  try {
    configureTransports(el);
  } catch (e) {
    console.warn("logger: dynamic configure failed:", e);
  }
  _backend = el;
}

// Try to dynamically import electron-log/renderer; ignore failures
try {
  import("electron-log/renderer.js")
    .then((mod: unknown) => {
      try {
        adoptBackend(mod);
      } catch (e) {
        console.warn("logger: adopting electron-log backend failed:", e);
      }
    })
    .catch((e: unknown) => {
      console.warn(
        "logger: dynamic import of electron-log/renderer failed:",
        e,
      );
    });
} catch (e) {
  console.warn("logger: import setup threw:", e);
}

const logger = {
  info: (...args: unknown[]): void => _backend.info(...args),
  warn: (...args: unknown[]): void => _backend.warn(...args),
  error: (...args: unknown[]): void => _backend.error(...args),
  debug: (...args: unknown[]): void => _backend.debug(...args),
  log: (...args: unknown[]): void => _backend.info(...args),
};

export default logger;
