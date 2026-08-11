export class OwnerLifetime {
  private controller = new AbortController();
  private active = true;

  signal(): AbortSignal {
    return this.controller.signal;
  }

  isCurrent(signal: AbortSignal): boolean {
    return this.active && !signal.aborted && signal === this.controller.signal;
  }

  isActive(): boolean {
    return this.active;
  }

  activate(): void {
    if (this.active) return;
    this.controller = new AbortController();
    this.active = true;
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.controller.abort();
  }
}
