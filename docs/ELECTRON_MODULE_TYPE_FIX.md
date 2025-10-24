# Electron ES Module Type Fix

## Problem

When `package.json` contains `"type": "module"`, Node.js and Electron interpret all `.js` files as ES modules by default. This caused an error when Electron tried to load the main process bundle:

```
This file is being treated as an ES module because it has a '.js' file extension 
and '/Users/mo/develop/my-electron-app/package.json' contains "type": "module". 
To treat it as a CommonJS script, rename it to use the '.cjs' file extension.
```

## Root Cause

The build configuration was already producing CommonJS output (`--format=cjs`), but the output filename was `dist-main/main.js`. With `"type": "module"` in package.json, this `.js` extension caused Node.js to treat the file as an ES module, creating a mismatch.

## Solution

Changed the build output to use the `.cjs` extension explicitly:

1. **Updated `package.json` "main" field**: Changed from `dist-main/main.js` to `dist-main/main.cjs`
2. **Updated `build:main` script**: Changed to output `dist-main/main.cjs` and `dist-main/ipcHandlers.cjs` using `--outfile` parameter

This ensures the files are always treated as CommonJS regardless of the package.json "type" setting.

## Why Keep "type": "module"?

The project keeps `"type": "module"` in package.json to support ES modules for:
- Renderer process code (built with Vite)
- Development scripts
- Other ES module dependencies

By using `.cjs` extension for the main process bundle, we can have CommonJS for the main process while keeping ES modules elsewhere.

## Alternative Solutions (Not Used)

1. **Remove "type": "module"** - Would break ES module support for renderer/scripts
2. **Switch to full ESM** - Would require:
   - Changing build to output `.mjs` 
   - Updating all CommonJS patterns (require, module.exports) to ESM (import/export)
   - Ensuring Electron version supports ESM main process
3. **Conditional loading** - More complex and fragile

## Build Commands

- **Build main process**: `npm run build:main` - Outputs CommonJS bundles to `dist-main/*.cjs`
- **Full prebuild**: `npm run prebuild` - Builds main, preload, and additional CJS modules
- **Start app**: `npm start` - Builds and launches Electron

## References

- [Node.js ES Module documentation](https://nodejs.org/api/esm.html)
- [Electron main process](https://www.electronjs.org/docs/latest/tutorial/process-model#the-main-process)
