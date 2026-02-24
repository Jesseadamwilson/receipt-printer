class PrintQueue {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRetries = options.maxRetries ?? 2;
    this._jobCounter = 0;
    this._pending = Promise.resolve();
  }

  enqueue(meta, handler) {
    const jobId = `job-${Date.now()}-${++this._jobCounter}`;
    const submittedAt = new Date().toISOString();

    const runJob = async () => {
      const startedAt = new Date().toISOString();
      const payload = await this._runWithRetries(handler);

      return {
        jobId,
        type: meta.type,
        submittedAt,
        startedAt,
        completedAt: new Date().toISOString(),
        ...payload
      };
    };

    const result = this._pending.then(runJob, runJob);
    this._pending = result.catch(() => undefined);

    return result;
  }

  async _runWithRetries(handler) {
    let attempt = 0;
    let lastError;

    while (attempt <= this.maxRetries) {
      attempt += 1;

      try {
        const result = await this._withTimeout(handler(attempt), this.timeoutMs);
        return {
          attempts: attempt,
          ...result
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  _withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Print job timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

module.exports = PrintQueue;
