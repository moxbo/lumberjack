/**
 * HTTP Load and Poll Dialog Components
 */
import { useState, useEffect } from "preact/hooks";
import { useI18n } from "../../utils/i18n";
import { nativeAlert } from "../../utils/nativeDialog";
import {
  httpGetAllowInsecureSSL,
  httpSetAllowInsecureSSL,
} from "../../utils/typedApi";

interface HttpLoadDialogProps {
  open: boolean;
  initialUrl: string;
  onClose: () => void;
  onLoad: (url: string) => Promise<void>;
}

export function HttpLoadDialog({
  open,
  initialUrl,
  onClose,
  onLoad,
}: HttpLoadDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string>(initialUrl);
  const [allowInsecureSSL, setAllowInsecureSSL] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      // Load current insecure SSL setting
      void httpGetAllowInsecureSSL().then((val) => {
        setAllowInsecureSSL(val);
      });
    }
  }, [open, initialUrl]);

  const handleLoad = async () => {
    const trimmedUrl = String(url || "").trim();
    if (!trimmedUrl) {
      nativeAlert(t("dialogs.httpLoad.invalidUrl"));
      return;
    }
    // Apply insecure SSL setting before loading
    await httpSetAllowInsecureSSL(allowInsecureSSL);
    onClose();
    await onLoad(trimmedUrl);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("dialogs.httpLoad.title")}</h3>
        <div className="kv">
          <span>{t("dialogs.httpLoad.url")}</span>
          <input
            type="text"
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder={t("dialogs.httpLoad.urlPlaceholder")}
            autoFocus
          />
        </div>
        <div className="kv">
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={allowInsecureSSL}
              onChange={(e) => setAllowInsecureSSL(e.currentTarget.checked)}
            />
            <span title={t("dialogs.httpLoad.allowInsecureSSLHint")}>
              {t("dialogs.httpLoad.allowInsecureSSL")}
            </span>
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t("dialogs.httpLoad.cancel")}</button>
          <button onClick={handleLoad}>{t("dialogs.httpLoad.load")}</button>
        </div>
      </div>
    </div>
  );
}

interface HttpPollDialogProps {
  open: boolean;
  initialUrl: string;
  initialInterval: number;
  isPollActive: boolean;
  onClose: () => void;
  onStart: (url: string, intervalSec: number) => Promise<void>;
}

