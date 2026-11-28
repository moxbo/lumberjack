import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import yaml from "js-yaml";

export function releaseAssets(tag) {
  if (!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag)) {
    throw new Error(`Unsupported release tag: ${tag}`);
  }
  const base = `Lumberjack-${tag.slice(1)}`;
  const setup = `${base}-x64-setup.exe`;
  const installer = [setup, `${setup}.blockmap`, "latest.yml"];
  return {
    setup,
    installer,
    win: [...installer, `${base}-x64-portable.exe`, `${base}-x64-win.zip`],
    mac: [
      `${base}-arm64.dmg`,
      `${base}-arm64.dmg.blockmap`,
      `${base}-arm64.zip`,
      `${base}-arm64.zip.blockmap`,
      "latest-mac.yml",
    ],
  };
}

async function requireFile(dir, name) {
  const entry = await stat(path.join(dir, name));
  if (!entry.isFile() || !entry.size)
    throw new Error(`Empty or invalid: ${name}`);
  return entry.size;
}

export async function verifyInstaller(dir, tag) {
  const { setup, installer } = releaseAssets(tag);
  const [size] = await Promise.all(
    installer.map((name) => requireFile(dir, name)),
  );
  const info = yaml.load(await readFile(path.join(dir, "latest.yml"), "utf8"), {
    schema: yaml.JSON_SCHEMA,
  });
  const file = info?.files?.[0];
  if (
    info?.version !== tag.slice(1) ||
    info.path !== setup ||
    !Array.isArray(info.files) ||
    info.files.length !== 1 ||
    file?.url !== setup ||
    file.size !== size
  ) {
    throw new Error(`latest.yml does not describe ${setup} (${size} bytes)`);
  }
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path.join(dir, setup)))
    hash.update(chunk);
  const digest = hash.digest("base64");
  if (file.sha512 !== digest || info.sha512 !== digest) {
    throw new Error(`SHA-512 mismatch between latest.yml and ${setup}`);
  }
  const map = JSON.parse(
    gunzipSync(await readFile(path.join(dir, `${setup}.blockmap`))),
  );
  const entry = map.files?.[0];
  if (
    map.version !== "2" ||
    map.files?.length !== 1 ||
    entry?.name !== "file" ||
    entry.offset !== 0 ||
    !Array.isArray(entry.sizes) ||
    !Array.isArray(entry.checksums) ||
    entry.sizes.length !== entry.checksums.length ||
    !entry.sizes.every((n) => Number.isSafeInteger(n) && n > 0) ||
    entry.sizes.reduce((sum, n) => sum + n, 0) !== size
  ) {
    throw new Error(`Blockmap does not cover ${setup}`);
  }
}

export async function stageAssets(dir, tag, platform) {
  if (platform !== "win" && platform !== "mac")
    throw new Error(`Unknown platform: ${platform}`);
  const names = releaseAssets(tag)[platform];
  await Promise.all(names.map((name) => requireFile(dir, name)));
  if (platform === "win") await verifyInstaller(dir, tag);
  // Never reuse a staging directory: its entire contents will be uploaded.
  const dest = path.join(dir, `publish-${platform}`);
  await mkdir(dest);
  for (const name of names)
    await rename(path.join(dir, name), path.join(dest, name));
}

export function verifyInventory(tag, assets) {
  const { win, mac } = releaseAssets(tag);
  const expected = new Set([...win, ...mac]);
  for (const asset of assets) {
    if (!expected.delete(asset.name))
      throw new Error(`Unexpected release asset: ${asset.name}`);
    if (asset.state !== "uploaded" || !(asset.size > 0))
      throw new Error(`Incomplete release asset: ${asset.name}`);
  }
  if (expected.size)
    throw new Error(`Missing release assets: ${[...expected].join(", ")}`);
}

export function previousStable(tag, tags) {
  releaseAssets(tag);
  // Only compare numeric X.Y.Z triples. A stable of the same core version
  // is never a predecessor (including for a beta/RC).
  const core = tag.split("-")[0];
  const compare = new Intl.Collator("en", { numeric: true }).compare;
  const previous = tags
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && compare(t, core) < 0)
    .sort(compare)
    .at(-1);
  if (!previous)
    throw new Error(`No older published stable installer for ${tag}`);
  return previous;
}

function gh(...args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function fetchInstallers(tag, dir) {
  if (!process.env.RELEASE_ASSET_QUERY || !process.env.GITHUB_OUTPUT) {
    throw new Error(
      "fetch-installers requires the release workflow's asset query and output file",
    );
  }
  const snapshot = gh(
    "release",
    "view",
    tag,
    "--json",
    "id,assets",
    "--jq",
    process.env.RELEASE_ASSET_QUERY,
  ).trim();
  verifyInventory(tag, JSON.parse(snapshot).assets);
  const fingerprint = createHash("sha256").update(snapshot).digest("hex");
  const tags = gh(
    "api",
    "--paginate",
    "repos/{owner}/{repo}/releases?per_page=100",
    "--jq",
    ".[] | select(.draft == false and .prerelease == false) | .tag_name",
  );
  const previous = previousStable(tag, tags.trim().split(/\s+/));
  for (const versionTag of [previous, tag]) {
    const target = path.join(dir, versionTag);
    await mkdir(target, { recursive: true });
    const patterns = releaseAssets(versionTag).installer.flatMap((name) => [
      "--pattern",
      name,
    ]);
    gh("release", "download", versionTag, "--dir", target, ...patterns);
    await verifyInstaller(target, versionTag);
  }
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `previous=${previous}\nasset_fingerprint=${fingerprint}\n`,
  );
  console.log(`Verified installers for ${previous} -> ${tag}`);
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const [command, dir, tag, platform] = process.argv.slice(2);
  if (command === "stage") await stageAssets(dir, tag, platform);
  else if (command === "fetch-installers") await fetchInstallers(tag, dir);
  else
    throw new Error(
      "Expected stage <dir> <tag> <platform> or fetch-installers <dir> <tag>",
    );
}
