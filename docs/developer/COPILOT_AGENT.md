# Copilot Agent Leitfaden für Lumberjack

Ziel dieses Dokuments: Eine robuste, projektpassende Arbeitsanweisung für Copilot Agents (und Menschen), um Änderungen an diesem Electron/Vite/TypeScript‑Projekt sicher, reproduzierbar und zügig umzusetzen.

Referenz: Praktische Tipps von GitHub: https://gh.io/copilot-coding-agent-tips

---

## Projektüberblick (Stack & Struktur)

- Plattform: Electron + Vite + TypeScript
- Haupt-Einstiegspunkte
  - Main: `src/main/main.ts`
  - IPC: `src/main/ipcHandlers.ts`
  - Renderer: `src/renderer/**`
  - Preload: `preload.ts` → gebündelt nach `preload.cjs`
- Builds/Artefakte
  - Main/IPC: gebündelt nach `dist-main/main.cjs` und `dist-main/ipcHandlers.cjs`
  - Renderer: `vite build` → `dist/`
  - Preload: `preload.cjs` im Projektroot (wird von `BrowserWindow.webPreferences.preload` genutzt)
- Besondere Pfade/Lade-Logik
  - `BrowserWindow` lädt im Dev-Modus via `VITE_DEV_SERVER_URL`, ansonsten `dist/index.html` (verschiedene Kandidatenpfade, siehe `createWindow`).
  - Preload wird über `path.join(app.getAppPath(), 'preload.cjs')` eingebunden – der Pfad muss nach dem Build existieren.

---

## Befehle (macOS/zsh)

- Setup
  - `npm install`
- Entwicklung (Vite + Electron Dev)
  - `npm run dev`
- Produktionsnah lokal starten (ohne Dev-Server)
  - `npm run start` (führt Prebuild + Renderer-Build aus und startet Electron)
- Typecheck
  - `npx tsc -p tsconfig.json --noEmit`
- Lint
  - `npm run lint`
  - `npm run lint:fix`
- Tests
  - `npm test`
- Packaging/Builds
  - Windows (portable x64): `npm run build:portable:x64`
  - Windows (NSIS/portable): `npm run build:x64`
  - macOS (dmg/zip, no-sign): `npm run build:mac:dmg`

Hinweis: Viele Befehle triggern zunächst `prebuild`, das Parser/Settings nach CJS transpiliert und Main/Preload bundelt.

---

## Arbeitsleitplanken für Agents

- Änderungsumfang
  - Erlaubt: `src/**`, `preload.ts`, `scripts/**`, kleine Ergänzungen in `package.json` (nur wenn notwendig und begründet), `docs/**`.
  - Tabu: `dist/**`, `dist-main/**`, `release/**`, Build-Artefakte, generierte Dateien.
  - Stil/Imports beibehalten; keine großflächigen Reformatierungen.
- Public API/Verhalten
  - Öffentliche IPC-Interfaces (`src/types/ipc.ts`) nicht brechen. Bei Änderungen: Typen + Handler + Aufrufer aktualisieren und Tests ergänzen.
  - Fenster/Start-Flow, Quit-Bestätigung und Single-Instance-Lock respektieren.
- Nebenläufigkeit/Robustheit
  - Renderer-Readiness beachten (siehe `isRendererReady`, `flushPendingAppends*`).
  - Netzwerk/TCP-Owner-Window‑Routing nicht versehentlich ändern.
- Sicherheit/Compliance
  - Keine Secrets ins Repo/Logs. Keine externen Netzaufrufe ohne explizite Freigabe.
- Reproduzierbarkeit
  - Vorhandene Skripte/Lockfiles nutzen. Keine unnötigen Versionssprünge.

---

## Qualitäts-Tore (müssen grün sein)

1. Build/Typecheck

- `npx tsc -p tsconfig.json --noEmit`
- `npm run prebuild` und `npm run build:renderer`

2. Lint

- `npm run lint` (optional `npm run lint:fix`)

3. Tests

- `npm test`

4. Smoke-Test (manuell, kurz)

- Dev: `npm run dev` – es öffnet sich ein Fenster, `index.html` lädt ohne „did-fail-load“. Keine uncaught errors im Main-Log.
- Start: `npm run start` – Fenster lädt `dist/index.html`, Menü funktioniert, keine Renderer-Fehler.

Abschluss: Kurzer Delta-Report (Welche Dateien? Warum? Ergebnis) + Mapping Anforderung → Done/Deferred.