export function HttpPollDialog({
  open,
  initialUrl,
  initialInterval,
  isPollActive,
  onClose,
  onStart,
}: HttpPollDialogProps) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    url: initialUrl,
    interval: initialInterval,
  });

  useEffect(() => {
    if (open) {
      setForm({
        url: initialUrl,
        interval: initialInterval,
      });
    }
  }, [open, initialUrl, initialInterval]);

  const handleStart = async () => {
    const url = String(form.url || "").trim();
    const sec = Math.max(1, Number(form.interval || 5));

    if (!url) {
      nativeAlert(t("dialogs.httpPoll.invalidUrl"));
      return;
    }
    if (isPollActive) return;

    onClose();
    await onStart(url, sec);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("dialogs.httpPoll.title")}</h3>
        <div className="kv">
          <span>{t("dialogs.httpPoll.url")}</span>
          <input
            type="text"
            value={form.url}
            onInput={(e) => setForm({ ...form, url: e.currentTarget.value })}
            placeholder={t("dialogs.httpPoll.urlPlaceholder")}
            autoFocus
          />
        </div>
        <div className="kv">
          <span>{t("dialogs.httpPoll.interval")}</span>
          <input
            type="number"
            min="1"
            step="1"
            value={form.interval}
            onInput={(e) =>
              setForm({
                ...form,
                interval: Math.max(0, Number(e.currentTarget.value || 0)),
              })
            }
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t("dialogs.httpPoll.cancel")}</button>
          <button
            disabled={isPollActive}
            title={isPollActive ? t("dialogs.httpPoll.stopFirst") : ""}
            onClick={handleStart}
          >
            {t("dialogs.httpPoll.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface HttpTailDialogProps {
  open: boolean;
  initialUrl: string;
  initialIntervalSec: number;
  initialEmitInitial: boolean;
  initialAllowInsecureSSL: boolean;
  initialAuthHeader: string;
  isAnyTailActive: boolean;
  onClose: () => void;
  onStart: (args: {
    url: string;
    intervalSec: number;
    emitInitial: boolean;
    allowInsecureSSL: boolean;
    authHeader: string;
  }) => Promise<void>;
}

/**
 * Dialog for starting an incremental HTTP tail (Range-based).
 * Optimised for endpoints like Spring Boot Actuator's `/actuator/logfile`.
 */
export function HttpTailDialog({
  open,
  initialUrl,
  initialIntervalSec,
  initialEmitInitial,
  initialAllowInsecureSSL,
  initialAuthHeader,
  isAnyTailActive,
  onClose,
  onStart,
}: HttpTailDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string>(initialUrl);
  const [intervalSec, setIntervalSec] = useState<number>(initialIntervalSec);
  const [emitInitial, setEmitInitial] = useState<boolean>(initialEmitInitial);
  const [allowInsecureSSL, setAllowInsecureSSL] = useState<boolean>(
    initialAllowInsecureSSL,
  );
  const [authHeader, setAuthHeader] = useState<string>(initialAuthHeader);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setIntervalSec(initialIntervalSec);
      setEmitInitial(initialEmitInitial);
      setAllowInsecureSSL(initialAllowInsecureSSL);
      setAuthHeader(initialAuthHeader);
    }
  }, [
    open,
    initialUrl,
    initialIntervalSec,
    initialEmitInitial,
    initialAllowInsecureSSL,
    initialAuthHeader,
  ]);

  const handleStart = async () => {
    const trimmed = String(url || "").trim();
    if (!trimmed) {
      nativeAlert(t("dialogs.httpTail.invalidUrl"));
      return;
    }
    onClose();
    await onStart({
      url: trimmed,
      intervalSec: Math.max(1, intervalSec),
      emitInitial,
      allowInsecureSSL,
      authHeader: String(authHeader || "").trim(),
    });
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("dialogs.httpTail.title")}</h3>
        <p className="dialog-hint">{t("dialogs.httpTail.hint")}</p>
        <div className="kv">
          <span>{t("dialogs.httpTail.url")}</span>
          <input
            type="text"
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder={t("dialogs.httpTail.urlPlaceholder")}
            autoFocus
          />
        </div>
        <div className="kv">
          <span>{t("dialogs.httpTail.interval")}</span>
          <input
            type="number"
            min="1"
            step="1"
            value={intervalSec}
            onInput={(e) =>
              setIntervalSec(Math.max(1, Number(e.currentTarget.value || 1)))
            }
          />
        </div>
        <div className="kv">
          <span>{t("dialogs.httpTail.authHeader")}</span>
          <input
            type="text"
            value={authHeader}
            onInput={(e) => setAuthHeader(e.currentTarget.value)}
            placeholder={t("dialogs.httpTail.authHeaderPlaceholder")}
          />
        </div>
        <div className="kv">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={emitInitial}
              onChange={(e) => setEmitInitial(e.currentTarget.checked)}
            />
            <span title={t("dialogs.httpTail.emitInitialHint")}>
              {t("dialogs.httpTail.emitInitial")}
            </span>
          </label>
        </div>
        <div className="kv">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allowInsecureSSL}
              onChange={(e) => setAllowInsecureSSL(e.currentTarget.checked)}
            />
            <span title={t("dialogs.httpLoad.allowInsecureSSLHint")}>
              {t("dialogs.httpLoad.allowInsecureSSL")}
            </span>
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t("common.cancel")}</button>
          <button
            disabled={isAnyTailActive}
            title={isAnyTailActive ? t("dialogs.httpTail.stopFirst") : ""}
            onClick={handleStart}
          >
            {t("dialogs.httpTail.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
