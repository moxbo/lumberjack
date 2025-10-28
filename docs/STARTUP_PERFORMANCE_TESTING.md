# Startup Performance Testing Guide

This document describes how to verify the startup performance improvements implemented in this PR.

## Background

**Issue**: Application startup was taking 9+ seconds (specifically 9172ms to window-ready-to-show)
**Root Cause**: Settings were being loaded synchronously BEFORE window creation, blocking the entire startup process
**Fix**: Deferred settings loading to AFTER window creation using setImmediate()

## Expected Results

After the optimization:
- **Cold start**: < 2 seconds (down from 9+ seconds)
- **Warm start**: < 1 second
- **Time-to-interactive**: Immediate (window shows and responds right away)

## How to Test

### Method 1: Check Performance Logs (Recommended)

1. Build the application:
   ```bash
   npm run build:zip:x64
   ```

2. Run the application from the built executable:
   ```bash
   # Windows
   .\release\win-unpacked\Lumberjack.exe
   
   # macOS
   ./release/mac/Lumberjack.app/Contents/MacOS/Lumberjack
   ```

3. Check the console output for performance logs. You should see:
   ```
   [PERF] app-start: 0ms
   [PERF] main-loaded: 45ms
   [PERF] ipc-handlers-register-start: 46ms
   [PERF] ipc-handlers-registered: 48ms
   [PERF] app-ready-handler-registered: 49ms
   [PERF] app-ready: 120ms
   [PERF] platform-setup-start: 121ms
   [PERF] platform-setup-complete: 125ms
   [PERF] create-window-start: 126ms
   [PERF] window-creation-start: 127ms
   [PERF] window-created: 145ms
   [PERF] create-window-initiated: 146ms
   [PERF] renderer-load-start: 148ms
   [PERF] renderer-loaded: 850ms
   [PERF] window-ready-to-show: 852ms
   ✓ Startup performance OK: 852ms
   
   === Startup Time Breakdown ===
     app-start → main-loaded: 45ms
     main-loaded → ipc-handlers-register-start: 1ms
     ipc-handlers-register-start → ipc-handlers-registered: 2ms
     ipc-handlers-registered → app-ready-handler-registered: 1ms
     app-ready-handler-registered → app-ready: 71ms
     app-ready → platform-setup-start: 1ms
     platform-setup-start → platform-setup-complete: 4ms
     platform-setup-complete → create-window-start: 1ms
     create-window-start → window-creation-start: 1ms
     window-creation-start → window-created: 18ms
     window-created → create-window-initiated: 1ms
     create-window-initiated → renderer-load-start: 2ms
     renderer-load-start → renderer-loaded: 702ms
     renderer-loaded → window-ready-to-show: 2ms
   ==============================
   ```

4. **Verify**: The `window-ready-to-show` time should be **< 2000ms** (previously was 9172ms)

5. Check that settings load happens AFTER window is shown:
   ```
   [PERF] menu-build-start: 855ms
   [PERF] menu-built: 858ms
   [PERF] settings-load-start: 859ms
   [PERF] settings-loaded-deferred: 1200ms
   ```
   
   Note: Settings load time (859ms → 1200ms = 341ms) is now NON-BLOCKING

### Method 2: Manual Timing

1. Close all instances of Lumberjack
2. Clear cache (optional, for cold start test)
3. Start a timer
4. Click the Lumberjack executable
5. Stop timer when the window appears and is interactive
6. **Expected**: < 2 seconds

### Method 3: Compare Before/After

If you want to see the difference:

**Before (without fix)**:
```
Checkout the commit before this PR
Build and run
You'll see: window-ready-to-show: ~9000ms+
```

**After (with fix)**:
```
Checkout this PR
Build and run
You'll see: window-ready-to-show: <2000ms
```

## Performance Breakdown Analysis

The detailed breakdown helps identify where time is spent:

### Expected Breakdown (Good)
```
app-start → main-loaded: ~40-60ms        (module loading)
app-ready → platform-setup-complete: ~5-10ms  (platform initialization)
create-window-start → window-created: ~15-25ms (window creation)
renderer-load-start → renderer-loaded: ~500-800ms (renderer loading)
window-ready-to-show total: <2000ms
```

### Problem Indicators (Bad)
```
settings-load-start → settings-loaded: >5000ms  (slow disk/network)
renderer-load-start → renderer-loaded: >2000ms  (renderer issue)
app-ready → platform-setup-complete: >1000ms    (antivirus scanning)
```

## Troubleshooting Slow Startup

If startup is still > 3 seconds after the fix, check:

1. **Antivirus**: Add Lumberjack to exclusions
   - Symptom: Large gap between `app-ready` and `platform-setup-complete`
   
2. **Settings on slow storage**: 
   - Check settings location: `%AppData%\Lumberjack` (Windows)
   - Move off network drive or cloud-synced folder
   - Symptom: Large gap between `settings-load-start` and `settings-loaded-deferred`
   - Note: This is now NON-BLOCKING but still worth fixing
   
3. **Renderer loading slow**:
   - Rebuild production bundle: `npm run build:renderer`
   - Check for corrupt build
   - Symptom: Large gap between `renderer-load-start` and `renderer-loaded`

4. **Graphics driver issue**:
   - Update graphics drivers
   - Symptom: Large gap between `create-window-start` and `window-created`

## Verification Checklist

- [ ] window-ready-to-show < 2000ms
- [ ] Settings load happens AFTER window shows (check logs)
- [ ] Window appears quickly (subjective feel test)
- [ ] All features work correctly:
  - [ ] Open log files
  - [ ] TCP server start/stop
  - [ ] HTTP load/poll
  - [ ] Settings persist
  - [ ] Filters work
- [ ] No console errors
- [ ] Performance breakdown shows reasonable times for each phase

## Success Criteria

✅ **PASS**: window-ready-to-show < 2000ms AND settings load after window creation  
❌ **FAIL**: window-ready-to-show > 3000ms OR settings load before window creation

## Reporting Issues

If startup is still slow after this fix, please provide:

1. Complete console output (especially performance logs)
2. Detailed breakdown output
3. System information:
   - OS version
   - Disk type (SSD/HDD/Network)
   - Antivirus software
   - Settings file location (check if on network/cloud drive)
4. Steps to reproduce

## Additional Notes

- The icon loading (icon-load-start → icon-load-end) happens AFTER the window is shown
  - This is intentional and doesn't affect perceived startup time
  - Icon load time is typically < 20ms
  
- The parsers setup also happens in background (parsers-setup-start → parsers-setup-complete)
  - This is also non-blocking
  - Typically < 10ms

- First window creation may be slightly slower than subsequent windows due to dist path caching
  - First window: searches 6 candidates
  - Subsequent windows: uses cached path
  - This is a minor optimization (saves ~5-10ms)
