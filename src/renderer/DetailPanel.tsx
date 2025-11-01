// Detail panel with progressive disclosure for stack traces and MDC
import { useState } from 'preact/hooks';

interface DetailPanelProps {
  entry: Record<string, unknown> | null;
  search: string;
  highlightFn: (text: string, search: string) => string;
  t: (key: string) => string;
  markColor?: string;
}

function levelClass(level: string | null | undefined): string {
  const l = (level || '').toUpperCase();
  return (
    {
      TRACE: 'lev-trace',
      DEBUG: 'lev-debug',
      INFO: 'lev-info',
      WARN: 'lev-warn',
      ERROR: 'lev-error',
      FATAL: 'lev-fatal',
    }[l] || 'lev-unk'
  );
}

function fmt(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return '';
}

function fmtTimestamp(ts: string | number | Date | null | undefined): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  } catch {
    return String(ts);
  }
}

function computeTint(color: string | null | undefined, alpha = 0.4): string {
  if (!color) return '';
  const c = String(color).trim();
  const hexRaw = c.startsWith('#') ? c.slice(1) : '';
  const hex = String(hexRaw);
  if (hex.length === 3 && hex.length >= 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16);
    const g = parseInt(hex[1]! + hex[1]!, 16);
    const b = parseInt(hex[2]! + hex[2]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}

export function DetailPanel({
  entry,
  search,
  highlightFn,
  t,
  markColor,
}: DetailPanelProps): JSX.Element {
  const [stackExpanded, setStackExpanded] = useState(false);
  const [mdcExpanded, setMdcExpanded] = useState(false);

  if (!entry) {
    return <div style={{ color: 'var(--color-text-secondary)' }}>{t('details.noSelection')}</div>;
  }

  const hasStackTrace = !!(entry.stack_trace || entry.stackTrace);
  const hasMdc = entry.mdc && typeof entry.mdc === 'object' && Object.keys(entry.mdc).length > 0;

  return (
    <div
      data-tinted={markColor ? '1' : '0'}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--details-tint' as any]: computeTint(markColor, 0.22),
      }}
    >
      <div className="meta-grid">
        <div>
          <div className="kv">
            <span>{t('details.time')}</span>
            <div>{fmtTimestamp(entry.timestamp)}</div>
          </div>
          <div className="kv">
            <span>{t('details.logger')}</span>
            <div>{fmt(entry.logger)}</div>
          </div>
        </div>
        <div>
          <div className="kv">
            <span>{t('details.level')}</span>
            <div>
              <span className={levelClass(entry.level)}>{fmt(entry.level)}</span>
            </div>
          </div>
          <div className="kv">
            <span>{t('details.thread')}</span>
            <div>{fmt(entry.thread)}</div>
          </div>
        </div>
      </div>

      <div className="section-sep" />

      <div className="kv full">
        <span>{t('details.message')}</span>
        <pre
          id="dMessage"
          dangerouslySetInnerHTML={{
            __html: highlightFn(entry.message || '', search),
          }}
        />
      </div>

      {/* Progressive disclosure for stack trace */}
      {hasStackTrace && (
        <div className="kv full">
          <span
            onClick={() => setStackExpanded(!stackExpanded)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {stackExpanded ? '▼' : '▶'} {t('details.stacktrace')}
          </span>
          {stackExpanded && (
            <pre className="stack-trace">
              {String(
                (entry.stack_trace as string | undefined) ||
                  (entry.stackTrace as string | undefined) ||
                  ''
              )}
            </pre>
          )}
        </div>
      )}

      {/* Progressive disclosure for MDC */}
      {hasMdc && (
        <div className="kv full">
          <span
            onClick={() => setMdcExpanded(!mdcExpanded)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {mdcExpanded ? '▼' : '▶'} MDC ({Object.keys(entry.mdc).length})
          </span>
          {mdcExpanded && (
            <div style={{ marginTop: '8px' }}>
              {Object.entries(entry.mdc).map(([key, value]) => (
                <div key={key} style={{ marginBottom: '4px' }}>
                  <strong>{key}:</strong> {String(value)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Display other relevant fields */}
      {entry.traceId && (
        <div className="kv full">
          <span>{t('details.traceId') || 'Trace ID'}</span>
          <div>{fmt(entry.traceId)}</div>
        </div>
      )}

      {entry.service && (
        <div className="kv full">
          <span>{t('details.service') || 'Service'}</span>
          <div>{fmt(entry.service)}</div>
        </div>
      )}
    </div>
  );
}
