#!/usr/bin/env node
/**
 * afterPack hook for electron-builder
 * Sets Windows executable metadata (FileDescription, ProductName) so that
 * the app shows as "Lumberjack" in Task Manager instead of "Electron"
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const productName = context.packager.appInfo.productName || 'Lumberjack';

  console.log(`[afterPack] Setting Windows metadata for: ${exePath}`);
  console.log(`[afterPack] ProductName: ${productName}`);

  try {
    // Find rcedit binary - it's bundled with @electron/packager or electron-builder
    const rceditPaths = [
      path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
      path.join(__dirname, '..', 'node_modules', '@electron', 'rcedit', 'bin', 'rcedit-x64.exe'),
      path.join(__dirname, '..', 'node_modules', 'app-builder-bin', 'win', 'x64', 'rcedit.exe'),
    ];

    let rceditBin = null;
    for (const p of rceditPaths) {
      if (fs.existsSync(p)) {
        rceditBin = p;
        break;
      }
    }

    if (!rceditBin) {
      // Try to use rcedit from npm
      try {
        const rcedit = require('rcedit');
        await rcedit(exePath, {
          'version-string': {
            FileDescription: productName,
            ProductName: productName,
            InternalName: productName,
            OriginalFilename: `${productName}.exe`
          }
        });
        console.log(`[afterPack] Windows metadata updated successfully via rcedit module`);
        return;
      } catch (e) {
        console.warn('[afterPack] rcedit module failed:', e.message);
      }
    }

    if (rceditBin) {
      console.log(`[afterPack] Using rcedit binary: ${rceditBin}`);
      const commands = [
        `"${rceditBin}" "${exePath}" --set-version-string "FileDescription" "${productName}"`,
        `"${rceditBin}" "${exePath}" --set-version-string "ProductName" "${productName}"`,
        `"${rceditBin}" "${exePath}" --set-version-string "InternalName" "${productName}"`,
        `"${rceditBin}" "${exePath}" --set-version-string "OriginalFilename" "${productName}.exe"`,
      ];

      for (const cmd of commands) {
        try {
          execSync(cmd, { stdio: 'pipe' });
        } catch (e) {
          console.warn(`[afterPack] Command failed: ${cmd}`, e.message);
        }
      }
      console.log(`[afterPack] Windows metadata updated successfully`);
    } else {
      console.warn('[afterPack] rcedit binary not found');
    }
  } catch (error) {
    console.error('[afterPack] Failed to update Windows metadata:', error.message);
    // Don't fail the build, just warn
  }
};

