import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { CheckpointStore } from "../src/main/CheckpointStore.js";

async function testCheckpointBasics() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-"));
  const store = new CheckpointStore(dir);
  const key = { file: path.join(dir, "log.txt"), fileKey: "inode-1" };
  const v1 = {
    offset: 100,
    mtimeMs: 1000,
    size: 100,
    updatedAt: Date.now(),
  } as any;
  store.set(key, v1);
  const got = store.get(key)!;
  if (got.offset !== 100 || got.mtimeMs !== 1000)
    throw new Error("checkpoint get/set failed");

  // Rotation: size kleiner als offset -> reset nötig
  const reset = store.shouldReset(key, { size: 50, mtimeMs: 2000 });
  if (!reset) throw new Error("shouldReset not detected");

  // Normaler Fortschritt: größerer offset erlaubt
  const noreset = store.shouldReset(key, { size: 200, mtimeMs: 3000 });
  if (noreset) throw new Error("shouldReset false-positive");
}

async function run() {
  await testCheckpointBasics();
  console.log("[tests] CheckpointStore ok");
}

run().catch((e) => {
  console.error("[tests] CheckpointStore FAILED", e);
  process.exit(1);
});
