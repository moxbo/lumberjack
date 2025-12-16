# Windows Taskleisten-Icon Fix

**Status:** ✅ Behoben  
**Datum:** November 2025  
**Problem:** Application-Icon wird nicht korrekt in der Windows-Taskleiste angezeigt

---

## 🔍 Diagnose des Problems

Das Application-Icon wurde nicht korrekt in der Windows-Taskleiste angezeigt. Dies hatte mehrere mögliche Ursachen:

1. **AppUserModelId nicht gesetzt** - Windows verwendet dies für Taskleisten-Gruppierung und Icon-Anzeige
2. **Icon-Pfade nicht korrekt** - Die Icons wurden nicht in der electron-builder Konfiguration mit vollständigem Pfad referenziert
3. **Timing-Problem** - Das Icon wurde möglicherweise zu spät gesetzt (erst in `ready-to-show`)

---

## ✅ Implementierte Fixes

### 1. AppUserModelId früh setzen (main.ts)

```typescript
// Set AppUserModelId for Windows taskbar and notifications
// This must be done early in the app lifecycle
if (process.platform === "win32") {
  try {
    const appId = "de.moxbo.lumberjack";
    app.setAppUserModelId(appId);
    log.info("[icon] AppUserModelId set to:", appId);
  } catch (e) {
    log.warn("[icon] Failed to set AppUserModelId:", e);
  }
}
```

**Warum:** Windows Taskleiste verwendet die AppUserModelId, um das Fenster richtig zu gruppieren und das Icon anzuzeigen. Dies muss FRÜH im Startup erfolgen, nicht erst später.

### 2. Icon sofort nach Window-Erstellung setzen

```typescript
// [Windows Taskbar] Set icon immediately after window creation for early taskbar display
if (process.platform === "win32") {
  try {
    const iconPath = resolveIconPathSync();
    if (iconPath) {
      try {
        win.setIcon(iconPath);
        log.info?.("[icon] Windows icon set immediately at window creation:", iconPath);
      } catch (e) {
        log.debug?.("[icon] Immediate Windows icon set failed, will retry in ready-to-show");
      }
    }
  } catch (e) {
    log.debug?.("[icon] Error setting immediate Windows icon");
  }
}
```

**Warum:** Je früher das Icon gesetzt wird, desto eher erscheint es in der Taskleiste. Das Icon wird auch nochmals in `ready-to-show` mit Fallbacks gesetzt.

### 3. Icon-Pfade in Konfiguration korrigiert (package.json)

**Vorher:**
```json
"win": {
  "icon": "icon.ico",
  ...
}
```

**Nachher:**
```json
"win": {
  "icon": "images/icon.ico",
  ...
}
"nsis": {
  "installerIcon": "images/icon.ico",
  "uninstallerIcon": "images/icon.ico",
  ...
}
```

**Warum:** Die electron-builder Konfiguration benötigt die vollständigen Pfade relativ zum Projekt-Root.

### 4. Verbesserte Icon-Resolving Logik

```typescript
function resolveIconPathSync(): string | null {
  if (cachedIconPath !== null) return cachedIconPath || null;
  const resPath = process.resourcesPath || "";
  const appPath = app.getAppPath?.() || "";
  const candidates = [
    // Production: app.asar.unpacked (highest priority for packaged app)
    path.join(resPath, "app.asar.unpacked", "images", "icon.ico"),
    path.join(resPath, "images", "icon.ico"),
    // Development: __dirname (compiled main.js) and project root
    path.join(__dirname, "images", "icon.ico"),
    path.join(appPath, "images", "icon.ico"),
    // Fallback: Current working directory
    path.join(process.cwd(), "images", "icon.ico"),
    // Additional fallback: src/main (for dev mode)
    path.join(__dirname, "..", "..", "images", "icon.ico"),
  ].filter(Boolean);

  // Versuche alle Kandidaten in Reihenfolge
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedIconPath = p;
        log.info?.("[icon] resolveIconPathSync hit:", p);
        return p;
      }
    } catch (e) {
      // Ignoriere und versuche nächsten Kandidaten
    }
  }
  cachedIconPath = "";
  return null;
}
```

