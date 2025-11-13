// Unified logger using electron-log everywhere (renderer-safe)
// We start with a console backend and try to upgrade to electron-log dynamically.
interface LogBackend {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

let _backend: LogBackend = {
  // eslint-disable-next-line no-console
  info: (...args: unknown[]) => console.info("[lj]", ...args),
  warn: (...args: unknown[]) => console.warn("[lj]", ...args),
  error: (...args: unknown[]) => console.error("[lj]", ...args),
  // eslint-disable-next-line no-console
  debug: (...args: unknown[]) => console.debug("[lj]", ...args),
};

// Try to dynamically import electron-log/renderer; ignore failures
try {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import("electron-log/renderer.js")
    .then((mod: Record<string, unknown>) => {
      try {
        const el =
          (mod.default as LogBackend | undefined) ||
          (mod as LogBackend | undefined);
        if (el && typeof el === "object" && "error" in el) {
          // Configure transports defensively
          try {
            const env =
              (
                import.meta as Record<
                  string,
                  Record<string, unknown> | undefined
                >
              )?.env || {};
            const lvl = String(
              (env.VITE_LOG_CONSOLE_LEVEL as string | undefined) ||
                (env.LOG_CONSOLE_LEVEL as string | undefined) ||
                "error",
            );
            const transports = el as Record<
              string,
              Record<string, unknown> | undefined
            >;
            if (transports.console && typeof transports.console === "object") {
              const console_ = transports.console as Record<string, unknown>;
              console_.level = lvl;
            }
            if (transports.remote && typeof transports.remote === "object") {
              const remote = transports.remote as Record<string, unknown>;
              remote.level = false;
            }
            const isDev =
              !!env?.DEV ||
              (typeof process !== "undefined" &&
                (process as Record<string, Record<string, string>>)?.env
                  ?.NODE_ENV === "development");
            if (transports.file && typeof transports.file === "object") {
              const file = transports.file as Record<string, unknown>;
              file.level = isDev ? false : "silly";
            }
          } catch (e) {
            console.warn("logger: dynamic configure failed:", e);
          }
          _backend = el;
        }
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
