/**
 * Help Dialog Component
 */
interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  if (!open) return null;

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
          🪓 Lumberjack - Hilfe
        </h3>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
        >
          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>📋 Übersicht</h4>
            <p>
              Lumberjack ist ein Log-Viewer für große Datenmengen und
              Live-Quellen mit Fokus auf Performance.
            </p>
          </section>

          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>📁 Datenquellen</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                <strong>Dateien:</strong> .log, .json, .jsonl, .txt und .zip
                (Drag & Drop oder Menü)
              </li>
              <li>
                <strong>HTTP:</strong> Einmaliges Laden oder periodisches
                Polling mit Deduplizierung
              </li>
              <li>
                <strong>TCP:</strong> Live-Log-Server für Echtzeit-Streams
              </li>
              <li>
                <strong>Elasticsearch:</strong> Logs aus ES-Clustern mit
                Zeitfilter
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>🔍 Volltextsuche</h4>
            <p style={{ marginBottom: "8px" }}>
              Syntax für die Nachrichtensuche:
            </p>
            <table style={tableStyle}>
              <tbody>
                <tr>
                  <td style={codeCell}>
                    <code>foo|bar</code>
                  </td>
                  <td style={descCell}>ODER - enthält 'foo' oder 'bar'</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>foo&bar</code>
                  </td>
                  <td style={descCell}>UND - enthält 'foo' und 'bar'</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>!foo</code>
                  </td>
                  <td style={descCell}>NICHT - enthält nicht 'foo'</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>foo&!bar</code>
                  </td>
                  <td style={descCell}>Kombination - 'foo' aber nicht 'bar'</td>
                </tr>
              </tbody>
            </table>
            <p style={hintStyle}>
              Suchmodus wählbar: Case-insensitiv (Standard), Case-sensitiv,
              Regex
            </p>
          </section>

          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>🎛️ Filter</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                <strong>Level:</strong> TRACE, DEBUG, INFO, WARN, ERROR, FATAL
              </li>
              <li>
                <strong>Logger:</strong> Substring-Suche im Logger-Namen
              </li>
              <li>
                <strong>Thread:</strong> Filtern nach Thread-Name
              </li>
              <li>
                <strong>DC-Filter:</strong> MDC-Keys wie TraceID, SpanID
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>🔎 Elasticsearch-Suche</h4>
            <p style={{ marginBottom: "8px" }}>
              Im Elasticsearch-Dialog kannst du nach verschiedenen Kriterien
              filtern:
            </p>
            <ul style={{ margin: "0 0 12px 0", paddingLeft: "20px" }}>
              <li>
                <strong>Application:</strong> Anwendungsname
              </li>
              <li>
                <strong>Level:</strong> ERROR, WARN, INFO, DEBUG
              </li>
              <li>
                <strong>Environment:</strong> prod, stage, dev
              </li>
              <li>
                <strong>Logger:</strong> Logger-Name (Substring)
              </li>
              <li>
                <strong>Message:</strong> Nachrichteninhalt mit erweiterter
                Syntax
              </li>
            </ul>
            <p style={{ marginBottom: "8px" }}>
              <strong>Message-Filter Syntax:</strong>
            </p>
            <table style={{ ...tableStyle, marginBottom: "8px" }}>
              <tbody>
                <tr>
                  <td style={{ ...codeCell, width: "180px" }}>
                    <code>error</code>
                  </td>
                  <td style={descCell}>Einfache Suche (serverseitig)</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>xml&CB24</code>
                  </td>
                  <td style={descCell}>UND - enthält 'xml' und 'CB24'</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>xml&(CB24|CB27)</code>
                  </td>
                  <td style={descCell}>
                    Gruppierung - 'xml' und ('CB24' oder 'CB27')
                  </td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <code>error&!timeout</code>
                  </td>
                  <td style={descCell}>NICHT - 'error' aber nicht 'timeout'</td>
                </tr>
              </tbody>
            </table>
            <p
              style={{
                fontSize: "11px",
                color: "var(--color-text-secondary)",
                margin: 0,
              }}
            >
              💡 Einfache Begriffe werden serverseitig gefiltert (schneller).
              Erweiterte Syntax (&, |, !, ()) wird client-seitig nach dem Laden
              angewendet.
            </p>
          </section>

          <section style={{ marginBottom: "20px" }}>
            <h4 style={sectionHeaderStyle}>⌨️ Tastaturkürzel</h4>
            <table style={tableStyle}>
              <tbody>
                <tr>
                  <td style={{ ...codeCell, width: "140px" }}>
                    <kbd>⌘/Ctrl + F</kbd>
                  </td>
                  <td style={descCell}>Suchfeld fokussieren</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>⌘/Ctrl + ⇧ + F</kbd>
                  </td>
                  <td style={descCell}>Filter ein-/ausblenden</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>j / k</kbd>
                  </td>
                  <td style={descCell}>Navigation (Vim-Style)</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>g / G</kbd>
                  </td>
                  <td style={descCell}>Zum Anfang / Ende</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>n / N</kbd>
                  </td>
                  <td style={descCell}>Nächster / Vorheriger Treffer</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>↑ / ↓</kbd>
                  </td>
                  <td style={descCell}>Navigation (Standard)</td>
                </tr>
                <tr>
                  <td style={codeCell}>
                    <kbd>Escape</kbd>
                  </td>
                  <td style={descCell}>Auswahl aufheben / Dialog schließen</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h4 style={sectionHeaderStyle}>💡 Tipps</h4>
            <ul style={{ margin: "0", paddingLeft: "20px" }}>
              <li>
                Rechtsklick auf Zeilen für Kontextmenü (Markieren, Färben)
              </li>
              <li>Detail-Panel-Höhe per Drag anpassbar</li>
              <li>Spaltenbreiten durch Ziehen der Trenner anpassbar</li>
              <li>Aktive Filter werden als Chips angezeigt</li>
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
            Schließen
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
