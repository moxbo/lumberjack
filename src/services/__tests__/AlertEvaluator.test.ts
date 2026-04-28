import { describe, expect, it } from "vitest";
import {
  AlertEvaluator,
  newAlertRuleId,
  ruleMatchesEntry,
  type AlertRule,
} from "../AlertEvaluator";

const baseRule: AlertRule = {
  id: "r1",
  name: "Errors in payment",
  enabled: true,
  severity: "warning",
  level: "ERROR",
  loggerSubstring: "payment",
  messageSubstring: "",
  cooldownMs: 1000,
};

describe("ruleMatchesEntry", () => {
  it("matches when level + logger substring are satisfied", () => {
    expect(
      ruleMatchesEntry(baseRule, {
        level: "error",
        logger: "com.example.PaymentService",
        message: "x",
      }),
    ).toBe(true);
  });
  it("rejects on different level", () => {
    expect(
      ruleMatchesEntry(baseRule, {
        level: "INFO",
        logger: "com.example.PaymentService",
        message: "x",
      }),
    ).toBe(false);
  });
  it("rejects when logger does not contain substring", () => {
    expect(
      ruleMatchesEntry(baseRule, {
        level: "ERROR",
        logger: "com.example.User",
        message: "x",
      }),
    ).toBe(false);
  });
  it("ignores level when rule.level is empty", () => {
    const r = { ...baseRule, level: undefined };
    expect(
      ruleMatchesEntry(r, { level: "DEBUG", logger: "payment.x", message: "" }),
    ).toBe(true);
  });
  it("matches case-insensitively for substrings", () => {
    const r = { ...baseRule, messageSubstring: "Timeout" };
    expect(
      ruleMatchesEntry(r, {
        level: "ERROR",
        logger: "payment",
        message: "connection timeout occurred",
      }),
    ).toBe(true);
  });
});

describe("AlertEvaluator", () => {
  it("fires once per matching batch and respects cooldown", () => {
    let now = 1000;
    const ev = new AlertEvaluator([baseRule], () => now);
    const e1 = ev.evaluate([
      { level: "ERROR", logger: "payment.X", message: "boom" },
    ]);
    expect(e1).toHaveLength(1);
    expect(e1[0]?.ruleId).toBe("r1");

    // Within cooldown – must not fire again
    now += 500;
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment.X", message: "boom2" }]),
    ).toHaveLength(0);

    // After cooldown – fires again
    now += 600;
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment.X", message: "boom3" }]),
    ).toHaveLength(1);
  });

  it("burst rule fires only once N matches accumulated within window", () => {
    let now = 1000;
    const burstRule: AlertRule = {
      ...baseRule,
      id: "burst",
      burstCount: 3,
      burstWindowMs: 5000,
      cooldownMs: 0,
    };
    const ev = new AlertEvaluator([burstRule], () => now);
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment.x", message: "1" }]),
    ).toHaveLength(0);
    now += 100;
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment.x", message: "2" }]),
    ).toHaveLength(0);
    now += 100;
    const fired = ev.evaluate([
      { level: "ERROR", logger: "payment.x", message: "3" },
    ]);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.matchCount).toBe(3);
  });

  it("does not fire when rule is disabled", () => {
    const ev = new AlertEvaluator([{ ...baseRule, enabled: false }]);
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment.x", message: "boom" }]),
    ).toHaveLength(0);
  });

  it("setRules drops state for removed rules", () => {
    const now = 1000;
    const ev = new AlertEvaluator([baseRule], () => now);
    ev.evaluate([{ level: "ERROR", logger: "payment", message: "x" }]);
    // remove rule entirely → no leftover lastFired entry would block re-add.
    ev.setRules([]);
    ev.setRules([baseRule]);
    expect(
      ev.evaluate([{ level: "ERROR", logger: "payment", message: "x" }]),
    ).toHaveLength(1);
  });
});

describe("newAlertRuleId", () => {
  it("generates unique-looking ids", () => {
    const a = newAlertRuleId();
    const b = newAlertRuleId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^ar-/);
  });
});
