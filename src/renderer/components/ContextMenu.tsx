/**
 * Context Menu Component for log entries
 */
import type { RefObject } from "preact";
import { useI18n } from "../../utils/i18n";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  ctxRef: RefObject<HTMLDivElement>;
  palette: string[];
  pickerColor: string;
  onPickerColorChange: (color: string) => void;
  onApplyMark: (color?: string) => void;
  onAddCustomColor: (color: string) => void;
  onAdoptTraceIds: () => void;
  onCopyTsMsg: () => void;
}

export function ContextMenu({
  open,
  x,
  y,
  ctxRef,
  palette,
  pickerColor,
  onPickerColorChange,
  onApplyMark,
  onAddCustomColor,
  onAdoptTraceIds,
  onCopyTsMsg,
}: ContextMenuProps) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div
      ref={ctxRef}
      className="context-menu"
      style={{ left: x + "px", top: y + "px" }}
    >
      <div className="item" onClick={() => onApplyMark(undefined)}>
        {t("contextMenu.removeMark")}
      </div>
      <div className="colors">
        {palette.map((c, i) => (
          <div
            key={i}
            className="swatch"
            style={{ background: c }}
            onClick={() => onApplyMark(c)}
            title={c}
          />
        ))}
      </div>
      <div
        className="item"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span>{t("contextMenu.color")}</span>
        <input
          type="color"
          className="swatch"
          value={pickerColor}
          onInput={(e) => onPickerColorChange(e.currentTarget.value)}
        />
        <button
          onClick={() => onApplyMark(pickerColor)}
          title={t("contextMenu.applyColorTooltip")}
        >
          {t("contextMenu.apply")}
        </button>
        <button
          onClick={() => onAddCustomColor(pickerColor)}
          title={t("contextMenu.addColorTooltip")}
        >
          {t("contextMenu.add")}
        </button>
      </div>
      <div className="sep" />
      <div className="item" onClick={onAdoptTraceIds}>
        {t("contextMenu.adoptTraceIds")}
      </div>
      <div className="item" onClick={onCopyTsMsg}>
        {t("contextMenu.copyTsMsg")}
      </div>
    </div>
  );
}
