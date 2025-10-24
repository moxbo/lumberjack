// @ts-nocheck
import { useEffect, useState } from 'preact/hooks';

export default function ElasticSearchDialog({
  open,
  initial,
  onApply,
  onClear,
  onClose,
  firstTs,
  lastTs,
}) {
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
      loadMode: 'append',
    }
  );

  useEffect(() => {
    if (open) {
      const base = initial || {};
      setForm({
        enabled: true,
        mode: base.mode || 'relative',
        duration: base.duration || '15m',
        from: base.from || '',
        to: base.to || '',
        application_name: base.application_name || '',
        logger: base.logger || '',
        level: base.level || '',
        environment: base.environment || '',
        loadMode: base.loadMode || 'append',
      });
    }
  }, [open, initial]);

  if (!open) return null;

  function setOlderRange() {
    setForm((f) => ({ ...f, mode: 'absolute', to: 'first', from: '' }));
  }
  function setNewerRange() {
    setForm((f) => ({ ...f, mode: 'absolute', from: 'last', to: '' }));
  }

  const isRel = form.mode === 'relative';
  const isAbs = form.mode === 'absolute';

  function fmtHm(v) {
    try {
      if (!v) return '—';
      const d = new Date(v);
      if (isNaN(d.getTime())) return '—';
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '—';
    }
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
              disabled={!isAbs}
              title="Lädt Einträge vor dem ersten sichtbaren Zeitstempel"
            >
              Ältere nachladen
            </button>
            <small style={{ color: 'var(--color-text-secondary)' }}>(bis {fmtHm(firstTs)})</small>
            <button
              type="button"
              onClick={setNewerRange}
              disabled={!isAbs}
              title="Lädt Einträge ab dem letzten sichtbaren Zeitstempel"
            >
              Neuere nachladen
            </button>
            <small style={{ color: 'var(--color-text-secondary)' }}>(ab {fmtHm(lastTs)})</small>
          </div>
        </div>

        {/* Suchfelder */}
        <div className="kv">
          <span>Application Name</span>
          <input
            type="text"
            value={form.application_name}
            onInput={(e) => setForm({ ...form, application_name: e.currentTarget.value })}
            placeholder="z. B. my-service"
          />
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
          <input
            type="text"
            value={form.environment}
            onInput={(e) => setForm({ ...form, environment: e.currentTarget.value })}
            placeholder="z. B. prod, stage"
          />
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
