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

export function escapeHtml(s: unknown): string {
  const str = toStringSafe(s);
  // Using standard replace with regex for HTML escape characters
  return str.replace(/[&<>]/g, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

// Cache für kompilierte RegExp-Objekte - vermeidet wiederholtes Kompilieren
const regexCache = new Map<string, RegExp>();
const MAX_REGEX_CACHE = 100;

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

  // Versuche gecachte Regex zu verwenden
  let re = regexCache.get(q);
  if (!re) {
    const escRe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(escRe, "gi");

    // Cache verwalten
    if (regexCache.size >= MAX_REGEX_CACHE) {
      // Lösche älteste Einträge
      const firstKey = regexCache.keys().next().value;
      if (firstKey) regexCache.delete(firstKey);
    }
    regexCache.set(q, re);
  } else {
    // Reset lastIndex für wiederholte Verwendung
    re.lastIndex = 0;
  }

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
