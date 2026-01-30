// Message-Filter-Auswertung mit Klammern und Operator-Priorität
// Syntax:
//  - OR mit '|'
//  - AND mit '&'
//  - Negation mit '!' als Präfix (mehrfach erlaubt: '!!foo' == 'foo')
//  - Klammern '(' und ')' zur Gruppierung
//  - Escape mit '\' für literale Sonderzeichen: \& \| \! \( \)
//  - Optional: Case-sensitive oder Regex-Modus
// Beispiele:
//  - foo&bar: message enthält foo UND bar
//  - foo|bar: message enthält foo ODER bar
//  - !bar: message enthält NICHT bar
//  - xml&(CB|AGV): message enthält xml UND (CB ODER AGV)
//  - Tom\&Jerry: message enthält wörtlich "Tom&Jerry"

export type SearchMode = "insensitive" | "sensitive" | "regex";

export interface MsgMatchOptions {
  mode?: SearchMode;
}

// Token-Typen außerhalb der Funktion für bessere Performance
type TokType = "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "WORD";
interface Token {
  readonly t: TokType;
  readonly v?: string;
}

// Cache für tokenisierte Ausdrücke - vermeidet wiederholtes Parsing
const tokenCache = new Map<string, Token[]>();
const MAX_TOKEN_CACHE = 50;

// Cache für kompilierte Regex im Regex-Modus
const regexFilterCache = new Map<string, RegExp | null>();
const MAX_REGEX_FILTER_CACHE = 50;

export function msgMatches(
  message: string,
  expr: string,
  options?: MsgMatchOptions,
): boolean {
  const mode = options?.mode ?? "insensitive";
  // Frühe Null-Checks
  const rawMsg = message ?? "";
  const rawExpr = (expr ?? "").trim();

  // Für Regex-Modus: gesamten Ausdruck als Regex behandeln (ohne AND/OR-Parsing)
  if (mode === "regex") {
    if (!rawExpr) return true;

    // Versuche gecachte Regex zu verwenden
    let re = regexFilterCache.get(rawExpr);
    if (re === undefined) {
      try {
        re = new RegExp(rawExpr, "i"); // Regex ist immer case-insensitive
      } catch {
        re = null; // Ungültiger Regex markieren
      }
      // Cache verwalten
      if (regexFilterCache.size >= MAX_REGEX_FILTER_CACHE) {
        const firstKey = regexFilterCache.keys().next().value;
        if (firstKey) regexFilterCache.delete(firstKey);
      }
      regexFilterCache.set(rawExpr, re);
    }

    if (re) {
      return re.test(rawMsg);
    } else {
      // Ungültiger Regex: fallback auf einfache Suche
      return rawMsg.toLowerCase().includes(rawExpr.toLowerCase());
    }
  }

  // Für normale Modi: case-handling anwenden
  const m = mode === "sensitive" ? rawMsg : rawMsg.toLowerCase();
  const q = mode === "sensitive" ? rawExpr : rawExpr.toLowerCase();
  if (!q) return true;

  // Tokenizer: zerlegt in Operatoren und Wörter; ignoriert Whitespace
  // Escape-Mechanismus: \& \| \! \( \) werden als literale Zeichen behandelt
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
      // Escape-Handling: \x behandelt x als literales Zeichen
      if (ch === "\\" && i + 1 < N) {
        // Escaped character wird als Teil eines Wortes behandelt
        let j = i;
        let word = "";
        while (j < N) {
          const c = s[j]!;
          if (c <= " ") break;
          // Handle escape sequences within words
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
      // Wort sammeln bis nächster Operator/Whitespace, mit Escape-Support
      let j = i;
      let word = "";
      while (j < N) {
        const c = s[j]!;
        if (c <= " ") break;
        // Handle escape sequences within words
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

  // Versuche gecachte Tokens zu verwenden
  let tokens = tokenCache.get(q);
  if (!tokens) {
    tokens = tokenize(q);
    // Cache verwalten
    if (tokenCache.size >= MAX_TOKEN_CACHE) {
      const firstKey = tokenCache.keys().next().value;
      if (firstKey) tokenCache.delete(firstKey);
    }
    tokenCache.set(q, tokens);
  }

  if (tokens.length === 0) return true;

  // Parser/Evaluator (rekursiver Abstieg) mit Kurzschlusslogik
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const take = (): Token | undefined => tokens[pos++];

  // primary := WORD | '(' expr ')'
  function evalPrimary(): boolean {
    const tk = peek();
    if (!tk) return true; // leere Stelle als true behandeln
    if (tk.t === "WORD") {
      take();
      return m.includes(tk.v!);
    }
    if (tk.t === "LPAREN") {
      take(); // '('
      const val = evalOr();
      if (peek()?.t === "RPAREN") take(); // ')', falls vorhanden
      return val;
    }
    // Unerwartet: behandle als true, damit fehlerhafte Zeichen nicht alles ausschalten
    take();
    return true;
  }

  // not := ('NOT')* primary
  function evalNot(): boolean {
    let neg = false;
    while (peek()?.t === "NOT") {
      take();
      neg = !neg;
    }
    const v = evalPrimary();
    return neg ? !v : v;
  }

  // and := not ('AND' not)*
  function evalAnd(): boolean {
    let left = evalNot();
    while (peek()?.t === "AND") {
      take();
      // Echte Kurzschluss-Logik: wenn left=false, überspringen wir die Evaluation
      if (!left) {
        // Konsumiere Tokens aber werte nicht aus (schneller Pfad)
        skipNotExpr();
      } else {
        left = evalNot();
      }
    }
    return left;
  }

  // Hilfsfunktion: Überspringt eine not-Expression ohne sie auszuwerten
  function skipNotExpr(): void {
    while (peek()?.t === "NOT") take();
    skipPrimary();
  }

  // Hilfsfunktion: Überspringt eine primary-Expression ohne sie auszuwerten
  function skipPrimary(): void {
    const tk = peek();
    if (!tk) return;
    if (tk.t === "WORD") {
      take();
      return;
    }
    if (tk.t === "LPAREN") {
      take(); // '('
      skipOr();
      if (peek()?.t === "RPAREN") take();
      return;
    }
    // Unerwartetes Token überspringen
    take();
  }

  // Hilfsfunktion: Überspringt eine and-Expression ohne sie auszuwerten
  function skipAnd(): void {
    skipNotExpr();
    while (peek()?.t === "AND") {
      take();
      skipNotExpr();
    }
  }

  // Hilfsfunktion: Überspringt eine or-Expression ohne sie auszuwerten
  function skipOr(): void {
    skipAnd();
    while (peek()?.t === "OR") {
      take();
      skipAnd();
    }
  }

  // or := and ('OR' and)*
  function evalOr(): boolean {
    let left = evalAnd();
    while (peek()?.t === "OR") {
      take();
      // Echte Kurzschluss-Logik: wenn left=true, überspringen wir die Evaluation
      if (left) {
        // Konsumiere Tokens aber werte nicht aus (schneller Pfad)
        skipAnd();
      } else {
        left = evalAnd();
      }
    }
    return left;
  }

  // Optionale Rest-Token bis zum Ende überspringen (Robustheit gegen fehlende Klammern)
  // while (pos < tokens.length) pos++;
  return evalOr();
}
