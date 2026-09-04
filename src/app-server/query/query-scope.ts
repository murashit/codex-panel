import { QueryClient } from "@tanstack/query-core";
import type { AppServerClient } from "../connection/client";
import type { AppServerClientAccess } from "../connection/client-access";
import type { AppServerExecutionContext } from "../connection/execution-context";

export interface AppServerQueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (context: { signal: AbortSignal }) => Promise<T>;
  readonly staleTime?: number;
}

export class AppServerQueryScope {
  readonly context: Readonly<AppServerExecutionContext>;
  readonly client: QueryClient;
  private readonly observerUnsubscribes = new Set<() => void>();
  private disposed = false;

  constructor(
    context: AppServerExecutionContext,
    private readonly clientAccess: AppServerClientAccess,
  ) {
    this.context = Object.freeze({ ...context });
    this.client = createAppServerQueryClient();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of [...this.observerUnsubscribes]) unsubscribe();
    this.observerUnsubscribes.clear();
    this.client.clear();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  invalidate(): void {
    if (this.disposed) return;
    void this.client.cancelQueries();
    void this.client.invalidateQueries({ refetchType: "none" });
  }

  assertUsable(): void {
    if (this.disposed) throw new Error("Codex execution runtime is no longer active.");
  }

  runWithClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    this.assertUsable();
    return this.clientAccess.withClient(operation);
  }

  trackObserver(unsubscribe: () => void): () => void {
    if (this.disposed) {
      unsubscribe();
      return () => undefined;
    }
    let subscribed = true;
    const trackedUnsubscribe = (): void => {
      if (!subscribed) return;
      subscribed = false;
      this.observerUnsubscribes.delete(trackedUnsubscribe);
      unsubscribe();
    };
    this.observerUnsubscribes.add(trackedUnsubscribe);
    return trackedUnsubscribe;
  }
}

function createAppServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Number.POSITIVE_INFINITY,
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
