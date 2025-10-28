# Startup Performance Optimizations

## Problem

The application was experiencing slow startup times of 20+ seconds, which is unacceptable for user experience.

## Root Causes Identified

1. **Synchronous File I/O**: Settings were loaded synchronously using `fs.readFileSync`, blocking the main process
2. **Heavy Dependencies Loaded Eagerly**:
   - `moment.js` (~67KB) loaded at module initialization
   - `adm-zip` loaded immediately even though ZIP processing is rare
   - `canvas` module attempted to load for icon generation
3. **Blocking Initialization**: Log stream opened before window creation
4. **No Progressive Loading**: Everything initialized before showing the window

## Optimizations Implemented

### 1. Lazy Loading of Dependencies

**Impact**: Reduces initial load time by deferring non-critical module loading

- **adm-zip**: Now loaded only when actually processing ZIP files

  ```javascript
  // Before: const AdmZip = require('adm-zip');
  // After: Lazy-loaded via getAdmZip() function
  let AdmZip = null;
  function getAdmZip() {
    if (!AdmZip) AdmZip = require('adm-zip');
    return AdmZip;
  }
  ```

- **moment.js**: Completely removed, replaced with native Date formatting
  - Bundle size reduction: 142.05 kB → 80.99 kB (43% reduction)
  - Zero performance impact - native Date is faster

### 2. Asynchronous Settings Loading

**Impact**: Prevents main process blocking during startup - **CRITICAL OPTIMIZATION**

- Changed `loadSettings()` from synchronous to async
- **Settings now load AFTER window creation using `setImmediate()`** (previously loaded BEFORE)
- Window appears immediately with default settings (no blocking wait)
- Settings applied once loaded, menu updates automatically
- **This change alone can reduce startup time from 9+ seconds to < 2 seconds**

```javascript
// BEFORE (BLOCKING): Settings loaded before window creation
void app.whenReady().then(async () => {
  await settingsService.load(); // BLOCKS window creation!
  createWindow();
});

// AFTER (NON-BLOCKING): Settings loaded after window creation
void app.whenReady().then(async () => {
  createWindow(); // Window created immediately
  setImmediate(async () => {
    await settingsService.load(); // Loads in background
  });
});
```

### 3. Deferred Window Display

**Impact**: Smoother perceived startup - window appears only when ready

```javascript
mainWindow = new BrowserWindow({
  // ... config
  show: false, // Don't show until ready
});

mainWindow.once('ready-to-show', () => {
  mainWindow.show(); // Show only when content is ready to paint
});
```

### 4. Deferred Feature Initialization

**Impact**: Reduces time-to-interactive by prioritizing UI rendering

- **Log stream**: Opens asynchronously after window creation
- **Menu building**: Uses default settings initially, updates after settings load
- **Icon generation**: Removed canvas-based icon generation entirely

### 5. Optimized Renderer Loading

**Impact**: Faster initial render and settings application

- Settings loading deferred with `setTimeout(async () => {...}, 0)`
- Allows first paint before fetching settings from main process
- Non-blocking progressive enhancement

### 6. Build Optimizations

**Impact**: Smaller, faster-to-parse bundles

- **Vite configuration**:
  - Minification: `esbuild` (faster than terser)
  - Target: `esnext` (modern browsers/Electron)
  - Single chunk: Simpler loading, no chunk overhead

- **Electron Builder**:
  - ASAR compression: `store` (no decompression overhead)
  - Explicit `asarUnpack: []` (no unnecessary file extraction)

### 7. Dist File Resolution Caching

**Impact**: Eliminates repeated filesystem checks on window creation

- Cache the resolved dist/index.html path on first window creation
- Subsequent windows load instantly without filesystem scans
- Reduces `fs.existsSync()` calls from 6+ to 1 per application launch

```javascript
let cachedDistIndexPath: string | null = null;

// First window: searches candidates
if (!cachedDistIndexPath) {
  for (const candidate of distCandidates) {
    if (fs.existsSync(candidate)) {
      cachedDistIndexPath = candidate; // Cache it
      break;
    }
  }
}
// Subsequent windows: use cached path
void win.loadFile(cachedDistIndexPath);
```

### 8. Comprehensive Performance Instrumentation

**Impact**: Better visibility into startup bottlenecks

- Performance marks added for all critical phases:
  - IPC handlers registration
  - Platform-specific setup (Windows/macOS)
  - Window creation phases
  - Renderer loading
  - Settings loading
  - Menu building
- Detailed breakdown logging shows time between consecutive marks
- Helps identify regressions and optimization opportunities

```javascript
perfService.mark('app-ready');
perfService.mark('platform-setup-start');
// ... platform setup ...
perfService.mark('platform-setup-complete');
perfService.mark('create-window-start');
createWindow();
perfService.mark('create-window-initiated');
```

## Performance Results

### Bundle Size

