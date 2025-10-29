// Utility: HTML escaping and full-text highlighting
function toStringSafe(v: unknown): string {
  if (v == null) return '';
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean' ? String(v) : '';
}

export function escapeHtml(s: unknown): string {
  // Avoid String.prototype.replaceAll to stay compatible with ES2020 typings
  const str = toStringSafe(s);
  return str.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

// Highlight all occurrences of needle in text (case-insensitive), returns safe HTML
export function highlightAll(text: unknown, needle: unknown): string {
  const s = toStringSafe(text);
  const q = toStringSafe(needle).trim();
  if (!q) return escapeHtml(s);
  const escRe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escRe, 'gi');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    out += escapeHtml(s.slice(last, m.index));
    out += '<mark>' + escapeHtml(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  out += escapeHtml(s.slice(last));
  return out;
}
