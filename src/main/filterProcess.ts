/**
 * Filter Utility Process
 *
 * Electron 40+ UtilityProcess für CPU-intensive Filter-Operationen.
 * Läuft in einem separaten Prozess für bessere Performance und Memory-Isolation.
 *
 * Vorteile gegenüber Web Workers:
 * - Eigener V8-Isolate (bessere Memory-Isolation)
 * - Kann Node.js APIs nutzen
 * - Kein Blob-URL-Workaround nötig
 * - Bessere Performance bei großen Datensätzen
 */

import { parentPort } from "node:worker_threads";

// ============================================================================
// Types
// ============================================================================

interface FilterOptions {
  stdFiltersEnabled: boolean;
  filter: {
    level: string;
    logger: string;
    thread: string;
    message: string;
  };
  onlyMarked: boolean;
  dcFilterEnabled: boolean;
  dcFilterEntries: Array<{ key: string; value: string; active: boolean }>;
  timeFilterEnabled: boolean;
  timeFilterFrom?: string;
  timeFilterTo?: string;
}

interface FilterRequest {
  type: "filter";
  requestId: number;
  entries: LogEntry[];
  options: FilterOptions;
}

interface FilterResponse {
  type: "result";
  requestId: number;
  filteredIndices: number[];
  stats: FilterStats;
}

interface FilterStats {
  total: number;
  passed: number;
  rejectedByOnlyMarked: number;
  rejectedByLevel: number;
  rejectedByLogger: number;
  rejectedByThread: number;
  rejectedByMessage: number;
  rejectedByTime: number;
  rejectedByDC: number;
  processingTimeMs: number;
}

