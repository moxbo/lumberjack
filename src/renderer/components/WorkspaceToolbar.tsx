import type { ComponentChildren } from "preact";

const paths = {
  open: "M3 7h6l2 2h10l-3 11H3V4h6l2 3",
  export: "M12 15V3m-4 4 4-4 4 4M4 13v8h16v-8",
  bottom: "M3 3h18v18H3zM3 14h18",
  right: "M3 3h18v18H3zM14 3v18",
  more: "M5 12h.1M12 12h.1M19 12h.1",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  filter: "M3 4h18l-7 8v7l-4 2v-9z",
  up: "m6 14 6-6 6 6",
  down: "m6 10 6 6 6-6",
  first: "M5 4h14m-13 11 6-6 6 6",
  last: "M5 20h14M6 9l6 6 6-6",
  bookmark: "M6 3h12v18l-6-4-6 4z",
} as const;

export function WorkspaceIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="workspace-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

interface WorkspaceToolbarProps {
  children: ComponentChildren;
  detailLayout: "bottom" | "right";
  onLayoutChange: (layout: "bottom" | "right") => void;
  onOpen: () => void;
  onExport: () => void;
  onSettings: () => void;
  onMore: () => void;
  busy: boolean;
  canExport: boolean;
  t: (key: string) => string;
}

export function WorkspaceToolbar({
  children,
  detailLayout,
  onLayoutChange,
  onOpen,
  onExport,
  onSettings,
  onMore,
  busy,
  canExport,
  t,
}: WorkspaceToolbarProps) {
  return (
    <div className="workspace-command">
      <div className="workspace-brand">
        <span aria-hidden="true">L</span>Lumberjack
      </div>
      <div className="workspace-file-actions">
        <button
          id="btnOpenLogs"
          className="workspace-primary"
          onClick={onOpen}
          disabled={busy}
        >
          <WorkspaceIcon name="open" />
          {t("workspace.open")}
        </button>
        <button
          id="btnExportLogs"
          onClick={onExport}
          disabled={busy || !canExport}
        >
          <WorkspaceIcon name="export" />
          {t("workspace.export")}
        </button>
      </div>
      {children}
      <div
        className="workspace-view-switch"
        role="group"
        aria-label={t("workspace.layout")}
      >
        {(["bottom", "right"] as const).map((layout) => (
          <button
            key={layout}
            id={`layout-${layout}`}
            aria-pressed={detailLayout === layout}
            title={t(`workspace.${layout}`)}
            aria-label={t(`workspace.${layout}`)}
            onClick={() => onLayoutChange(layout)}
          >
            <WorkspaceIcon name={layout} />
          </button>
        ))}
      </div>
      <button
        className="workspace-quiet"
        onClick={onSettings}
        title={t("workspace.settings")}
        aria-label={t("workspace.settings")}
      >
        <WorkspaceIcon name="settings" />
      </button>
      <button
        className="workspace-quiet"
        onClick={onMore}
        title={t("workspace.more")}
        aria-label={t("workspace.more")}
      >
        <WorkspaceIcon name="more" />
      </button>
    </div>
  );
}
