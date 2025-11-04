// Message-Filter-Auswertung mit Klammern und Operator-Priorität
// Syntax:
//  - OR mit '|'
//  - AND mit '&'
//  - Negation mit '!' als Präfix (mehrfach erlaubt: '!!foo' == 'foo')
//  - Klammern '(' und ')' zur Gruppierung
//  - Case-insensitive Teilstring-Suche
// Beispiele:
//  - foo&bar: message enthält foo UND bar
//  - foo|bar: message enthält foo ODER bar
//  - !bar: message enthält NICHT bar
//  - xml&(CB|AGV): message enthält xml UND (CB ODER AGV)
export function msgMatches(message: string, expr: string): boolean {
  const m = String(message || "").toLowerCase();
  const q = String(expr || "")
    .toLowerCase()
    .trim();
  if (!q) return true;

  type TokType = "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "WORD";
  type Token = { t: TokType; v?: string };

  // Tokenizer: zerlegt in Operatoren und Wörter; ignoriert Whitespace
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
      if (isOp(ch)) {
        if (ch === "&") toks.push({ t: "AND" });
        else if (ch === "|") toks.push({ t: "OR" });
        else if (ch === "!") toks.push({ t: "NOT" });
        else if (ch === "(") toks.push({ t: "LPAREN" });
        else if (ch === ")") toks.push({ t: "RPAREN" });
        i++;
        continue;
      }
      // Wort sammeln bis nächster Operator/Whitespace
      let j = i;
      while (j < N) {
        const c = s[j]!;
        if (c <= " " || isOp(c)) break;
        j++;
      }
      const word = s.slice(i, j).trim();
      if (word) toks.push({ t: "WORD", v: word });
      i = j;
    }
    return toks;
  }

  const tokens = tokenize(q);
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
      const right = evalNot();
      left = left && right;
      if (!left) {
        // Kurzschluss: weitere AND-Komponenten konsumieren und ignorieren
        while (peek()?.t === "AND") {
          take();
          // Konsumiere die nächste not-Komponente dennoch vollständig
          void evalNot();
        }
        return false;
      }
    }
    return left;
  }

  // or := and ('OR' and)*
  function evalOr(): boolean {
    let left = evalAnd();
    while (peek()?.t === "OR") {
      take();
      const right = evalAnd();
      left = left || right;
      if (left) {
        // Kurzschluss: weitere OR-Komponenten konsumieren und ignorieren
        while (peek()?.t === "OR") {
          take();
          // Konsumiere die nächste and-Komponente dennoch vollständig
          void evalAnd();
        }
        return true;
      }
    }
    return left;
  }

  const result = evalOr();
  // Optionale Rest-Token bis zum Ende überspringen (Robustheit gegen fehlende Klammern)
  // while (pos < tokens.length) pos++;
  return result;
}
