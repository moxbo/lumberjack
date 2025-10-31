/*
 * Persistente Reader-Checkpoints: (fileKey/Inode, size/offset, mtimeMs)
 */
import fs from 'node:fs';
import path from 'node:path';

export interface CheckpointKey {
  file: string; // Absoluter Pfad
  fileKey?: string; // z.B. Inode/FileID als String
}

export interface CheckpointValue {
  offset: number; // gelesene Bytes
  mtimeMs: number;
  size: number;
  updatedAt: number; // epoch ms
}

export class CheckpointStore {
  private filePath: string;
  private map: Map<string, CheckpointValue> = new Map();

  constructor(dir: string, name = 'checkpoints.json') {
    this.filePath = path.join(dir, name);
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj || {})) {
        if (v && typeof v === 'object' && 'offset' in v && 'mtimeMs' in v && 'size' in v) {
          this.map.set(k, v as CheckpointValue);
        }
      }
    } catch {
      // ignore corrupt
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const obj: Record<string, CheckpointValue> = {};
      for (const [k, v] of this.map.entries()) obj[k] = v;
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  private k(key: CheckpointKey): string {
    return `${key.fileKey ?? ''}|${key.file}`;
  }

  get(key: CheckpointKey): CheckpointValue | undefined {
    return this.map.get(this.k(key));
  }

  set(key: CheckpointKey, val: CheckpointValue): void {
    this.map.set(this.k(key), { ...val, updatedAt: Date.now() });
    this.save();
  }

  // Rotation/Truncation erkennen: wenn size < offset oder mtimeMs < gespeichert → neu anfangen
  shouldReset(key: CheckpointKey, stat: { size: number; mtimeMs: number }): boolean {
    const cur = this.get(key);
    if (!cur) return false;
    if (stat.size < cur.offset) return true;
    if (stat.mtimeMs < cur.mtimeMs) return true;
    return false;
  }
}
