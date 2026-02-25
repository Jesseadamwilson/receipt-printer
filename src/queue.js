class QueueJobError extends Error {
  constructor(message, job) {
    super(message);
    this.name = 'QueueJobError';
    this.job = job;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

class PrintQueue {
  constructor(options = {}) {
    if (typeof options.worker !== 'function') {
      throw new Error('PrintQueue requires a worker(job) function');
    }

    this.worker = options.worker;
    this.maxRetries = sanitizeNonNegativeNumber(options.maxRetries, 2);
    this.retryDelayMs = sanitizeNonNegativeNumber(options.retryDelayMs, 1000);
    this.maxHistory = sanitizeNonNegativeNumber(options.maxHistory, 250);

    this.pending = [];
    this.jobs = [];
    this.jobsById = new Map();
    this.processing = false;
    this.activeJobId = null;
    this.counter = 0;
  }

  enqueue(type, payload = {}) {
    const job = {
      id: `job-${Date.now()}-${++this.counter}`,
      type: String(type || 'unknown'),
      status: 'queued',
      attempts: 0,
      maxAttempts: this.maxRetries + 1,
      submittedAt: nowIso(),
      startedAt: null,
      completedAt: null,
      lastError: null,
      result: null
    };

    this.jobs.push(job);
    this.jobsById.set(job.id, job);
    this.trimHistory();

    return new Promise((resolve, reject) => {
      this.pending.push({
        job,
        payload,
        resolve,
        reject
      });

      this.process().catch((error) => {
        const message = error && error.message ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error(`[queue] unexpected process error: ${message}`);
      });
    });
  }

  getStatus() {
    return {
      pending: this.pending.length,
      processing: this.processing,
      activeJobId: this.activeJobId,
      maxRetries: this.maxRetries,
      retryDelayMs: this.retryDelayMs,
      totalJobsTracked: this.jobs.length
    };
  }

  getJob(jobId) {
    const job = this.jobsById.get(jobId);
    if (!job) {
      return null;
    }

    return this.serializeJob(job);
  }

  async process() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift();
        await this.runJob(item);
      }
    } finally {
      this.processing = false;
      this.activeJobId = null;
    }
  }

  async runJob(item) {
    const { job, payload, resolve, reject } = item;
    this.activeJobId = job.id;
    job.startedAt = job.startedAt || nowIso();
    job.status = 'in_progress';

    for (let attempt = 1; attempt <= job.maxAttempts; attempt += 1) {
      job.attempts = attempt;

      try {
        const result = await this.worker({
          id: job.id,
          type: job.type,
          attempt,
          payload
        });

        job.status = 'completed';
        job.completedAt = nowIso();
        job.result = result || {};
        resolve(this.serializeJob(job));
        return;
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        job.lastError = message;
        const retryable = !error || error.retryable !== false;

        if (retryable && attempt < job.maxAttempts) {
          job.status = 'retrying';
          await sleep(this.retryDelayMs);
          job.status = 'in_progress';
          continue;
        }

        job.status = 'failed';
        job.completedAt = nowIso();
        reject(new QueueJobError(message, this.serializeJob(job)));
        return;
      }
    }
  }

  serializeJob(job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      submittedAt: job.submittedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastError: job.lastError,
      result: job.result
    };
  }

  trimHistory() {
    while (this.jobs.length > this.maxHistory) {
      const removed = this.jobs.shift();
      if (removed && this.jobsById.get(removed.id) === removed) {
        this.jobsById.delete(removed.id);
      }
    }
  }
}

module.exports = {
  PrintQueue,
  QueueJobError
};
