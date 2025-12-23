// @ts-check
const { notarize } = require("@electron/notarize");
const path = require("path");

/**
 * afterSign hook for macOS Notarization
 * This script runs automatically after electron-builder signs the app.
 *
 * Required environment variables:
 * - APPLE_ID: Your Apple ID email
 * - APPLE_APP_SPECIFIC_PASSWORD: App-specific password from appleid.apple.com
 * - APPLE_TEAM_ID: Your 10-character Team ID
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== "darwin") {
    console.log("[notarize] Skipping: not macOS");
    return;
  }

  // Check if running in CI or if credentials are available
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword) {
    console.log(
      "[notarize] Skipping: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set"
    );
    console.log("[notarize] Set these environment variables to enable notarization:");
    console.log("  - APPLE_ID: Your Apple ID email");
    console.log("  - APPLE_APP_SPECIFIC_PASSWORD: App-specific password");
    console.log("  - APPLE_TEAM_ID: Your 10-character Team ID");
    return;
  }

  if (!teamId) {
    console.log("[notarize] Skipping: APPLE_TEAM_ID not set");
    console.log("[notarize] Team ID is required for notarization");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Starting notarization for: ${appPath}`);
  console.log(`[notarize] Apple ID: ${appleId.substring(0, 3)}***`);
  console.log(`[notarize] Team ID: ${teamId || "not set"}`);

  const startTime = Date.now();

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`[notarize] ✅ Notarization complete! (${duration}s)`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[notarize] ❌ Notarization failed:", error.message);

    // In CI, fail the build if notarization fails
    if (process.env.CI) {
      throw error;
    }

    // Locally, just warn but continue
    console.log("[notarize] Continuing without notarization (local build)");
  }
};

