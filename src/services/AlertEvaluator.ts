/**
 * Alert rule types and evaluation engine.
 *
 * Rules are stored as JSON (one file in userData, analogous to filter-profiles).
 * The evaluator is a pure function so it can run in either process and is unit
 * testable in isolation.
 */

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRule {
  /** Stable id (uuid-like). */
  id: string;
  /** Human-friendly name shown in the UI and notification title. */
  name: string;
  /** Whether the rule actively fires. */
  enabled: boolean;
  /** Severity – influences notification icon + sound. */
  severity: AlertSeverity;
  /** Match by exact log level, e.g. "ERROR". Empty = any level. */
  level?: string;
  /** Substring match against logger name (case-insensitive). */
  loggerSubstring?: string;
  /** Substring match against the message (case-insensitive). */
  messageSubstring?: string;
  /**
   * Minimum milliseconds between two notifications for the same rule
   * (debounce / cooldown). Default 30 000 ms.
   */
  cooldownMs?: number;
  /**
   * If set, fires only when N matching entries arrive within `windowMs`.
   * Default: fires immediately on first match.
   */
  burstCount?: number;
  burstWindowMs?: number;
}

export interface AlertEntryLike {
  level?: string | null;
  logger?: string | null;
  message?: string | null;
  timestamp?: number | string | null;
}

export interface AlertEvent {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  /** First matching entry that triggered this event. */
  triggeringMessage: string;
  triggeringLevel: string;
  triggeringLogger: string;
  /** How many matches contributed (1 or burstCount). */
  matchCount: number;
  /** When the event fired (ms epoch). */
  firedAt: number;
}

/**
 * Stateful evaluator: feed it new entries via `evaluate`, get back fired events.
 * Tracks per-rule cooldowns and burst windows internally.
 */
export class AlertEvaluator {
  private rules: AlertRule[] = [];
  /** ruleId → last fired timestamp (ms). */
  private lastFired = new Map<string, number>();
  /** ruleId → recent match timestamps for burst detection. */
  private recentMatches = new Map<string, number[]>();
  /** Clock injection for tests. */
  private now: () => number;

  constructor(rules: AlertRule[] = [], nowFn: () => number = Date.now) {
    this.rules = rules;
    this.now = nowFn;
  }

  setRules(rules: AlertRule[]): void {
    this.rules = rules;
    // Drop state for removed rules
    const ids = new Set(rules.map((r) => r.id));
    for (const k of Array.from(this.lastFired.keys())) {
      if (!ids.has(k)) this.lastFired.delete(k);
    }
    for (const k of Array.from(this.recentMatches.keys())) {
      if (!ids.has(k)) this.recentMatches.delete(k);
    }
  }

  /**
   * Returns the list of newly-fired alert events (after cooldown / burst checks).
   * Caller is responsible for delivering them (notification, toast, sound).
   */
  evaluate(entries: AlertEntryLike[]): AlertEvent[] {
    if (!entries.length || !this.rules.length) return [];
    const events: AlertEvent[] = [];
    const now = this.now();

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const cooldown = rule.cooldownMs ?? 30_000;
      const lastFired = this.lastFired.get(rule.id) ?? 0;

      for (const entry of entries) {
        if (!ruleMatchesEntry(rule, entry)) continue;

        // Track for burst detection
        if (rule.burstCount && rule.burstCount > 1 && rule.burstWindowMs) {
          const arr = this.recentMatches.get(rule.id) ?? [];
          arr.push(now);
          // Drop expired entries
          const cutoff = now - rule.burstWindowMs;
          while (arr.length && arr[0]! < cutoff) arr.shift();
          this.recentMatches.set(rule.id, arr);
          if (arr.length < rule.burstCount) continue;
        }

        // Cooldown
        if (now - lastFired < cooldown) break;

        events.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          triggeringMessage: String(entry.message ?? ""),
          triggeringLevel: String(entry.level ?? ""),
          triggeringLogger: String(entry.logger ?? ""),
          matchCount:
            rule.burstCount && rule.burstCount > 1 ? rule.burstCount : 1,
          firedAt: now,
        });
        this.lastFired.set(rule.id, now);
        // Reset burst window after firing so we don't fire again immediately
        this.recentMatches.set(rule.id, []);
        break; // only fire once per rule per evaluate-batch
      }
    }
    return events;
  }
}

export function ruleMatchesEntry(
  rule: AlertRule,
  entry: AlertEntryLike,
): boolean {
  if (rule.level && rule.level.length > 0) {
    if (String(entry.level ?? "").toUpperCase() !== rule.level.toUpperCase()) {
      return false;
    }
  }
  if (rule.loggerSubstring && rule.loggerSubstring.length > 0) {
    if (
      !String(entry.logger ?? "")
        .toLowerCase()
        .includes(rule.loggerSubstring.toLowerCase())
    ) {
      return false;
    }
  }
  if (rule.messageSubstring && rule.messageSubstring.length > 0) {
    if (
      !String(entry.message ?? "")
        .toLowerCase()
        .includes(rule.messageSubstring.toLowerCase())
    ) {
      return false;
    }
  }
  return true;
}

/** Stable id generator (no external deps). */
export function newAlertRuleId(): string {
  return (
    "ar-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}
