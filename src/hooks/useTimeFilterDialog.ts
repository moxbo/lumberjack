/**
 * useTimeFilterDialog Hook
 *
 * Owns the Elastic time-filter dialog state and the filter-history lists,
 * extracted verbatim from App.tsx so behaviour is unchanged:
 *  - showTimeDialog / timeForm: dialog visibility + form state.
 *  - openTimeFilterDialog: opens the dialog, pre-filling the form from the
 *    current TimeFilter state, the last Elastic search form and the persisted
 *    filter-history / settings fallbacks.
 *  - clearTimeFilter: resets the local form and closes the dialog.
 *  - histAppName / histEnvironment / histIndex + addToHistory: the volatile
 *    (but settings-persisted) filter-history lists shown in the dialog.
 *
 * The last Elastic search form is provided lazily via `getLastEsForm` so this
 * hook can be called before `useElasticSearch` without a circular dependency.
 */
import { useState } from "preact/hooks";
import logger from "../utils/logger";
import { getSettings, patchSettingsQuiet } from "../utils/typedApi";
import { TimeFilter } from "../store/timeFilter";
import type { ElasticFormState, TimeFormState } from "../types/renderer";

export interface UseTimeFilterDialogOptions {
  showAlert: (msg: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Lazily read the last Elastic search form (owned by useElasticSearch). */
  getLastEsForm: () => ElasticFormState | null;
}

export interface UseTimeFilterDialogReturn {
  showTimeDialog: boolean;
  setShowTimeDialog: (v: boolean) => void;
  timeForm: TimeFormState;
  setTimeForm: (
    v: TimeFormState | ((prev: TimeFormState) => TimeFormState),
  ) => void;
  openTimeFilterDialog: () => Promise<void>;
  clearTimeFilter: () => void;
  histAppName: string[];
  setHistAppName: (v: string[]) => void;
  histEnvironment: string[];
  setHistEnvironment: (v: string[]) => void;
  histIndex: string[];
  setHistIndex: (v: string[]) => void;
  addToHistory: (kind: "app" | "env" | "index", val: string) => void;
}

export function useTimeFilterDialog({
  showAlert,
  t,
  getLastEsForm,
}: UseTimeFilterDialogOptions): UseTimeFilterDialogReturn {
  // Zeit-Filter Dialog-State
  const [showTimeDialog, setShowTimeDialog] = useState<boolean>(false);
  const [timeForm, setTimeForm] = useState<TimeFormState>({
    enabled: true,
    mode: "relative",
    duration: "15m",
    from: "",
    to: "",
    application_name: "",
    logger: "",
    level: "",
    environment: "",
    index: "",
    environmentCase: "original",
  });

  // Filter-Historien
  // Entfernt: persistente Logger-Historie; stattdessen flüchtige Verlaufslisten
  const [histAppName, setHistAppName] = useState<string[]>([]);
  const [histEnvironment, setHistEnvironment] = useState<string[]>([]);
  // NEW: Index history
  const [histIndex, setHistIndex] = useState<string[]>([]);

  // Öffnet den Elastic-Search-Dialog und befüllt Formular aus TimeFilter-State
  async function openTimeFilterDialog(): Promise<void> {
    // Helper: get last used values from in-memory history or settings as fallback
    const getLasts = async (): Promise<{
      lastApp: string;
      lastEnv: string;
      lastIndex: string;
      lastEnvCase: string | undefined;
      lastTimestampField: string;
    }> => {
      let lastApp =
        (histAppName && histAppName.length > 0 ? String(histAppName[0]) : "") ||
        "";
      let lastEnv =
        (histEnvironment && histEnvironment.length > 0
          ? String(histEnvironment[0])
          : "") || "";
      let lastIndex =
        (histIndex && histIndex.length > 0 ? String(histIndex[0]) : "") || "";
      let lastEnvCase: string | undefined;
      let lastTimestampField = "";
      try {
        const r = await getSettings();
        if (!lastApp && Array.isArray(r?.histAppName) && r.histAppName.length)
          lastApp = String(r.histAppName[0] || "");
        if (
          !lastEnv &&
          Array.isArray(r?.histEnvironment) &&
          r.histEnvironment.length
        )
          lastEnv = String(r.histEnvironment[0] || "");
        if (!lastIndex && Array.isArray(r?.histIndex) && r.histIndex.length)
          lastIndex = String(r.histIndex[0] || "");
        if (r && typeof r.lastEnvironmentCase === "string")
          lastEnvCase = r.lastEnvironmentCase;
        if (r && typeof r.lastTimestampField === "string")
          lastTimestampField = r.lastTimestampField;
      } catch {
        // ignore
      }
      return { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField };
    };

    try {
      const s = TimeFilter.getState();
      const toLocal = (iso: unknown): string => {
        const t = String(iso || "").trim();
        if (!t) return "";
        const d = new Date(t);
        if (isNaN(d.getTime())) return "";
        const pad = (n: number): string => String(n).padStart(2, "0");
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const da = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        return `${y}-${m}-${da}T${hh}:${mm}`;
      };
      const { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField } =
        await getLasts();
      // Bestimme zuletzt verwendete Werte aus der letzten Suche (falls vorhanden)
      const prev: Partial<ElasticFormState> = getLastEsForm() || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      const initTsField = String(
        prev.timestampField ||
          lastTimestampField ||
          timeForm.timestampField ||
          "",
      );
      setTimeForm({
        enabled: true,
        mode: (s && s.mode) || "relative",
        duration: (s && s.duration) || "15m",
        from: toLocal(s?.from),
        to: toLocal(s?.to),
        application_name: lastApp,
        logger: "",
        level: "",
        environment: lastEnv,
        index: initIndex,
        environmentCase: initEnvCase,
        timestampField: initTsField,
      });
    } catch {
      const { lastApp, lastEnv, lastIndex, lastEnvCase, lastTimestampField } =
        await getLasts();
      const prev: Partial<ElasticFormState> = getLastEsForm() || {};
      const initIndex = String(prev.index || lastIndex || "");
      const initEnvCase = String(
        prev.environmentCase ||
          lastEnvCase ||
          timeForm.environmentCase ||
          "original",
      );
      const initTsField = String(
        prev.timestampField ||
          lastTimestampField ||
          timeForm.timestampField ||
          "",
      );
      setTimeForm({
        enabled: true,
        mode: "relative",
        duration: "15m",
        from: "",
        to: "",
        application_name: lastApp,
        logger: "",
        level: "",
        environment: lastEnv,
        index: initIndex,
        environmentCase: initEnvCase,
        timestampField: initTsField,
      });
    }
    setShowTimeDialog(true);
  }

  // Setzt das lokale Formular zurück und schließt den Dialog
  function clearTimeFilter(): void {
    setTimeForm({
      enabled: true,
      mode: "relative",
      duration: "15m",
      from: "",
      to: "",
      application_name: "",
      logger: "",
      level: "",
      environment: "",
      index: "",
      environmentCase: "original",
    });
    setShowTimeDialog(false);
  }

  // History-Pflege für Elastic-Dialog
  function addToHistory(kind: "app" | "env" | "index", val: string): void {
    const v = String(val || "").trim();
    if (!v) return;
    if (kind === "app") {
      setHistAppName((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          patchSettingsQuiet({ histAppName: list });
        } catch (e) {
          logger.error("Failed to save histAppName settings:", e);
          showAlert(t("errors.histAppNameSaveFailed"));
        }
        return list;
      });
    } else if (kind === "env") {
      setHistEnvironment((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          patchSettingsQuiet({ histEnvironment: list });
        } catch (e) {
          logger.error("Failed to save histEnvironment settings:", e);
          showAlert(t("errors.histEnvironmentSaveFailed"));
        }
        return list;
      });
    } else if (kind === "index") {
      setHistIndex((prev) => {
        const list = [v, ...prev.filter((x) => x !== v)].slice(0, 10);
        try {
          patchSettingsQuiet({ histIndex: list });
        } catch (e) {
          logger.error("Failed to save histIndex settings:", e);
          showAlert(t("errors.histIndexSaveFailed"));
        }
        return list;
      });
    }
  }

  return {
    showTimeDialog,
    setShowTimeDialog,
    timeForm,
    setTimeForm,
    openTimeFilterDialog,
    clearTimeFilter,
    histAppName,
    setHistAppName,
    histEnvironment,
    setHistEnvironment,
    histIndex,
    setHistIndex,
    addToHistory,
  };
}
