# Windows Startup Performance Optimization

## Overview

This document details the performance optimizations made to improve Lumberjack's startup time on Windows, particularly addressing the >20 second startup issue.

## Baseline Performance Issues

### Identified Problems
1. **Synchronous module loading**: Heavy modules loaded during startup
2. **File I/O blocking**: Settings and logs loaded synchronously
3. **No performance tracking**: Unable to identify bottlenecks
4. **Mixed CommonJS/ESM**: Build complexity and slower module resolution
5. **Unoptimized window creation**: Icon loading and settings during critical path

## Optimizations Implemented

### 1. Lazy Module Loading

**Before:**
```javascript
const AdmZip = require('adm-zip');  // Loaded immediately
const parsers = require('./parsers.cjs');  // Loaded at startup
```

**After:**
```typescript
let AdmZip: unknown = null;
function getAdmZip() {
  if (!AdmZip) {
    AdmZip = require('adm-zip');
  }
  return AdmZip as typeof import('adm-zip');
}
```

**Impact:** Defers loading of heavy modules until first use

### 2. Asynchronous Settings Loading

**Before:**
```javascript
// Settings loaded synchronously during startup
const raw = fs.readFileSync(settingsPath, 'utf8');
```

**After:**
```typescript
// Settings loaded asynchronously after window creation
async load(): Promise<void> {
  const raw = await fs.promises.readFile(this.settingsPath, 'utf8');
}
```

**Impact:** Non-blocking settings load, window shows faster

### 3. Performance Tracking Service

**New Addition:**
```typescript
class PerformanceService {
  mark(name: string): void {
    const duration = Date.now() - this.startTime;
    log.info(`[PERF] ${name}: ${duration}ms`);
  }
}
```

**Impact:** Identifies slow startup paths, enables data-driven optimization

### 4. Service-Based Architecture

**Before:** Monolithic main.cjs with mixed concerns

**After:** 
- `SettingsService`: Manages settings with async/sync methods
- `NetworkService`: Handles TCP/HTTP operations
- `PerformanceService`: Tracks performance metrics
- `ipcHandlers.ts`: Separate IPC logic

**Impact:** Better code organization, easier to optimize, testable units

### 5. Deferred Icon Loading

Window shown before icon processing completes (Windows-specific optimization)

### 6. TypeScript Build Optimization

Pre-compiled TypeScript to CommonJS with esbuild for faster startup

## Performance Benchmarks

### Target Improvements

| Metric | Before | Target |
|--------|--------|--------|
| Cold Start | >20s | <3s |
| Warm Start | ~10s | <1s |
| Window Visible | ~15s | <1s |

### Key Performance Marks

1. `app-start`: Application initialization
2. `window-created`: BrowserWindow instantiated
3. `renderer-loaded`: Renderer finished loading
4. `window-ready-to-show`: Window ready to display
5. `settings-loaded`: Settings loaded from disk

## Performance Optimizations for Windows Startup

### Critical Performance Fixes (2025-10)

**Problem**: Application startup on Windows taking >20 seconds due to synchronous file I/O operations.

**Root causes identified**:
1. **Settings loading on-demand**: `SettingsService.get()` called `loadSync()` multiple times during startup, each time reading from disk synchronously
2. **Icon extraction from ASAR**: Synchronous file reads and writes during window creation
3. **No async initialization**: Settings loaded lazily instead of eagerly at startup

**Solutions implemented**:

1. **Async settings loading before window creation**:
   ```typescript
   // Before: Settings loaded synchronously when first accessed
   const settings = settingsService.get(); // Triggers loadSync()
   
   // After: Settings loaded asynchronously before window creation
   await settingsService.load(); // Async load during app.whenReady()
   const settings = settingsService.get(); // Returns cached settings
   ```
   
2. **Async icon loading after window shown**:
   ```typescript
   // Before: Synchronous icon extraction during window creation
   const iconPath = resolveIconPath(); // fs.readFileSync, fs.writeFileSync
   
   // After: Async icon loading deferred until after window is visible
   const iconPath = await resolveIconPathAsync(); // fs.promises.readFile/writeFile
   ```

3. **Performance tracking**:
   - Added `settings-load-start` and `settings-loaded` marks
   - Added `icon-load-start` and `icon-load-end` marks
   - Improved visibility into startup bottlenecks

**Expected performance improvement**:
- Settings load: ~500-2000ms saved (Windows file I/O is slow)
- Icon extraction: ~200-500ms saved (one-time ASAR extraction)
- Window visible: 1-3 seconds faster on cold start
- **Total improvement**: 2-5 seconds faster startup on Windows

**Code changes**:
- `main.ts`: Added async settings loading in `app.whenReady()`
- `main.ts`: Created `resolveIconPathAsync()` with async file operations
- `main.ts`: Deferred icon loading to `setImmediate` after window shown
- Performance marks added for better observability

## Windows-Specific Optimizations

- Icons extracted from ASAR to userData folder (prevents repeated extraction)
- Portable EXE support with local settings
- Async file logging with buffering
- Deferred heavy operations with `setImmediate`

## Testing Performance

### Manual Testing
```bash
npm run build:zip:x64
# Extract and run, check logs for [PERF] markers
```

### Performance Logging
The PerformanceService automatically logs startup metrics and warns if startup exceeds 5 seconds.

## Best Practices

1. **Keep Critical Path Minimal**: Only essential operations before window shown
2. **Use Async APIs**: Prefer `fs.promises` over sync methods
3. **Lazy Load Dependencies**: Load heavy modules only when needed
4. **Profile Before Optimizing**: Use PerformanceService to measure

## Conclusion

Target: Consistent <3 second startup on Windows with production builds.

The refactoring implements multiple layers of optimization through service-based architecture, asynchronous I/O, and build optimizations.
