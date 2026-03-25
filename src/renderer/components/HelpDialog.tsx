/**
 * Help Dialog Component
 */
import { useI18n } from "../../utils/i18n";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const { t } = useI18n();
  if (!open) return null;

  // Search syntax rows: [example key, description key]
  const searchRows: [string, string][] = [
    ["help.search.phraseExample", "help.search.phraseDesc"],
    ["help.search.implicitAndExample", "help.search.implicitAndDesc"],
    ["help.search.orExample", "help.search.orDesc"],
    ["help.search.andExample", "help.search.andDesc"],
    ["help.search.notExample", "help.search.notDesc"],
    ["help.search.combinedExample", "help.search.combinedDesc"],
    ["help.search.groupExample", "help.search.groupDesc"],
    ["help.search.escapeExample", "help.search.escapeDesc"],
  ];

  // ES syntax rows
  const esRows: [string, string][] = [
    ["help.elasticsearch.simpleExample", "help.elasticsearch.simpleDesc"],
    ["help.elasticsearch.phraseExample", "help.elasticsearch.phraseDesc"],
    [
      "help.elasticsearch.implicitAndExample",
      "help.elasticsearch.implicitAndDesc",
    ],
    ["help.elasticsearch.groupExample", "help.elasticsearch.groupDesc"],
    ["help.elasticsearch.notExample", "help.elasticsearch.notDesc"],
  ];

  // Keyboard shortcuts: [key combo, description key]
  const kbRows: [string, string][] = [
    ["⌘/Ctrl + F", "help.keyboard.ctrlF"],
    ["⌘/Ctrl + ⇧ + F", "help.keyboard.ctrlShiftF"],
    ["⌘/Ctrl + K", "help.keyboard.ctrlK"],
    ["F1", "help.keyboard.f1"],
    ["Enter", "help.keyboard.enter"],
    ["j / k", "help.keyboard.jk"],
    ["g / G", "help.keyboard.gG"],
    ["Home / End", "help.keyboard.homeEnd"],
    ["n / N", "help.keyboard.nN"],
    ["↑ / ↓", "help.keyboard.arrows"],
    ["⇧ + ↑/↓/j/k", "help.keyboard.shiftSelect"],
    ["Escape", "help.keyboard.escape"],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "700px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px 0",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          {t("help.title")}
        </h3>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
        >
          {/* Overview */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>{t("help.overview.heading")}</h4>
            <p>{t("help.overview.text")}</p>
          </section>

          {/* Data Sources */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>{t("help.dataSources.heading")}</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                <strong>Files:</strong> {t("help.dataSources.files")}
              </li>
              <li>
                <strong>HTTP:</strong> {t("help.dataSources.http")}
              </li>
              <li>
                <strong>TCP:</strong> {t("help.dataSources.tcp")}
              </li>
              <li>
                <strong>Elasticsearch:</strong> {t("help.dataSources.elastic")}
              </li>
            </ul>
          </section>

          {/* Full-Text Search */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>{t("help.search.heading")}</h4>
            <p style={{ marginBottom: "8px" }}>{t("help.search.intro")}</p>
            <table style={tableStyle}>
              <tbody>
                {searchRows.map(([exKey, descKey]) => (
                  <tr key={exKey}>
                    <td style={codeCell}>
                      <code>{t(exKey)}</code>
                    </td>
                    <td style={descCell}>{t(descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={hintStyle}>
              {t("help.search.hintPhrase")}
              <code>{t("help.search.hintPhraseExample")}</code>
              {t("help.search.hintPhraseSuffix")}
              <br />
              {t("help.search.hintEscape")}
              <code>{"\\&"}</code> <code>{"\\|"}</code> <code>{"\\!"}</code>{" "}
              <code>{"\\("}</code> <code>{"\\)"}</code>
              <br />
              {t("help.search.hintMode")}
            </p>
          </section>

          {/* Filters */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>{t("help.filters.heading")}</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                <strong>Level:</strong> {t("help.filters.level")}
              </li>
              <li>
                <strong>Logger:</strong> {t("help.filters.logger")}
              </li>
              <li>
                <strong>Thread:</strong> {t("help.filters.thread")}
              </li>
              <li>
                <strong>DC-Filter:</strong> {t("help.filters.dc")}
              </li>
              <li>
                <strong>{t("toolbar.toggleMarked")}:</strong>{" "}
                {t("help.filters.markedOnly")}
              </li>
              <li>
                <strong>{t("filterProfiles.button")}:</strong>{" "}
                {t("help.filters.profiles")}
              </li>
            </ul>
          </section>

          {/* Elasticsearch */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>
              {t("help.elasticsearch.heading")}
            </h4>
            <p style={{ marginBottom: "8px" }}>
              {t("help.elasticsearch.intro")}
            </p>
            <ul style={{ margin: "0 0 12px 0", paddingLeft: "20px" }}>
              <li>
                <strong>Application:</strong>{" "}
                {t("help.elasticsearch.application")}
              </li>
              <li>
                <strong>Level:</strong> {t("help.elasticsearch.level")}
              </li>
              <li>
                <strong>Environment:</strong>{" "}
                {t("help.elasticsearch.environment")}
              </li>
              <li>
                <strong>Logger:</strong> {t("help.elasticsearch.logger")}
              </li>
              <li>
                <strong>Message:</strong> {t("help.elasticsearch.message")}
              </li>
            </ul>
            <p style={{ marginBottom: "8px" }}>
              <strong>{t("help.elasticsearch.syntaxHeading")}</strong>
            </p>
            <table style={{ ...tableStyle, marginBottom: "8px" }}>
              <tbody>
                {esRows.map(([exKey, descKey], i) => (
                  <tr key={exKey}>
                    <td
                      style={
                        i === 0 ? { ...codeCell, width: "180px" } : codeCell
                      }
                    >
                      <code>{t(exKey)}</code>
                    </td>
                    <td style={descCell}>{t(descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p
              style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              {t("help.elasticsearch.hint")}
            </p>
          </section>

          {/* Keyboard Shortcuts */}
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>{t("help.keyboard.heading")}</h4>
            <table style={tableStyle}>
              <tbody>
                {kbRows.map(([combo, descKey]) => (
                  <tr key={combo}>
                    <td style={{ ...codeCell, width: "140px" }}>
                      <kbd>{combo}</kbd>
                    </td>
                    <td style={descCell}>{t(descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Tips */}
          <section>
            <h4 style={sectionHeaderStyle}>{t("help.tips.heading")}</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                <strong>Command Palette:</strong> <kbd>⌘/Ctrl + K</kbd>{" "}
                {t("help.tips.commandPalette")}
              </li>
              <li>
                <strong>{t("contextMenu.color")}:</strong>{" "}
                {t("help.tips.contextMenu")}
              </li>
              <li>
                <strong>Follow:</strong> {t("help.tips.followMode")}
              </li>
              <li>
                <strong>{t("traceTimeline.title")}:</strong>{" "}
                {t("help.tips.traceTimeline")}
              </li>
              <li>
                <strong>{t("toolbar.search")}:</strong>{" "}
                {t("help.tips.searchHistory")}
              </li>
              <li>
                <strong>Export:</strong> {t("help.tips.export")}
              </li>
              <li>{t("help.tips.detailPanel")}</li>
              <li>{t("help.tips.columnResize")}</li>
              <li>{t("help.tips.filterChips")}</li>
            </ul>
          </section>
        </div>
        <div
          className="modal-actions"
          style={{
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-divider)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "var(--accent-gradient)",
              color: "white",
              border: "none",
            }}
          >
            {t("help.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const sectionHeaderStyle = {
  color: "var(--color-primary)",
  marginBottom: "8px",
  borderBottom: "1px solid var(--color-divider)",
  paddingBottom: "4px",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: "12px",
};

const codeCell = {
  padding: "4px 8px",
  background: "var(--color-bg-hover)",
};

const descCell = {
  padding: "4px 8px",
};

const hintStyle = {
  marginTop: "8px",
  fontSize: "12px",
  color: "var(--color-text-secondary)",
};
