// Utility: HTML escaping and full-text highlighting
export function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// Highlight all occurrences of needle in text (case-insensitive), returns safe HTML
export function highlightAll(text, needle) {
  const s = String(text ?? '')
  const q = String(needle ?? '').trim()
  if (!q) return escapeHtml(s)
  const escRe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escRe, 'gi')
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    out += escapeHtml(s.slice(last, m.index))
    out += '<mark>' + escapeHtml(m[0]) + '</mark>'
    last = m.index + m[0].length
  }
  out += escapeHtml(s.slice(last))
  return out
}

