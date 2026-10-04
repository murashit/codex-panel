import type { AppServerClient } from "./client";
import { StaleConnectionError } from "./connection-manager";

/** Persistent subscriptions belong to the shared connection, not the panel that resumed them. */
export class ThreadSubscriptions {
  private readonly subscribed = new Set<string>();
  private readonly updates = new Map<string, Promise<void>>();
  private readonly activations = new Map<string | null, number>();
  private generation = 0;

  constructor(
    private readonly currentClient: () => AppServerClient | null,
    private readonly requiredThreads: () => ReadonlySet<string>,
    private readonly reportFailure: (message: string) => void,
  ) {}

  record(threadId: string, client: AppServerClient): void {
    if (client !== this.currentClient()) return;
    this.subscribed.add(threadId);
  }

  reconcile(): void {
    const client = this.currentClient();
    if (!client) return;
    const required = this.requiredThreads();
    for (const threadId of new Set([...this.subscribed, ...required])) {
      const subscribe = required.has(threadId);
      // New IDs arrive by notification before creation replies. Hold releases until adoption,
      // but keep unrelated subscriptions and known-thread activations moving.
      if (this.activations.has(threadId) || (!subscribe && this.activations.has(null))) continue;
      if (subscribe === this.subscribed.has(threadId) || this.updates.has(threadId)) continue;
      const generation = this.generation;
      const update = this.update(threadId, subscribe, client, generation).then((updated) => {
        if (this.updates.get(threadId) !== update) return;
        this.updates.delete(threadId);
        if (updated) this.reconcile();
      });
      this.updates.set(threadId, update);
    }
  }

  async activate<T>(threadId: string | null, operation: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    this.activations.set(threadId, (this.activations.get(threadId) ?? 0) + 1);
    try {
      // A preceding unsubscribe must finish before a new resume can subscribe again.
      const pending = threadId === null ? undefined : this.updates.get(threadId);
      if (pending) await pending;
      if (generation !== this.generation) throw new StaleConnectionError();
      return await operation();
    } finally {
      if (generation === this.generation) {
        const remaining = (this.activations.get(threadId) ?? 1) - 1;
        if (remaining > 0) this.activations.set(threadId, remaining);
        else this.activations.delete(threadId);
        this.reconcile();
      }
    }
  }

  reset(): void {
    this.generation += 1;
    this.subscribed.clear();
    this.updates.clear();
    this.activations.clear();
  }

  private async update(threadId: string, subscribe: boolean, client: AppServerClient, generation: number): Promise<boolean> {
    try {
      // Unsubscribe releases this connection's interest; Codex owns active-thread retention,
      // the configured inactive unload delay, and eventual writer-lock release.
      if (subscribe) await client.request("thread/resume", { threadId, excludeTurns: true });
      else await client.request("thread/unsubscribe", { threadId }, { timeoutMs: 5_000 });
      if (generation !== this.generation || client !== this.currentClient()) return false;
      if (subscribe) this.subscribed.add(threadId);
      else this.subscribed.delete(threadId);
      return true;
    } catch (error) {
      if (generation !== this.generation || client !== this.currentClient()) return false;
      this.reportFailure(`Could not update thread subscription ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
