/**
 * Pure analytics helpers for log entries.
 * Used by StatsDialog – kept side-effect-free so it can be unit tested.
 */

export interface AnalyticsEntry {
  level?: string | null;
  logger?: string | null;
  timestamp?: number | string | null;
}

export interface LevelHistogram {
  level: string;
  count: number;
  /** 0..1 share of total. */
  share: number;
}

export interface LoggerStat {
  logger: string;
  count: number;
}

export interface TimeBucket {
  /** Bucket start (ms epoch). */
  startMs: number;
  count: number;
}

export const KNOWN_LEVELS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
];

export function levelHistogram(entries: AnalyticsEntry[]): LevelHistogram[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const lvl = String(e?.level ?? "").toUpperCase() || "UNKNOWN";
    counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
  }
  const total = entries.length || 1;
  // Stable order: KNOWN_LEVELS first, then any custom levels alphabetically.
  const ordered: string[] = [];
  for (const l of KNOWN_LEVELS) if (counts.has(l)) ordered.push(l);
  const extra = Array.from(counts.keys())
    .filter((l) => !KNOWN_LEVELS.includes(l))
    .sort();
  ordered.push(...extra);
  return ordered.map((level) => ({
    level,
    count: counts.get(level) ?? 0,
    share: (counts.get(level) ?? 0) / total,
  }));
}

export function topLoggers(
  entries: AnalyticsEntry[],
  limit = 10,
): LoggerStat[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const lg = String(e?.logger ?? "");
    if (!lg) continue;
    counts.set(lg, (counts.get(lg) ?? 0) + 1);
  }
  const arr: LoggerStat[] = [];
  for (const [logger, count] of counts) arr.push({ logger, count });
  arr.sort((a, b) => b.count - a.count || a.logger.localeCompare(b.logger));
  return arr.slice(0, limit);
}

function toMs(ts: unknown): number | null {
  if (ts == null) return null;
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : null;
  if (typeof ts === "string") {
    const n = Date.parse(ts);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Bucketize entries by timestamp. Picks a sensible bucket size based on
 * the total span, snapped to common granularities (1s, 10s, 1m, 5m, 1h).
 */
export function timeBuckets(
  entries: AnalyticsEntry[],
  targetBuckets = 30,
): TimeBucket[] {
  if (entries.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  const ts: number[] = [];
  for (const e of entries) {
    const m = toMs(e?.timestamp);
    if (m == null) continue;
    ts.push(m);
    if (m < min) min = m;
    if (m > max) max = m;
  }
  if (ts.length === 0 || !Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }
  const span = Math.max(1, max - min);
  const rawSize = span / targetBuckets;
  const candidates = [
    1_000,
    10_000,
    30_000,
    60_000,
    5 * 60_000,
    15 * 60_000,
    60 * 60_000,
    6 * 60 * 60_000,
    24 * 60 * 60_000,
  ];
  let size = candidates[0]!;
  for (const c of candidates) {
    if (c >= rawSize) {
      size = c;
      break;
    }
    size = c;
  }
  const buckets = new Map<number, number>();
  for (const m of ts) {
    const key = Math.floor((m - min) / size) * size + min;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const out: TimeBucket[] = [];
  for (const [startMs, count] of buckets) out.push({ startMs, count });
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

export interface AnalyticsSummary {
  total: number;
  uniqueLoggers: number;
  errorCount: number;
  warnCount: number;
  /** Earliest / latest timestamps in entries (or null if no parseable ts). */
  startMs: number | null;
  endMs: number | null;
}

export function summarise(entries: AnalyticsEntry[]): AnalyticsSummary {
  const loggers = new Set<string>();
  let err = 0;
  let warn = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const e of entries) {
    const lg = String(e?.logger ?? "");
    if (lg) loggers.add(lg);
    const lvl = String(e?.level ?? "").toUpperCase();
    if (lvl === "ERROR" || lvl === "FATAL") err++;
    else if (lvl === "WARN" || lvl === "WARNING") warn++;
    const m = toMs(e?.timestamp);
    if (m != null) {
      if (m < min) min = m;
      if (m > max) max = m;
    }
  }
  return {
    total: entries.length,
    uniqueLoggers: loggers.size,
    errorCount: err,
    warnCount: warn,
    startMs: Number.isFinite(min) ? min : null,
    endMs: Number.isFinite(max) ? max : null,
  };
}
