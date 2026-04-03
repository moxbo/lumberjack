# Quick Start - Icon & Freeze Fixes Deployment

**For**: Developers & QA Teams  
**Status**: Ready to Deploy  
**Date**: November 12, 2025  

---

## What's Included

✅ Icon fixes (Windows/macOS)  
✅ Freeze monitoring & diagnostics  
✅ Crash prevention  
✅ Enhanced logging  

---

## Build & Deploy

### Step 1: Verify Build
```bash
cd /Users/mo/develop/my-electron-app
npm run prebuild
# Expected output: ✡ Done (no errors)
```

### Step 2: Create Distribution

**Windows**:
```bash
npm run build:portable
# Output: release/Lumberjack-x.x.x.exe
```

**macOS**:
```bash
npm run build:mac:dmg
# Output: release/Lumberjack-x.x.x.dmg
```

### Step 3: Test Fresh Install

**Windows**:
1. Uninstall previous version
2. Run .exe installer
3. Verify icon in:
   - Taskbar ✓
   - Alt+Tab ✓
   - Window title ✓
4. Load large log file
5. Check for freeze logs

**macOS**:
1. Delete previous app
2. Mount DMG and copy to Applications
3. Verify icon in:
   - Dock ✓
   - Finder ✓
   - Spotlight ✓

---

## Verification Checklist

### Icon Display
- [ ] Icon appears in taskbar on first launch
- [ ] Icon persists after minimize/restore
- [ ] Icon shows in Alt+Tab switcher (Windows)
- [ ] Icon shows in App Switcher (macOS)
- [ ] Application name matches in taskbar

### Performance
- [ ] Application starts normally
- [ ] No noticeable slowdown
- [ ] No CPU spike on startup
- [ ] Logs are written correctly

### Logging
- [ ] Check log for `[icon]` entries
  - Expected: `[icon] resolveIconPathSync hit: ...`
- [ ] No errors in icon resolution
- [ ] No freeze warnings on normal use

### Stability
- [ ] Load large files (10MB+) without freezing
- [ ] No crashes during normal operation
- [ ] Clean shutdown (no crash logs)
- [ ] Graceful handling of missing icon

---

## Log Locations

| OS | Path |
|----|------|
| Windows | `%APPDATA%\Lumberjack\logs\main.log` |
| macOS | `~/Library/Logs/Lumberjack/main.log` |
| Linux | `~/.config/Lumberjack/logs/main.log` |

### View Logs
```bash
# Windows (PowerShell)
Get-Content "$env:APPDATA\Lumberjack\logs\main.log" -Tail 50

# macOS/Linux
tail -f ~/Library/Logs/Lumberjack/main.log
```

---

## Key Log Tags

| Tag | Meaning | Action |
|-----|---------|--------|
| `[icon]` | Icon operations | Normal - verify resolution successful |
| `[freeze-diag]` | Batch operations | Monitor - indicates activity |
| `[freeze-monitor]` | Event loop | Alert - if frequent freeze warnings |

---

## Rollback Plan

If issues arise:

```bash
# Revert to previous build
git checkout src/main/main.ts

# Rebuild
npm run prebuild

# Rebuild distribution
npm run build:portable  # or build:mac:dmg
```

---

## FAQ

### Q: Icon still not showing?
**A**: 
1. Check logs for `[icon]` entries
2. Verify `images/icon.ico` exists in dist
3. Ensure icon file is not corrupted:
   ```bash
   file images/icon.ico
   # Should output: Windows icon resource
   ```
4. Try regenerating: `npm run icon:generate`

### Q: Freezes still happening?
**A**:
1. Check logs for `[freeze-monitor]` warnings
2. Note the timestamp and frozen duration
3. Load same files with previous version and compare
4. Report with log excerpt if different

### Q: How to enable debug logging?
**A**:
```bash
NODE_ENV=development npm start
# More verbose logging output
```

### Q: Can I test icon before building?
**A**:
```bash
npm run dev
# Check console for [icon] messages
# Verify window shows correct icon
```

---

## Deployment Checklist

- [ ] Code changes reviewed
- [ ] Build succeeds (npm run prebuild ✓)
- [ ] No new errors in logs
- [ ] Icon resolution verified
- [ ] Freeze monitor working
- [ ] Backward compatibility confirmed
- [ ] Documentation updated
- [ ] Distribution builds complete
- [ ] QA testing passed
- [ ] Release notes prepared

---

## Release Notes Template

