/**
 * AlertDialog Component
 * Simple modal alert for displaying messages to the user
 */

interface AlertDialogProps {
  open: boolean;
  title?: string;
  message: string;
  type?: "info" | "warning" | "error";
  onClose: () => void;
}

export function AlertDialog({
  open,
  title,
  message,
  type = "info",
  onClose,
}: AlertDialogProps) {
  if (!open) return null;

  const iconMap = {
    info: "ℹ️",
    warning: "⚠️",
    error: "❌",
  };

  const icon = iconMap[type];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal modal-alert modal-alert-${type}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="alert-content">
          <span className="alert-icon">{icon}</span>
          <div className="alert-text">
            {title && <h4 className="alert-title">{title}</h4>}
            <p className="alert-message">{message}</p>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={onClose} autoFocus>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
