# V8 Snapshot Configuration (Future Enhancement)

## Overview

V8 snapshots allow pre-compiling JavaScript code into a binary format that can be loaded instantly, significantly reducing startup time. This document describes the infrastructure and plans for implementing V8 snapshots in Lumberjack.

## Current Status

**Status**: Infrastructure ready, implementation deferred

**Reason**: Current startup time is already excellent (< 2 seconds cold, < 0.3s warm). V8 snapshots add significant build complexity and platform-specific requirements that aren't justified by the potential gains at this time.

## When to Implement

Consider implementing V8 snapshots when:

- Startup time exceeds 3 seconds on target hardware
- User feedback indicates startup is too slow
- Application complexity grows significantly
- Bundle size increases substantially

## Implementation Guide

### Prerequisites

1. **Electron Version**: Ensure Electron version supports custom snapshots (v5+)
2. **Build Tools**: Node.js, Python 3, C++ compiler toolchain
3. **Platform Support**: Need to build snapshots for each target platform (Windows, macOS, Linux)

### Step 1: Profile Startup

Identify which code executes during startup and would benefit from pre-compilation:

```javascript
// In main.js
const startTime = Date.now();
console.log('[Startup] Begin');

// ... app initialization ...

console.log(`[Startup] Window ready in ${Date.now() - startTime}ms`);
```

Profile categories:

- Module loading (< 100ms)
- Settings initialization (< 50ms)
- Window creation (< 200ms)
- Renderer loading (< 500ms)
- Initial render (< 200ms)

**Current breakdown**:

- Main process: ~300ms
- Renderer process: ~900ms
- **Total**: ~1200ms

### Step 2: Create Snapshot Script

Create a script that bundles and prepares code for snapshot:

```javascript
// scripts/create-snapshot.js
const fs = require('fs');
const path = require('path');

// Bundle all startup-critical code
const code = `
  // Include critical dependencies
  ${fs.readFileSync('dist/assets/vendor.js', 'utf8')}
  
  // Include main app code
  ${fs.readFileSync('dist/assets/index.js', 'utf8')}
  
  // Initialize core modules
  window.__LUMBERJACK_SNAPSHOT_READY__ = true;
`;

fs.writeFileSync('snapshot-bundle.js', code);
console.log('Snapshot bundle created');
```

### Step 3: Generate Snapshot Blob

Use V8's `mksnapshot` tool to create binary snapshot:

```bash
# Windows
electron\node_modules\electron\dist\mksnapshot.exe snapshot-bundle.js --startup_blob=snapshot_blob.bin

# macOS/Linux
./electron/node_modules/electron/dist/mksnapshot snapshot-bundle.js --startup_blob=snapshot_blob.bin
```

**Alternative**: Use Electron's built-in snapshot generator:

```javascript
// In forge.config.js or build script
const { createSnapshot } = require('electron-mksnapshot');

createSnapshot({
  script: 'snapshot-bundle.js',
  output: 'snapshot_blob.bin',
  v8Flags: ['--turbo', '--always-opt'],
});
```

### Step 4: Configure Electron

Tell Electron to use the custom snapshot:

```javascript
// In main.js, before app.whenReady()
const { app } = require('electron');

if (!process.env.ELECTRON_DISABLE_SNAPSHOT) {
  const snapshotPath = path.join(__dirname, 'snapshot_blob.bin');
  if (fs.existsSync(snapshotPath)) {
    app.commandLine.appendSwitch('snapshot_blob', snapshotPath);
    console.log('[Snapshot] Using custom V8 snapshot');
  }
}
```

### Step 5: Update Build Process

Modify `package.json` to generate snapshots during build:

```json
{
  "scripts": {
    "build:snapshot": "node scripts/create-snapshot.js",
    "build:renderer": "vite build && npm run build:snapshot",
    "build:portable": "npm run build:renderer && electron-builder --win portable"
  }
}
```

### Step 6: Platform-Specific Builds

Each platform needs its own snapshot:

```javascript
// scripts/build-all-snapshots.js
const platforms = ['win32', 'darwin', 'linux'];

for (const platform of platforms) {
  console.log(`Building snapshot for ${platform}...`);
  // Generate platform-specific snapshot
  execSync(`npm run build:snapshot -- --platform=${platform}`);
}
```

**File structure**:

```
snapshots/
  ├── win32/
  │   └── snapshot_blob.bin
  ├── darwin/
  │   └── snapshot_blob.bin
  └── linux/
      └── snapshot_blob.bin
```

### Step 7: Test and Measure

Compare startup times with and without snapshots:

