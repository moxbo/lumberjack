# Node.js Installer Konflikt - Schnellreferenz

## ⚠️ Problem

Lumberjack stürzt ab, nachdem Windows Event Log zeigt:
```
"Product: Node.js -- A later version of Node.js is already installed. Setup will now exit."
```

## 🔍 Ursache

Windows versucht Node.js zu installieren, während Lumberjack läuft.

## ✅ Lösung (Schnell)

### Schritt 1: Lumberjack beenden
```cmd
taskkill /IM Lumberjack.exe /F
```

### Schritt 2: Verwaiste Prozesse bereinigen
```cmd
taskkill /IM electron.exe /F
```

### Schritt 3: Lumberjack neu starten
Einfach über Desktop-Icon starten.

## 🛡️ Prävention

### WICHTIG:
**Lumberjack benötigt KEINE separate Node.js-Installation!**

Die Anwendung enthält bereits eine eigene Node.js Runtime.

### So vermeiden Sie das Problem:

1. ✅ **Beenden Sie Lumberjack VOR Node.js-Installation/Updates**
2. ✅ **Lassen Sie Windows Updates laufen, wenn Lumberjack nicht läuft**
3. ✅ **Verwenden Sie die portable Version** für maximale Stabilität

## 📋 Erkennung

Lumberjack erkennt jetzt automatisch Installer-Konflikte und loggt:

```
[installer-conflict] Potential installer interference detected
[WARNUNG] Möglicher Installer-Konflikt erkannt
```

## 📖 Mehr Informationen

Vollständige Dokumentation:
- [NODE_INSTALLER_CONFLICT.md](./NODE_INSTALLER_CONFLICT.md) - Detaillierte Troubleshooting-Anleitung
- [SILENT_EXIT_FIX.md](./SILENT_EXIT_FIX.md) - Allgemeine Exit-Probleme
- [EXIT_CODE_1_FIX.md](./EXIT_CODE_1_FIX.md) - Exit Code Diagnose

## 🆘 Hilfe

Wenn das Problem weiterhin auftritt:

1. **Log-Dateien prüfen**:
   ```cmd
   notepad %APPDATA%\Lumberjack\logs\main.log
   ```

2. **Diagnostik ausführen**:
   ```cmd
   npm run diagnose:memory
   ```

3. **Windows Event Log prüfen**:
   ```cmd
   eventvwr.msc
   ```
   → Windows Logs → Application → Nach "Node.js" oder "MsiInstaller" filtern

## 💡 Wichtige Fakten

- ✅ Lumberjack ist eine **Electron-Anwendung**
- ✅ Enthält **eingebettete Node.js Runtime** (v20.19.5)
- ✅ Funktioniert **unabhängig** von System-Node.js
- ✅ **Keine separate Node.js-Installation erforderlich**
- ✅ Windows Installer kann mit laufender App **interferieren**

## 🔧 Support

Bei weiteren Fragen, siehe:
- [TROUBLESHOOTING_MEMORY.md](./TROUBLESHOOTING_MEMORY.md)
- Log-Dateien: `%APPDATA%\Lumberjack\logs\`
- Crash Dumps: `%APPDATA%\Lumberjack\crashes\`
