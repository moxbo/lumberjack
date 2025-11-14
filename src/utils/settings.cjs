"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var settings_exports = {};
__export(settings_exports, {
  SETTINGS_SCHEMA: () => SETTINGS_SCHEMA,
  SETTINGS_VERSION: () => SETTINGS_VERSION,
  getDefaultSettings: () => getDefaultSettings,
  mergeSettings: () => mergeSettings,
  migrateSettings: () => migrateSettings,
  parseSettingsJSON: () => parseSettingsJSON,
  stringifySettingsJSON: () => stringifySettingsJSON,
  validateSetting: () => validateSetting,
  validateSettings: () => validateSettings
});
module.exports = __toCommonJS(settings_exports);
const MIN_USER_PORT = 1024;
const MAX_PORT = 65535;
const MAX_LOG_SIZE_BYTES = 1024 * 1024 * 1024;
const SETTINGS_SCHEMA = {
  // Window settings
  windowBounds: {
    type: "object",
    default: { width: 1200, height: 800 },
    validate: (val) => {
      if (typeof val !== "object" || val === null) return false;
      const { width, height } = val;
      return width >= 400 && width <= 4096 && height >= 300 && height <= 2160;
    }
  },
  // Network settings
  tcpPort: {
    type: "number",
    default: 5e3,
    validate: (val) => Number.isInteger(val) && val >= MIN_USER_PORT && val <= MAX_PORT
  },
  httpUrl: {
    type: "string",
    default: "",
    validate: (val) => val.length <= 2048
  },
  httpInterval: {
    type: "number",
    default: 5e3,
    validate: (val) => Number.isInteger(val) && val >= 500 && val <= 3e5
  },
  // UI settings
  detailHeight: {
    type: "number",
    default: 300,
    validate: (val) => val >= 150 && val <= 2e3
  },
  colTs: {
    type: "number",
    default: 220,
    validate: (val) => val >= 100 && val <= 600
  },
  colLvl: {
    type: "number",
    default: 90,
    validate: (val) => val >= 50 && val <= 200
  },
  colLogger: {
    type: "number",
    default: 280,
    validate: (val) => val >= 100 && val <= 800
  },
  // NEW: theme mode (persisted user choice)
  themeMode: {
    type: "string",
    default: "system",
    validate: (val) => ["system", "light", "dark"].includes(val)
  },
  // NEW: follow flags (persisted UI behaviour)
  follow: {
    type: "boolean",
    default: false,
    validate: (val) => typeof val === "boolean"
  },
  followSmooth: {
    type: "boolean",
    default: false,
    validate: (val) => typeof val === "boolean"
  },
  // History
  histLogger: {
    type: "array",
    default: [],
    validate: (val) => Array.isArray(val) && val.length <= 10 && val.every((item) => item.length <= 256)
  },
  // NEW: ElasticSearch histories for dropdowns
  histAppName: {
    type: "array",
    default: [],
    validate: (val) => Array.isArray(val) && val.length <= 10 && val.every((item) => item.length <= 256)
  },
  histEnvironment: {
    type: "array",
    default: [],
    validate: (val) => Array.isArray(val) && val.length <= 10 && val.every((item) => item.length <= 256)
  },
  histTrace: {
    type: "array",
    default: [],
    validate: (val) => Array.isArray(val) && val.length <= 10 && val.every((item) => item.length <= 256)
  },
  // Logging settings
  logToFile: {
    type: "boolean",
    default: false,
    // accept both true and false as valid booleans
    validate: (val) => typeof val === "boolean"
  },
  logFilePath: {
    type: "string",
    default: "",
    validate: (val) => val.length <= 4096
  },
  logMaxBytes: {
    type: "number",
    default: 5 * 1024 * 1024,
    validate: (val) => Number.isInteger(val) && val >= 1024 && val <= MAX_LOG_SIZE_BYTES
  },
  logMaxBackups: {
    type: "number",
    default: 3,
    validate: (val) => Number.isInteger(val) && val >= 0 && val <= 99
  },
  // Elasticsearch settings
  elasticUrl: {
    type: "string",
    default: "",
    validate: (val) => val.length <= 2048
  },
  elasticSize: {
    type: "number",
    default: 1e3,
    validate: (val) => Number.isInteger(val) && val >= 1 && val <= 1e4
  },
  elasticUser: {
    type: "string",
    default: "",
    validate: (val) => val.length <= 256
  },
  elasticPassEnc: {
    type: "string",
    default: "",
    validate: (val) => val.length <= 8192
  }
};
const SETTINGS_VERSION = 1;
function validateSetting(key, value) {
  const schema = SETTINGS_SCHEMA[key];
  if (!schema) {
    return { valid: false, value: null, error: `Unknown setting: ${key}` };
  }
  if (value === null || value === void 0) {
    return { valid: true, value: schema.default };
  }
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (actualType !== schema.type) {
    return {
      valid: false,
      value: schema.default,
      error: `Invalid type for ${key}: expected ${schema.type}, got ${actualType}`
    };
  }
  if (schema.validate && !schema.validate(value)) {
    return {
      valid: false,
      value: schema.default,
      error: `Validation failed for ${key}`
    };
  }
  return { valid: true, value };
}
function validateSettings(settings) {
  const validated = {};
  const errors = [];
  for (const key of Object.keys(SETTINGS_SCHEMA)) {
    const result = validateSetting(key, settings?.[key]);
    validated[key] = result.value;
    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }
  return { settings: validated, errors };
}
function mergeSettings(partialSettings, defaults = null) {
  const base = defaults || getDefaultSettings();
  const result = { ...base };
  if (!partialSettings || typeof partialSettings !== "object") {
    return result;
  }
  for (const [key, value] of Object.entries(partialSettings)) {
    if (key in SETTINGS_SCHEMA) {
      if (value === void 0 || value === null) continue;
      const validation = validateSetting(key, value);
      result[key] = validation.value;
    }
  }
  return result;
}
function getDefaultSettings() {
  const defaults = {};
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    const schemaObj = schema;
    defaults[key] = schemaObj.default;
  }
  return defaults;
}
function migrateSettings(settings, fromVersion) {
  const migrated = { ...settings };
  if (fromVersion < 1) {
    const defaults = getDefaultSettings();
    for (const key of Object.keys(defaults)) {
      if (!(key in migrated)) {
        migrated[key] = defaults[key];
      }
    }
  }
  return migrated;
}
function parseSettingsJSON(jsonString) {
  try {
    if (!jsonString) {
      return { success: false, error: "Invalid input: not a string" };
    }
    const parsed = JSON.parse(jsonString);
    if (typeof parsed !== "object" || parsed === null) {
      return { success: false, error: "Invalid JSON: not an object" };
    }
    const parsedObj = parsed;
    const version = typeof parsedObj._version === "number" ? parsedObj._version : 0;
    const settings = version < SETTINGS_VERSION ? migrateSettings(parsedObj, version) : parsedObj;
    const { settings: validated, errors } = validateSettings(
      settings
    );
    if (errors.length > 0) {
      console.warn("Settings validation warnings:", errors);
    }
    validated._version = SETTINGS_VERSION;
    return { success: true, settings: validated };
  } catch (err) {
    return {
      success: false,
      error: `JSON parse error: ${err?.message || String(err)}`
    };
  }
}
function stringifySettingsJSON(settings) {
  try {
    if (typeof settings !== "object" || settings === null) {
      return { success: false, error: "Invalid settings: not an object" };
    }
    const { settings: validated } = validateSettings(settings);
    validated._version = SETTINGS_VERSION;
    const json = JSON.stringify(validated, null, 2);
    return { success: true, json };
  } catch (err) {
    return {
      success: false,
      error: `JSON stringify error: ${err?.message || String(err)}`
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SETTINGS_SCHEMA,
  SETTINGS_VERSION,
  getDefaultSettings,
  mergeSettings,
  migrateSettings,
  parseSettingsJSON,
  stringifySettingsJSON,
  validateSetting,
  validateSettings
});
