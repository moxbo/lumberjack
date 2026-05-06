/**
 * ConfirmDialog Component
 *
 * In-App replacement for window.confirm() that avoids the Electron/Chromium
 * focus-routing bug triggered by native modal dialogs.
 *
 * Renders inside the existing webContents – no OS-level focus loss, no
 * window flicker.
 */

import { useEffect, useRef } from "preact/hooks";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: "info" | "warning" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Abbrechen",
  type = "warning",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the confirm button so Enter / Esc work immediately.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      try {
        confirmBtnRef.current?.focus();
      } catch {
        /* ignore */
      }
    }, 30);
    return () => clearTimeout(id);
  }, [open]);

  // Keyboard shortcuts: Enter = confirm, Esc = cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const iconMap = {
    info: "ℹ️",
    warning: "⚠️",
    danger: "❌",
  } as const;
  const icon = iconMap[type];

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className={`modal modal-alert modal-alert-${type === "danger" ? "error" : type}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="alert-content">
          <span className="alert-icon">{icon}</span>
          <div className="alert-text">
            {title && <h4 className="alert-title">{title}</h4>}
            <p className="alert-message" style={{ whiteSpace: "pre-wrap" }}>
              {message}
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={
              type === "danger"
                ? {
                    background: "var(--color-level-error, #d33)",
                    color: "white",
                    borderColor: "transparent",
                  }
                : {
                    background: "var(--accent-gradient)",
                    color: "white",
                    borderColor: "transparent",
                  }
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