```markdown
## Version 1.0.2 - Icon & Stability Fixes

### Fixes
- 🎨 Fixed application icon not displaying in taskbar (Windows/macOS)
- ❄️ Added freeze detection and diagnostics
- 💥 Improved crash robustness with better error handling

### Changes
- Enhanced icon resolution with fallback paths
- Added event loop monitoring for freeze detection
- Improved batch message delivery diagnostics
- Platform-specific icon handling (Windows/macOS)

### Improvements
- Better logging for troubleshooting
- Graceful handling of missing resources
- Improved application stability

### Testing
- Icon verified on fresh Windows install
- Freeze monitoring active and logging
- Large file loading tested without issues

### Known Issues
- None reported

### Upgrade Notes
- No migration needed
- Works with existing settings
- No breaking changes
```

---

## Support Contact

If issues arise after deployment:
1. Collect logs from user
2. Search for `[icon]` and `[freeze-monitor]` tags
3. Report with:
   - OS version
   - Lumberjack version
   - Log excerpt (last 100 lines)
   - Steps to reproduce

---

## Version & Build Info

- **Version**: 1.0.14
- **Build Date**: April 3, 2026
- **Target**: Lumberjack Log Viewer
- **Platforms**: Windows, macOS, Linux (icon fixes on Win/Mac)

---

## Code Signing & Notarization

Ohne Code Signing zeigen macOS (Gatekeeper) und Windows (SmartScreen) Warnungen an. Für eine reibungslose Benutzererfahrung muss die App signiert und (auf macOS) notarisiert werden.

> **Detaillierte Anleitung**: Siehe [`docs/developer/CODE_SIGNING_GUIDE.md`](developer/CODE_SIGNING_GUIDE.md) für Schritt-für-Schritt-Instruktionen.

### Voraussetzungen

| Plattform | Zertifikat | Kosten | Zweck |
|-----------|------------|--------|-------|
| **macOS** | Apple Developer ID Application | $99/Jahr | Gatekeeper-Freigabe |
| **Windows** | EV Code Signing (DigiCert, Sectigo, etc.) | $200-500/Jahr | SmartScreen-Freigabe sofort |
| **Windows** | Standard OV Certificate | $70-300/Jahr | SmartScreen baut Reputation auf |

### GitHub Secrets konfigurieren

Folgende Secrets müssen im GitHub Repository unter **Settings → Secrets and variables → Actions** eingerichtet werden:

**macOS:**
| Secret | Beschreibung |
|--------|-------------|
| `MAC_CSC_LINK` | Base64-encodiertes .p12 Zertifikat |
| `MAC_CSC_KEY_PASSWORD` | Passwort für das Zertifikat |
| `APPLE_ID` | Apple ID E-Mail-Adresse |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-spezifisches Passwort (appleid.apple.com) |
| `APPLE_TEAM_ID` | 10-stellige Apple Team ID |

**Windows:**
| Secret | Beschreibung |
|--------|-------------|
| `WIN_CSC_LINK` | Base64-encodiertes .pfx Zertifikat |
| `WIN_CSC_KEY_PASSWORD` | Passwort für das Zertifikat |

### Signing aktivieren

1. **Zertifikat zu Base64 konvertieren:**
   ```bash
   # macOS
   base64 -i certificate.p12 | pbcopy
   
   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
   ```

2. **GitHub Secrets anlegen** (siehe Tabelle oben)

3. **Build auslösen** – Die CI/CD Pipeline erkennt automatisch ob Signing-Secrets vorhanden sind:
   - `afterSign` Hook (`scripts/afterSign.cjs`) führt macOS Notarization durch
   - `afterPack` Hook (`scripts/afterPack.cjs`) setzt Windows-Metadaten
   - Wenn keine Secrets vorhanden: Build läuft ohne Signing weiter

### Signing lokal deaktivieren

```bash
# Lokaler Build ohne Signing (für Tests)
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:mac:dmg    # macOS
npm run build:portable   # Windows
```

### Signatur verifizieren

```bash
# macOS
codesign --verify --deep --strict /path/to/Lumberjack.app
spctl --assess --verbose=4 /path/to/Lumberjack.app

# Windows (PowerShell)
Get-AuthenticodeSignature "path\to\Lumberjack.exe"
```

---

## CI/CD Pipeline

### Workflow-Übersicht

| Workflow | Trigger | Aktionen |
|----------|---------|----------|
| `ci.yml` | Push/PR auf main/develop | Lint, Tests (Ubuntu/Windows/macOS), Coverage |
| `build.yml` | Alle Pushes + Tags | CI-Tests + Release-Builds bei Tags |
| `release.yml` | Tag-Push (`v*`) | Multi-Platform Build + GitHub Release |

### Test-Coverage

Coverage-Reports werden automatisch als Artifacts hochgeladen:
- **CI-Workflow**: `coverage-report` (Ubuntu)
- **Build-Workflow**: `coverage-report-ci`

---

**Status**: ✅ Ready for Deployment  
**Last Updated**: April 3, 2026

