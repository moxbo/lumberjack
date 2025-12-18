## Plan: Lumberjack Release Readiness

Cross-team plan to harden stability, finalize Win/macOS distribution with signing hooks, wire up Playwright + CI coverage, update compliance docs, and execute a last-mile QA gate so Lumberjack ships reliably on both platforms.

**Version**: 1.0.2  
**Last Updated**: 2025-12-17  
**Status**: 🟡 In Progress

---

### Current State Assessment

| Bereich | Status      | Details |
|---------|-------------|---------|
| Electron-Builder Config | ✅ Done      | Win portable/NSIS + macOS DMG/ZIP konfiguriert |
| CI/CD Pipeline | ✅ Done      | GitHub Actions für Windows x64/ia32 builds |
| Unit-Tests | ✅ Done      | 8+ Test-Suites in `scripts/` (smoke-parse, msg-filter, etc.) |
| CHANGELOG | ✅ Done      | `docs/reference/CHANGELOG.md` vorhanden |
| DEPLOYMENT_GUIDE | ✅ Done      | `docs/DEPLOYMENT_GUIDE.md` vorhanden |
| Icon-Generation | ✅ Done      | `scripts/make-icon.ts` + Assets |
| Lint/Format/Husky | ✅ Done      | ESLint + Prettier + lint-staged |
| E2E-Tests (Playwright) | ✅ Done      | Basis-Tests in `tests/e2e/` |
| PRIVACY.md | ✅ Done      | `docs/PRIVACY.md` (DE/EN) |
| Third-Party-Lizenzen | ✅ Done     | `docs/THIRD_PARTY_LICENSES.md` + npm script |
| Code Signing | ⚠️ Prepared | Konfiguriert aber deaktiviert |
| macOS CI-Build | ⚠️ Missing  | Nur Windows in CI-Matrix |
| Notarization Hook | ❌ Missing   | `afterSign` Hook fehlt |
| Tests in CI | ✅ Done     | `npm test` in Workflow vor Build |

---

### Steps

#### Step 1: Stabilität & Telemetrie ✅ COMPLETED
- [x] Konsolidierte Fehlerdomänen implementiert
- [x] `electron-log` mit Rotation konfiguriert
- [x] Watchdogs für main.ts, preload.ts, renderer
- [x] Freeze-Monitor und Diagnostics implementiert
- [x] Icon-Resolution Fehlerbehandlung

**Evidence**: `docs/reference/CHANGELOG.md` dokumentiert alle Fixes

#### Step 2: Release-Builds & Signierung ⚠️ PARTIAL
- [x] electron-builder Targets für Win (portable+NSIS) konfiguriert
- [x] electron-builder Targets für macOS (DMG+ZIP) konfiguriert
- [x] `scripts/afterPack.cjs` vorhanden
- [ ] **TODO**: afterSign Hook für macOS Notarization erstellen
- [ ] **TODO**: Code-Signing-Zertifikate beschaffen
- [ ] **TODO**: Signing-Dokumentation in DEPLOYMENT_GUIDE ergänzen

**Files**: `package.json` (build section), `scripts/afterPack.cjs`

#### Step 3: Automatisierte Tests & CI ⚠️ PARTIAL
- [x] Unit-Tests in `scripts/` (8+ Suites, alle passing)
- [x] Playwright + playwright-electron als devDependencies
- [x] GitHub Actions Workflow für Windows builds
- [x] `npm test` in CI-Pipeline integriert
- [x] E2E-Tests erstellt (`tests/e2e/*.spec.ts`)
- [ ] **TODO**: macOS zur CI-Matrix hinzufügen
- [ ] **TODO**: Test-Report/Coverage-Upload

**Files**: `.github/workflows/build.yml`, `scripts/test-*.ts`, `tests/e2e/*.spec.ts`

#### Step 4: Dokumentation & Compliance ✅ COMPLETED
- [x] README.md aktuell und vollständig
- [x] CHANGELOG.md vorhanden
- [x] DEPLOYMENT_GUIDE.md vorhanden
- [x] Umfangreiche docs/ Struktur
- [x] Third-Party-Lizenz-Liste generiert (`docs/THIRD_PARTY_LICENSES.md`)
- [x] `docs/PRIVACY.md` erstellt (DE/EN)
- [ ] **TODO**: Security Addendum falls Telemetrie

**Files**: `README.md`, `docs/`

#### Step 5: Finaler QA/Release-Check 🔲 PENDING
- [x] `docs/archive/CHECKLIST_IMPLEMENTATION.md` vorhanden
- [ ] Smoke-Tests auf signierten Artefakten (blocked by Step 2)
- [ ] Release Notes Review
- [ ] Go/No-Go Meeting

---

### Priority Tasks (Recommended Order)

#### 🔴 P0 - Release Blocker (Diese Woche)
| # | Task | Effort | Impact | Begründung |
|---|------|--------|--------|------------|
| 1 | `npm test` in CI integrieren | 2h | Critical | Verhindert Regressionen bei jedem Push |
| 2 | Third-Party-Lizenzen exportieren | 1h | Critical | Rechtlich erforderlich für Distribution |

