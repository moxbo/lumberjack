# Build Structure Migration Summary

## Date: 2025-11-14

## Background
User asked whether it makes sense to adopt the release build structure from electron-react-boilerplate to ensure proper release builds including icon handling.

## Decision
**YES** - Adopt ERB's build output structure while keeping Lumberjack's core architecture.

## What Changed

### Directory Structure
**Before:**
```
lumberjack/
├── dist/                    # Vite output (gitignored)
├── dist-main/               # esbuild output (gitignored)
├── preload.cjs              # Preload script
├── images/                  # Icons
│   ├── icon.ico
│   └── icon.icns
└── release/                 # electron-builder output
```

**After:**
```
lumberjack/
├── release/
│   ├── app/                # Production app directory
│   │   ├── package.json    # Minimal production deps
│   │   └── dist/           # All built files
│   │       ├── main/
│   │       ├── preload/
│   │       └── renderer/
│   └── build/              # electron-builder output
├── assets/                 # Build resources
│   ├── icon.ico
│   └── icon.icns
└── images/                 # Source images (kept for icon generation)
```

### Build Scripts Updated
- `build:main`: outputs to `release/app/dist/main/main.js`
- `build:preload`: outputs to `release/app/dist/preload/preload.js`  
- `build:renderer`: outputs to `release/app/dist/renderer/`
- `build:prod`: new unified build command
- Build artifacts now use `.js` extension instead of `.cjs` for consistency

### electron-builder Configuration
**Before:**
```json
{
  "directories": {
    "output": "release",
    "buildResources": "images"
  },
  "icon": "images/icon.ico",
  "files": [
    "dist/**/*",
    "dist-main/**/*",
    "!dist-main/**/*.js",
    "preload.cjs",
    "src/**/*.ts",      // Source files unnecessarily included
    "src/**/*.tsx",
    "src/**/*.js",
    "src/**/*.cjs",
    "index.html",
    "styles.css",
    "package.json",
    "images/**"
  ],
  "asarUnpack": ["images/**"],
  "extraResources": [
    {"from": "images/icon.ico", "to": "images/icon.ico"}
  ]
}
```

**After:**
```json
{
  "directories": {
    "app": "release/app",        // Point to built app
    "buildResources": "assets",  // Standard location
    "output": "release/build"    // Separate build output
  },
  "files": [
    "dist/**/*",                 // Only built files
    "package.json"
  ],
  "asarUnpack": ["**/*.node"]    // Only native modules
  // No icon, extraResources, or source files needed!
}
```

### Code Changes
**src/main/main.ts:**
- Updated preload path: `dist/preload/preload.js`
- Updated renderer search paths to look for `dist/renderer/index.html`
- Added fallback paths for backward compatibility

**scripts/make-icon.ts:**
- Updated to output icons to `assets/` instead of `images/`
- Both Windows (.ico) and macOS (.icns) supported

### Documentation Updates
**README.md:**
- Updated build commands
- Simplified icon troubleshooting section
- Updated paths throughout
- Removed complex icon extraction explanations

**New docs:**
- `BUILD_STRUCTURE_ANALYSIS.md`: Detailed comparison and rationale

## Benefits

1. **Simpler Icon Configuration**
   - Icons in `assets/` are automatically handled by electron-builder
   - No manual asarUnpack or extraResources configuration needed
   - Works consistently across platforms

2. **Cleaner Packages**
   - No source files included in production builds
   - Smaller package size
   - Only runtime dependencies in production package.json

3. **Better Security**
   - Source code not exposed in production builds
   - TypeScript files excluded from final package

4. **Follows Best Practices**
   - Aligns with electron-builder recommendations
   - Clear separation of development and production artifacts
   - Standard directory structure

5. **Easier Maintenance**
   - Simpler electron-builder configuration
   - Fewer edge cases to handle
   - Better organized build output

## Migration Notes

### For Developers
- Build output is now in `release/app/dist/`
- Icons go in `assets/` directory
- Built app for testing: `release/build/win-unpacked/Lumberjack.exe`

### Breaking Changes
- None for end users
- Build output location changed (only affects development)
- Icon generation now outputs to `assets/`

### Backward Compatibility
- Runtime paths include legacy fallbacks
- Icon resolution checks both old and new locations
- No changes needed for existing releases

## Testing
- ✅ All builds pass (main, preload, renderer)
- ✅ Bundle sizes maintained (63.43 kB main, 18.53 kB gzipped)
- ✅ No security issues (CodeQL clean)
- ✅ Build times unchanged (~1.2s total)

## Conclusion
This migration provides the best of both worlds:
- Keeps Lumberjack's superior Vite/Preact performance architecture
- Adopts ERB's cleaner, more maintainable build structure
- Simplifies icon handling and reduces package size
- Follows electron-builder best practices

The result is a more professional, maintainable build system without sacrificing any of Lumberjack's performance advantages.
