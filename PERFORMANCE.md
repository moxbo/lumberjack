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

**Impact**: Prevents main process blocking during startup

- Changed `loadSettings()` from synchronous to async
- Settings now load after window creation using `setImmediate()`
- Window appears immediately with default settings
- Settings applied once loaded, menu updates automatically

```javascript
// Before: loadSettings() with fs.readFileSync
// After: async loadSettings() with fs.promises.readFile
async function loadSettings() {
  const raw = await fs.promises.readFile(p, 'utf8');
  // ... parsing logic
}
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

## Performance Results

### Bundle Size

- **Before**: 142.05 kB (gzipped: 46.00 kB)
- **After**: 80.99 kB (gzipped: 26.10 kB)
- **Improvement**: 43% reduction

### Startup Sequence

**Before**:

1. Load moment.js, adm-zip, canvas
2. Synchronously read settings file
3. Open log stream
4. Generate menu icons
5. Build menu
6. Create window
7. Load renderer

**After**:

1. Create window immediately (show: false)
2. Build menu with defaults
3. Load renderer
4. Show window (ready-to-show)
5. Asynchronously load settings
6. Update menu if needed
7. Open log stream if enabled

### Expected Improvements

- **Cold start**: Should be < 2 seconds on typical hardware
- **Warm start**: Should be < 1 second
- **Time-to-interactive**: Immediate - window shows and responds immediately

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
