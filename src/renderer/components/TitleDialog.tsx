/**
 * Window Title Dialog Component
 */
import { useState, useEffect } from "preact/hooks";
import logger from "../../utils/logger";
import { useI18n } from "../../utils/i18n";

interface TitleDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TitleDialog({ open, onClose }: TitleDialogProps) {
  const { t } = useI18n();
  const [titleInput, setTitleInput] = useState<string>("Lumberjack");

  // Load current title when dialog opens
  useEffect(() => {
    if (!open) return;

    void (async () => {
      try {
        const res = await window.api?.windowTitleGet?.();
        const title =
          res?.ok && typeof res.title === "string" && res.title.trim()
            ? String(res.title)
            : "Lumberjack";
        setTitleInput(title);
      } catch {
        setTitleInput("Lumberjack");
      }
    })();
  }, [open]);

  const handleApply = (): void => {
    const title = String(titleInput || "").trim();
    if (!title) {
      alert(t("titleDialog.emptyError"));
      return;
    }
    void (async () => {
      try {
        await window.api?.windowTitleSet?.(title);
        onClose();
      } catch (e) {
        logger.error("Failed to set window title:", e);
        const message = (e as Error)?.message || String(e);
        alert(t("titleDialog.saveFailed", { message }));
      }
    })();
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("titleDialog.title")}</h3>
        <div className="kv full">
          <span>{t("titleDialog.label")}</span>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.currentTarget.value)}
            placeholder={t("titleDialog.placeholder")}
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t("titleDialog.cancel")}</button>
          <button onClick={handleApply}>{t("titleDialog.apply")}</button>
        </div>
      </div>
    </div>
  );
}