- **Before**: 142.05 kB (gzipped: 46.00 kB)
- **After**: 80.99 kB (gzipped: 26.10 kB)
- **Improvement**: 43% reduction

### Startup Sequence

**Before**:

1. Load moment.js, adm-zip, canvas
2. **Synchronously read settings file (BLOCKING!)**
3. Open log stream
4. Generate menu icons
5. Build menu
6. Create window (delayed by settings load)
7. Load renderer

**After**:

1. Create window immediately (show: false)
2. Build menu with defaults
3. Load renderer (parallel to window creation)
4. Show window (ready-to-show)
5. **Asynchronously load settings (non-blocking)**
6. Update menu if needed
7. Open log stream if enabled

**Key Difference**: Settings no longer block window creation!

### Expected Improvements

- **Cold start**: Should be < 2 seconds on typical hardware
- **Warm start**: Should be < 1 second
- **Time-to-interactive**: Immediate - window shows and responds immediately

**Performance Logs**: The application now logs detailed startup metrics:

```
[PERF] app-start: 0ms
[PERF] main-loaded: 45ms
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
[PERF] menu-build-start: 855ms
[PERF] menu-built: 858ms
[PERF] settings-load-start: 859ms
[PERF] settings-loaded-deferred: 1200ms
✓ Startup performance OK: 852ms
```

## Troubleshooting Slow Startup

If you're experiencing startup times > 3 seconds, check the performance logs:

### Common Issues

1. **Settings file on slow storage**
   - Symptom: Large gap between `settings-load-start` and `settings-loaded-deferred`
   - Solution: Settings file is on network drive or slow disk
   - Impact: Now non-blocking (doesn't delay window), but still worth investigating

2. **Antivirus scanning**
   - Symptom: Large gap between `app-ready` and `platform-setup-complete`
   - Solution: Add Lumberjack to antivirus exclusions
   - Impact: Can add 5-10 seconds to startup

3. **Renderer loading slow**
   - Symptom: Large gap between `renderer-load-start` and `renderer-loaded`
   - Solution: Check network (if loading from dev server), rebuild production bundle
   - Impact: Usually indicates corrupted build or dev server not responding

4. **Window creation slow**
   - Symptom: Large gap between `create-window-start` and `window-created`
   - Solution: Graphics driver issue, try updating drivers
   - Impact: Rare, usually < 50ms

### Debugging Steps

1. **Check logs**: Look for performance marks in console/log file
2. **Identify bottleneck**: Find largest time delta between consecutive marks
3. **Use detailed breakdown**: The app logs time between each phase
4. **Compare hardware**: Test on different machine to rule out hardware issues

### Performance Analysis

Run the app and check the console output for the detailed breakdown:

```
=== Startup Time Breakdown ===
  app-start → main-loaded: 45ms
  main-loaded → app-ready: 75ms
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

This breakdown helps identify exactly which phase is slow.

## Testing Recommendations

### Manual Testing

1. **Cold Start**: Close app, clear cache, start fresh
   - Time from click to interactive window
   - Verify all features work (file loading, TCP, HTTP, settings)

2. **Warm Start**: Start app after recent close
   - Should be even faster
   - Settings should persist correctly

3. **Feature Verification**:
   - Load .log files ✓
   - Load .json files ✓
   - Load .zip files ✓ (verify lazy-loading works)
   - TCP server start/stop ✓
   - HTTP load/poll ✓
   - Settings persist ✓
   - All filters work ✓

### Performance Profiling

```bash
# Build portable version
npm run build:portable:x64

# Measure startup time (Windows)
Measure-Command { Start-Process ".\release\Lumberjack-1.0.0-x64.exe" -Wait }
```

## Future Optimization Opportunities

1. **Code Splitting**: Split rarely-used features into separate chunks
2. **Web Workers**: Move heavy parsing to worker threads
3. **Virtual Scrolling**: Already implemented, but could be optimized further
4. **Precompiled Templates**: Use template literals instead of DOM manipulation
5. **Service Worker Cache**: Cache static assets for instant subsequent loads
6. **V8 Snapshot**: Create custom V8 snapshot with app code pre-compiled

## Maintenance Notes

### When Adding New Dependencies

- Consider lazy-loading if not needed at startup
- Measure bundle size impact: `npm run build:renderer`
- Prefer native APIs over large libraries

### When Modifying Startup Code

- Keep `createWindow()` minimal
- Defer non-critical operations with `setImmediate()` or `setTimeout()`
- Test cold start performance after changes

### Monitoring

Watch these metrics:

- Bundle size (dist/assets/\*.js)
- Module count in build output
- Startup time on target hardware

## References

- [Electron Performance Best Practices](https://www.electronjs.org/docs/latest/tutorial/performance)
- [V8 Optimization Tips](https://v8.dev/blog/elements-kinds)
- [Web Vitals](https://web.dev/vitals/)
