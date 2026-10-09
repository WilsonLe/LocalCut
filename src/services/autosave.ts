// One trailing timer per project; commits remain durable independently of versions.
export class Autosave {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Map<string, Promise<void>>();
  constructor(
    private save: (id: string) => Promise<void>,
    private onError: (id: string, error: unknown) => void,
  ) {}
  schedule(id: string) {
    this.cancel(id);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.flush(id).catch((error) => this.onError(id, error));
      }, 1000),
    );
  }
  cancel(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
  async flush(id: string) {
    this.cancel(id);
    // A second flush must also capture edits that landed during the first save.
    await this.running.get(id);
    const task = this.save(id);
    this.running.set(id, task);
    try {
      await task;
    } finally {
      if (this.running.get(id) === task) this.running.delete(id);
    }
  }
  async flushAll() {
    const ids = new Set([...this.timers.keys(), ...this.running.keys()]);
    const results = await Promise.allSettled(
      [...ids].map((id) => this.flush(id)),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
}
