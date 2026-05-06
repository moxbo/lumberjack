# 📚 Lumberjack Dokumentation

**Version:** 1.0.15  
**Stand:** Mai 2026

---

## 🚀 Schnellstart

| Ich möchte...                     | Dokument                                                           |
|-----------------------------------|--------------------------------------------------------------------|
| **Die App nutzen**                | [user/START_HERE.md](user/START_HERE.md)                           |
| **Einen Überblick über Features** | [../README.md](../README.md)                                       |
| **Optimierungen verstehen**       | [SUMMARY_QUICK_REFERENCE.md](SUMMARY_QUICK_REFERENCE.md)           |
| **Die App deployen**              | [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)                         |
| **Probleme beheben**              | [user/TROUBLESHOOTING_AND_FAQ.md](user/TROUBLESHOOTING_AND_FAQ.md) |

---

## 📖 Dokumentationsstruktur

### Hauptdokumente (Root)

| Datei                                                              | Beschreibung                 |
|--------------------------------------------------------------------|------------------------------|
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)                         | Build & Deployment Anleitung |
| [MONITORING_AND_TESTING_GUIDE.md](MONITORING_AND_TESTING_GUIDE.md) | Tests & Monitoring           |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md)                           | Kurzreferenz                 |
| [SUMMARY_QUICK_REFERENCE.md](SUMMARY_QUICK_REFERENCE.md)           | Executive Summary            |

### 👤 Benutzer-Dokumentation (`user/`)

Für Endbenutzer und Tester:

- [START_HERE.md](user/START_HERE.md) - Einstieg & erste Schritte
- [TROUBLESHOOTING_AND_FAQ.md](user/TROUBLESHOOTING_AND_FAQ.md) - Häufige Probleme & Lösungen
- [TROUBLESHOOTING_MEMORY.md](user/TROUBLESHOOTING_MEMORY.md) - Speicherprobleme beheben
- [QUICK_START_OPTIMIZATIONS.md](user/QUICK_START_OPTIMIZATIONS.md) - Performance-Tipps

### 🔧 Entwickler-Dokumentation (`developer/`)

Für Entwickler und Contributors:

**Architektur & Design:**

- [ARCHITECTURE_DECISION.md](developer/ARCHITECTURE_DECISION.md) - Architektur-Entscheidungen
- [COPILOT_AGENT.md](developer/COPILOT_AGENT.md) - AI-Assistenten Leitfaden

**Performance & Optimierung:**

- [PERFORMANCE.md](developer/PERFORMANCE.md) - Performance-Übersicht
- [PERFORMANCE_OPTIMIZATIONS.md](developer/PERFORMANCE_OPTIMIZATIONS.md) - Detaillierte Optimierungen
- [OPTIMIZATION_STABILITY_ROADMAP_2025.md](developer/OPTIMIZATION_STABILITY_ROADMAP_2025.md) - Roadmap
- [PRODUCTION_OPTIMIZATIONS.md](developer/PRODUCTION_OPTIMIZATIONS.md) - Production-ready Features
- [STABILITY_IMPROVEMENTS.md](developer/STABILITY_IMPROVEMENTS.md) - Stabilitäts-Verbesserungen

**Windows-spezifisch:**

- [WINDOWS_OPTIMIZATIONS.md](developer/WINDOWS_OPTIMIZATIONS.md) - Windows-Optimierungen
- [WINDOWS_PERFORMANCE.md](developer/WINDOWS_PERFORMANCE.md) - Windows-Performance

**Implementierung:**

- [PRACTICAL_IMPLEMENTATION_GUIDE.md](developer/PRACTICAL_IMPLEMENTATION_GUIDE.md) - Implementierungs-Leitfaden
- [MDC_FILTER_IMPLEMENTATION.md](developer/MDC_FILTER_IMPLEMENTATION.md) - MDC Filter
- [TESTING.md](developer/TESTING.md) - Test-Dokumentation

### 📋 Referenz (`reference/`)

Technische Referenz-Dokumentation:

- [CHANGELOG.md](reference/CHANGELOG.md) - Änderungsprotokoll
- [NODE_INSTALLER_CONFLICT.md](reference/NODE_INSTALLER_CONFLICT.md) - Node.js Konflikt-Lösung
- [UX_DESIGN_UPDATE_2025-12-10.md](reference/UX_DESIGN_UPDATE_2025-12-10.md) - UX-Updates
- Windows Icon-Dokumentation (mehrere Dateien)

### 📦 Archiv (`archive/`)

Historische Implementierungsprotokolle und abgeschlossene Fix-Dokumentationen.  
Diese Dateien dienen der Nachvollziehbarkeit und werden nicht aktiv gepflegt.

---

## 🎯 Quick Links nach Aufgabe

### Entwicklung starten

```bash
npm install
npm run dev
```

### Build erstellen

```bash
# Windows Portable
npm run build:portable:x64

# macOS DMG
npm run build:mac:dmg
```

### Tests ausführen

```bash
npm test
```

---

## 📊 Projekt-Status

- ✅ Core Features implementiert
- ✅ Performance-Optimierungen abgeschlossen
- ✅ Windows/macOS Icon-Support
- ✅ Stabilitäts-Verbesserungen implementiert
- ✅ Produktionsreife erreicht
- ✅ HTTP-Tailing (Range-basiertes Polling) und File-Tail (Watcher) verfügbar
- ✅ Filter-Profile mit Suche, Import/Export, Undo
- ✅ Alert-Regeln mit OS-Notifications
- ✅ Bookmarks für schnelle Navigation
- ✅ Internationalisierung (DE / EN) für UI und Electron-Menü
- ✅ Auto-Updater (mit Portable-Modus-Erkennung)
- ✅ Barrierefreiheit (aria-live, prefers-reduced-motion, Fokus-Handling)

---

*Alte Index-Dateien: `00_INDEX.md` und `README.md` in diesem Ordner werden nicht mehr gepflegt.*

