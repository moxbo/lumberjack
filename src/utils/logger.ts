// Unified logger using electron-log everywhere
import electronLog from 'electron-log/renderer.js';

// Detect development mode
function isDevelopment() {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development')
      return true;
  } catch {}
  try {
    if (
      typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.DEV
    )
      return true;
  } catch {}
  return false;
}

const isDev = isDevelopment();

// Helper: resolve desired console level (allow override via env)
function resolveConsoleLevel(): any {
  try {
    const env = (import.meta as any)?.env || {};
    const lvl = (env.VITE_LOG_CONSOLE_LEVEL || env.LOG_CONSOLE_LEVEL || '').toString().trim();
    if (lvl) return lvl; // e.g. 'debug' | 'info' | 'warn' | 'error' | false
  } catch {}
  try {
    const lvl = (process as any)?.env?.LOG_CONSOLE_LEVEL;
    if (lvl) return String(lvl);
  } catch {}
  // Default: keep console quiet to avoid spam in Electron main logs
  // 'error' will suppress warn/info/debug in console while still keeping file transport (prod)
  return 'error';
}

const desiredConsoleLevel = resolveConsoleLevel();

// Configure electron-log based on environment (defensive: transports may be missing in some contexts)
try {
  const tConsole = (electronLog as any)?.transports?.console;
  if (tConsole && typeof tConsole === 'object') {
    tConsole.level = desiredConsoleLevel;
  }
} catch {}

// Disable remote transport to avoid warnings if main isn't ready or remote is not desired
try {
  const tRemote = (electronLog as any)?.transports?.remote;
  if (tRemote && typeof tRemote === 'object') {
    tRemote.level = false as any;
  }
} catch {}

try {
  const tFile = (electronLog as any)?.transports?.file;
  if (tFile && typeof tFile === 'object') {
    // In development, disable file logging; in production, enable it
    tFile.level = isDev ? (false as any) : 'info';
  }
} catch {}

const logger = {
  info: (...args: any[]) => (electronLog as any).info(...args),
  warn: (...args: any[]) => (electronLog as any).warn(...args),
  error: (...args: any[]) => (electronLog as any).error(...args),
  debug: (...args: any[]) => (electronLog as any).debug(...args),
  log: (...args: any[]) => (electronLog as any).info(...args),
};

export default logger;