---

## Typische Edit-Punkte (Wegweiser)

- IPC hinzufügen/ändern
  - Typen: `src/types/ipc.ts`
  - Main-Handler: `src/main/ipcHandlers.ts` (Registrierung über `registerIpcHandlers` in `main.ts`)
  - Renderer-Aufrufer: üblicherweise in `src/renderer/**`
- Menü/Window-Logik
  - Menüvorlagen/Status: `buildMenu`, `updateMenu` in `src/main/main.ts`
  - Fenstererzeugung und Preload: `createWindow` in `src/main/main.ts`
- Netzwerk/Logs
  - `src/services/NetworkService.ts` (Status, TCP, HTTP)
  - Log-Routing: `sendAppend` in `src/main/main.ts`
- Einstellungen
  - `src/services/SettingsService.ts` (Laden/Speichern, Pfade, Limits)

---

## Edge Cases, die Agents beachten sollten

- Renderer noch nicht bereit → Puffer/Flush-Mechanismen (keine direkten Sends ohne Guard).
- TCP-Logs nur an das Owner-Window routen; sonst in main übernehmen (bestehendes Verhalten).
- Icon-Auflösung (Windows/macOS): Nur Pfade außerhalb von `app.asar` funktionieren zur Laufzeit verlässlich.
- macOS: Fenster-Schließen beendet die App nicht; Quit-Flow erfolgt über `before-quit` mit Bestätigung.

---

## Do/Don’t (Kurz)

- Do
  - Kleine, gezielte Diffs; nach jedem Edit: Build/Typecheck + (kurzer) Testlauf.
  - Bestehende Patterns (Logging, Guards, Services) übernehmen.
  - Annahmen kurz dokumentieren, konservative Defaults.
- Don’t
  - Dist/Release anfassen, große Rewrites, riskante Refactorings ohne Tests.
  - API-Brüche ohne umfassende Aktualisierung von Typen/Handlern und Aufrufern.

---

## Agent‑Workflow (empfohlener Ablauf)

1. Plan (2–4 Schritte), Erfolgskriterien und Scope notieren.
2. Kontext laden: `package.json`, `src/main/main.ts`, `src/main/ipcHandlers.ts`, relevante Renderer‑Dateien, `src/types/ipc.ts`, Services.
3. Umsetzung mit minimalen Diffs. Nur betroffene Dateien anfassen.
4. Validierung
   - `npx tsc -p tsconfig.json --noEmit`
   - `npm run lint`
   - `npm test`
   - `npm run start` oder `npm run dev` (Smoke)
5. Ergebnisbericht (kurz, präzise) + Next Steps (falls sinnvoll).

---

## Prompt‑Template (zum Kopieren & Anpassen)

System/Repo-Briefing

- Projekt: Electron + Vite + TypeScript. Main unter `src/main/main.ts`, Renderer unter `src/renderer/**`, Preload aus `preload.ts` → `preload.cjs`.
- Nutze nur vorhandene Skripte. Keine Netzwerkaufrufe. Keine dist/release‑Edits.

Ziel(e)

- [konkret beschreiben]

Erfolgskriterien

- Typecheck grün, Lint grün, `npm test` grün.
- App startet (`npm run start` oder `npm run dev`), `index.html` lädt ohne Fehler, Menü/IPC wie spezifiziert.

Leitplanken

- Kleine, gezielte Diffs; Stil/Imports beibehalten; keine Reformatierung großer Blöcke.
- Erlaube Änderungen in: `src/**`, `preload.ts`, `scripts/**`, `docs/**`.

Edge Cases

- Renderer-Readiness berücksichtigen, Quit‑Flow respektieren, TCP‑Owner‑Routing nicht brechen.

Kommandos

```bash
npm install
npx tsc -p tsconfig.json --noEmit
npm run lint
npm test
npm run start   # oder: npm run dev
```

Reporting (am Ende ausgeben)

- Geänderte Dateien + kurze Begründung.
- Qualitäts-Tore: Build/Typecheck, Lint, Tests, Smoke → PASS/FAIL mit kurzer Notiz.
- Mapping: Anforderung → Done/Deferred (mit Grund).

---

## Nützliche Referenzen

- Copilot Agent Tipps: https://gh.io/copilot-coding-agent-tips
- Electron: https://www.electronjs.org/docs/latest
- Vite: https://vitejs.dev/guide/
- esbuild: https://esbuild.github.io/
