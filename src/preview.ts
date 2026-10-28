/** At most one in-flight preview and one latest value per control. */
export class LatestPreview<T> {
  private latest: T | undefined;
  private running: Promise<void> | null = null;
  private frame: number | null = null;
  private active = true;
  private generation = 0;
  private apply: (value: T) => Promise<unknown>;
  private report: (error: unknown) => void;
  private requestFrame: (callback: () => void) => number;
  private cancelFrame: (id: number) => void;

  constructor(apply: (value: T) => Promise<unknown>, report: (error: unknown) => void,
    requestFrame = (callback: () => void) => requestAnimationFrame(callback),
    cancelFrame = (id: number) => cancelAnimationFrame(id)) {
    this.apply = apply; this.report = report;
    this.requestFrame = requestFrame; this.cancelFrame = cancelFrame;
  }
  resume() { this.active = true; this.generation++; }
  enqueue(value: T) {
    if (!this.active) return;
    this.latest = value;
    this.schedule();
  }
  private unschedule() {
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }
  private schedule() {
    if (!this.active || this.running || this.frame !== null || this.latest === undefined) return;
    this.frame = this.requestFrame(() => { this.frame = null; void this.process(); });
  }
  private async process() {
    if (!this.active || this.running || this.latest === undefined) return;
    const value = this.latest;
    const generation = this.generation;
    this.latest = undefined;
    this.running = Promise.resolve().then(() => this.apply(value)).catch(error => {
      if (this.active && generation === this.generation) this.report(error);
    }).then(() => { this.running = null; this.schedule(); });
    await this.running;
  }
  async flush() {
    while (this.active && (this.running || this.latest !== undefined)) {
      this.unschedule();
      if (this.running) await this.running;
      else await this.process();
    }
    this.unschedule();
  }
  async cancel() {
    this.active = false; this.generation++; this.latest = undefined;
    this.unschedule();
    await this.running;
  }
}
