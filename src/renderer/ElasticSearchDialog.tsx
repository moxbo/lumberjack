/* eslint-disable */
import { useEffect, useState } from 'preact/hooks';

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

  const [form, setForm] = useState(
    initial || {
      enabled: true,
      mode: 'relative',
      duration: '15m',
      from: '',
      to: '',
      application_name: '',
      logger: '',
      level: '',
      environment: '',
      // NEW: environment case handling
      environmentCase: 'original', // 'original' | 'lower' | 'upper' | 'case-sensitive'
      loadMode: 'replace',
      // new fields
      index: '',
      sort: 'asc',
      allowInsecureTLS: false,
    }
  );

  // Dropdown-Flags für vollständige Listen
  const [showIdxList, setShowIdxList] = useState(false);
  const [showAppList, setShowAppList] = useState(false);
  const [showEnvList, setShowEnvList] = useState(false);

  useEffect(() => {
    function onDocClick() {
      setShowIdxList(false);
      setShowAppList(false);
      setShowEnvList(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    if (open) {
      const base = initial || {};
      const envCase = (base as any).environmentCase || 'original';
      setForm({
        enabled: true,
        mode: (base as any).mode || 'relative',
        duration: (base as any).duration || '15m',
        from: (base as any).from || '',
        to: (base as any).to || '',
        application_name: (base as any).application_name || '',
        logger: (base as any).logger || '',
        level: (base as any).level || '',
        environment: (base as any).environment || '',
        environmentCase: envCase,
        loadMode: (base as any).loadMode || 'replace',
        index: (base as any).index || '',
        sort: (base as any).sort || 'asc',
        allowInsecureTLS: !!(base as any).allowInsecureTLS,
      });
    }
  }, [open, initial]);

  if (!open) return null;

  function parseDateLike(v: any) {
    try {
      if (v == null) return null;
      let d: any = null;
      if (v instanceof Date) d = v;
      else if (typeof v === 'number') d = new Date(v);
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
    if (!d) return '';
    const pad = (n: any) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function setOlderRange() {
    const toStr = fmtInputDatetimeLocal(firstTs);
    setForm((f: any) => ({ ...f, mode: 'absolute', to: toStr, from: '' }));
  }
  function setNewerRange() {
    const fromStr = fmtInputDatetimeLocal(lastTs);
    setForm((f: any) => ({ ...f, mode: 'absolute', from: fromStr, to: '' }));
  }

  const isRel = form.mode === 'relative';
  const isAbs = form.mode === 'absolute';

  function fmtHm(v: any) {
    const d = parseDateLike(v);
    if (!d) return '—';
    const pad = (n: any) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Hilfsrenderer für einfache Dropdown-Liste
  function HistoryList(props: { items: any[]; onPick: (v: string) => void; style?: any }) {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div
        className="history-dropdown"
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: '4px',
          maxHeight: '180px',
          overflow: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: '4px',
          background: 'var(--color-bg, #fff)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          padding: '4px',
          zIndex: 30,
          ...(props.style || {}),
        }}
      >
        {items.length === 0 && (
          <div style={{ padding: '6px 8px', color: '#888' }}>Keine Einträge</div>
        )}
        {items.map((v: any, i: number) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => props.onPick(String(v))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') props.onPick(String(v));
            }}
            style={{
              padding: '6px 8px',
              cursor: 'pointer',
              borderRadius: '4px',
            }}
            onMouseOver={(e) => ((e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(0,0,0,0.06)')}
            onMouseOut={(e) => ((e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent')}
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Elastic-Search</h3>

        {/* Laden: Anhängen oder Ersetzen */}
        <div className="kv">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              className="native-checkbox"
              checked={(form.loadMode || 'append') === 'append'}
              onChange={(e) =>
                setForm({ ...form, loadMode: e.currentTarget.checked ? 'append' : 'replace' })
              }
            />
            <span>Anhängen (deaktiviert = Ersetzen)</span>
          </label>
        </div>

        {/* Modus-Auswahl */}
        <div className="kv">
          <span>Modus</span>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="radio"
                name="esMode"
                value="relative"
                checked={isRel}
                onChange={() => setForm({ ...form, mode: 'relative' })}
              />
              <span>Relativ</span>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="radio"
                name="esMode"
                value="absolute"
                checked={isAbs}
                onChange={() => setForm({ ...form, mode: 'absolute' })}
              />
              <span>Absolut</span>
            </label>
          </div>
        </div>

        {/* Dauer (relativ) */}
        <div className="kv" aria-disabled={!isRel} style={isRel ? undefined : { opacity: 0.5 }}>
          <span>Dauer (relativ)</span>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '6px' }}
          >
            <input
              type="text"
              value={form.duration}
              onInput={(e) => setForm({ ...form, duration: e.currentTarget.value })}
              placeholder="z. B. 5m, 15m, 1h, 24h"
              disabled={!isRel}
            />
            <button
              type="button"
              onClick={() => setForm({ ...form, duration: '5m' })}
              disabled={!isRel}
            >
              5m
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, duration: '15m' })}
              disabled={!isRel}
            >
              15m
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, duration: '1h' })}
              disabled={!isRel}
            >
              1h
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, duration: '24h' })}
              disabled={!isRel}
            >
              24h
            </button>
          </div>
        </div>

        {/* Absolute Zeitfenster */}
        <div className="kv" aria-disabled={!isAbs} style={isAbs ? undefined : { opacity: 0.5 }}>
          <span>Von (absolut)</span>
          <input
            type="datetime-local"
            value={form.from}
            onInput={(e) => setForm({ ...form, from: e.currentTarget.value })}
            disabled={!isAbs}
          />
        </div>
        <div className="kv" aria-disabled={!isAbs} style={isAbs ? undefined : { opacity: 0.5 }}>
          <span>Bis (absolut)</span>
          <input
            type="datetime-local"
            value={form.to}
            onInput={(e) => setForm({ ...form, to: e.currentTarget.value })}
            disabled={!isAbs}
          />
        </div>

        {/* Nachladen Buttons */}
        <div className="kv" aria-disabled={!isAbs} style={isAbs ? undefined : { opacity: 0.5 }}>
          <span>Nachladen</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={setOlderRange}
              disabled={!isAbs || !firstTs}
              title="Lädt Einträge vor dem ersten sichtbaren Zeitstempel"
            >
              Ältere nachladen
            </button>
            <small style={{ color: 'var(--color-text-secondary)' }}>(bis {fmtHm(firstTs)})</small>
            <button
              type="button"
              onClick={setNewerRange}
              disabled={!isAbs || !lastTs}
              title="Lädt Einträge ab dem letzten sichtbaren Zeitstempel"
            >
              Neuere nachladen
            </button>
            <small style={{ color: 'var(--color-text-secondary)' }}>(ab {fmtHm(lastTs)})</small>
          </div>
        </div>

        {/* Suchfelder */}
        <div className="kv">
          <span>Index</span>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
              <input
                list="esIndexHistory"
                type="text"
                value={form.index}
                onInput={(e) => setForm({ ...form, index: e.currentTarget.value })}
                placeholder="z. B. logs-*, filebeat-* (leer = _all)"
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
                disabled={!Array.isArray(histIndex) || histIndex.length === 0}
                title="Alle gespeicherten Index-Werte anzeigen"
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
                style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, marginTop: 0 }}
              />
            )}
          </div>
          <datalist id="esIndexHistory">
            {Array.isArray(histIndex) &&
              histIndex.map((v: any, i: any) => <option key={i} value={v} />)}
          </datalist>
        </div>

        <div className="kv">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              className="native-checkbox"
              checked={!!form.allowInsecureTLS}
              onChange={(e) => setForm({ ...form, allowInsecureTLS: e.currentTarget.checked })}
            />
            <span>Unsicheres TLS erlauben (selbstsigniert)</span>
          </label>
        </div>

        <div className="kv">
          <span>Application Name</span>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
              <input
                list="esAppNameHistory"
                type="text"
                value={form.application_name}
                onInput={(e) => setForm({ ...form, application_name: e.currentTarget.value })}
                placeholder="z. B. my-service"
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
                disabled={!Array.isArray(histAppName) || histAppName.length === 0}
                title="Alle gespeicherten Application Names anzeigen"
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
                style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, marginTop: 0 }}
              />
            )}
          </div>
          <datalist id="esAppNameHistory">
            {Array.isArray(histAppName) &&
              histAppName.map((v: any, i: any) => <option key={i} value={v} />)}
          </datalist>
        </div>

        <div className="kv">
          <span>Logger</span>
          <input
            type="text"
            value={form.logger}
            onInput={(e) => setForm({ ...form, logger: e.currentTarget.value })}
            placeholder="Logger enthält…"
          />
        </div>

        <div className="kv">
          <span>Level</span>
          <select
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.currentTarget.value })}
          >
            <option value="">Alle</option>
            {['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="kv">
          <span>Environment</span>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
              <input
                list="esEnvHistory"
                type="text"
                value={form.environment}
                onInput={(e) => setForm({ ...form, environment: e.currentTarget.value })}
                placeholder="z. B. prod, stage"
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
                disabled={!Array.isArray(histEnvironment) || histEnvironment.length === 0}
                title="Alle gespeicherten Environment-Werte anzeigen"
              >
                ▼
              </button>
            </div>
            {showEnvList && (
              <HistoryList
                items={Array.isArray(histEnvironment) ? histEnvironment : []}
                onPick={(v) => {
                  setForm({ ...form, environment: v });
                  setShowEnvList(false);
                }}
                style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, marginTop: 0 }}
              />
            )}
          </div>
          <datalist id="esEnvHistory">
            {Array.isArray(histEnvironment) &&
              histEnvironment.map((v: any, i: any) => <option key={i} value={v} />)}
          </datalist>
        </div>

        {/* NEW: Environment Case Handling */}
        <div className="kv">
          <span>Environment-Case</span>
          <select
            value={form.environmentCase}
            onChange={(e) => setForm({ ...form, environmentCase: e.currentTarget.value })}
          >
            <option value="original">Original</option>
            <option value="lower">nach lowercase konvertieren</option>
            <option value="upper">nach UPPERCASE konvertieren</option>
            <option value="case-sensitive">Case-sensitiv suchen</option>
          </select>
        </div>

        <div className="modal-actions">
          <button onClick={onClear} title="Felder zurücksetzen">
            Leeren
          </button>
          <button onClick={onClose}>Abbrechen</button>
          <button onClick={() => onApply({ ...form, enabled: true })}>Suchen</button>
        </div>
      </div>
    </div>
  );
}
