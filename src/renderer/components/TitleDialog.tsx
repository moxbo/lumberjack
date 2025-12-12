/**
 * Window Title Dialog Component
 */
import { useState, useEffect } from "preact/hooks";
import logger from "../../utils/logger";

interface TitleDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TitleDialog({ open, onClose }: TitleDialogProps) {
  const [titleInput, setTitleInput] = useState<string>("Lumberjack");

  // Load current title when dialog opens
  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        const res = await window.api?.windowTitleGet?.();
        const t =
          res?.ok && typeof res.title === "string" && res.title.trim()
            ? String(res.title)
            : "Lumberjack";
        setTitleInput(t);
      } catch {
        setTitleInput("Lumberjack");
      }
    })();
  }, [open]);

  const handleApply = async () => {
    const t = String(titleInput || "").trim();
    if (!t) {
      alert("Bitte einen Fenstertitel eingeben");
      return;
    }
    try {
      await window.api?.windowTitleSet?.(t);
      onClose();
    } catch (e) {
      logger.error("Failed to set window title:", e);
      alert("Speichern fehlgeschlagen: " + ((e as any)?.message || String(e)));
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Fenster-Titel setzen</h3>
        <div className="kv full">
          <span>Titel</span>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.currentTarget.value)}
            placeholder="Lumberjack"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>Abbrechen</button>
          <button onClick={handleApply}>Übernehmen</button>
        </div>
      </div>
    </div>
  );
}
