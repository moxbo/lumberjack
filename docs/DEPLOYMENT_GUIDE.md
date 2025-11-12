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

- **Version**: 1.0.2
- **Build Date**: November 12, 2025
- **Target**: Lumberjack Log Viewer
- **Platforms**: Windows, macOS, Linux (icon fixes on Win/Mac)

---

**Status**: ✅ Ready for Deployment  
**Last Updated**: November 12, 2025  