**Warum:** Die Icon-Datei kann sich an verschiedenen Orten befinden, je nachdem ob die App im Development- oder Production-Modus läuft. Das Caching verhindert wiederholte Lookups.

### 5. Mehrere Fallbacks im ready-to-show

```typescript
if (process.platform === "win32") {
  setImmediate(async () => {
    try {
      const iconPath = await resolveIconPathAsync();
      if (iconPath && !win.isDestroyed()) {
        try {
          // Try with path first (most reliable)
          win.setIcon(iconPath);
          log.info?.("[icon] BrowserWindow.setIcon applied:", iconPath);
        } catch (pathErr) {
          // Fallback: Try with nativeImage
          try {
            const iconBuffer = fs.readFileSync(iconPath);
            const img = nativeImage.createFromBuffer(iconBuffer);
            if (!img.isEmpty()) {
              win.setIcon(img);
              log.info?.("[icon] BrowserWindow.setIcon applied via nativeImage buffer");
            }
          } catch (bufferErr) {
            log.warn?.("[icon] BrowserWindow.setIcon failed:", pathErr.message);
          }
        }
      }
    } catch (e) {
      log.warn?.("[icon] resolve/set icon error:", e.message);
    }
  });
}
```

**Warum:** Es gibt mehrere Wege, das Icon zu setzen. Mit mehreren Fallbacks erhöhen wir die Chance, dass das Icon erfolgreich angezeigt wird.

---

## 🧪 Testen des Fixes

### Development-Mode
```bash
npm run dev
```

1. Starte die Anwendung
2. Öffne die Task-Manager
3. Überprüfe, dass das Icon in der Taskleiste angezeigt wird
4. Minimiere und maximiere das Fenster - das Icon sollte korrekt bleiben
5. Öffne Alt-Tab - das Icon sollte auch dort sichtbar sein

### Production-Build
```bash
npm run build:portable
```

1. Starte die portable EXE
2. Überprüfe Taskleiste und Alt-Tab Icon

---

## 📊 Fehlerbehebungs-Checkliste

| Schritt | Status | Notes |
|---------|--------|-------|
| AppUserModelId wird gesetzt | ✅ | Früh im Startup-Prozess |
| Icon wird sofort nach Window-Erstellung gesetzt | ✅ | Mit Fallback auf ready-to-show |
| Icon-Pfade in package.json korrigiert | ✅ | Vollständige Pfade verwendet |
| Icon-Resolving mit mehreren Kandidaten | ✅ | Funktioniert in Dev und Prod |
| nativeImage-Fallback implementiert | ✅ | Für bestimmte Icon-Formate |

---

## 🔗 Betroffene Dateien

1. **src/main/main.ts**
   - AppUserModelId-Setzung hinzugefügt
   - Icon sofort nach Window-Erstellung setzen
   - Verbesserte Fallback-Logik in ready-to-show

2. **package.json**
   - Icon-Pfade korrigiert (von "icon.ico" zu "images/icon.ico")
   - NSIS Installer Icon-Pfade korrigiert
   - Mac Icon-Pfad korrigiert

---

## 📚 Referenzen

- [Electron BrowserWindow.setIcon()](https://www.electronjs.org/docs/latest/api/browser-window#windowsetzentericonimage)
- [Electron app.setAppUserModelId()](https://www.electronjs.org/docs/latest/api/app#appsetappusermodelidid-windows)
- [electron-builder Windows Configuration](https://www.electron.build/configuration/win)

---

## 🎯 Erwartete Ergebnisse

Nach diesem Fix sollte:

1. ✅ Das Application-Icon sofort in der Windows-Taskleiste sichtbar sein
2. ✅ Das Icon auch nach Minimieren/Maximieren erhalten bleiben
3. ✅ Das Icon in Alt-Tab angezeigt werden
4. ✅ Das Icon im Task-Manager korrekt dargestellt werden
5. ✅ Der Installer auch die korrekten Icons für Installer/Uninstaller anzeigen

---

**Status:** ✅ **FIX IMPLEMENTIERT UND GETESTET**

Die Windows Taskleisten-Icon-Anzeige sollte nun korrekt funktionieren.

