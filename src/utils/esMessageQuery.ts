// Übersetzt einen Message-Filter-Ausdruck (Syntax siehe msgFilter.ts) in eine
// Elasticsearch-Query. Wird im Main-Prozess (parsers.ts) verwendet, damit die
// serverseitige Vorfilterung dieselbe Boolesche Logik abbildet wie die
// clientseitige Auswertung in `msgMatches`.
//
// Wichtig: Diese Query ist eine *Vorfilterung*. Die exakte, endgültige
// Filterung erfolgt weiterhin clientseitig über `msgMatches` auf dem
// vollständigen Message-Text. Deshalb wird hier bewusst eine eher *großzügige*
// Treffermenge (Superset) erzeugt, damit keine clientseitig sichtbaren
// Ergebnisse verloren gehen:
//   - Einzel-Token: `wildcard` *term* (case-insensitive) ~ Substring je Token
//   - Phrasen (mit Leerzeichen): `match_phrase`
//
// Mapping der Grammatik:
//   WORD        -> wildcard/match_phrase auf dem Message-Feld
//   NOT x       -> bool.must_not [x]
//   a AND b ... -> bool.must [a, b, ...]   (auch implizites AND)
//   a OR b ...  -> bool.should [a, b, ...], minimum_should_match: 1
//   (...)       -> verschachteltes bool

import { tokenizeQuery, type Token } from "./msgFilter";

type AnyMap = Record<string, unknown>;

function escapeWildcard(term: string): string {
  // ES-Wildcard-Sonderzeichen escapen: \ * ?
  return term.replace(/([\\*?])/g, "\\$1");
}

function messageLeaf(term: string, field: string): AnyMap {
  // Phrasen (enthalten Whitespace) als match_phrase – tokenbasiert,
  // entspricht der Reihenfolge-Suche und vermeidet teure Leading-Wildcards.
  if (/\s/.test(term)) {
    return { match_phrase: { [field]: { query: term } } };
  }
  // Einzel-Token: Substring je Token via Wildcard (case-insensitive),
  // damit z.B. "err" auch "error" findet (analog zum clientseitigen includes).
  return {
    wildcard: {
      [field]: { value: `*${escapeWildcard(term)}*`, case_insensitive: true },
    },
  };
}

/**
 * Baut aus einem Message-Filter-Ausdruck eine Elasticsearch-Query.
 * @returns Query-Objekt oder `null`, wenn der Ausdruck leer ist bzw. keine
 *          verwertbaren Begriffe enthält.
 */
export function buildElasticMessageQuery(
  expr: string,
  field = "message",
): AnyMap | null {
  const raw = (expr ?? "").trim();
  if (!raw) return null;

  const tokens: Token[] = tokenizeQuery(raw);
  if (tokens.length === 0) return null;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const take = (): Token | undefined => tokens[pos++];

  // primary := WORD | '(' or ')'
  function parsePrimary(): AnyMap | null {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === "WORD") {
      take();
      return messageLeaf(tk.v ?? "", field);
    }
    if (tk.t === "LPAREN") {
      take();
      const val = parseOr();
      if (peek()?.t === "RPAREN") take();
      return val;
    }
    // Unerwartetes Token überspringen (robust gegen fehlerhafte Eingaben)
    take();
    return null;
  }

  // not := ('NOT')* primary
  function parseNot(): AnyMap | null {
    let neg = false;
    while (peek()?.t === "NOT") {
      take();
      neg = !neg;
    }
    const v = parsePrimary();
    if (v == null) return null;
    return neg ? { bool: { must_not: [v] } } : v;
  }

  // and := not (('AND' | implicit) not)*
  function parseAnd(): AnyMap | null {
    const parts: AnyMap[] = [];
    const first = parseNot();
    if (first) parts.push(first);
    while (true) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === "AND") {
        take();
        const n = parseNot();
        if (n) parts.push(n);
      } else if (tk.t === "WORD" || tk.t === "LPAREN" || tk.t === "NOT") {
        // Implizites AND
        const n = parseNot();
        if (n) parts.push(n);
      } else {
        break;
      }
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    return { bool: { must: parts } };
  }

  // or := and ('OR' and)*
  function parseOr(): AnyMap | null {
    const parts: AnyMap[] = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (peek()?.t === "OR") {
      take();
      const a = parseAnd();
      if (a) parts.push(a);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    return { bool: { should: parts, minimum_should_match: 1 } };
  }

  return parseOr();
}
