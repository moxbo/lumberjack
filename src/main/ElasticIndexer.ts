/*
 * Idempotentes Elasticsearch-Indexing mit deterministischem _id, 409/Retry-Handling und Bulk-Support.
 */
import crypto from 'node:crypto';

export type AuthConfig =
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey' | 'bearer'; token: string };

export interface FingerprintOptions {
  fields: string[]; // Felder in Reihenfolge
  normalizers?: Partial<Record<string, (v: unknown) => string>>; // optionale Feld-Normalisierer
  hash?: 'sha1' | 'sha256';
}

export interface IndexerOptions {
  baseUrl: string; // z.B. https://es:9200
  index: string; // Zielindex
  pipeline?: string; // optionale Ingest-Pipeline
  auth?: AuthConfig;
  timeoutMs?: number;
  bulkSize?: number; // Anzahl Dokumente pro Bulk-Request
  maxRetries?: number; // Retry-Zyklen für 429/5xx
  backoffBaseMs?: number; // Startwert für Exponential Backoff
  fingerprint?: FingerprintOptions; // Konfiguration Fingerprint
  useCreate?: boolean; // op_type=create verwenden
  transport?: (req: RequestInfo, init?: RequestInit) => Promise<Response>; // DI für Tests
}

export interface IndexMetrics {
  created: number;
  duplicates409: number;
  failed: number;
  retries: number;
  lastError?: string;
}

export interface IndexResult {
  ok: boolean;
  status?: number;
  duplicate?: boolean; // 409-Konflikt
  error?: string;
}