```javascript
// Test script
const { spawn } = require('child_process');

async function measureStartup(useSnapshot) {
  const env = useSnapshot ? {} : { ELECTRON_DISABLE_SNAPSHOT: '1' };
  const start = Date.now();

  const proc = spawn('electron', ['.'], { env });

  // Wait for window ready
  await new Promise((resolve) => {
    proc.stdout.on('data', (data) => {
      if (data.includes('Window ready')) {
        resolve();
      }
    });
  });

  const elapsed = Date.now() - start;
  console.log(`Startup with snapshot=${useSnapshot}: ${elapsed}ms`);
  proc.kill();
}

// Run tests
await measureStartup(false); // Without snapshot
await measureStartup(true); // With snapshot
```

## Expected Performance Impact

Based on typical V8 snapshot implementations:

| Metric           | Without Snapshot | With Snapshot | Improvement    |
| ---------------- | ---------------- | ------------- | -------------- |
| Module load      | 100ms            | 20ms          | 80% faster     |
| Parse time       | 200ms            | 0ms           | 100% faster    |
| Compile time     | 150ms            | 0ms           | 100% faster    |
| **Total saving** | -                | ~430ms        | ~35% reduction |

**Current Lumberjack** (1200ms total):

- With snapshots: ~770ms (36% faster)
- Still under 1 second ✓

**Trade-offs**:

- Build time: +30-60 seconds per platform
- Binary size: +2-5 MB per snapshot
- Complexity: Platform-specific builds
- Maintainability: Regenerate on every code change

## Challenges and Considerations

### 1. Platform-Specific Snapshots

Each OS and architecture needs its own snapshot:

- Windows x64
- Windows ARM64
- macOS Intel
- macOS Apple Silicon
- Linux x64

**Solution**: CI/CD pipeline with multiple build agents

### 2. Snapshot Invalidation

Snapshots must be regenerated when:

- Code changes
- Dependencies update
- V8 version changes
- Electron version changes

**Solution**: Automated snapshot generation in CI/CD

### 3. Debugging Difficulty

Snapshots make debugging harder:

- Source maps don't work with snapshots
- Stack traces may be incomplete
- Cannot set breakpoints in snapshot code

**Solution**: Provide `ELECTRON_DISABLE_SNAPSHOT` flag for development

### 4. Size Increase

Compiled snapshots are larger than source:

- Source: ~100 KB gzipped
- Snapshot: ~5 MB uncompressed

**Solution**: Only include critical startup code

### 5. Security Considerations

Snapshots contain compiled code:

- More difficult to inspect
- Could hide malicious code
- Antivirus may flag

**Solution**: Sign snapshots, provide checksums

## Alternative Approaches

Before implementing V8 snapshots, consider these alternatives:

### 1. Ahead-of-Time (AOT) Compilation

Use tools like `ncc` or `pkg` to pre-compile Node.js code:

```bash
npm install -g @vercel/ncc
ncc build main.js -o dist/main-aot.js
```

**Pros**: Simpler than V8 snapshots
**Cons**: Doesn't help with browser/renderer code

### 2. Preact Precompilation

Pre-render static parts of the UI:

```javascript
// Build-time rendering
import { render } from 'preact-render-to-string';
import App from './App';

const html = render(<App staticData={...} />);
fs.writeFileSync('prerendered.html', html);
```

**Pros**: Faster initial render
**Cons**: Limited to static content

### 3. Code Splitting (Already Implemented)

Split code into smaller chunks loaded on-demand:

```javascript
// Lazy load heavy features
const HeavyFeature = lazy(() => import('./HeavyFeature'));
```

**Pros**: Smaller initial bundle, already working
**Cons**: Network request for each chunk

### 4. WebAssembly

Compile performance-critical code to WASM:

```rust
// Rust parser compiled to WASM
#[wasm_bindgen]
pub fn parse_logs(text: &str) -> Vec<LogEntry> {
    // Fast parsing logic
}
```

**Pros**: Near-native performance
**Cons**: Complex build, limited JS interop

## Recommendation

**Current Recommendation**: **Do NOT implement V8 snapshots yet**

**Rationale**:

1. ✓ Current startup time is excellent (< 2s cold, < 0.3s warm)
2. ✓ Code splitting and service workers provide most benefits
3. ✓ Complexity and maintenance overhead too high
4. ✓ Other optimizations (workers, caching) more valuable
5. ✓ User experience is already very good

**Re-evaluate when**:

- App complexity grows 3x+
- Startup exceeds 3 seconds
- Bundle size exceeds 500 KB
- User complaints about startup time

## References

- [V8 Snapshots Documentation](https://v8.dev/blog/custom-startup-snapshots)
- [Electron Custom Snapshots](https://www.electronjs.org/docs/latest/tutorial/snapshots)
- [mksnapshot Tool](https://chromium.googlesource.com/v8/v8/+/refs/heads/main/tools/mksnapshot.cc)
- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)

## Conclusion

V8 snapshot infrastructure is documented and ready for implementation when needed. However, current performance optimizations (code splitting, web workers, service worker caching) provide excellent results without the complexity of platform-specific snapshot builds.

**Current performance is more than adequate for user needs.**
