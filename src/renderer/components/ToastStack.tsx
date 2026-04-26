import type { JSX } from "preact/jsx-runtime";
import type { Toast } from "../../hooks/useToasts";

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  closeLabel?: string;
}

const ICONS: Record<Toast["severity"], string> = {
  success: "\u2713",
  info: "\u2139",
  warning: "\u26A0",
  error: "\u2715",
};

export function ToastStack(props: ToastStackProps): JSX.Element | null {
  const { toasts, onDismiss, closeLabel = "Schliessen" } = props;
  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-stack"
      role="region"
      aria-label="Benachrichtigungen"
      aria-live="polite"
    >
      {toasts.map((tst) => (
        <div
          key={tst.id}
          className={`toast toast-${tst.severity}`}
          role={tst.severity === "error" ? "alert" : "status"}
        >
          <span className="toast-icon" aria-hidden="true">
            {ICONS[tst.severity]}
          </span>
          <span className="toast-message">{tst.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(tst.id)}
            aria-label={closeLabel}
            title={closeLabel}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