function toIsoMs(ts: unknown): string {
  if (ts == null) return '';
  const d = new Date(ts as any);
  if (isNaN(d.getTime())) return String(ts ?? '');
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-` +
    `${pad(d.getUTCMonth() + 1, 2)}-` +
    `${pad(d.getUTCDate(), 2)}T` +
    `${pad(d.getUTCHours(), 2)}:` +
    `${pad(d.getUTCMinutes(), 2)}:` +
    `${pad(d.getUTCSeconds(), 2)}.` +
    `${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

export function defaultFingerprint(
  event: Record<string, unknown>,
  fp?: FingerprintOptions
): string {
  const cfg: FingerprintOptions = fp ?? {
    fields: ['@timestamp', 'logger', 'thread', 'message', 'traceId'],
    hash: 'sha1',
  };
  const normalizers: Partial<Record<string, (v: unknown) => string>> = {
    '@timestamp': toIsoMs,
    message: (v) => String(v ?? ''),
    logger: (v) => String(v ?? ''),
    thread: (v) => String(v ?? ''),
    traceId: (v) => String(v ?? ''),
    ...(cfg.normalizers || {}),
  };
  const parts: string[] = [];
  for (const f of cfg.fields) {
    const raw = (event as any)[f];
    const norm = normalizers[f] ? normalizers[f]!(raw) : String(raw ?? '');
    parts.push(`${f}=${norm}`);
  }
  const data = parts.join('|');
  const algo = cfg.hash || 'sha1';
  const h = crypto.createHash(algo).update(data).digest('hex');
  return h; // hex lower-case
}

export class ElasticIndexer {
  private opts: IndexerOptions;
  private metrics: IndexMetrics = { created: 0, duplicates409: 0, failed: 0, retries: 0 };

  constructor(opts: IndexerOptions) {
    this.opts = {
      bulkSize: 500,
      maxRetries: 3,
      backoffBaseMs: 200,
      timeoutMs: 10000,
      useCreate: true,
      ...opts,
    };
  }

  getMetrics(): IndexMetrics {
    return { ...this.metrics };
  }

  computeId(event: Record<string, unknown>): string {
    return defaultFingerprint(event, this.opts.fingerprint);
  }

  private async doFetch(path: string, init: RequestInit & { method: string }): Promise<Response> {
    const base = this.opts.baseUrl.replace(/\/$/, '');
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(init.headers as any),
    };
    // Auth
    const auth = this.opts.auth;
    if (auth) {
      if (auth.type === 'basic') {
        const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        headers['authorization'] = `Basic ${token}`;
      } else if (auth.type === 'apiKey') {
        headers['authorization'] = `ApiKey ${auth.token}`;
      } else if (auth.type === 'bearer') {
        headers['authorization'] = `Bearer ${auth.token}`;
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const transport = this.opts.transport ?? (globalThis as any).fetch;
    if (!transport) throw new Error('No fetch available. Provide options.transport');
    try {
      return await transport(url, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async indexOne(event: Record<string, unknown>): Promise<IndexResult> {
    const id = this.computeId(event);
    const qp = new URLSearchParams();
    if (this.opts.pipeline) qp.set('pipeline', this.opts.pipeline);
    if (this.opts.useCreate) qp.set('op_type', 'create');
    const res = await this.doFetch(
      `/${encodeURIComponent(this.opts.index)}/_doc/${encodeURIComponent(id)}?${qp.toString()}`,
      { method: 'PUT', body: JSON.stringify(event) } as any
    );
    if (res.status === 201 || res.status === 200) {
      this.metrics.created++;
      return { ok: true, status: res.status };
    }
    if (res.status === 409) {
      this.metrics.duplicates409++;
      return { ok: true, status: res.status, duplicate: true };
    }
    const text = await safeText(res);
    this.metrics.failed++;
    this.metrics.lastError = `indexOne ${res.status}: ${text}`;
    return { ok: false, status: res.status, error: text };
  }

  async indexBulk(events: Record<string, unknown>[]): Promise<IndexResult> {
    if (!events.length) return { ok: true };
    const batches = chunk(events, this.opts.bulkSize!);
    for (const batch of batches) {
      let retryItems = batch.map((e) => ({ e, id: this.computeId(e) }));
      for (let attempt = 0; attempt <= (this.opts.maxRetries ?? 0); attempt++) {
        const ndjson = retryItems
          .map(({ e, id }) => actionAndSource(this.opts.index, id, this.opts.pipeline, e))
          .join('');
        const res = await this.doFetch('/_bulk', {
          method: 'POST',
          headers: { 'content-type': 'application/x-ndjson' },
          body: ndjson,
        } as any);
        if (res.status >= 200 && res.status < 300) {
          const body = await res.json().catch(() => null as any);
          const items: any[] = Array.isArray(body?.items) ? body.items : [];
          let nextRetry: Array<{ e: Record<string, unknown>; id: string }> = [];
          for (let i = 0; i < (items.length || 0); i++) {
            const it = items[i];
            const r = it?.create || it?.index || it?.update || it?.delete;
            const status = r?.status;
            if (status === 201 || status === 200) {
              this.metrics.created++;
            } else if (status === 409) {
              this.metrics.duplicates409++;
            } else if (status === 429 || (status >= 500 && status < 600)) {
              // retryable
              nextRetry.push(retryItems[i]!);
            } else {
              this.metrics.failed++;
              this.metrics.lastError = JSON.stringify(r);
            }
          }
          if (nextRetry.length === 0) break; // batch done
          if (attempt === (this.opts.maxRetries ?? 0)) break; // out of retries
          await backoff(this.opts.backoffBaseMs!, attempt);
          this.metrics.retries++;
          retryItems = nextRetry;
          continue;
        } else if (res.status === 409) {
          // Entire bulk should not return 409; treat as duplicates
          this.metrics.duplicates409 += retryItems.length;
          break;
        } else if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          if (attempt === (this.opts.maxRetries ?? 0)) {
            this.metrics.failed += retryItems.length;
            const text = await safeText(res);
            this.metrics.lastError = `bulk ${res.status}: ${text}`;
            break;
          }
          await backoff(this.opts.backoffBaseMs!, attempt);
          this.metrics.retries++;
          continue;
        } else {
          const text = await safeText(res);
          this.metrics.failed += retryItems.length;
          this.metrics.lastError = `bulk ${res.status}: ${text}`;
          break;
        }
      }
    }
    return { ok: this.metrics.failed === 0 };
  }
}

function actionAndSource(
  index: string,
  id: string,
  pipeline: string | undefined,
  src: Record<string, unknown>
): string {
  const meta: any = { _index: index, _id: id };
  if (pipeline) meta.pipeline = pipeline;
  const action = { create: meta };
  return JSON.stringify(action) + '\n' + JSON.stringify(src) + '\n';
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function backoff(baseMs: number, attempt: number): Promise<void> {
  const ms = Math.round(baseMs * Math.pow(2, attempt));
  await new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 5000);
  } catch {
    return '';
  }
}
