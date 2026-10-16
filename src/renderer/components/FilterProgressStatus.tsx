import { useEffect, useRef, useState } from "preact/hooks";
import type { FilterProgress } from "../../types/filterProgress";

type Translate = (key: string, params?: Record<string, string>) => string;

export function filterProgressLabel(
  progress: FilterProgress | null,
  running: boolean,
  locale: string,
  t: Translate,
): string {
  if (!running) return "";
  if (!progress) return t("searchProgress.starting");
  const number = new Intl.NumberFormat(locale);
  return t("searchProgress.running", {
    processed: number.format(progress.processed),
    total: number.format(progress.total),
  });
}

export function FilterProgressStatus({
  progress,
  running,
  locale,
  t,
}: {
  progress: FilterProgress | null;
  running: boolean;
  locale: string;
  t: Translate;
}) {
  const label = filterProgressLabel(progress, running, locale, t);
  const latest = useRef(label);
  latest.current = label;
  const [announcement, setAnnouncement] = useState(label);
  useEffect(() => {
    setAnnouncement(latest.current);
    if (!running) return;
    // Visual progress is immediate; speech updates at most once per second.
    const timer = setInterval(() => setAnnouncement(latest.current), 1000);
    return () => clearInterval(timer);
  }, [running, locale]);

  if (!running) return null;

  return (
    <div className="filter-progress" style={{ fontSize: "11px" }}>
      <span aria-hidden="true">{label}</span>
      <progress
        aria-label={t("searchProgress.label")}
        max={Math.max(1, progress?.total ?? 1)}
        value={progress?.processed ?? 0}
        style={{ width: "70px", marginLeft: "6px" }}
      />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {announcement}
      </span>
    </div>
  );
}
