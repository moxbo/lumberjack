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
  info: (...args: unknown[]) => console.info('[lj]', ...args),
  warn: (...args: unknown[]) => console.warn('[lj]', ...args),
  error: (...args: unknown[]) => console.error('[lj]', ...args),
  // eslint-disable-next-line no-console
  debug: (...args: unknown[]) => console.debug('[lj]', ...args),
};

// Try to dynamically import electron-log/renderer; ignore failures
try {
  import('electron-log/renderer.js')
    .then((mod) => {
      try {
        const el = (mod as { default?: LogBackend }).default || (mod as LogBackend);
        if (el) {
          // Configure transports defensively
          try {
            // Type guard for import.meta.env
            const env = (import.meta as { env?: Record<string, unknown> }).env || {};
            const viteLevel = env.VITE_LOG_CONSOLE_LEVEL;
            const logLevel = env.LOG_CONSOLE_LEVEL;
            const lvl =
              typeof viteLevel === 'string' || typeof viteLevel === 'number'
                ? String(viteLevel)
                : typeof logLevel === 'string' || typeof logLevel === 'number'
                  ? String(logLevel)
                  : 'error';
            // Type guard for electron-log object with transports
            const elWithTransports = el as {
              transports?: {
                console?: { level?: string | boolean };
                remote?: { level?: string | boolean };
                file?: { level?: string | boolean };
              };
            };
            if (elWithTransports.transports?.console) {
              elWithTransports.transports.console.level = lvl;
            }
            if (elWithTransports.transports?.remote) {
              elWithTransports.transports.remote.level = false;
            }
            const isDev =
              !!env?.DEV ||
              (typeof process !== 'undefined' &&
                (process as { env?: { NODE_ENV?: string } })?.env?.NODE_ENV === 'development');
            if (elWithTransports.transports?.file) {
              elWithTransports.transports.file.level = isDev ? false : 'info';
            }
          } catch (e) {
            console.warn('logger: dynamic configure failed:', e);
          }
          _backend = el;
        }
      } catch (e) {
        console.warn('logger: adopting electron-log backend failed:', e);
      }
    })
    .catch((e) => {
      console.warn('logger: dynamic import of electron-log/renderer failed:', e);
    });
} catch (e) {
  console.warn('logger: import setup threw:', e);
}

const logger = {
  info: (...args: unknown[]): void => _backend.info(...args),
  warn: (...args: unknown[]): void => _backend.warn(...args),
  error: (...args: unknown[]): void => _backend.error(...args),
  debug: (...args: unknown[]): void => _backend.debug(...args),
  log: (...args: unknown[]): void => _backend.info(...args),
};

export default logger;
