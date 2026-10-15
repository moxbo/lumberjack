interface LiveIntakeStatusProps {
  count: number;
  limit: number;
  locale: string;
  onOpenSettings: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function LiveIntakeStatus({
  count,
  limit,
  locale,
  onOpenSettings,
  t,
}: LiveIntakeStatusProps) {
  const paused = count >= limit;
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="live-intake-status" data-paused={paused}>
      <div className="live-intake-usage">
        <span>
          {t("liveIntake.usage", {
            count: number.format(count),
            limit: number.format(limit),
          })}
        </span>
        <meter
          min={0}
          max={limit}
          value={Math.min(count, limit)}
          high={limit * 0.9}
          optimum={0}
          aria-label={t("liveIntake.label")}
        />
        <button type="button" onClick={onOpenSettings}>
          {t("liveIntake.settings")}
        </button>
      </div>
      {paused && (
        <div className="live-intake-paused" role="status">
          <strong>{t("liveIntake.paused")}</strong> {t("liveIntake.pausedHint")}
        </div>
      )}
    </div>
  );
}
