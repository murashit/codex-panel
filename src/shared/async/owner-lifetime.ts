export class OwnerLifetime {
  private controller = new AbortController();

  signal(): AbortSignal {
    return this.controller.signal;
  }

  isCurrent(signal: AbortSignal): boolean {
    return !signal.aborted && signal === this.controller.signal;
  }

  isActive(): boolean {
    return !this.controller.signal.aborted;
  }

  activate(): void {
    if (this.isActive()) return;
    this.controller = new AbortController();
  }

  dispose(): void {
    this.controller.abort();
  }
}
