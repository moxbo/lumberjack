# Startup Performance Optimizations

## Problem Analysis

Based on the provided performance logs, the application had a slow startup time of ~20.8 seconds with the following breakdown:

- **Main process initialization**: 0-661ms (fast, well-optimized)
- **Renderer load (did-finish-load)**: 661-5580ms (~4.9s)
- **Window ready-to-show delay**: 5580-20840ms (~15.3s) ⚠️ **Critical bottleneck**

The 15-second delay between `renderer-loaded` (did-finish-load) and `window-ready-to-show` was the primary issue.

## Root Cause

The `ready-to-show` event in Electron's BrowserWindow fires when Chromium believes the page is fully ready to display without visual artifacts. However, this event can be delayed significantly due to:

1. Chromium waiting for all resources to finish loading
2. Waiting for first meaningful paint
3. Background tasks or event loop blocking
4. Browser-specific timing heuristics

## Implemented Optimizations

### 1. Early Window Display (Primary Fix)

**Change**: Show window 50ms after `did-finish-load` instead of waiting for `ready-to-show`

**Impact**: Expected ~15-second improvement in perceived startup time

**Implementation**:
```typescript
// In createWindow function (main.ts)
win.webContents.on('did-finish-load', () => {
  // ... existing code ...
  
  // Show window shortly after load completes
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 50);
});
```

**Safety**: Added `backgroundColor: '#0f1113'` to BrowserWindow options to prevent white flash when showing early.

### 2. Deferred Renderer Initialization

**Changes**:
- Service worker registration deferred using `requestIdleCallback`
- Settings loading deferred using `requestIdleCallback` with 100ms timeout
- IPC event listeners setup remains in useEffect (already deferred)

**Impact**: Reduces blocking during initial render, improves time-to-interactive

**Implementation**:
```typescript
// Service worker registration (main.tsx)
requestIdleCallback(() => {
  navigator.serviceWorker.register('/service-worker.js')...
}, { timeout: 5000 });

// Settings loading (App.tsx)
requestIdleCallback(() => {
  loadSettings();
}, { timeout: 100 });
```

### 3. Renderer Performance Instrumentation

**Added**: Comprehensive performance tracking in renderer process

**Marks tracked**:
- `renderer-init`: When rendererPerf module initializes
- `main-tsx-start`: When main.tsx starts executing
- `pre-render`: Before React/Preact render
- `post-render`: After React/Preact render
- `first-paint-ready`: After first requestAnimationFrame
- `renderer-ready`: After second requestAnimationFrame (actual paint)
- `app-component-init`: App component initialization
- `settings-load-start` / `settings-loaded`: Settings loading
- `ipc-setup-start` / `ipc-setup-complete`: IPC listeners setup
- `app-mounted`: App component fully mounted

**Usage**: Check browser console for `[RENDERER-PERF]` logs

### 4. Main Process Optimizations (Already Present)

These were already implemented:
- Lazy loading of heavy modules (AdmZip, parsers)
- Deferred settings/menu/logstream setup using setImmediate
- Icon loading deferred until after window is visible

## Expected Results

Before optimizations:
- Total startup: ~20.8s
- Window visible: ~20.8s

After optimizations:
- Total startup: ~20.8s (unchanged - this is when ready-to-show fires)
- **Window visible: ~5.6s** (50ms after did-finish-load)
- **Perceived startup improvement: ~15s faster** ✅

The window now shows as soon as the renderer has loaded and painted, rather than waiting for the arbitrary `ready-to-show` event.

## Future Optimization Opportunities

1. **Bundle size optimization**: 
   - Current main bundle: ~45KB (gzipped: ~14KB) - already well-optimized
   - Code splitting is implemented for dialogs

2. **Lazy load heavy features**:
   - DCFilterDialog and ElasticSearchDialog already lazy-loaded
   - Consider lazy-loading DragAndDropManager (362 lines)

3. **Renderer-side profiling**:
   - Use Chrome DevTools Performance tab to identify long tasks
   - Monitor First Contentful Paint (FCP) and Time to Interactive (TTI)

4. **Progressive enhancement**:
   - Show skeleton UI immediately
   - Load settings/state asynchronously
   - Defer non-critical features until after first interaction

## Validation

To validate improvements:
1. Build the app: `npm run prebuild && npm run build:renderer`
2. Run the app: `npm start` or packaged executable
3. Check console logs for performance marks
4. Compare window visible time vs previous ~20s baseline

Look for these log entries:
- `[PERF] window-shown-early` - should be ~50ms after renderer-loaded
- `[RENDERER-PERF]` logs showing initialization phases
- Main process performance summary (always logged on startup)

## Technical Notes

### Why not use `show: true` on BrowserWindow?

Setting `show: true` would show the window immediately, but before any content is loaded, causing a white flash. Our approach:
1. Create window with `show: false` and `backgroundColor`
2. Load content
3. Show window after `did-finish-load` + 50ms delay
4. Background color prevents flash until first paint

### Why 50ms delay?

The 50ms delay allows the browser's rendering pipeline to complete:
- Parse HTML/CSS
- Build render tree
- Layout
- Paint

Without this delay, the window might show before the first paint, still causing a flash.

### RequestIdleCallback vs setTimeout

`requestIdleCallback` is preferred for non-critical work because:
- Executes during idle time (when event loop is not busy)
- Doesn't delay critical rendering
- Has timeout option to ensure work completes eventually

`setTimeout(0)` runs on next tick but can still block rendering if the event loop is busy.

## Monitoring

Enable additional debugging:
```bash
# Renderer debugging
LJ_DEBUG_RENDERER=1 npm start

# Check logs in:
# - Console (renderer performance)
# - Main process log output (main performance)
```

## References

- [Electron BrowserWindow ready-to-show](https://www.electronjs.org/docs/latest/api/browser-window#event-ready-to-show)
- [requestIdleCallback API](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- [Web Performance Optimization](https://web.dev/performance/)
