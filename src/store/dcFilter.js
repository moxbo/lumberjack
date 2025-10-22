// DiagnosticContextFilter: verwaltet (key,val,active)-Einträge und kann MDC-Prädikate bilden

class SimpleEmitter { constructor(){ this._ls=new Set() } on(fn){ if(typeof fn==='function'){ this._ls.add(fn); return ()=>this._ls.delete(fn)} return ()=>{} } emit(){ for(const fn of this._ls) { try{ fn() }catch{} } } }

function entryKey(key,val){ return `${key}\u241F${val}` } // UNIT SEPARATOR-like delimiter

class DiagnosticContextFilterImpl {
  constructor(){ this._map = new Map(); this._em = new SimpleEmitter(); this._enabled = true }
  onChange(fn){ return this._em.on(fn) }
  isEnabled(){ return !!this._enabled }
  setEnabled(v){ const nv = !!v; if (nv !== this._enabled){ this._enabled = nv; this._em.emit() } }
  _normalizeKey(k){ return String(k||'').trim() }
  _normalizeVal(v){ return v == null ? '' : String(v) }
  addMdcEntry(key,val){ const k=this._normalizeKey(key); if(!k) return; const v=this._normalizeVal(val); const id=entryKey(k,v); const prev=this._map.get(id); if(prev){ return } this._map.set(id,{ key:k, val:v, active:true }); this._em.emit() }
  removeMdcEntry(key,val){ const k=this._normalizeKey(key); if(!k) return; const v=this._normalizeVal(val); const id=entryKey(k,v); if(this._map.delete(id)) this._em.emit() }
  activateMdcEntry(key,val){ const k=this._normalizeKey(key); if(!k) return; const v=this._normalizeVal(val); const id=entryKey(k,v); const e=this._map.get(id); if(e && !e.active){ e.active=true; this._em.emit() } }
  deactivateMdcEntry(key,val){ const k=this._normalizeKey(key); if(!k) return; const v=this._normalizeVal(val); const id=entryKey(k,v); const e=this._map.get(id); if(e && e.active){ e.active=false; this._em.emit() } }
  reset(){ if(this._map.size){ this._map.clear(); } this._em.emit() }
  getDcEntries(){ return Array.from(this._map.values()).sort((a,b)=> a.key.localeCompare(b.key) || a.val.localeCompare(b.val)) }
  hasActive(){ for(const e of this._map.values()) if(e.active) return true; return false }
  // matches: AND über Keys, OR innerhalb eines Keys. val=='' => Wildcard für alle Werte dieses Keys (Key muss vorhanden sein)
  matches(mdc){ if(!this.isEnabled()) return true; if(!this.hasActive()) return true; const groups = new Map(); for(const e of this._map.values()){ if(!e.active) continue; if(!groups.has(e.key)) groups.set(e.key, []); groups.get(e.key).push(e) }
    // Für jede Key-Gruppe muss mindestens ein Eintrag matchen
    const hasOwn = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
    for(const [k, arr] of groups){ const evHas = mdc && typeof mdc==='object' ? hasOwn(mdc,k) : false; const evVal = evHas ? String(mdc[k] ?? '') : '';
      let ok=false;
      for(const it of arr){ if(it.val===''){ if(evHas) { ok=true; break } } else { if(evHas && evVal===it.val){ ok=true; break } } }
      if(!ok) return false }
    return true }
}

export const DiagnosticContextFilter = new DiagnosticContextFilterImpl();
export function dcEntryId(e){ return entryKey(e.key,e.val) }
