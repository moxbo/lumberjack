// filepath: /Users/mo/develop/my-electron-app/src/workers/filterWorker.ts
/**
 * Web Worker für das Filtern großer Log-Mengen.
 * Wird verwendet, wenn mehr als 10.000 Einträge gefiltert werden müssen.
 */

// Message types
interface FilterRequest {
  type: "filter";
  entries: any[];
  options: FilterOptions;
}

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

interface FilterResponse {
  type: "result";
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
}

// Token types for the parser
type TokType = "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "WORD";
interface Token {
  readonly t: TokType;
  readonly v?: string;
}

// Full message matching with AND, OR, NOT operators and escape support
// Syntax:
//  - OR with '|'
//  - AND with '&'
//  - Negation with '!' prefix
//  - Parentheses '(' and ')' for grouping
//  - Escape with '\' for literal special characters: \& \| \! \( \)
function msgMatches(message: unknown, pattern: string): boolean {
  if (!pattern) return true;
  const rawMsg = String(message || "");
  const rawExpr = pattern.trim();

  if (!rawExpr) return true;

  const m = rawMsg.toLowerCase();
  const q = rawExpr.toLowerCase();

  // Tokenizer with escape support
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
      // Quoted string: "..." is treated as a single WORD (phrase search)
      if (ch === '"') {
        let j = i + 1;
        let word = "";
        while (j < N && s[j] !== '"') {
          if (s[j] === "\\" && j + 1 < N) {
            word += s[j + 1]!;
            j += 2;
            continue;
          }
          word += s[j]!;
          j++;
        }
        if (j < N) j++; // skip closing quote
        if (word) toks.push({ t: "WORD", v: word });
        i = j;
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
    while (true) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === "AND") {
        take();
        skipNotExpr();
      } else if (tk.t === "WORD" || tk.t === "LPAREN" || tk.t === "NOT") {
        skipNotExpr();
      } else {
        break;
      }
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
    while (true) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === "AND") {
        take();
        if (!left) {
          skipNotExpr();
        } else {
          left = evalNot();
        }
      } else if (tk.t === "WORD" || tk.t === "LPAREN" || tk.t === "NOT") {
        if (!left) {
          skipNotExpr();
        } else {
          left = evalNot();
        }
      } else {
        break;
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

// Check if timestamp is within time range
function matchesTimeRange(
  timestamp: unknown,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;

  try {
    const ts = new Date(timestamp as string).getTime();
    if (isNaN(ts)) return true; // Invalid timestamps pass through

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

// Check if entry matches DC filter
// Logic: OR for same keys (e.g., TraceID=A OR TraceID=B), AND across different keys
function matchesDcFilter(
  mdc: Record<string, unknown> | undefined,
  dcEntries: Array<{ key: string; value: string; active: boolean }>,
): boolean {
  if (!dcEntries || dcEntries.length === 0) return true;

  const activeEntries = dcEntries.filter((e) => e.active);
  if (activeEntries.length === 0) return true;

  if (!mdc || typeof mdc !== "object") return false;

  // Group entries by key (normalized to lowercase)
  const entriesByKey = new Map<string, string[]>();
  for (const entry of activeEntries) {
    const key = entry.key.toLowerCase();
    const values = entriesByKey.get(key) || [];
    values.push(entry.value.toLowerCase());
    entriesByKey.set(key, values);
  }

  // For each key group: at least one value must match (OR within key)
  // All key groups must have a match (AND across keys)
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

// Main filter function
function filterEntries(entries: any[], options: FilterOptions): FilterResponse {
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
  };

  const filteredIndices: number[] = [];

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
      if (options.filter.level) {
        const lev = String(e.level || "").toUpperCase();
        if (lev !== options.filter.level.toUpperCase()) {
          stats.rejectedByLevel++;
          continue;
        }
      }

      // Logger filter
      if (options.filter.logger) {
        const q = options.filter.logger.toLowerCase();
        if (
          !String(e.logger || "")
            .toLowerCase()
            .includes(q)
        ) {
          stats.rejectedByLogger++;
          continue;
        }
      }

      // Thread filter
      if (options.filter.thread) {
        const q = options.filter.thread.toLowerCase();
        if (
          !String(e.thread || "")
            .toLowerCase()
            .includes(q)
        ) {
          stats.rejectedByThread++;
          continue;
        }
      }

      // Message filter
      if (options.filter.message) {
        if (!msgMatches(e.message, options.filter.message)) {
          stats.rejectedByMessage++;
          continue;
        }
      }
    }

    // Time filter (only for Elastic sources)
    const isElasticSrc =
      typeof e?.source === "string" && e.source.startsWith("elastic://");
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

  return {
    type: "result",
    filteredIndices,
    stats,
  };
}

// Worker message handler
self.onmessage = (event: MessageEvent<FilterRequest>) => {
  const { type, entries, options } = event.data;

  if (type === "filter") {
    const result = filterEntries(entries, options);
    self.postMessage(result);
  }
};

// Export for type checking
export type { FilterRequest, FilterResponse, FilterOptions, FilterStats };
