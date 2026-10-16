import { describe, expect, it } from "vitest";
import { createMessageMatcher } from "../filterWorker";
import { msgMatches, type SearchMode } from "../../utils/msgFilter";

describe("compiled worker search language", () => {
  const expressions = [
    "",
    "  ",
    "alpha",
    "Alpha beta",
    "alpha AND beta",
    "alpha OR beta",
    "NOT alpha",
    "NOT NOT beta",
    "alpha AND (beta OR NOT gamma)",
    '"alpha beta"',
    'alpha | "beta gamma"',
    "Tom\\&Jerry",
    "\\AND",
    '"OR"',
    "and",
    "or",
    "not",
    "alpha\\ beta",
    "alpha\u00a0beta",
    "alpha&",
    "alpha OR",
    "!(",
    ")",
    "(alpha OR beta",
    "alpha))beta",
    "&&alpha",
    '""',
    '"unfinished',
    "alpha AND OR beta",
    "((!alpha)|beta)",
    "alpha.*beta",
    "[invalid",
    "\\",
    "alpha\\",
  ];
  const messages = [
    "",
    "alpha",
    "beta",
    "gamma",
    "alpha beta",
    "ALPHA BETA",
    "Alpha beta gamma",
    "Tom&Jerry",
    "AND OR NOT",
    "and or not",
    "alpha\u00a0beta",
    "alpha\tbeta",
    "[invalid",
  ];
  it.each<SearchMode>(["insensitive", "sensitive", "regex"])(
    "matches the existing evaluator in %s mode, including malformed expressions",
    (mode) => {
      for (const expression of expressions) {
        const compiled = createMessageMatcher(expression, mode);
        for (const message of messages) {
          const expected = msgMatches(message, expression, { mode });
          expect(
            compiled({ message }),
            `${mode}: ${expression} / ${message}`,
          ).toBe(expected);
          expect(
            compiled({ message, messageLower: message.toLowerCase() }),
          ).toBe(expected);
        }
      }
    },
  );

  it("parses boolean expressions once instead of walking the parser per million rows", () => {
    const query =
      '(alpha OR beta) AND NOT gamma AND ("message value" OR delta)';
    const message = "alpha message value";
    const count = 1_000_000;
    let baselineMatches = 0;
    const baselineStart = performance.now();
    for (let i = 0; i < count; i++) {
      if (msgMatches(message, query)) baselineMatches++;
    }
    const baselineMs = performance.now() - baselineStart;
    const matcher = createMessageMatcher(query);
    const entry = { message, messageLower: message };
    let compiledMatches = 0;
    const compiledStart = performance.now();
    for (let i = 0; i < count; i++) {
      if (matcher(entry)) compiledMatches++;
    }
    const compiledMs = performance.now() - compiledStart;
    expect(compiledMatches).toBe(baselineMatches);
    expect(compiledMatches).toBe(count);
    console.warn(
      `[perf] 1m boolean matches: evaluator=${baselineMs.toFixed(1)}ms compiled=${compiledMs.toFixed(1)}ms`,
    );
  });
});
