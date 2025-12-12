/**
 * HTTP Load and Poll Dialog Components
 */
import { useState, useEffect } from "preact/hooks";

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
  const [url, setUrl] = useState<string>(initialUrl);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
    }
  }, [open, initialUrl]);

  const handleLoad = async () => {
    const trimmedUrl = String(url || "").trim();
    if (!trimmedUrl) {
      alert("Bitte eine gültige URL eingeben");
      return;
    }
    onClose();
    await onLoad(trimmedUrl);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>HTTP einmal laden</h3>
        <div className="kv">
          <span>HTTP URL</span>
          <input
            type="text"
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder="https://…/logs.json"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Abbrechen</button>
          <button onClick={handleLoad}>Laden</button>
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
  onStart: (url: string, intervalMs: number) => Promise<void>;
}

export function HttpPollDialog({
  open,
  initialUrl,
  initialInterval,
  isPollActive,
  onClose,
  onStart,
}: HttpPollDialogProps) {
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
    const ms = Math.max(500, Number(form.interval || 5000));

    if (!url) {
      alert("Bitte eine gültige URL eingeben");
      return;
    }
    if (isPollActive) return;

    onClose();
    await onStart(url, ms);
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>HTTP Poll starten</h3>
        <div className="kv">
          <span>HTTP URL</span>
          <input
            type="text"
            value={form.url}
            onInput={(e) => setForm({ ...form, url: e.currentTarget.value })}
            placeholder="https://…/logs.json"
            autoFocus
          />
        </div>
        <div className="kv">
          <span>Intervall (ms)</span>
          <input
            type="number"
            min="500"
            step="500"
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
          <button onClick={onClose}>Abbrechen</button>
          <button
            disabled={isPollActive}
            title={isPollActive ? "Bitte laufendes Polling zuerst stoppen" : ""}
            onClick={handleStart}
          >
            Starten
          </button>
        </div>
      </div>
    </div>
  );
}
