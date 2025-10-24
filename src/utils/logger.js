// Lightweight logger wrapper: route logs to electron-log in production, keep console in development
import electronLog from 'electron-log';

function detectDev() {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') return true;
  } catch {}
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) return true;
  } catch {}
  try {
    // Vite dev server indicator sometimes passed via env
    if (typeof process !== 'undefined' && process.env && process.env.VITE_DEV_SERVER_URL) return true;
  } catch {}
  return false;
}

const isDev = detectDev();

const logger = {
  info: (...args) => {
    if (isDev) console.info(...args);
    else electronLog.info(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
    else electronLog.warn(...args);
  },
  error: (...args) => {
    if (isDev) console.error(...args);
    else electronLog.error(...args);
  },
  debug: (...args) => {
    if (isDev) console.debug(...args);
    else electronLog.debug(...args);
  },
  log: (...args) => {
    if (isDev) console.log(...args);
    else electronLog.info(...args);
  },
};

export default logger;

