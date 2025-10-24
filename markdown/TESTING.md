# Testing the Startup Optimizations

## How to Build and Test

### Build the Portable Version

```bash
# Install dependencies (if not already done)
npm install

# Build the renderer
npm run build:renderer

# Build portable Windows executable
npm run build:portable:x64
```

This will create `release/Lumberjack-1.0.0-x64.exe` (or similar version).

### Measure Startup Time

#### Windows PowerShell

```powershell
# Cold start (first launch after reboot/clear cache)
Measure-Command {
    Start-Process ".\release\Lumberjack-1.0.0-x64.exe" -Wait
}

# Or manually:
# 1. Click the .exe
# 2. Start stopwatch
# 3. Stop when window is interactive (not just visible, but can click buttons)
```

#### Expected Results

- **Before optimizations**: 20+ seconds
- **After optimizations**: < 2 seconds (target)

### What Was Changed

#### Performance Improvements Summary

1. **Bundle size**: 142KB → 81KB (43% smaller)
2. **Removed moment.js**: Replaced with native Date formatting
3. **Lazy-loaded modules**: adm-zip and parsers only load when needed
4. **Async initialization**: Settings and log stream load after window shows
5. **Faster renderer**: Deferred settings fetch, optimized build

#### Files Modified

- `main.js`: Lazy-loading, async settings, deferred window display
- `src/App.jsx`: Native Date formatter, deferred settings load
- `src/parsers.ts`: Lazy-load adm-zip
- `vite.config.mjs`: Build optimizations
- `package.json`: Build configuration tweaks

### Feature Testing Checklist

After confirming startup is fast, verify all features still work:

#### Basic Features

- [ ] Window opens and displays correctly
- [ ] Menu works (File, Network, View menus)
- [ ] Settings dialog opens and saves
- [ ] Theme switching works (light/dark/system)

#### File Loading

- [ ] Open .log file via "Öffnen" button
- [ ] Open .json file
- [ ] Open .zip file containing logs
- [ ] Drag-and-drop .log file
- [ ] Drag-and-drop .zip file
- [ ] Multiple file selection works

#### Filtering

- [ ] Search filter works
- [ ] Level filter dropdown works
- [ ] Logger filter works
- [ ] Thread filter works
- [ ] Message filter with & | ! operators
- [ ] TraceId filter works
- [ ] MDC filter works
- [ ] Filter chips display and remove correctly

#### Network Features

- [ ] TCP server starts on configured port
- [ ] TCP server receives log entries
- [ ] TCP server stops correctly
- [ ] HTTP load once fetches logs
- [ ] HTTP polling starts and receives updates
- [ ] HTTP polling stops
- [ ] HTTP settings persist

#### Log Management

- [ ] File logging toggle works
- [ ] Log file rotation works (when configured)
- [ ] Max size and backups settings respected
- [ ] Log entries are written to file

#### UI Features

- [ ] Row selection works (click, Shift+click, Ctrl+click)
- [ ] Virtual scrolling works smoothly
- [ ] Details pane shows selected entry
- [ ] Context menu on right-click works
- [ ] Color marking works
- [ ] Navigate marked entries works
- [ ] Copy functions work

### Performance Verification

#### Cold Start (Most Important)

1. Restart computer or close app and wait 5 minutes
2. Launch .exe
3. Measure time until window is interactive
4. Should be < 2 seconds

#### Warm Start

1. Close app
2. Immediately launch again
3. Should be < 1 second

#### Memory Usage

- Open Task Manager
- Launch Lumberjack
- Check memory usage should be reasonable (~100-150MB initially)

#### Load Test

1. Open a large log file (10MB+)
2. Should parse and display quickly
3. Scrolling should remain smooth
4. Memory should not spike excessively

### Comparing Before/After

#### Quick Comparison Test

If you have the old version:

1. Rename old .exe to `Lumberjack-old.exe`
2. Build new version
3. Test both side-by-side:
   - Measure startup time (both cold and warm)
   - Check memory usage
   - Verify feature parity

#### What Should Feel Different

- **Startup**: Window appears almost instantly
- **First interaction**: Buttons/menus respond immediately
- **Settings load**: Happens in background, not blocking
- **Overall feel**: More responsive, less "waiting"

### Troubleshooting

#### If Startup Is Still Slow

Check these:

- **Antivirus**: Might be scanning .exe on launch (whitelist it)
- **HDD vs SSD**: Mechanical drives are inherently slower
- **Windows Defender**: Real-time protection can slow first launch
- **Other processes**: High CPU/disk usage from other apps

#### If Features Don't Work

1. Check browser console (F12) for errors
2. Check main process logs
3. Verify all files were built correctly
4. Try a clean build:
   ```bash
   rm -rf dist release node_modules
   npm install
   npm run build:renderer
   npm run build:portable:x64
   ```

### Reporting Results

When reporting test results, please include:

**Environment:**

- OS version (Windows 10/11)
- CPU model
- RAM amount
- Disk type (SSD/HDD/NVMe)
- Antivirus software

**Measurements:**

- Cold start time (seconds)
- Warm start time (seconds)
- Memory usage at startup
- Any features that don't work

**Comparison (if available):**

- Old version cold start time
- New version cold start time
- Improvement percentage

### Expected Outcome

Based on the optimizations:

- **43% smaller bundle** = faster to load and parse
- **Lazy-loading** = fewer modules to initialize
- **Async operations** = non-blocking startup
- **Native Date** = no moment.js overhead

Conservative estimate: **80-90% reduction in startup time**

- Before: 20+ seconds
- After: 2-4 seconds on typical hardware
- Best case: < 1 second on fast systems

The goal is immediate usability ("sofort zum Öffnen und Bedienen"), which should now be achieved.