interface LogEntry {
  level?: string;
  logger?: string;
  thread?: string;
  message?: string;
  timestamp?: string;
  source?: string;
  mdc?: Record<string, unknown>;
  _mark?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// Token Parser für Message-Filter
// ============================================================================

type TokType = "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "WORD";
interface Token {
  readonly t: TokType;
  readonly v?: string;
}

/**
 * Message-Matching mit AND, OR, NOT Operatoren und Escape-Support
 * Syntax:
 *  - OR mit '|'
 *  - AND mit '&'
 *  - Negation mit '!' prefix
 *  - Klammern '(' und ')' für Gruppierung
 *  - Escape mit '\' für Sonderzeichen: \& \| \! \( \)
 */
function msgMatches(message: unknown, pattern: string): boolean {
  if (!pattern) return true;
  const rawMsg = String(message || "");
  const rawExpr = pattern.trim();

  if (!rawExpr) return true;

  const m = rawMsg.toLowerCase();
  const q = rawExpr.toLowerCase();

  // Tokenizer mit Escape-Support
  function tokenize(s: string): Token[] {
    const toks: Token[] = [];
    let i = 0;
    const N = s.length;
    const isOp = (ch: string): boolean =>
      ch === "&" || ch === "|" || ch === "!" || ch === "(" || ch === ")";

    while (i < N) {
      const ch = s[i]!;
      if (ch <= " ") {
        i++;
        continue;
      }
      // Escape handling
      if (ch === "\\" && i + 1 < N) {
        let j = i;
        let word = "";
        while (j < N) {
          const c = s[j]!;
          if (c <= " ") break;
          if (c === "\\" && j + 1 < N) {
            word += s[j + 1]!;
            j += 2;
            continue;
          }
          if (isOp(c)) break;
          word += c;
          j++;
        }
        if (word) toks.push({ t: "WORD", v: word });
        i = j;
        continue;
      }
      if (isOp(ch)) {
        if (ch === "&") toks.push({ t: "AND" });
        else if (ch === "|") toks.push({ t: "OR" });
        else if (ch === "!") toks.push({ t: "NOT" });
        else if (ch === "(") toks.push({ t: "LPAREN" });
        else if (ch === ")") toks.push({ t: "RPAREN" });
        i++;
        continue;
      }
      // Collect word with escape support
      let j = i;
      let word = "";
      while (j < N) {
        const c = s[j]!;
        if (c <= " ") break;
        if (c === "\\" && j + 1 < N) {
          word += s[j + 1]!;
          j += 2;
          continue;
        }
        if (isOp(c)) break;
        word += c;
        j++;
      }
      if (word) toks.push({ t: "WORD", v: word });
      i = j;
    }
    return toks;
  }

  const tokens = tokenize(q);
  if (tokens.length === 0) return true;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const take = (): Token | undefined => tokens[pos++];

  function evalPrimary(): boolean {
    const tk = peek();
    if (!tk) return true;
    if (tk.t === "WORD") {
      take();
      return m.includes(tk.v!);
    }
    if (tk.t === "LPAREN") {
      take();
      const val = evalOr();
      if (peek()?.t === "RPAREN") take();
      return val;
    }
    take();
    return true;
  }

  function evalNot(): boolean {
    let neg = false;
    while (peek()?.t === "NOT") {
      take();
      neg = !neg;
    }
    const v = evalPrimary();
    return neg ? !v : v;
  }

  function skipPrimary(): void {
    const tk = peek();
    if (!tk) return;
    if (tk.t === "WORD") {
      take();
      return;
    }
    if (tk.t === "LPAREN") {
      take();
      skipOr();
      if (peek()?.t === "RPAREN") take();
      return;
    }
    take();
  }

  function skipNotExpr(): void {
    while (peek()?.t === "NOT") take();
    skipPrimary();
  }

  function skipAnd(): void {
    skipNotExpr();
    while (peek()?.t === "AND") {
      take();
      skipNotExpr();
    }
  }

  function skipOr(): void {
    skipAnd();
    while (peek()?.t === "OR") {
      take();
      skipAnd();
    }
  }

  function evalAnd(): boolean {
    let left = evalNot();
    while (peek()?.t === "AND") {
      take();
      if (!left) {
        skipNotExpr();
      } else {
        left = evalNot();
      }
    }
    return left;
  }

  function evalOr(): boolean {
    let left = evalAnd();
    while (peek()?.t === "OR") {
      take();
      if (left) {
        skipAnd();
      } else {
        left = evalAnd();
      }
    }
    return left;
  }

  return evalOr();
}

// ============================================================================
// Filter-Hilfsfunktionen
// ============================================================================

/**
 * Prüft ob Timestamp im Zeitbereich liegt
 */
function matchesTimeRange(
  timestamp: unknown,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;

  try {
    const ts = new Date(timestamp as string).getTime();
    if (isNaN(ts)) return true; // Ungültige Timestamps durchlassen

    if (from) {
      const fromTs = new Date(from).getTime();
      if (!isNaN(fromTs) && ts < fromTs) return false;
    }

    if (to) {
      const toTs = new Date(to).getTime();
      if (!isNaN(toTs) && ts > toTs) return false;
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * Prüft ob Entry den DC-Filter matched
 * Logik: OR für gleiche Keys (z.B. TraceID=A OR TraceID=B), AND über verschiedene Keys
 */
function matchesDcFilter(
  mdc: Record<string, unknown> | undefined,
  dcEntries: Array<{ key: string; value: string; active: boolean }>,
): boolean {
  if (!dcEntries || dcEntries.length === 0) return true;

  const activeEntries = dcEntries.filter((e) => e.active);
  if (activeEntries.length === 0) return true;

  if (!mdc || typeof mdc !== "object") return false;

  // Gruppiere Einträge nach Key (lowercase normalisiert)
  const entriesByKey = new Map<string, string[]>();
  for (const entry of activeEntries) {
    const key = entry.key.toLowerCase();
    const values = entriesByKey.get(key) || [];
    values.push(entry.value.toLowerCase());
    entriesByKey.set(key, values);
  }

  // Für jede Key-Gruppe: mindestens ein Value muss matchen (OR innerhalb Key)
  // Alle Key-Gruppen müssen einen Match haben (AND über Keys)
  for (const [key, allowedValues] of entriesByKey) {
    let keyMatched = false;

    for (const [k, v] of Object.entries(mdc)) {
      if (k.toLowerCase() === key) {
        const val = String(v || "").toLowerCase();
        if (allowedValues.includes(val)) {
          keyMatched = true;
          break;
        }
      }
    }

    if (!keyMatched) return false;
  }

  return true;
}

// ============================================================================
// Haupt-Filter-Funktion
// ============================================================================

/**
 * Filtert Entries nach den gegebenen Optionen
 * Optimiert für große Datensätze (>5000 Entries)
 */
function filterEntries(
  entries: LogEntry[],
  options: FilterOptions,
): { filteredIndices: number[]; stats: FilterStats } {
  const startTime = performance.now();

  const stats: FilterStats = {
    total: 0,
    passed: 0,
    rejectedByOnlyMarked: 0,
    rejectedByLevel: 0,
    rejectedByLogger: 0,
    rejectedByThread: 0,
    rejectedByMessage: 0,
    rejectedByTime: 0,
    rejectedByDC: 0,
    processingTimeMs: 0,
  };

  const filteredIndices: number[] = [];

  // Pre-compute lowercase filter values für Performance
  const levelFilter = options.filter.level?.toUpperCase() || "";
  const loggerFilter = options.filter.logger?.toLowerCase() || "";
  const threadFilter = options.filter.thread?.toLowerCase() || "";
  const messageFilter = options.filter.message || "";

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    stats.total++;

    if (!e) continue;

    // Only marked filter
    if (options.onlyMarked && !e._mark) {
      stats.rejectedByOnlyMarked++;
      continue;
    }

    // Standard filters
    if (options.stdFiltersEnabled) {
      // Level filter
      if (levelFilter) {
        const lev = String(e.level || "").toUpperCase();
        if (lev !== levelFilter) {
          stats.rejectedByLevel++;
          continue;
        }
      }

      // Logger filter
      if (loggerFilter) {
        if (
          !String(e.logger || "")
            .toLowerCase()
            .includes(loggerFilter)
        ) {
          stats.rejectedByLogger++;
          continue;
        }
      }

      // Thread filter
      if (threadFilter) {
        if (
          !String(e.thread || "")
            .toLowerCase()
            .includes(threadFilter)
        ) {
          stats.rejectedByThread++;
          continue;
        }
      }

      // Message filter
      if (messageFilter) {
        if (!msgMatches(e.message, messageFilter)) {
          stats.rejectedByMessage++;
          continue;
        }
      }
    }

    // Time filter (nur für Elastic-Quellen)
    const isElasticSrc =
      typeof e.source === "string" && e.source.startsWith("elastic://");
    if (isElasticSrc && options.timeFilterEnabled) {
      if (
        !matchesTimeRange(
          e.timestamp,
          options.timeFilterFrom,
          options.timeFilterTo,
        )
      ) {
        stats.rejectedByTime++;
        continue;
      }
    }

    // DC filter
    if (options.dcFilterEnabled) {
      if (!matchesDcFilter(e.mdc, options.dcFilterEntries)) {
        stats.rejectedByDC++;
        continue;
      }
    }

    stats.passed++;
    filteredIndices.push(i);
  }

  stats.processingTimeMs = performance.now() - startTime;

  return { filteredIndices, stats };
}

// ============================================================================
// Message Handler
// ============================================================================

if (parentPort) {
  parentPort.on("message", (message: FilterRequest) => {
    if (message.type === "filter") {
      const { requestId, entries, options } = message;

      try {
        const result = filterEntries(entries, options);

        const response: FilterResponse = {
          type: "result",
          requestId,
          filteredIndices: result.filteredIndices,
          stats: result.stats,
        };

        parentPort!.postMessage(response);
      } catch (error) {
        // Bei Fehler leere Ergebnisse zurückgeben
        parentPort!.postMessage({
          type: "result",
          requestId,
          filteredIndices: [],
          stats: {
            total: entries.length,
            passed: 0,
            rejectedByOnlyMarked: 0,
            rejectedByLevel: 0,
            rejectedByLogger: 0,
            rejectedByThread: 0,
            rejectedByMessage: 0,
            rejectedByTime: 0,
            rejectedByDC: 0,
            processingTimeMs: 0,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  });

  // Signal dass der Process bereit ist
  parentPort.postMessage({ type: "ready" });
}

export type { FilterRequest, FilterResponse, FilterOptions, FilterStats };
