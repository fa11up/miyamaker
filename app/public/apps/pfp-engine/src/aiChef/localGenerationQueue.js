"use strict";

class LocalGenerationQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.cancelRequested = false;
    this.cancelReason = "AI Chef generation cancelled";
  }

  enqueue(task) {
    const runTask = async () => {
      if (this.cancelRequested) throw new Error(this.cancelReason);
      return task({
        isCancelled: () => this.cancelRequested,
        reason: () => this.cancelReason,
      });
    };
    const run = this.tail.then(runTask, runTask);
    this.tail = run.catch(() => {});
    return run;
  }

  cancelAll(reason = "AI Chef generation cancelled") {
    this.cancelRequested = true;
    this.cancelReason = reason;
  }

  resetCancellation() {
    this.cancelRequested = false;
    this.cancelReason = "AI Chef generation cancelled";
  }

  isCancelled() {
    return this.cancelRequested;
  }
}

module.exports = { LocalGenerationQueue };
