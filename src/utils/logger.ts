// Unified logger using electron-log everywhere
import electronLog from 'electron-log';

// Detect development mode
function isDevelopment() {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') return true;
  } catch {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) return true;
  } catch {}
  return false;
}

const isDev = isDevelopment();

// Configure electron-log based on environment
electronLog.transports.console.level = 'debug';
// In development, disable file logging; in production, enable it
electronLog.transports.file.level = isDev ? false : 'info';

const logger = {
  info: (...args: any[]) => electronLog.info(...args),
  warn: (...args: any[]) => electronLog.warn(...args),
  error: (...args: any[]) => electronLog.error(...args),
  debug: (...args: any[]) => electronLog.debug(...args),
  log: (...args: any[]) => electronLog.info(...args),
};

export default logger;

