import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { AlertRule } from "../services/AlertEvaluator";
import { newAlertRuleId } from "../services/AlertEvaluator";
import logger from "../utils/logger";

interface ApiShape {
  alertRulesGetAll?: () => Promise<{
    ok: boolean;
    rules: unknown[];
    error?: string;
  }>;
  alertRulesSave?: (
    rules: unknown[],
  ) => Promise<{ ok: boolean; error?: string }>;
  onAlertRulesChanged?: (callback: () => void) => () => void;
}

function getApi(): ApiShape | undefined {
  const w = window as unknown as { api?: ApiShape };
  return w.api;
}

export function useAlertRules() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const lastSavedRef = useRef<string>("[]");

  const load = useCallback(async () => {
    try {
      const api = getApi();
      if (!api?.alertRulesGetAll) {
        setLoaded(true);
        return;
      }
      const res = await api.alertRulesGetAll();
      if (res.ok) {
        const list = (res.rules as AlertRule[]) || [];
        setRules(list);
        lastSavedRef.current = JSON.stringify(list);
      }
    } catch (e) {
      logger.warn("[useAlertRules] load failed:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const api = getApi();
    if (!api?.onAlertRulesChanged) return;
    const off = api.onAlertRulesChanged(() => void load());
    return off;
  }, [load]);

  const persist = useCallback(async (next: AlertRule[]) => {
    try {
      const api = getApi();
      if (!api?.alertRulesSave) return;
      const serialised = JSON.stringify(next);
      if (serialised === lastSavedRef.current) return;
      const res = await api.alertRulesSave(next as unknown[]);
      if (res.ok) lastSavedRef.current = serialised;
    } catch (e) {
      logger.warn("[useAlertRules] save failed:", e);
    }
  }, []);

  const addRule = useCallback(
    (partial: Partial<AlertRule>) => {
      const rule: AlertRule = {
        id: newAlertRuleId(),
        name: partial.name?.trim() || "Neue Regel",
        enabled: partial.enabled ?? true,
        severity: partial.severity ?? "warning",
        level: partial.level ?? "ERROR",
        loggerSubstring: partial.loggerSubstring ?? "",
        messageSubstring: partial.messageSubstring ?? "",
        cooldownMs: partial.cooldownMs ?? 30_000,
        burstCount: partial.burstCount,
        burstWindowMs: partial.burstWindowMs,
      };
      setRules((prev) => {
        const next = [...prev, rule];
        void persist(next);
        return next;
      });
      return rule;
    },
    [persist],
  );

  const updateRule = useCallback(
    (id: string, patch: Partial<AlertRule>) => {
      setRules((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeRule = useCallback(
    (id: string) => {
      setRules((prev) => {
        const next = prev.filter((r) => r.id !== id);
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggleRule = useCallback(
    (id: string) => {
      setRules((prev) => {
        const next = prev.map((r) =>
          r.id === id ? { ...r, enabled: !r.enabled } : r,
        );
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  return { rules, loaded, addRule, updateRule, removeRule, toggleRule };
}
