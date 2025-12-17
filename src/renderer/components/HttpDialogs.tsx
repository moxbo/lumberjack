/**
 * HTTP Load and Poll Dialog Components
 */
import { useState, useEffect } from "preact/hooks";
import { useI18n } from "../../utils/i18n";

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

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
    }
  }, [open, initialUrl]);

  const handleLoad = async () => {
    const trimmedUrl = String(url || "").trim();
    if (!trimmedUrl) {
      alert(t("dialogs.httpLoad.invalidUrl"));
      return;
    }
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
      alert(t("dialogs.httpPoll.invalidUrl"));
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
