import type { QueryClient } from "@tanstack/query-core";

interface QueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (context: { signal: AbortSignal }) => Promise<T>;
  readonly staleTime?: number;
}

export interface InvalidatedQueryRefreshCoordinator<Queries extends object> {
  read<Id extends keyof Queries>(id: Id): Promise<Queries[Id]>;
  refreshAfterInvalidation(id: keyof Queries): Promise<void>;
}

interface InvalidatedQueryRefreshOptions<Queries extends object> {
  readonly client: QueryClient;
  readonly queryOptions: <Id extends keyof Queries>(id: Id, cause: "read" | "refresh") => QueryOptions<Queries[Id]>;
}

export function createInvalidatedQueryRefreshCoordinator<Queries extends object>(
  options: InvalidatedQueryRefreshOptions<Queries>,
): InvalidatedQueryRefreshCoordinator<Queries> {
  return new QueryRefreshCoordinator(options);
}

class QueryRefreshCoordinator<Queries extends object> implements InvalidatedQueryRefreshCoordinator<Queries> {
  private readonly refreshes = new Map<keyof Queries, RefreshEntry>();

  constructor(private readonly options: InvalidatedQueryRefreshOptions<Queries>) {}

  async read<Id extends keyof Queries>(id: Id): Promise<Queries[Id]> {
    for (;;) {
      const refresh = this.refreshes.get(id);
      if (!refresh) return this.options.client.query(this.options.queryOptions(id, "read"));
      await refresh.promise;
      if (this.refreshes.has(id)) continue;
      const queryKey = this.options.queryOptions(id, "read").queryKey;
      const refreshed = this.options.client.getQueryData<Queries[Id]>(queryKey);
      if (refreshed !== undefined) return refreshed;
    }
  }

  refreshAfterInvalidation(id: keyof Queries): Promise<void> {
    const current = this.refreshes.get(id);
    if (current) {
      current.requestAnother();
      return current.promise;
    }

    const refresh = new RefreshEntry((entry) => this.runRefresh(id, entry));
    this.refreshes.set(id, refresh);
    return refresh.promise;
  }

  private async runRefresh(id: keyof Queries, refresh: RefreshEntry): Promise<void> {
    try {
      for (;;) {
        refresh.beginAttempt();
        const queryOptions = this.options.queryOptions(id, "refresh");
        await this.options.client.cancelQueries({ queryKey: queryOptions.queryKey, exact: true });
        await this.options.client.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: "none" });

        try {
          await this.options.client.query(queryOptions);
        } catch (error) {
          if (!refresh.needsAnotherAttempt()) throw error;
        }
        if (!refresh.needsAnotherAttempt()) return;
      }
    } finally {
      if (this.refreshes.get(id) === refresh) this.refreshes.delete(id);
    }
  }
}

class RefreshEntry {
  readonly promise: Promise<void>;
  private refreshAgain = false;

  constructor(run: (entry: RefreshEntry) => Promise<void>) {
    this.promise = Promise.resolve().then(() => run(this));
  }

  requestAnother(): void {
    this.refreshAgain = true;
  }

  beginAttempt(): void {
    this.refreshAgain = false;
  }

  needsAnotherAttempt(): boolean {
    return this.refreshAgain;
  }
}
