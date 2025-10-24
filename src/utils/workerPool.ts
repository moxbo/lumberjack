/**
 * Worker Pool Manager for Parser Workers
 * Manages a pool of web workers for parallel parsing
 */
import logger from './logger.ts';

class WorkerPool {
  constructor(workerPath, poolSize = 2) {
    this.workerPath = workerPath;
    this.poolSize = poolSize;
    this.workers = [];
    this.taskQueue = [];
    this.nextTaskId = 1;
    this.pendingTasks = new Map();

    // Initialize worker pool
    this.initializePool();
  }

  initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      try {
        const worker = new Worker(new URL('../workers/parser.worker.js', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (e) => this.handleWorkerMessage(e);
        worker.onerror = (err) => this.handleWorkerError(err);
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

  handleWorkerMessage(e) {
    const { type, id, result, error } = e.data;

    // Find the worker that sent this message
    const worker = e.target;
    worker.busy = false;

    // Resolve or reject the pending task
    const task = this.pendingTasks.get(id);
    if (task) {
      this.pendingTasks.delete(id);
      if (error) {
        task.reject(new Error(error));
      } else {
        task.resolve(result);
      }
    }

    // Process next task from queue
    this.processNextTask();
  }

  handleWorkerError(err) {
    logger.error('[WorkerPool] Worker error:', err);
    // Find the worker that errored
    const worker = err.target;
    worker.busy = false;

    // Process next task
    this.processNextTask();
  }

  processNextTask() {
    if (this.taskQueue.length === 0) return;

    const availableWorker = this.workers.find((w) => !w.busy);
    if (!availableWorker) return;

    const task = this.taskQueue.shift();
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
  execute(type, data) {
    // If workers unavailable, return rejected promise
    if (this.unavailable) {
      return Promise.reject(new Error('Workers unavailable'));
    }

    return new Promise((resolve, reject) => {
      const taskId = this.nextTaskId++;
      const task = {
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
  parseLines(lines, filename) {
    return this.execute('parseLines', { lines, filename });
  }

  /**
   * Parse JSON using worker
   */
  parseJSON(text, filename) {
    return this.execute('parseJSON', { text, filename });
  }

  /**
   * Parse zip entries using worker
   */
  parseZipEntries(entries, zipName) {
    return this.execute('parseZipEntries', { entries, zipName });
  }

  /**
   * Terminate all workers
   */
  terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
  }
}

// Create and export a singleton instance
let workerPool = null;

export function getWorkerPool() {
  if (!workerPool) {
    try {
      // Use 2 workers by default for balance between parallelism and memory
      workerPool = new WorkerPool('/workers/parser.worker.js', 2);
    } catch (err) {
      logger.warn('[WorkerPool] Failed to initialize:', err);
    }
  }
  return workerPool;
}

export function terminateWorkerPool() {
  if (workerPool) {
    workerPool.terminate();
    workerPool = null;
  }
}
