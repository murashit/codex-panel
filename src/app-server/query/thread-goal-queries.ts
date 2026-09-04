import { QueryObserver } from "@tanstack/query-core";
import type { ThreadGoal } from "../../domain/threads/goal";
import type { ServerNotification } from "../connection/rpc-messages";
import { threadGoalFromAppServerGoal } from "../protocol/thread-goal";
import { readThreadGoal } from "../services/threads";
import type { AppServerQueryOptions, AppServerQueryScope } from "./query-scope";

type ThreadGoalNotification = Extract<ServerNotification, { method: "thread/goal/updated" | "thread/goal/cleared" }>;

type ThreadGoalChangeListener = (threadId: string, previous: ThreadGoal | null, next: ThreadGoal | null) => void;

export class AppServerThreadGoalQueries {
  private readonly changeListeners = new Set<ThreadGoalChangeListener>();

  constructor(private readonly scope: AppServerQueryScope) {}

  snapshot(threadId: string): ThreadGoal | null | undefined {
    if (this.scope.isDisposed()) return undefined;
    return this.scope.client.getQueryData<ThreadGoal | null>(threadGoalQueryKey(threadId));
  }

  observe(threadId: string, listener: (goal: ThreadGoal | null, error: string | null) => void): () => void {
    this.scope.assertUsable();
    const observer = new QueryObserver(this.scope.client, { ...this.queryOptions(threadId), enabled: true });
    const emit = (): void => {
      const result = observer.getCurrentResult();
      listener(result.data ?? null, result.error ? errorMessage(result.error) : null);
    };
    const unsubscribe = observer.subscribe(emit);
    emit();
    return this.scope.trackObserver(() => {
      unsubscribe();
      observer.destroy();
    });
  }

  observeChanges(listener: ThreadGoalChangeListener): () => void {
    this.scope.assertUsable();
    this.changeListeners.add(listener);
    return this.scope.trackObserver(() => {
      this.changeListeners.delete(listener);
    });
  }

  applyNotification(notification: ThreadGoalNotification): void {
    const threadId = notification.params.threadId;
    const goal = notification.method === "thread/goal/updated" ? threadGoalFromAppServerGoal(notification.params.goal) : null;
    this.applyGoal(threadId, goal);
  }

  private applyGoal(threadId: string, goal: ThreadGoal | null): void {
    this.scope.assertUsable();
    const previous = this.snapshot(threadId) ?? null;
    void this.scope.client.cancelQueries({ queryKey: threadGoalQueryKey(threadId), exact: true });
    this.scope.client.setQueryData(threadGoalQueryKey(threadId), goal);
    for (const listener of this.changeListeners) listener(threadId, previous, goal);
  }

  private queryOptions(threadId: string): AppServerQueryOptions<ThreadGoal | null> {
    return {
      queryKey: threadGoalQueryKey(threadId),
      queryFn: () => this.scope.runWithClient((client) => readThreadGoal(client, threadId)),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function threadGoalQueryKey(threadId: string): readonly ["threads", string, "goal"] {
  return ["threads", threadId, "goal"];
}
