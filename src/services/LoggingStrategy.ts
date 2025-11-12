/**
 * LoggingStrategy
 * Flexible logging control with categories and levels
 * Allows fine-grained control over logging verbosity
 */

import log from "electron-log/main";

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
}

/**
 * LoggingStrategy provides flexible logging control
 */
export class LoggingStrategy {
  private level: LogLevel = LogLevel.INFO;
  private categories = new Map<string, LogLevel>();

  /**
   * Set global log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
    log.info("[logging] Global level set to", LogLevel[level]);
  }

  /**
   * Set level for specific category
   */
  setCategoryLevel(category: string, level: LogLevel): void {
    this.categories.set(category, level);
    log.info(`[logging] Category '${category}' level set to ${LogLevel[level]}`);
  }

  /**
   * Check if message should be logged
   */
  shouldLog(category: string, level: LogLevel): boolean {
    const categoryLevel = this.categories.get(category) ?? this.level;
    return level >= categoryLevel;
  }

  /**
   * Log with category and level
   */
  logMessage(
    category: string,
    level: LogLevel,
    message: string,
    data?: any,
  ): void {
    if (!this.shouldLog(category, level)) return;

    const logFn =
      level >= LogLevel.ERROR
        ? log.error
        : level >= LogLevel.WARN
          ? log.warn
          : level >= LogLevel.DEBUG
            ? log.debug
            : log.info;

    if (data !== undefined) {
      logFn(`[${category}] ${message}`, data);
    } else {
      logFn(`[${category}] ${message}`);
    }
  }

  /**
   * Get current global level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Get level for specific category
   */
  getCategoryLevel(category: string): LogLevel {
    return this.categories.get(category) ?? this.level;
  }

  /**
   * Reset all category-specific levels
   */
  resetCategories(): void {
    this.categories.clear();
    log.info("[logging] All category levels reset");
  }

  /**
   * Get all configured categories
   */
  getCategories(): Map<string, LogLevel> {
    return new Map(this.categories);
  }
}
