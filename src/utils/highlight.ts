// Utility: HTML escaping and full-text highlighting
function toStringSafe(v: unknown): string {
  if (v == null) return "";
  const t = typeof v;
  if (t === "string") return v as string;
  if (t === "number" || t === "boolean") return String(v);
  return "";
}

export function escapeHtml(s: unknown): string {
  const str = toStringSafe(s);
  // Using standard replace with regex for HTML escape characters
  return str.replace(/[&<>]/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;",
  );
}

// Highlight all occurrences of needle in text (case-insensitive), returns safe HTML
export function highlightAll(text: unknown, needle: unknown): string {
  const s = toStringSafe(text);
  const q = toStringSafe(needle).trim();
  if (!q) return escapeHtml(s);
  const escRe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escRe, "gi");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    out += escapeHtml(s.slice(last, m.index));
    out += "<mark>" + escapeHtml(m[0]) + "</mark>";
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out;
}
