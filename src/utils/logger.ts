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
        const el = (mod as any)?.default || (mod as any);
        if (el) {
          // Configure transports defensively
          try {
            const env: any = (import.meta as any)?.env || {};
            const lvl = String(env.VITE_LOG_CONSOLE_LEVEL || env.LOG_CONSOLE_LEVEL || 'error');
            if (el.transports?.console) el.transports.console.level = lvl;
            if (el.transports?.remote) el.transports.remote.level = false as any;
            const isDev =
              !!env?.DEV ||
              (typeof process !== 'undefined' && (process as any)?.env?.NODE_ENV === 'development');
            if (el.transports?.file) el.transports.file.level = isDev ? (false as any) : 'silly';
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
