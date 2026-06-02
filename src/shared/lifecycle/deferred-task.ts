export type DeferredTaskWindow = Pick<Window, "setTimeout" | "clearTimeout">;

export class DeferredTask {
  private timer: ReturnType<DeferredTaskWindow["setTimeout"]> | null = null;

  constructor(
    private readonly getWindow: () => DeferredTaskWindow,
    private readonly delay: number,
  ) {}

  schedule(callback: () => void): void {
    if (this.timer !== null) return;
    this.timer = this.getWindow().setTimeout(() => {
      this.timer = null;
      callback();
    }, this.delay);
  }

  clear(): void {
    if (this.timer === null) return;
    this.getWindow().clearTimeout(this.timer);
    this.timer = null;
  }
}
