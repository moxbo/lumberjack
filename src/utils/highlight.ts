// Utility: HTML escaping and full-text highlighting
function toStringSafe(v: unknown): string {
  if (v == null) return "";
  const t = typeof v;
  if (t === "string") return v as string;
  if (t === "number" || t === "boolean") return String(v);
  return "";
}

// Vorab-escaped HTML characters map für schnellere Lookups
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

// Hot-Path-Optimierung: Wenn der String keines der Sonderzeichen enthält,
// gib ihn direkt zurück (spart Regex-Allokation in ~95 % aller Log-Zeilen).
const HTML_NEEDS_ESCAPE_RE = /[&<>]/;

export function escapeHtml(s: unknown): string {
  const str = toStringSafe(s);
  if (!HTML_NEEDS_ESCAPE_RE.test(str)) return str;
  return str.replace(/[&<>]/g, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

// LRU-Cache für kompilierte RegExp-Objekte – verhindert wiederholtes Kompilieren
// und bevorzugt häufig genutzte Suchbegriffe (recently-used → bleibt im Cache).
const MAX_REGEX_CACHE = 100;
const regexCache = new Map<string, RegExp>();

function getCachedRegex(query: string): RegExp {
  const cached = regexCache.get(query);
  if (cached) {
    // LRU: Eintrag durch Re-Insert ans Ende der Iteration verschieben.
    regexCache.delete(query);
    regexCache.set(query, cached);
    cached.lastIndex = 0;
    return cached;
  }
  const escRe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escRe, "gi");
  if (regexCache.size >= MAX_REGEX_CACHE) {
    // Map iteration order = insertion order → erster Key ist Least-Recently-Used.
    const firstKey = regexCache.keys().next().value;
    if (firstKey !== undefined) regexCache.delete(firstKey);
  }
  regexCache.set(query, re);
  return re;
}

// Maximale Textlänge für Highlighting um Performance-Probleme zu vermeiden
const MAX_HIGHLIGHT_LENGTH = 50_000;

// Highlight all occurrences of needle in text (case-insensitive), returns safe HTML
export function highlightAll(text: unknown, needle: unknown): string {
  const s = toStringSafe(text);
  const q = toStringSafe(needle).trim();
  if (!q) return escapeHtml(s);

  // Für sehr lange Texte: kein Highlighting, nur Escape
  if (s.length > MAX_HIGHLIGHT_LENGTH) {
    return escapeHtml(s);
  }

  const re = getCachedRegex(q);

  let out = "";
  let last = 0;
  let m;
  let matchCount = 0;
  const MAX_MATCHES = 1000; // Begrenze Anzahl der Matches für Performance

  while ((m = re.exec(s)) !== null && matchCount < MAX_MATCHES) {
    out += escapeHtml(s.slice(last, m.index));
    out += "<mark>" + escapeHtml(m[0]) + "</mark>";
    last = m.index + m[0].length;
    matchCount++;
  }
  out += escapeHtml(s.slice(last));
  return out;
}

// Clear regex cache (call when search term changes significantly)
export function clearRegexCache(): void {
  regexCache.clear();
}
