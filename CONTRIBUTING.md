# Contributing to Lumberjack

Vielen Dank für Ihr Interesse an Lumberjack! Dieses Dokument beschreibt, wie Sie zum Projekt beitragen können.

---

## 🚀 Schnellstart

```bash
# Repository klonen
git clone https://github.com/moxbo/lumberjack.git
cd lumberjack

# Dependencies installieren
npm install

# Entwicklungsmodus starten
npm run dev
```

---

## 📋 Contribution Workflow

### 1. Issue erstellen oder finden

- Prüfen Sie, ob bereits ein Issue existiert
- Bei neuen Features: Issue erstellen und auf Feedback warten
- Bei Bugs: Issue mit Reproduktionsschritten erstellen

### 2. Fork & Branch

```bash
# Fork erstellen (via GitHub UI)
# Dann:
git clone https://github.com/IHR_USERNAME/lumberjack.git
cd lumberjack
git checkout -b feature/mein-feature
# oder
git checkout -b fix/mein-bugfix
```

### 3. Entwickeln

```bash
# Entwicklungsmodus
npm run dev

# Tests ausführen
npm test

# Linting
npm run lint

# Formatierung
npm run format
```

### 4. Commit & Push

```bash
git add .
git commit -m "feat: Beschreibung des Features"
git push origin feature/mein-feature
```

### 5. Pull Request

- PR gegen `main` Branch erstellen
- PR-Template ausfüllen
- Auf CI-Check warten

---

## 📝 Commit-Konventionen

Wir verwenden [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Verwendung |
|--------|------------|
| `feat:` | Neue Features |
| `fix:` | Bugfixes |
| `docs:` | Dokumentation |
| `style:` | Formatierung (kein Code-Change) |
| `refactor:` | Code-Refactoring |
| `test:` | Tests hinzufügen/ändern |
| `chore:` | Wartung, Dependencies |

**Beispiele:**
```
feat: TCP-Listener für Echtzeit-Logs hinzugefügt
fix: Icon wird jetzt korrekt in Taskbar angezeigt
docs: README mit Build-Anleitung erweitert
```

---

## 🧪 Tests

### Unit-Tests ausführen

```bash
npm test
```

### E2E-Tests ausführen

```bash
npm run test:e2e
```

### Einzelne Test-Suites

```bash
# Spezifischer Test
tsx ./scripts/test-msg-filter.ts
```

---

## 🎨 Code Style

- **TypeScript** für Main- und Renderer-Prozess
- **Preact** für UI-Komponenten
- **ESLint + Prettier** für Formatierung

### Automatische Formatierung

```bash
npm run format       # Alle Dateien formatieren
npm run lint:fix     # Lint-Fehler automatisch beheben
```

### Pre-Commit Hooks

Husky führt automatisch `lint-staged` aus:
- `.ts/.tsx` Dateien: ESLint + Prettier
- `.json/.md/.css/.html`: Prettier

---

## 📁 Projektstruktur

```
lumberjack/
├── src/
│   ├── main/         # Electron Main Process
│   ├── renderer/     # Preact UI
│   ├── services/     # Business Logic
│   ├── types/        # TypeScript Definitionen
│   └── utils/        # Hilfsfunktionen
├── scripts/          # Build & Test Scripts
├── tests/            # E2E Tests
└── docs/             # Dokumentation
```

---

## 🔧 Entwicklungs-Setup

### Voraussetzungen

- Node.js 20+ (LTS empfohlen)
- npm 9+
- Git

### IDE-Empfehlungen

- **VS Code** oder **WebStorm**
- Empfohlene Extensions:
  - ESLint
  - Prettier
  - TypeScript

---

## 📖 Hilfreiche Dokumentation

| Dokument | Beschreibung |
|----------|--------------|
| [docs/INDEX.md](docs/INDEX.md) | Dokumentationsübersicht |
| [docs/developer/ARCHITECTURE_DECISION.md](docs/developer/ARCHITECTURE_DECISION.md) | Architektur-Entscheidungen |
| [docs/developer/PERFORMANCE.md](docs/developer/PERFORMANCE.md) | Performance-Optimierungen |

---

## ❓ Fragen?

- Issues: [GitHub Issues](https://github.com/moxbo/lumberjack/issues)
- Diskussionen: [GitHub Discussions](https://github.com/moxbo/lumberjack/discussions)

---

## 📄 Lizenz

Mit dem Einreichen eines Beitrags stimmen Sie zu, dass Ihr Beitrag unter der [MIT-Lizenz](LICENSE) lizenziert wird.

---

Vielen Dank für Ihre Beiträge! 🪓

