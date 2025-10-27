// Unified logger using electron-log everywhere (renderer-safe)
// We start with a console backend and try to upgrade to electron-log dynamically.
let _backend: any = {
  // eslint-disable-next-line no-console
  info: (...args: any[]) => console.info('[lj]', ...args),
  warn: (...args: any[]) => console.warn('[lj]', ...args),
  error: (...args: any[]) => console.error('[lj]', ...args),
  // eslint-disable-next-line no-console
  debug: (...args: any[]) => console.debug('[lj]', ...args),
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
            if (el.transports?.file) el.transports.file.level = isDev ? (false as any) : 'info';
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
  info: (...args: any[]) => _backend.info(...args),
  warn: (...args: any[]) => _backend.warn(...args),
  error: (...args: any[]) => _backend.error(...args),
  debug: (...args: any[]) => _backend.debug(...args),
  log: (...args: any[]) => _backend.info(...args),
};

export default logger;
