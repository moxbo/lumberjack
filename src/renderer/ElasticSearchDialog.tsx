import { useEffect, useRef, useState } from "preact/hooks";
import { useI18n } from "../utils/i18n";

export default function ElasticSearchDialog(props: any) {
  const {
    open,
    initial,
    onApply,
    onClear,
    onClose,
    firstTs,
    lastTs,
    histAppName = [],
    histEnvironment = [],
    // NEW: Index history from settings
    histIndex = [],
  } = props as any;

  const { t } = useI18n();

  const [form, setForm] = useState(
    initial || {
      enabled: true,
      mode: "relative",
      duration: "15m",
      from: "",
      to: "",
      application_name: "",
      logger: "",
      level: "",
      environment: "",
      message: "", // NEU: Message-Filter
      // NEW: environment case handling
      environmentCase: "original", // 'original' | 'lower' | 'upper' | 'case-sensitive'
      loadMode: "append", // geändert: Standard jetzt 'append' statt 'replace'
      // new fields
      index: "",
      sort: "asc",
      allowInsecureTLS: false,
    },
  );

  // Dropdown-Flags für vollständige Listen
  const [showIdxList, setShowIdxList] = useState(false);
  const [showAppList, setShowAppList] = useState(false);
  const [showEnvList, setShowEnvList] = useState(false);

  // Progressive Disclosure: Sektionen ausklappbar
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    time: true, // Zeit-Optionen standardmäßig offen
    search: true, // Suchfelder standardmäßig offen
    advanced: false, // Erweiterte Optionen standardmäßig zu
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    function onDocClick() {
      setShowIdxList(false);
      setShowAppList(false);
      setShowEnvList(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (open) {
      const base = initial || {};
      const envCase = (base as any).environmentCase || "original";
      setForm({
        enabled: true,
        mode: (base as any).mode || "relative",
        duration: (base as any).duration || "15m",
        from: (base as any).from || "",
        to: (base as any).to || "",
        application_name: (base as any).application_name || "",
        logger: (base as any).logger || "",
        level: (base as any).level || "",
        environment: (base as any).environment || "",
        message: (base as any).message || "",
        environmentCase: envCase,
        loadMode: (base as any).loadMode || "append", // geändert: Default beim Öffnen
        index: (base as any).index || "",
        sort: (base as any).sort || "asc",
        allowInsecureTLS: !!(base as any).allowInsecureTLS,
      });
    }
  }, [open, initial]);

  // When the dialog opens, force the modal to receive keyboard focus.
  // This is necessary because a preceding native dialog (e.g. window.confirm
  // in clearLogs) can leave the webContents in a state where the DOM no longer
  // receives keyboard events.  Focusing the modal container re-establishes
  // the input routing.
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Delayed focus to ensure the DOM has rendered the dialog
    const id = setTimeout(() => {
      try {
        // Try to focus the first input inside the modal
        const firstInput = modalRef.current?.querySelector<HTMLElement>(
          "input, select, textarea, button",
        );
        if (firstInput) {
          firstInput.focus();
        } else {
          modalRef.current?.focus();
        }
      } catch {
        // ignore
      }
    }, 50);
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  function parseDateLike(v: any) {
    try {
      if (v == null) return null;
      let d: any = null;
      if (v instanceof Date) d = v;
      else if (typeof v === "number") d = new Date(v);
      else {
        const s = String(v).trim();
        if (!s) return null;
        if (/^\d+$/.test(s)) d = new Date(parseInt(s, 10));
        else d = new Date(s);
      }
      if (!d || isNaN(d.getTime())) return null;
      return d;
    } catch {
      return null;
    }
  }

  function fmtInputDatetimeLocal(v: any) {
    const d = parseDateLike(v);
    if (!d) return "";
    const pad = (n: any) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function setOlderRange() {
    const toStr = fmtInputDatetimeLocal(firstTs);
    setForm((f: any) => ({ ...f, mode: "absolute", to: toStr, from: "" }));
  }
  function setNewerRange() {
    const fromStr = fmtInputDatetimeLocal(lastTs);
    setForm((f: any) => ({ ...f, mode: "absolute", from: fromStr, to: "" }));
  }

  const isRel = form.mode === "relative";
  const isAbs = form.mode === "absolute";

  function fmtHm(v: any) {
    const d = parseDateLike(v);
    if (!d) return "—";
    const pad = (n: any) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Hilfsrenderer für einfache Dropdown-Liste
  function HistoryList(props: {
    items: any[];
    onPick: (v: string) => void;
    style?: any;
  }) {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div
        className="history-dropdown"
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: "4px",
          maxHeight: "280px",
          overflow: "auto",
          border: "1px solid var(--glass-border, var(--color-border))",
          borderRadius: "4px",
          background: "var(--color-bg-paper)",
          color: "var(--color-text-primary)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          padding: "4px",
          zIndex: 9999,
          ...(props.style || {}),
        }}
      >
        {items.length === 0 && (
          <div
            style={{ padding: "6px 8px", color: "var(--color-text-secondary)" }}
          >
            {t("elasticDialog.noEntries")}
          </div>
        )}
        {items.map((v: any, i: number) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => props.onPick(String(v))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") props.onPick(String(v));
            }}
            style={{
              padding: "6px 8px",
              cursor: "pointer",
              borderRadius: "4px",
            }}
            onMouseOver={(e) =>
              ((e.currentTarget as HTMLDivElement).style.backgroundColor =
                "var(--color-bg-hover)")
            }
            onMouseOut={(e) =>
              ((e.currentTarget as HTMLDivElement).style.backgroundColor =
                "transparent")
            }
            title={String(v)}
          >
            {String(v)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "600px" }}
        tabIndex={-1}
      >
        <h3>{t("elasticDialog.title")}</h3>

        {/* Quick Options - immer sichtbar */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "16px",
            flexWrap: "wrap",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              className="native-checkbox"
              checked={(form.loadMode || "append") === "append"}
              onChange={(e) =>
                setForm({
                  ...form,
                  loadMode: e.currentTarget.checked ? "append" : "replace",
                })
              }
            />
            <span>{t("elasticDialog.appendToLogs")}</span>
          </label>
        </div>

        {/* Sektion: Zeitraum */}
        <div
          className={`es-dialog-section ${expandedSections.time ? "" : "collapsed"}`}
        >
          <div
            className={`es-dialog-section-header ${expandedSections.time ? "expanded" : ""}`}
            onClick={() => toggleSection("time")}
          >
            <h4>
              {t("elasticDialog.timeSection")}
              {(form.duration || form.from || form.to) && (
                <span className="section-filled-badge">
                  {t("elasticDialog.timeSectionConfigured")}
                </span>
              )}
            </h4>
            <span className="expand-icon">▼</span>
          </div>
          <div className="es-dialog-section-content">
            {/* Modus-Auswahl */}
            <div className="kv">
              <span>{t("elasticDialog.mode")}</span>
              <div
                style={{ display: "flex", gap: "12px", alignItems: "center" }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <input
                    type="radio"
                    name="esMode"
                    value="relative"
                    checked={isRel}
                    onChange={() => setForm({ ...form, mode: "relative" })}
                  />
                  <span>{t("elasticDialog.modeRelative")}</span>
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <input
                    type="radio"
                    name="esMode"
                    value="absolute"
                    checked={isAbs}
                    onChange={() => setForm({ ...form, mode: "absolute" })}
                  />
                  <span>{t("elasticDialog.modeAbsolute")}</span>
                </label>
              </div>
            </div>

            {/* Dauer (relativ) */}
            {isRel && (
              <div className="kv">
                <span>{t("elasticDialog.duration")}</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {["5m", "15m", "1h", "6h", "24h"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setForm({ ...form, duration: d })}
                      style={
                        form.duration === d
                          ? {
                              background: "var(--accent-gradient)",
                              color: "white",
                              borderColor: "transparent",
                            }
                          : {}
                      }
                    >
                      {d}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={form.duration}
                    onInput={(e) =>
                      setForm({ ...form, duration: e.currentTarget.value })
                    }
                    placeholder={t("elasticDialog.durationPlaceholder")}
                    style={{ width: "80px" }}
                  />
                </div>
              </div>
            )}

            {/* Absolute Zeitfenster */}
            {isAbs && (
              <>
                <div className="kv">
                  <span>{t("elasticDialog.from")}</span>
                  <input
                    type="datetime-local"
                    value={form.from}
                    onInput={(e) =>
                      setForm({ ...form, from: e.currentTarget.value })
                    }
                  />
                </div>
                <div className="kv">
                  <span>{t("elasticDialog.to")}</span>
                  <input
                    type="datetime-local"
                    value={form.to}
                    onInput={(e) =>
                      setForm({ ...form, to: e.currentTarget.value })
                    }
                  />
                </div>
                {(firstTs || lastTs) && (
                  <div className="kv">
                    <span>{t("elasticDialog.quickSelect")}</span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={setOlderRange}
                        disabled={!firstTs}
                      >
                        {t("elasticDialog.olderThan", { time: fmtHm(firstTs) })}
                      </button>
                      <button
                        type="button"
                        onClick={setNewerRange}
                        disabled={!lastTs}
                      >
                        {t("elasticDialog.newerThan", { time: fmtHm(lastTs) })}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sektion: Suchkriterien */}
        <div
          className={`es-dialog-section ${expandedSections.search ? "" : "collapsed"}`}
        >
          <div
            className={`es-dialog-section-header ${expandedSections.search ? "expanded" : ""}`}
            onClick={() => toggleSection("search")}
          >
            <h4>
              {t("elasticDialog.searchSection")}
              {(form.application_name ||
                form.logger ||
                form.level ||
                form.environment ||
                form.message) && (
                <span className="section-filled-badge">
                  {t("elasticDialog.searchSectionActive")}
                </span>
              )}
            </h4>
            <span className="expand-icon">▼</span>
          </div>
          <div className="es-dialog-section-content">
            {/* Application Name */}
            <div className="kv">
              <span>{t("elasticDialog.application")}</span>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "6px",
                  }}
                >
                  <input
                    type="text"
                    value={form.application_name}
                    onInput={(e) =>
                      setForm({
                        ...form,
                        application_name: e.currentTarget.value,
                      })
                    }
                    placeholder={t("elasticDialog.applicationPlaceholder")}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAppList((v) => !v);
                      setShowIdxList(false);
                      setShowEnvList(false);
                    }}
                    disabled={
                      !Array.isArray(histAppName) || histAppName.length === 0
                    }
                  >
                    ▼
                  </button>
                </div>
                {showAppList && (
                  <HistoryList
                    items={Array.isArray(histAppName) ? histAppName : []}
                    onPick={(v) => {
                      setForm({ ...form, application_name: v });
                      setShowAppList(false);
                    }}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      marginTop: 0,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Level */}
            <div className="kv">
              <span>{t("elasticDialog.level")}</span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, level: "" })}
                  style={
                    !form.level
                      ? {
                          background: "var(--accent-gradient)",
                          color: "white",
                          borderColor: "transparent",
                        }
                      : {}
                  }
                >
                  {t("elasticDialog.levelAll")}
                </button>
                {["ERROR", "WARN", "INFO", "DEBUG"].map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setForm({ ...form, level: l })}
                    style={
                      form.level === l
                        ? {
                            background: `var(--color-level-${l.toLowerCase()})`,
                            color: "white",
                            borderColor: "transparent",
                          }
                        : {}
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Environment */}
            <div className="kv">
              <span>{t("elasticDialog.environment")}</span>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "6px",
                  }}
                >
                  <input
                    type="text"
                    value={form.environment}
                    onInput={(e) =>
                      setForm({ ...form, environment: e.currentTarget.value })
                    }
                    placeholder={t("elasticDialog.environmentPlaceholder")}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEnvList((v) => !v);
                      setShowIdxList(false);
                      setShowAppList(false);
                    }}
                    disabled={
                      !Array.isArray(histEnvironment) ||
                      histEnvironment.length === 0
                    }
                  >
                    ▼
                  </button>
                </div>
                {showEnvList && (
                  <HistoryList
                    items={
                      Array.isArray(histEnvironment) ? histEnvironment : []
                    }
                    onPick={(v) => {
                      setForm({ ...form, environment: v });
                      setShowEnvList(false);
                    }}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      marginTop: 0,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Logger */}
            <div className="kv">
              <span>{t("elasticDialog.logger")}</span>
              <input
                type="text"
                value={form.logger}
                onInput={(e) =>
                  setForm({ ...form, logger: e.currentTarget.value })
                }
                placeholder={t("elasticDialog.loggerPlaceholder")}
              />
            </div>

            {/* Message Filter */}
            <div className="kv">
              <span>{t("elasticDialog.message")}</span>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <input
                  type="text"
                  value={form.message}
                  onInput={(e) =>
                    setForm({ ...form, message: e.currentTarget.value })
                  }
                  placeholder={t("elasticDialog.messagePlaceholder")}
                  style={{ width: "100%" }}
                />
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--color-text-secondary)",
                    lineHeight: "1.3",
                  }}
                >
                  {t("elasticDialog.messageHint")}
                  <code
                    style={{
                      background: "var(--color-bg-hover)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                    }}
                  >
                    "…"
                  </code>{" "}
                  {t("elasticDialog.messageHintPhrase")}
                  <code
                    style={{
                      background: "var(--color-bg-hover)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      marginLeft: "4px",
                    }}
                  >
                    &
                  </code>{" "}
                  {t("elasticDialog.messageHintAnd")}
                  <code
                    style={{
                      background: "var(--color-bg-hover)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      marginLeft: "4px",
                    }}
                  >
                    |
                  </code>{" "}
                  {t("elasticDialog.messageHintOr")}
                  <code
                    style={{
                      background: "var(--color-bg-hover)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      marginLeft: "4px",
                    }}
                  >
                    !
                  </code>{" "}
                  {t("elasticDialog.messageHintNot")}
                  <code
                    style={{
                      background: "var(--color-bg-hover)",
                      padding: "1px 4px",
                      borderRadius: "3px",
                      marginLeft: "4px",
                    }}
                  >
                    ()
                  </code>
                  {t("elasticDialog.messageHintSuffix")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sektion: Erweiterte Optionen */}
        <div
          className={`es-dialog-section ${expandedSections.advanced ? "" : "collapsed"}`}
        >
          <div
            className={`es-dialog-section-header ${expandedSections.advanced ? "expanded" : ""}`}
            onClick={() => toggleSection("advanced")}
          >
            <h4>
              {t("elasticDialog.advancedSection")}
              {(form.index ||
                form.allowInsecureTLS ||
                form.environmentCase !== "original") && (
                <span className="section-filled-badge">
                  {t("elasticDialog.advancedCustomized")}
                </span>
              )}
            </h4>
            <span className="expand-icon">▼</span>
          </div>
          <div className="es-dialog-section-content">
            {/* Index */}
            <div className="kv">
              <span>{t("elasticDialog.index")}</span>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "6px",
                  }}
                >
                  <input
                    type="text"
                    value={form.index}
                    onInput={(e) =>
                      setForm({ ...form, index: e.currentTarget.value })
                    }
                    placeholder={t("elasticDialog.indexPlaceholder")}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowIdxList((v) => !v);
                      setShowAppList(false);
                      setShowEnvList(false);
                    }}
                    disabled={
                      !Array.isArray(histIndex) || histIndex.length === 0
                    }
                  >
                    ▼
                  </button>
                </div>
                {showIdxList && (
                  <HistoryList
                    items={Array.isArray(histIndex) ? histIndex : []}
                    onPick={(v) => {
                      setForm({ ...form, index: v });
                      setShowIdxList(false);
                    }}
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      marginTop: 0,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Environment Case */}
            <div className="kv">
              <span>{t("elasticDialog.envCase")}</span>
              <select
                value={form.environmentCase}
                onChange={(e) =>
                  setForm({ ...form, environmentCase: e.currentTarget.value })
                }
              >
                <option value="original">
                  {t("elasticDialog.envCaseOriginal")}
                </option>
                <option value="lower">{t("elasticDialog.envCaseLower")}</option>
                <option value="upper">{t("elasticDialog.envCaseUpper")}</option>
                <option value="case-sensitive">
                  {t("elasticDialog.envCaseSensitive")}
                </option>
              </select>
            </div>

            {/* Sort */}
            <div className="kv">
              <span>{t("elasticDialog.sort")}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <input
                    type="radio"
                    name="esSort"
                    value="asc"
                    checked={form.sort === "asc"}
                    onChange={() => setForm({ ...form, sort: "asc" })}
                  />
                  <span>{t("elasticDialog.sortAsc")}</span>
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <input
                    type="radio"
                    name="esSort"
                    value="desc"
                    checked={form.sort === "desc"}
                    onChange={() => setForm({ ...form, sort: "desc" })}
                  />
                  <span>{t("elasticDialog.sortDesc")}</span>
                </label>
              </div>
            </div>

            {/* TLS */}
            <div className="kv">
              <label
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <input
                  type="checkbox"
                  className="native-checkbox"
                  checked={!!form.allowInsecureTLS}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      allowInsecureTLS: e.currentTarget.checked,
                    })
                  }
                />
                <span>{t("elasticDialog.allowInsecureTLS")}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button
            onClick={onClear}
            title={t("elasticDialog.clearFieldsTooltip")}
          >
            {t("elasticDialog.clear")}
          </button>
          <button onClick={onClose}>{t("elasticDialog.cancel")}</button>
          <button
            onClick={() => onApply({ ...form, enabled: true })}
            style={{
              background: "var(--accent-gradient)",
              color: "white",
              borderColor: "transparent",
            }}
          >
            🔍 {t("elasticDialog.search")}
          </button>
        </div>
      </div>
    </div>
  );
}
