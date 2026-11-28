import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  previousStable,
  releaseAssets,
  stageAssets,
  verifyInstaller,
  verifyInventory,
} from "../../../scripts/release-assets.mjs";

const tag = "v2.0.10-rc.1";
const { win, mac, installer, setup } = releaseAssets(tag);
const bytes = Buffer.from("candidate setup");
const sha512 = createHash("sha512").update(bytes).digest("base64");
const manifest = {
  version: tag.slice(1),
  files: [{ url: setup, sha512, size: bytes.length }],
  path: setup,
  sha512,
};
const blockmap = {
  version: "2",
  files: [{ name: "file", offset: 0, sizes: [bytes.length], checksums: ["c"] }],
};

describe("release artifact gate", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lumberjack-assets-"));
    await Promise.all(
      [...win, ...mac].map((name) => writeFile(path.join(dir, name), bytes)),
    );
    await writeFile(path.join(dir, "latest.yml"), JSON.stringify(manifest));
    await writeFile(
      path.join(dir, `${setup}.blockmap`),
      gzipSync(JSON.stringify(blockmap)),
    );
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("only stages versioned deliveries and the two GitHub channel manifests", async () => {
    for (const extra of [
      "builder-debug.yml",
      "Lumberjack-1.0.0-x64-setup.exe",
    ]) {
      await writeFile(path.join(dir, extra), "not for release");
    }
    await stageAssets(dir, tag, "win");
    await stageAssets(dir, tag, "mac");
    expect((await readdir(path.join(dir, "publish-win"))).sort()).toEqual(
      [...win].sort(),
    );
    expect((await readdir(path.join(dir, "publish-mac"))).sort()).toEqual(
      [...mac].sort(),
    );
    expect(await readdir(dir)).toContain("builder-debug.yml");
  });

  it.each([...win, ...mac])(
    "rejects a missing %s before upload",
    async (name) => {
      await rm(path.join(dir, name));
      await expect(
        stageAssets(dir, tag, win.includes(name) ? "win" : "mac"),
      ).rejects.toThrow(name);
    },
  );

  it.each([
    { version: "2.0.10" },
    { path: "unrelated.exe" },
    { files: [{ ...manifest.files[0], url: "unrelated.exe" }] },
    { files: [{ ...manifest.files[0], size: 1 }] },
    { files: [{ ...manifest.files[0], sha512: "wrong" }] },
    { sha512: "wrong" },
  ])("rejects mismatched updater metadata: %j", async (patch) => {
    await writeFile(
      path.join(dir, "latest.yml"),
      JSON.stringify({ ...manifest, ...patch }),
    );
    await expect(verifyInstaller(dir, tag)).rejects.toThrow(/latest.yml/);
  });

  it("hashes the EXE itself and rejects a different EXE of the same size", async () => {
    await writeFile(path.join(dir, setup), Buffer.alloc(bytes.length));
    await expect(verifyInstaller(dir, tag)).rejects.toThrow("SHA-512 mismatch");
  });

  it("rejects a truncated or stale blockmap", async () => {
    const file = path.join(dir, `${setup}.blockmap`);
    await writeFile(file, "");
    await expect(verifyInstaller(dir, tag)).rejects.toThrow("Empty");
    await writeFile(
      file,
      gzipSync(
        JSON.stringify({
          ...blockmap,
          files: [{ ...blockmap.files[0], sizes: [bytes.length - 1] }],
        }),
      ),
    );
    await expect(verifyInstaller(dir, tag)).rejects.toThrow("Blockmap");
  });

  it("rejects missing, extra and unfinished assets on the release itself", () => {
    const assets = [...win, ...mac].map((name) => ({
      name,
      state: "uploaded",
      size: 1,
    }));
    expect(() => verifyInventory(tag, assets)).not.toThrow();
    expect(() =>
      verifyInventory(
        tag,
        assets.filter((a) => a.name !== setup),
      ),
    ).toThrow(setup);
    expect(() =>
      verifyInventory(tag, [...assets, { name: "builder-debug.yml" }]),
    ).toThrow("Unexpected");
    expect(() =>
      verifyInventory(
        tag,
        assets.map((a) => ({ ...a, state: "starter" })),
      ),
    ).toThrow("Incomplete");
  });

  it("selects the highest older stable, even when re-running an older RC", () => {
    expect(
      previousStable(tag, [
        "v2.0.2",
        "v2.0.10",
        "v2.0.11",
        "v2.0.12-beta.1",
        "v2.0.9",
      ]),
    ).toBe("v2.0.9");
    expect(() => previousStable(tag, ["v2.0.10", "v2.0.9-beta.1"])).toThrow(
      "No older",
    );
    expect(() => releaseAssets("../v2.0.10")).toThrow("Unsupported");
    expect(installer).toContain("latest.yml");
  });

  it.skipIf(process.platform !== "win32")(
    "creates a runnable-layout ZIP without mutating the NSIS payload",
    async () => {
      const root = path.join(dir, "win-unpacked");
      await mkdir(path.join(root, "resources"), { recursive: true });
      for (const name of [
        "Lumberjack.exe",
        "resources/app.asar",
        "resources/app-update.yml",
        "resources/elevate.exe",
      ]) {
        await writeFile(path.join(root, name), bytes);
      }
      const zip = path.join(dir, "standalone.zip");
      execFileSync("pwsh", [
        "-NoProfile",
        "-File",
        "scripts/create-windows-zip.ps1",
        "-UnpackedDir",
        root,
        "-ZipPath",
        zip,
      ]);
      const entries = new AdmZip(zip).getEntries();
      expect(entries.map((entry) => entry.entryName).sort()).toEqual([
        "Lumberjack.exe",
        "resources/app.asar",
      ]);
      expect(entries.every((entry) => entry.getData().equals(bytes))).toBe(
        true,
      );
      expect(
        await readFile(path.join(root, "resources/app-update.yml")),
      ).toEqual(bytes);
    },
  );
});
