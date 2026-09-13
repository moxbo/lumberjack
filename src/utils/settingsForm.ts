import type { Settings } from "../types/ipc";
import type { SettingsFormState, ThemeMode } from "../types/renderer";

const MB = 1024 * 1024;
const numberOr = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : fallback;
};
const theme = (value: unknown): ThemeMode =>
  value === "light" || value === "dark" ? value : "system";
const heapSize = (value: unknown): number =>
  Math.max(512, Math.min(8192, numberOr(value, 4096)));

export function normalizeSettingsForm(
  settings: Partial<Settings>,
): SettingsFormState {
  return {
    tcpPort: numberOr(settings.tcpPort, 5000),
    httpUrl: settings.httpUrl ?? "",
    httpInterval: numberOr(settings.httpPollInterval, 5000),
    logToFile: !!settings.logToFile,
    logFilePath: settings.logFilePath ?? "",
    logMaxMB: Math.max(
      1,
      Math.round(numberOr(settings.logMaxBytes, 5 * MB) / MB),
    ),
    logMaxBackups: Math.max(
      0,
      Number.isFinite(settings.logMaxBackups) ? settings.logMaxBackups! : 3,
    ),
    themeMode: theme(settings.themeMode),
    elasticUrl: settings.elasticUrl ?? "",
    elasticSize: Math.max(1, numberOr(settings.elasticSize, 1000)),
    elasticUser: settings.elasticUser ?? "",
    elasticPassNew: "",
    elasticPassClear: false,
    elasticMaxParallel: Math.max(1, numberOr(settings.elasticMaxParallel, 1)),
    allowPrerelease: !!settings.allowPrerelease,
    heapSizeMB: heapSize(settings.heapSizeMB),
  };
}

export function settingsFormPatch(
  form: SettingsFormState,
  elasticMaxParallel = 1,
): Partial<Settings> | null {
  const port = Number(form.tcpPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const patch: Partial<Settings> = {
    tcpPort: port,
    httpUrl: form.httpUrl.trim(),
    httpPollInterval: Math.max(1, numberOr(form.httpInterval, 5)),
    logToFile: form.logToFile,
    logFilePath: form.logFilePath.trim(),
    logMaxBytes: Math.round(Math.max(1, numberOr(form.logMaxMB, 5)) * MB),
    logMaxBackups: Math.max(0, numberOr(form.logMaxBackups, 0)),
    themeMode: theme(form.themeMode),
    elasticUrl: form.elasticUrl.trim(),
    elasticSize: Math.max(1, numberOr(form.elasticSize, 1000)),
    elasticUser: form.elasticUser.trim(),
    elasticMaxParallel: Math.max(
      1,
      numberOr(form.elasticMaxParallel, elasticMaxParallel),
    ),
    allowPrerelease: form.allowPrerelease,
    heapSizeMB: heapSize(form.heapSizeMB),
  };
  if (form.elasticPassClear) patch.elasticPassClear = true;
  else if (form.elasticPassNew.trim())
    patch.elasticPassPlain = form.elasticPassNew.trim();
  return patch;
}
