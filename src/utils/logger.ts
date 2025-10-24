// Unified logger using electron-log everywhere
import electronLog from 'electron-log';

// Configure electron-log
electronLog.transports.console.level = 'debug';
electronLog.transports.file.level = 'info';

const logger = {
  info: (...args: any[]) => electronLog.info(...args),
  warn: (...args: any[]) => electronLog.warn(...args),
  error: (...args: any[]) => electronLog.error(...args),
  debug: (...args: any[]) => electronLog.debug(...args),
  log: (...args: any[]) => electronLog.info(...args),
};

export default logger;

