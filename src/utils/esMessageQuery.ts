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
//   - Einzel-Token: `query_string` *term* (case-insensitive) ~ Substring je Token
//   - Phrasen (mit Leerzeichen): `match_phrase`
//
// Hinweis: Für Einzel-Token wird bewusst `query_string` mit `analyze_wildcard`
// statt `wildcard` + `case_insensitive` verwendet. Die Option `case_insensitive`
// im `wildcard`-Query gibt es erst ab Elasticsearch 7.10; ältere Cluster lehnen
// sie mit `[wildcard] query does not support [case_insensitive]` (HTTP 400) ab.
// `query_string` mit `analyze_wildcard` ist versionsübergreifend kompatibel und
// case-insensitiv, weil der Feld-Analyzer auf den Wildcard-Term angewendet wird.
//
// Mapping der Grammatik:
//   WORD        -> wildcard/match_phrase auf dem Message-Feld
//   NOT x       -> bool.must_not [x]
//   a AND b ... -> bool.must [a, b, ...]   (auch implizites AND)
//   a OR b ...  -> bool.should [a, b, ...], minimum_should_match: 1
//   (...)       -> verschachteltes bool

import { tokenizeQuery, type Token } from "./msgFilter";

type AnyMap = Record<string, unknown>;

function escapeQueryStringTerm(term: string): string {
  // Lucene-`query_string`-Sonderzeichen escapen. `< >` lassen sich nicht
  // escapen und führen zu Parse-Fehlern – daher durch Leerzeichen ersetzen.
  return term
    .replace(/[<>]/g, " ")
    .replace(/([+\-=&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

function textLeaf(term: string, fields: string[]): AnyMap {
  const fieldQueries = fields.map((field) => {
    // Phrasen (enthalten Whitespace) als match_phrase – tokenbasiert,
    // entspricht der Reihenfolge-Suche und vermeidet teure Leading-Wildcards.
    if (/\s/.test(term)) {
      return { match_phrase: { [field]: { query: term } } };
    }
    // Einzel-Token: Substring je Token via Wildcard (case-insensitive),
    // damit z.B. "err" auch "error" findet (analog zum clientseitigen includes).
    // `query_string` + `analyze_wildcard` ist auf allen ES-Versionen verfügbar,
    // anders als `wildcard` + `case_insensitive` (erst ab ES 7.10).
    return {
      query_string: {
        query: `${field}:*${escapeQueryStringTerm(term)}*`,
        analyze_wildcard: true,
        allow_leading_wildcard: true,
      },
    };
  });

  if (fieldQueries.length === 1) return fieldQueries[0]!;

  return {
    bool: {
      should: fieldQueries,
      minimum_should_match: 1,
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
  field: string | string[] = "message",
): AnyMap | null {
  const raw = (expr ?? "").trim();
  if (!raw) return null;
  const fields = (Array.isArray(field) ? field : [field]).filter(Boolean);
  if (fields.length === 0) return null;

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
      return textLeaf(tk.v ?? "", fields);
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
