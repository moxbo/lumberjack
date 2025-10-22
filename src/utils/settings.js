/**
 * Settings validation and schema utilities
 * Provides type-safe settings validation and migration
 */

/**
 * Constants for validation bounds
 */
const MIN_USER_PORT = 1024; // Ports below 1024 are reserved for system services
const MAX_PORT = 65535;
const MAX_LOG_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

/**
 * Default settings schema with types and validators
 */
export const SETTINGS_SCHEMA = {
  // Window settings
  windowBounds: {
    type: 'object',
    default: { width: 1200, height: 800 },
    validate: (val) => {
      if (typeof val !== 'object' || val === null) return false;
      const { width, height } = val;
      return (
        typeof width === 'number' &&
        typeof height === 'number' &&
        width >= 400 &&
        width <= 4096 &&
        height >= 300 &&
        height <= 2160
      );
    },
  },

  // Network settings
  tcpPort: {
    type: 'number',
    default: 5000,
    validate: (val) => Number.isInteger(val) && val >= MIN_USER_PORT && val <= MAX_PORT,
  },

  httpUrl: {
    type: 'string',
    default: '',
    validate: (val) => typeof val === 'string' && val.length <= 2048,
  },

  httpInterval: {
    type: 'number',
    default: 5000,
    validate: (val) => Number.isInteger(val) && val >= 500 && val <= 300000,
  },

  // UI settings
  detailHeight: {
    type: 'number',
    default: 300,
    validate: (val) => typeof val === 'number' && val >= 150 && val <= 2000,
  },

  colTs: {
    type: 'number',
    default: 220,
    validate: (val) => typeof val === 'number' && val >= 100 && val <= 600,
  },

  colLvl: {
    type: 'number',
    default: 90,
    validate: (val) => typeof val === 'number' && val >= 50 && val <= 200,
  },

  colLogger: {
    type: 'number',
    default: 280,
    validate: (val) => typeof val === 'number' && val >= 100 && val <= 800,
  },

  // History
  histLogger: {
    type: 'array',
    default: [],
    validate: (val) =>
      Array.isArray(val) &&
      val.length <= 10 &&
      val.every((item) => typeof item === 'string' && item.length <= 256),
  },

  histTrace: {
    type: 'array',
    default: [],
    validate: (val) =>
      Array.isArray(val) &&
      val.length <= 10 &&
      val.every((item) => typeof item === 'string' && item.length <= 256),
  },

  // Logging settings
  logToFile: {
    type: 'boolean',
    default: false,
    validate: (val) => typeof val === 'boolean',
  },

  logFilePath: {
    type: 'string',
    default: '',
    validate: (val) => typeof val === 'string' && val.length <= 4096,
  },

  logMaxBytes: {
    type: 'number',
    default: 5 * 1024 * 1024,
    validate: (val) => Number.isInteger(val) && val >= 1024 && val <= MAX_LOG_SIZE_BYTES,
  },

  logMaxBackups: {
    type: 'number',
    default: 3,
    validate: (val) => Number.isInteger(val) && val >= 0 && val <= 99,
  },
};

/**
 * Current settings version for migration
 */
export const SETTINGS_VERSION = 1;

/**
 * Validates a single setting value against its schema
 * @param {string} key - Setting key
 * @param {*} value - Value to validate
 * @returns {{ valid: boolean, value: *, error?: string }}
 */
export function validateSetting(key, value) {
  const schema = SETTINGS_SCHEMA[key];

  if (!schema) {
    return { valid: false, value: null, error: `Unknown setting: ${key}` };
  }

  // Null/undefined check
  if (value === null || value === undefined) {
    return { valid: true, value: schema.default };
  }

  // Type check
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (actualType !== schema.type) {
    return {
      valid: false,
      value: schema.default,
      error: `Invalid type for ${key}: expected ${schema.type}, got ${actualType}`,
    };
  }

  // Custom validation
  if (schema.validate && !schema.validate(value)) {
    return {
      valid: false,
      value: schema.default,
      error: `Validation failed for ${key}`,
    };
  }

  return { valid: true, value };
}

/**
 * Validates and sanitizes a settings object
 * @param {Object} settings - Raw settings object
 * @returns {{ settings: Object, errors: string[] }}
 */
export function validateSettings(settings) {
  const validated = {};
  const errors = [];

  // Validate each known setting
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    const result = validateSetting(key, settings?.[key]);
    validated[key] = result.value;

    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return { settings: validated, errors };
}

/**
 * Merges partial settings with defaults, validating each value
 * @param {Object} partialSettings - Partial settings to merge
 * @param {Object} defaults - Default settings (optional)
 * @returns {Object}
 */
export function mergeSettings(partialSettings, defaults = null) {
  const base = defaults || getDefaultSettings();
  const result = { ...base };

  if (!partialSettings || typeof partialSettings !== 'object') {
    return result;
  }

  for (const [key, value] of Object.entries(partialSettings)) {
    if (key in SETTINGS_SCHEMA) {
      const validation = validateSetting(key, value);
      result[key] = validation.value;
    }
  }

  return result;
}

/**
 * Gets default settings for all schema entries
 * @returns {Object}
 */
export function getDefaultSettings() {
  const defaults = {};
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    defaults[key] = schema.default;
  }
  return defaults;
}

/**
 * Migrates settings from an older version
 * @param {Object} settings - Settings to migrate
 * @param {number} fromVersion - Current version of settings
 * @returns {Object}
 */
export function migrateSettings(settings, fromVersion) {
  let migrated = { ...settings };

  // Migration from version 0 (no version) to version 1
  if (fromVersion < 1) {
    // Add any new fields with defaults
    const defaults = getDefaultSettings();
    for (const key of Object.keys(defaults)) {
      if (!(key in migrated)) {
        migrated[key] = defaults[key];
      }
    }
  }

  // Add future migrations here as needed
  // if (fromVersion < 2) { ... }

  return migrated;
}

/**
 * Safely parses settings JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @returns {{ success: boolean, settings?: Object, error?: string }}
 */
export function parseSettingsJSON(jsonString) {
  try {
    if (!jsonString || typeof jsonString !== 'string') {
      return { success: false, error: 'Invalid input: not a string' };
    }

    const parsed = JSON.parse(jsonString);

    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'Invalid JSON: not an object' };
    }

    // Check version and migrate if needed
    const version = typeof parsed._version === 'number' ? parsed._version : 0;
    let settings = version < SETTINGS_VERSION ? migrateSettings(parsed, version) : parsed;

    // Validate and sanitize
    const { settings: validated, errors } = validateSettings(settings);

    if (errors.length > 0) {
      console.warn('Settings validation warnings:', errors);
    }

    // Add current version
    validated._version = SETTINGS_VERSION;

    return { success: true, settings: validated };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err.message}`,
    };
  }
}

/**
 * Safely stringifies settings to JSON
 * @param {Object} settings - Settings to stringify
 * @returns {{ success: boolean, json?: string, error?: string }}
 */
export function stringifySettingsJSON(settings) {
  try {
    if (typeof settings !== 'object' || settings === null) {
      return { success: false, error: 'Invalid settings: not an object' };
    }

    // Validate before stringifying
    const { settings: validated } = validateSettings(settings);

    // Add version marker
    validated._version = SETTINGS_VERSION;

    const json = JSON.stringify(validated, null, 2);
    return { success: true, json };
  } catch (err) {
    return {
      success: false,
      error: `JSON stringify error: ${err.message}`,
    };
  }
}
