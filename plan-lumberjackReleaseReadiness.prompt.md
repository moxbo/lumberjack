## Plan: Lumberjack Release Readiness

Cross-team plan to harden stability, finalize Win/macOS distribution with signing hooks, wire up Playwright + CI coverage, update compliance docs, and execute a last-mile QA gate so Lumberjack ships reliably on both platforms.

### Steps
1. Stabilität & Telemetrie schärfen (2–3 T, Core Dev): Konsolidierte Fehlerdomänen, `electron-log` Rotation, watchdogs für `src/main/main.ts`, preload (`preload.ts`) und renderer (`src/**/*`); Abhängigkeit: finale Log-Schema-Freigabe; Owner: Backend Lead.
2. Release-Builds & Signierung vorbereiten (2 T, Build Eng): Ergänze electron-builder Targets (`package.json`, `forge.config.js`) für Win portable+NSIS und macOS DMG+ZIP inkl. notarize hook; Dokumentiere Zertifikatsanforderungen in `docs/DEPLOYMENT_GUIDE.md`; Abhängigkeit: Beschaffung Dev-ID & EV-Zertifikate.
3. Automatisierte Tests & CI-Pipelines aufsetzen (3 T, QA Eng): Playwright E2E-Smoke-Suite (`tests/e2e/*.spec.ts`) auf electron runner, Unit/Integration Gaps (`scripts/*`, `src/**/*`), GitHub Actions/JetBrains Space Flow für `npm run test` + Playwright matrix; Abhängigkeit: stabile seed-Datasets in `assets/`.
4. Dokumentation & Compliance aktualisieren (1.5 T, Tech Writer + Security): README, `docs/CHANGELOG.md`, Privacy/Security Addendum (`docs/PRIVACY.md`); Lizenz-Third-Party-Liste, Update Notes; Abhängigkeit: finale Feature-Scope.
5. Finaler QA/Release-Check (2 T, QA + PM): Manuelle Regression-Checklist (`docs/CHECKLIST_IMPLEMENTATION.md`), smoke auf signierten Artefakten (`release/build/*`), Release Notes Review, “Go/No-Go” Meeting; Abhängigkeit: abgeschlossene Schritte 1–4.

### Further Considerations
1. Code Signing – Option A: internes Apple Dev-ID & DigiCert EV; Option B: externe Signing-Dienstleister.
2. Telemetrieumfang abstimmen – minimal anonymisierte Metriken vs. komplettes Opt-In?
3. CI-Runner-Kapazität klären – lokale Macs oder Cloud-Geräte für Playwright auf macOS?

### Next Actions
1. Entscheider für Code-Signing-Zertifikate benennen und Beschaffung anstoßen.
2. Core Dev bestätigt Logging/Fehlerdomänen-Zielbild, damit Step 1 starten kann.
3. QA Eng entwirft Playwright-Testliste und stimmt Testdatenbedarf mit Dev ab.

