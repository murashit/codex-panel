export type DeferredTaskWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export class DeferredTask {
  private pending: { owner: DeferredTaskWindow; timer: number } | null = null;

  constructor(
    private readonly getWindow: () => DeferredTaskWindow,
    private readonly delay: number,
  ) {}

  schedule(callback: () => void): void {
    if (this.pending !== null) return;
    const owner = this.getWindow();
    const timer = owner.setTimeout(() => {
      this.pending = null;
      callback();
    }, this.delay);
    this.pending = { owner, timer };
  }

  clear(): void {
    if (this.pending === null) return;
    this.pending.owner.clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