#### 🟠 P1 - Vor Release (Woche 1-2)
| # | Task | Effort | Impact | Begründung |
|---|------|--------|--------|------------|
| ~~3~~ | ~~PRIVACY.md erstellen~~ | ~~2h~~ | ~~High~~ | ✅ DONE |
| ~~4~~ | ~~E2E-Tests Basis (`tests/e2e/smoke.spec.ts`)~~ | ~~1d~~ | ~~High~~ | ✅ DONE |
| 5 | macOS zur CI-Matrix hinzufügen | 3h | High | Aktuell nur Windows getestet |

#### 🟡 P2 - Vor Production Release (Woche 3-4)
| # | Task | Effort | Impact | Begründung |
|---|------|--------|--------|------------|
| 6 | Code-Signing aktivieren | 1d | Critical | Ohne Signing: Gatekeeper/SmartScreen-Warnungen |
| 7 | afterSign Hook (Notarization) | 0.5d | High | macOS-spezifisch, nach Signing |

#### 🟢 P3 - Nice-to-Have (Nach Release)
| # | Task | Effort | Impact | Begründung |
|---|------|--------|--------|------------|
| 8 | E2E-Tests erweitern (Filter, TCP, etc.) | 2-3d | Medium | Mehr Coverage |
| 9 | ~~Auto-Update (electron-updater)~~ | ~~1d~~ | ~~Medium~~ | ✅ DONE |
| 10 | Linux CI-Build | 0.5d | Low | Geringere Nutzerbasis |

---

### Begründung der Priorisierung

**Warum Tests in CI vor E2E-Tests?**
- Die Unit-Tests existieren bereits und sind stabil
- CI-Integration ist 2h Aufwand mit sofortigem Nutzen
- E2E-Tests brauchen mehr Setup-Zeit

**Warum Third-Party-Lizenzen so hoch?**
- Rechtliche Anforderung für jede öffentliche Distribution
- Trivial zu generieren (`npx license-checker`)
- Risiko bei Nicht-Erfüllung: Rechtliche Probleme

**Warum Code-Signing "erst" P2?**
- Benötigt externe Ressourcen (Zertifikate kaufen)
- App funktioniert auch ohne (nur Warnungen)
- Paralleler Track: Beschaffung anstoßen während P0/P1 läuft

---

### Further Considerations

1. **Code Signing** – Option A: internes Apple Dev-ID & DigiCert EV; Option B: externe Signing-Dienstleister.
2. **Telemetrieumfang** – Aktuell keine Telemetrie implementiert. Falls geplant: minimal anonymisierte Metriken vs. komplettes Opt-In.
3. **CI-Runner-Kapazität** – GitHub-hosted `macos-latest` für Playwright auf macOS nutzen (kostenlos für öffentliche Repos).
4. **Auto-Update** – ✅ electron-updater implementiert (`src/services/AutoUpdaterService.ts`). Benötigt GitHub Releases als Update-Quelle. Funktioniert nur mit signierten Builds.
5. **Linux-Support** – Aktuell nicht in CI. Bei Bedarf `ubuntu-latest` + AppImage/deb targets hinzufügen.

---

### Next Actions (Updated)

#### 🔴 Heute/Morgen (P0): ✅ DONE
1. [x] `npm test` Step in `.github/workflows/build.yml` vor Build einfügen
2. [x] `npm run licenses` Script + `docs/THIRD_PARTY_LICENSES.md` erstellt

#### 🟠 Diese Woche (P1):
3. [x] `docs/PRIVACY.md` mit Standard-Template erstellen
4. [ ] E2E-Test-Grundstruktur anlegen: `tests/e2e/smoke.spec.ts`
5. [ ] macOS Job in `.github/workflows/build.yml` hinzufügen

#### 🟡 Parallel anstoßen (P2 Vorbereitung):
6. [ ] Entscheider für Code-Signing-Zertifikate benennen
7. [ ] Budget für Apple Developer Program ($99/Jahr) klären
8. [ ] Windows EV-Zertifikat evaluieren (optional, ~$200-500/Jahr)

#### 🟢 Nach Zertifikatsbeschaffung (P2):
9. [ ] `scripts/afterSign.cjs` für macOS Notarization implementieren
10. [ ] GitHub Secrets für Signing-Credentials einrichten
11. [ ] Signing in CI aktivieren und testen

---

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Unsigned App wird von Gatekeeper/SmartScreen blockiert | High | High | Code Signing priorisieren |
| E2E-Tests fehlen, Regression unbemerkt | Medium | Medium | Playwright-Suite aufbauen |
| Privacy-Compliance-Issues | Low | Low | ✅ PRIVACY.md erstellt |
| CI-Build-Fehler auf macOS | Low | Low | macOS in CI testen |

---

### Timeline Estimate

```
Week 1: Tasks 1-5 (E2E, CI-Integration, Docs)
Week 2: Zertifikatsbeschaffung anstoßen
Week 3-4: Code Signing implementieren und testen
Week 5: Final QA & Go/No-Go
```

**Estimated Release Date**: Q1 2026 (abhängig von Signing-Zertifikaten)
