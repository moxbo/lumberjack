/**
 * Hook for HTTP polling functionality
 */
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import logger from "../utils/logger";
import {
  getSettings,
  patchSettingsQuiet,
  httpLoadOnce as typedHttpLoadOnce,
  httpStartPoll as typedHttpStartPoll,
  httpStopPoll as typedHttpStopPoll,
} from "../utils/typedApi";

interface UseHttpPollingOptions {
  httpUrl: string;
  httpInterval: number;
  setHttpUrl: (url: string) => void;
  setHttpInterval: (interval: number) => void;
  setHttpStatus: (status: string) => void;
  appendEntries: (entries: any[]) => void;
}

export function useHttpPolling({
  httpUrl,
  httpInterval,
  setHttpUrl,
  setHttpInterval,
  setHttpStatus,
  appendEntries,
}: UseHttpPollingOptions) {
  const [httpPollId, setHttpPollId] = useState<number | null>(null);
  const [currentPollInterval, setCurrentPollInterval] = useState<number | null>(
    null,
  );
  const [nextPollDueAt, setNextPollDueAt] = useState<number | null>(null);
  const [nextPollIn, setNextPollIn] = useState<string>("");

  // Dialog states
  const [showHttpLoadDlg, setShowHttpLoadDlg] = useState<boolean>(false);
  const [httpLoadUrl, setHttpLoadUrl] = useState<string>("");
  const [showHttpPollDlg, setShowHttpPollDlg] = useState<boolean>(false);
  const [httpPollForm, setHttpPollForm] = useState({ url: "", interval: 5 });

  // Ref for stable access
  const httpPollIdRef = useRef<number | null>(httpPollId);
  useEffect(() => {
    httpPollIdRef.current = httpPollId;
  }, [httpPollId]);

  // Countdown timer effect
  useEffect(() => {
    if (!nextPollDueAt) {
      setNextPollIn("");
      return;
    }

    const tick = () => {
      const ms = Math.max(0, Number(nextPollDueAt) - Date.now());
      const active = httpPollId != null && currentPollInterval != null;
      setNextPollIn(ms > 0 ? `${Math.ceil(ms / 1000)}s` : active ? "0s" : "");
    };

    tick();
    const t = window.setInterval(tick, 250);
    return () => clearInterval(t);
  }, [nextPollDueAt, httpPollId, currentPollInterval]);

  // Keep countdown running
  useEffect(() => {
    const interval =
      currentPollInterval != null ? Math.max(500, currentPollInterval) : null;
    if (httpPollId == null || interval == null) return;

    setNextPollDueAt(Date.now() + interval);

    const h = window.setInterval(() => {
      setNextPollDueAt(Date.now() + interval);
    }, interval);

    return () => clearInterval(h);
  }, [httpPollId, currentPollInterval]);

  // Open HTTP Load Dialog
  const openHttpLoadDialog = useCallback(async () => {
    let url = httpUrl;
    try {
      const r = await getSettings();
      if (r && typeof r.httpUrl === "string") {
        url = r.httpUrl;
        setHttpUrl(url);
      }
    } catch (e) {
      logger.warn("Failed to load settings for HTTP load dialog:", e);
    }
    setHttpLoadUrl(String(url || ""));
    setShowHttpLoadDlg(true);
  }, [httpUrl, setHttpUrl]);

  // Open HTTP Poll Dialog
  const openHttpPollDialog = useCallback(async () => {
    let url = httpUrl;
    let interval = httpInterval;
    try {
      const r = await getSettings();
      if (r) {
        if (typeof r.httpUrl === "string") {
          url = r.httpUrl;
          setHttpUrl(url);
        }
        const int = r.httpPollInterval;
        if (int != null) {
          interval = Number(int) || 5;
          setHttpInterval(interval);
        }
      }
    } catch (e) {
      logger.warn("Failed to load settings for HTTP poll dialog:", e);
    }
    setHttpPollForm({
      url: String(url || ""),
      interval: Number(interval || 5),
    });
    setShowHttpPollDlg(true);
  }, [httpUrl, httpInterval, setHttpUrl, setHttpInterval]);

  // Load HTTP once
  const httpLoadOnce = useCallback(
    async (url: string) => {
      const trimmedUrl = String(url || "").trim();
      if (!trimmedUrl) return;

      try {
        setHttpUrl(trimmedUrl);
        patchSettingsQuiet({ httpUrl: trimmedUrl });
        const res = await typedHttpLoadOnce(trimmedUrl);
        if (res.ok) {
          appendEntries((res.entries || []) as any[]);
          setHttpStatus("");
        } else {
          setHttpStatus("Fehler: " + (res.error || "unbekannt"));
        }
      } catch (e) {
        setHttpStatus("Fehler: " + ((e as any)?.message || String(e)));
      }
    },
    [setHttpUrl, appendEntries, setHttpStatus],
  );

  // Start HTTP Poll
  const startHttpPoll = useCallback(
    async (url: string, intervalSec: number) => {
      const trimmedUrl = String(url || "").trim();
      const sec = Math.max(1, intervalSec);
      if (!trimmedUrl || httpPollId != null) return;

      try {
        setHttpUrl(trimmedUrl);
        setHttpInterval(sec);
        patchSettingsQuiet({
          httpUrl: trimmedUrl,
          httpPollInterval: sec,
        });

        const r = await typedHttpStartPoll({
          url: trimmedUrl,
          intervalSec: sec,
        });
        if (r.ok) {
          setHttpPollId(r.id!);
          setHttpStatus(`Polling #${r.id}`);
          // Convert to ms for internal timer tracking
          setNextPollDueAt(Date.now() + sec * 1000);
          setCurrentPollInterval(sec * 1000);
        } else {
          setHttpStatus("Fehler: " + (r.error || "unbekannt"));
        }
      } catch (e) {
        setHttpStatus("Fehler: " + ((e as any)?.message || String(e)));
      }
    },
    [httpPollId, setHttpUrl, setHttpInterval, setHttpStatus],
  );

  // Stop HTTP Poll
  const stopHttpPoll = useCallback(async () => {
    if (httpPollId == null) return;

    const r = await typedHttpStopPoll(httpPollId);
    if (r.ok) {
      setHttpStatus("Poll gestoppt");
      setHttpPollId(null);
      setNextPollIn("");
      setNextPollDueAt(null);
      setCurrentPollInterval(null);
    }
  }, [httpPollId, setHttpStatus]);

  return {
    // State
    httpPollId,
    httpPollIdRef,
    currentPollInterval,
    nextPollIn,

    // Dialog state
    showHttpLoadDlg,
    setShowHttpLoadDlg,
    httpLoadUrl,
    setHttpLoadUrl,
    showHttpPollDlg,
    setShowHttpPollDlg,
    httpPollForm,
    setHttpPollForm,

    // Actions
    openHttpLoadDialog,
    openHttpPollDialog,
    httpLoadOnce,
    startHttpPoll,
    stopHttpPoll,
  };
}
