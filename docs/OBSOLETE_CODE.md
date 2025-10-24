# Obsolete Code Analysis

## Zusammenfassung

Nach dem Refactoring zu TypeScript und Service-Architektur gibt es mehrere Dateien, die obsolet sind und entfernt werden können.

## Bereits entfernte Dateien

### ✅ src/main/renderer.ts (412 Zeilen)
- **Status**: Gelöscht
- **Grund**: Alter/alternativer Renderer, wurde nicht mehr verwendet
- **Ersetzt durch**: `src/main/util/main.tsx` ist der aktuelle Einstiegspunkt

### ✅ src/main/theme.ts (286 Zeilen)  
- **Status**: Gelöscht
- **Grund**: Keine Referenzen gefunden, nicht mehr verwendet

## Dateien die als Legacy behalten werden

### src/main/main.cjs (1119 Zeilen)
- **Status**: Legacy-Datei, vollständig ersetzt durch `main.ts`
- **Grund zum Behalten**: Referenz für Vergleich während Testphase
- **Empfehlung**: Kann nach vollständiger Validierung von main.ts gelöscht werden
- **Hinweis**: `package.json` verweist bereits auf `dist-main/main.js` (kompiliert von main.ts)

## Generierte Build-Artefakte (BEHALTEN)

Diese Dateien werden automatisch im Build-Prozess generiert und sind notwendig:

### src/main/parsers.cjs
- **Status**: WIRD VERWENDET
- **Generiert von**: `parsers.ts` via esbuild
- **Verwendet in**: `main.ts` lädt via `require('./parsers.cjs')`
- **Build-Kommando**: `esbuild src/main/parsers.ts --outdir=src --out-extension:.js=.cjs`
- **Empfehlung**: BEHALTEN - notwendig für Laufzeit

### src/utils/settings.cjs
- **Status**: WIRD GENERIERT
- **Generiert von**: `settings.ts` via esbuild
- **Verwendet in**: Parsers.cjs (Legacy-Kompatibilität)
- **Build-Kommando**: `esbuild src/utils/settings.ts --outdir=src --out-extension:.js=.cjs`
- **Empfehlung**: BEHALTEN - Teil des Build-Prozesses

**Wichtig**: Diese .cjs Dateien sind bereits in `.gitignore` unter `src/**/*.js`

## Funktionen die in Services migriert wurden

### Aus main.cjs → SettingsService
Die folgenden Funktionen wurden von `main.cjs` in `SettingsService` migriert:

| Alt (main.cjs) | Neu (SettingsService) |
|----------------|----------------------|
| `ensureSettings()` | `get()` |
| `loadSettings()` | `load()` |
| `loadSettingsSyncSafe()` | `loadSync()` |
| `saveSettings()` | `save()` / `saveSync()` |
| `settingsPath()` | `resolveSettingsPath()` (privat) |
| `encryptSecret()` | `encryptSecret()` |
| `decryptSecret()` | `decryptSecret()` |

### Aus main.cjs → NetworkService
Die folgenden Funktionen wurden in `NetworkService` migriert:

| Alt (main.cjs) | Neu (NetworkService) |
|----------------|---------------------|
| TCP Server Setup | `startTcpServer()` |
| TCP Server Stop | `stopTcpServer()` |
| HTTP Polling | `httpStartPoll()` |
| HTTP Poll Stop | `httpStopPoll()` |
| `httpFetchText()` | `httpFetchText()` (privat) |
| `dedupeNewEntries()` | `dedupeNewEntries()` (privat) |

### Noch in main.ts (könnten in LogFileService)
Diese Funktionen sind noch direkt in `main.ts` und könnten in einen separaten Service ausgelagert werden:

- `openLogStream()`
- `closeLogStream()`
- `rotateIfNeeded()`
- `writeEntriesToFile()`

**Empfehlung**: Optional - könnte ein `LogFileService` erstellt werden für bessere Trennung.

## Duplizierte Logik

### src/utils/settings.ts vs SettingsService
Die Funktionen in `settings.ts` sind größtenteils in `SettingsService` dupliziert:

| settings.ts | SettingsService |
|-------------|-----------------|
| `getDefaultSettings()` | `getDefaults()` (static) |
| `parseSettingsJSON()` | Teil von `load()` |
| `stringifySettingsJSON()` | Teil von `save()` |
| `mergeSettings()` | Teil von `update()` |

**Status**: `settings.ts` wird noch für die Kompilierung zu `settings.cjs` benötigt (für parsers.cjs Legacy-Support)

**Empfehlung**: Behalten bis `parsers.cjs` Abhängigkeit aufgelöst ist.

## Dateigröße-Einsparungen

Bereits entfernt:
- `renderer.ts`: ~412 Zeilen / ~12KB
- `theme.ts`: ~286 Zeilen / ~8KB
- **Gesamt**: ~698 Zeilen / ~20KB

Potentiell entfernbar (nach Tests):
- `main.cjs`: ~1119 Zeilen / ~34KB

## Empfohlene nächste Schritte

### Kurzfristig (bereits erledigt)
1. ✅ `src/main/renderer.ts` gelöscht
2. ✅ `src/main/theme.ts` gelöscht
3. ✅ `tsconfig.json` aktualisiert

### Mittelfristig (nach Validierung)
1. ⚠️ `src/main/main.cjs` löschen nach ausführlichem Testing
2. 🔄 File-Logging in `LogFileService` auslagern (optional)

### Langfristig (Architektur)
1. 🔄 `parsers.cjs` Abhängigkeit von `settings.cjs` entfernen
2. 🔄 `settings.ts` vereinfachen oder entfernen

## Build-Prozess

Der aktuelle Build-Prozess generiert folgende Dateien:

```bash
npm run prebuild
  ├── build:main → dist-main/main.js (von main.ts)
  ├── build:preload → preload.js (von preload.ts)
  └── esbuild → src/main/parsers.cjs, src/utils/settings.cjs
```

Alle generierten Dateien sind in `.gitignore` erfasst.

## Validierung

Nach dem Entfernen von `renderer.ts` und `theme.ts`:

```bash
npm run test    # Alle Tests müssen bestehen
npm run lint    # Keine Fehler
npm run prebuild # Build muss erfolgreich sein
```

Alle Checks sollten erfolgreich durchlaufen.
