import { LOG_LEVELS } from "../constants/logViewer";

export function compileLevelFilter(
  level?: string | null,
): ReadonlySet<string> | null {
  const selectedLevel = level?.toUpperCase() || "";
  if (!selectedLevel || selectedLevel === "ALL") return null;

  const severity = LOG_LEVELS.findIndex((known) => known === selectedLevel);
  // Custom levels have no severity rank; preserve exact matching.
  return new Set(severity >= 0 ? LOG_LEVELS.slice(severity) : [selectedLevel]);
}
