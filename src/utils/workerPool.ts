/**
 * Worker Pool Manager for Parser Workers
 * Manages a pool of web workers for parallel parsing
 */
import logger from './logger';

type PoolTask = {
  id: number;
  type: string;
  data: unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type PWorker = Worker & { busy: boolean };

class WorkerPool {
  private workerPath: string;
  private poolSize: number;
  private workers: PWorker[];
  private taskQueue: PoolTask[];
  private nextTaskId: number;
  private pendingTasks: Map<number, PoolTask>;
  private unavailable: boolean;

  constructor(workerPath: string, poolSize = 2) {
    this.workerPath = workerPath;
    this.poolSize = poolSize;
    this.workers = [];
    this.taskQueue = [];
    this.nextTaskId = 1;
    this.pendingTasks = new Map();
    this.unavailable = false;

    // Initialize worker pool
    this.initializePool();
  }

  private initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      try {
        // Use provided path relative to this module so bundlers (Vite) can locate the worker at build time
        const worker = new Worker(new URL(this.workerPath, import.meta.url), {
          type: 'module',
        }) as PWorker;
        worker.onmessage = (e: MessageEvent) => this.handleWorkerMessage(e);
        worker.onerror = (err: any) => this.handleWorkerError(err);
        worker.busy = false;
        this.workers.push(worker);
      } catch (err) {
        logger.warn('[WorkerPool] Failed to create worker:', err);
      }
    }

    // Fallback: if no workers available, mark pool as unavailable
    if (this.workers.length === 0) {
      logger.warn('[WorkerPool] No workers available, falling back to main thread');
      this.unavailable = true;
    }
  }

  private handleWorkerMessage(e: MessageEvent): void {
    const messageData = e.data as { id?: number; result?: unknown; error?: string };
    const { id, result, error } = messageData || {};

    // Find the worker that sent this message
    const worker = e.target as PWorker | null;
    if (worker) worker.busy = false;

    // Resolve or reject the pending task
    if (id !== undefined) {
      const task = this.pendingTasks.get(id);
      if (task) {
        this.pendingTasks.delete(id);
        if (error) {
          task.reject(new Error(error));
        } else {
          task.resolve(result);
        }
      }
    }

    // Process next task from queue
    this.processNextTask();
  }

  private handleWorkerError(err: ErrorEvent): void {
    logger.error('[WorkerPool] Worker error:', err);
    // Find the worker that errored
    const worker = err.target as PWorker | null;
    if (worker) worker.busy = false;

    // Process next task
    this.processNextTask();
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0) return;

    const availableWorker = this.workers.find((w) => !w.busy);
    if (!availableWorker) return;

    const task = this.taskQueue.shift()!;
    availableWorker.busy = true;
    availableWorker.postMessage({
      type: task.type,
      data: task.data,
      id: task.id,
    });
  }

  /**
   * Execute a task using a worker from the pool
   */
  private execute(type: string, data: unknown): Promise<unknown> {
    // If workers unavailable, return rejected promise
    if (this.unavailable) {
      return Promise.reject(new Error('Workers unavailable'));
    }

    return new Promise<unknown>((resolve, reject) => {
      const taskId = this.nextTaskId++;
      const task: PoolTask = {
        id: taskId,
        type,
        data,
        resolve,
        reject,
      };

      this.pendingTasks.set(taskId, task);

      // Try to assign to an available worker immediately
      const availableWorker = this.workers.find((w) => !w.busy);
      if (availableWorker) {
        availableWorker.busy = true;
        availableWorker.postMessage({
          type,
          data,
          id: taskId,
        });
      } else {
        // Queue the task
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * Parse text lines using worker
   */
  parseLines(lines: string[], filename: string): Promise<unknown> {
    return this.execute('parseLines', { lines, filename });
  }

  /**
   * Parse JSON using worker
   */
  parseJSON(text: string, filename: string): Promise<unknown> {
    return this.execute('parseJSON', { text, filename });
  }

  /**
   * Parse zip entries using worker
   */
  parseZipEntries(entries: unknown[], zipName: string): Promise<unknown> {
    return this.execute('parseZipEntries', { entries, zipName });
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
  }
}

// Singleton helpers stored on globalThis to avoid module resolution quirks
const WP_KEY = '__ljWorkerPool__';

export function getWorkerPool(): WorkerPool | null {
  const existing = (globalThis as { __ljWorkerPool__?: WorkerPool }).__ljWorkerPool__;
  if (existing) return existing;
  try {
    // Use 2 workers by default for balance between parallelism and memory
    const wp = new WorkerPool('../workers/parser.worker.js', 2);
    (globalThis as { __ljWorkerPool__?: WorkerPool }).__ljWorkerPool__ = wp;
    return wp;
  } catch (err) {
    logger.warn('[WorkerPool] Failed to initialize:', err);
    return null;
  }
}

export function terminateWorkerPool(): void {
  const wp = (globalThis as { __ljWorkerPool__?: WorkerPool }).__ljWorkerPool__;
  if (wp) {
    wp.terminate();
    (globalThis as { __ljWorkerPool__?: WorkerPool | null }).__ljWorkerPool__ = null;
  }
}
