# ⚡ Quick Reference

Knappe Übersicht über Lumberjacks wichtigste Befehle, Pfade und Shortcuts.

---

## 🛠️ npm-Skripte

| Befehl | Zweck |
|--------|-------|
| `npm install` | Abhängigkeiten installieren |
| `npm run dev` | Entwicklungsmodus (Vite + Electron) |
| `npm start` | Build + App starten |
| `npm test` | Vitest-Unit-Tests |
| `npm run test:coverage` | Tests mit Coverage |
| `npm run test:e2e` | Playwright-End-to-End-Tests |
| `npm run lint` / `lint:fix` | ESLint-Check / Auto-Fix |
| `npm run format` | Prettier auf alle Dateien |
| `npm run icon:generate` | App-Icons (`.ico` / `.icns`) erzeugen |
| `npm run diagnose:memory` | Speicher-Diagnose |
| `npm run build:portable:x64` | Windows Portable Build |
| `npm run build:x64` | Windows NSIS-Installer |
| `npm run build:mac:dmg` | macOS DMG (lokal, ohne Publish) |
| `npm run release:mac` | macOS DMG/ZIP veröffentlichen |
| `npm run release:win` | Windows NSIS + Portable veröffentlichen |

---

## 🔌 Standard-Ports & Endpunkte

| Zweck | Default |
|-------|---------|
| TCP-Log-Empfang | `localhost:4445` |
| Vite Dev-Server | `http://localhost:5173` |

> Konfigurierbar in *Einstellungen → TCP Port*.

---

## 📁 App-Datenpfade

| OS | Logs | Settings |
|----|------|----------|
| Windows | `%APPDATA%\Lumberjack\logs\main.log` | `%APPDATA%\Lumberjack\` |
| macOS | `~/Library/Logs/Lumberjack/main.log` | `~/Library/Application Support/Lumberjack/` |
| Linux | `~/.config/Lumberjack/logs/main.log` | `~/.config/Lumberjack/` |

---

## 🔎 Filter-Syntax

```
error|warn           → "error" ODER "warn"
service&timeout      → "service" UND "timeout"
QcStatus&!CB23       → "QcStatus", aber NICHT "CB23"
```

---

## ⌨️ Shortcuts

| Aktion | Shortcut |
|--------|----------|
| Datei öffnen | `Ctrl/Cmd+O` |
| Suchen | `Ctrl/Cmd+F` |
| Bookmark setzen | `Ctrl/Cmd+D` |
| Nächster/Voriger Suchtreffer | `F3` / `Shift+F3` |
| Auswahl löschen | `Esc` |
| Listennavigation | `↑` `↓` `Home` `End` `PgUp` `PgDn` |

---

## 🚀 Release-Workflow (Kurzform)

```bash
git tag v1.2.3
git push && git push --tags
npm run release:mac     # macOS
npm run release:win     # Windows
```

Version wird automatisch aus dem Git-Tag abgeleitet (`RELEASE_VERSION` als
Override möglich).

---

## 🔗 Weiterlesen

- [Haupt-README](../README.md)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- [user/START_HERE.md](user/START_HERE.md)
- [user/TROUBLESHOOTING_AND_FAQ.md](user/TROUBLESHOOTING_AND_FAQ.md)
- [developer/PERFORMANCE.md](developer/PERFORMANCE.md)
- [developer/ARCHITECTURE_DECISION.md](developer/ARCHITECTURE_DECISION.md)

