import type { JSX } from "preact/jsx-runtime";

// Cache für Level-Klassen (statisch, ändert sich nie)
const LEVEL_CLASS_MAP: Record<string, string> = {
  TRACE: "lev-trace",
  DEBUG: "lev-debug",
  INFO: "lev-info",
  WARN: "lev-warn",
  ERROR: "lev-error",
  FATAL: "lev-fatal",
};

export function levelClass(level: string | null | undefined): string {
  const l = (level || "").toUpperCase();
  return LEVEL_CLASS_MAP[l] || "lev-unk";
}

// Cache für Timestamp-Formatierung (begrenzte Größe)
const timestampCache = new Map<string | number, string>();
const MAX_TS_CACHE_SIZE = 1000;

export function fmtTimestamp(
  ts: string | number | Date | null | undefined,
): string {
  if (!ts) return "-";

  // Nur string/number cachen, Date-Objekte nicht
  const cacheKey = typeof ts === "string" || typeof ts === "number" ? ts : null;

  if (cacheKey !== null) {
    const cached = timestampCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    const result = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;

    // Cache das Ergebnis
    if (cacheKey !== null) {
      if (timestampCache.size >= MAX_TS_CACHE_SIZE) {
        // Lösche die ersten 100 Einträge
        const keysToDelete = Array.from(timestampCache.keys()).slice(0, 100);
        for (const key of keysToDelete) {
          timestampCache.delete(key);
        }
      }
      timestampCache.set(cacheKey, result);
    }

    return result;
  } catch {
    return String(ts);
  }
}

// Funktion zum Leeren des Timestamp-Caches (beim Löschen der Logs aufrufen)
export function clearTimestampCache(): void {
  timestampCache.clear();
}

// Cache für computeTint (begrenzte Größe)
const tintCache = new Map<string, string>();
const MAX_TINT_CACHE_SIZE = 50;

export function computeTint(
  color: string | null | undefined,
  alpha = 0.4,
): string {
  if (!color) return "";

  const cacheKey = `${color}|${alpha}`;
  const cached = tintCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const c = String(color).trim();
  const hexRaw = c.startsWith("#") ? c.slice(1) : "";
  const hex = String(hexRaw);
  let result = c;

  if (hex.length === 3 && hex.length >= 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } else if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Cache das Ergebnis
  if (tintCache.size >= MAX_TINT_CACHE_SIZE) {
    const firstKey = tintCache.keys().next().value;
    if (firstKey) tintCache.delete(firstKey);
  }
  tintCache.set(cacheKey, result);

  return result;
}

export function fmt(v: unknown): string {
  if (v == null) return "";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  return "";
}

export function getTs(
  obj: Record<string, unknown>,
  key: string,
): string | number | Date | undefined {
  const v = obj[key];
  if (typeof v === "string" || typeof v === "number") return v;
  if (v && typeof v === "object" && v instanceof Date) return v;
  return undefined;
}

export function getStr(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return fmt(v);
}

export function renderLoggerNameList(raw: unknown): JSX.Element {
  const s = fmt(raw);
  if (!s) return <span />;
  const parts = s.split(".").filter(Boolean);
  if (parts.length <= 1) {
    // Kein Package: nur Klassenname ausgeben
    return (
      <span className="logger-name">
        <span className="logger-cls">{s}</span>
      </span>
    );
  }
  const cls = parts[parts.length - 1]!;
  const pkg = parts.slice(0, -1).join(".") + ".";
  return (
    <span className="logger-name">
      <span className="logger-pkg" title={pkg}>
        ....
      </span>
      <span className="logger-cls" title={cls}>
        {cls}
      </span>
    </span>
  );
}
