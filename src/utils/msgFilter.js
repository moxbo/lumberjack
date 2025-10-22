// Message-Filter-Auswertung
// Syntax: OR mit '|', AND mit '&', Negation mit '!' vor einem Token
// - Case-insensitive Teilstring-Suche
// - Mehrere '!' werden als togglende Negation ausgewertet (z.B. '!!foo' == 'foo')
export function msgMatches(message, expr) {
  const m = String(message || '').toLowerCase()
  const q = String(expr || '').toLowerCase().trim()
  if (!q) return true
  const orGroups = q
    .split('|')
    .map(s => s.trim())
    .filter(Boolean)
    .map(g => g.split('&').map(t => t.trim()).filter(Boolean))
  if (!orGroups.length) return true
  return orGroups.some(andGroup =>
    andGroup.every(rawTok => {
      let t = rawTok
      let neg = false
      while (t.startsWith('!')) { neg = !neg; t = t.slice(1) }
      t = t.trim()
      if (!t) return true
      const hit = m.includes(t)
      return neg ? !hit : hit
    })
  )
}

