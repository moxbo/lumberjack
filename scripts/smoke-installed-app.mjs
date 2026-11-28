import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { _electron } from "@playwright/test";

const [executablePath, profile, tag, mode] = process.argv.slice(2);
const heapSizeMB = 2816; // Deliberately different from the default.
assert.ok(mode === "write" || mode === "read");
const app = await _electron.launch({
  executablePath,
  cwd: path.dirname(executablePath),
  args: ["--disable-gpu"],
  timeout: 60_000,
  env: {
    ...process.env,
    NODE_ENV: "production",
    LUMBERJACK_E2E_TEST: "1", // suppress the interactive quit dialog
    LUMBERJACK_E2E_USER_DATA: "",
    PORTABLE_EXECUTABLE_DIR: "",
  },
});
try {
  const info = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    userData: app.getPath("userData"),
  }));
  assert.ok(info.packaged);
  assert.equal(info.version, tag.slice(1));
  assert.equal(path.relative(profile, info.userData), "");
  const page = await app.firstWindow({ timeout: 60_000 });
  await page
    .locator("#app > *")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  const result =
    mode === "write"
      ? await page.evaluate(
          (value) => window.api.settingsSet({ heapSizeMB: value }),
          heapSizeMB,
        )
      : await page.evaluate(() => window.api.settingsGet());
  assert.ok(result.ok, result.error);
  assert.equal(result.settings?.heapSizeMB, heapSizeMB);
  const disk = JSON.parse(
    await readFile(path.join(profile, "settings.json"), "utf8"),
  );
  assert.equal(disk.heapSizeMB, heapSizeMB);
} finally {
  await app.close();
}
