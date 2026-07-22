import type { Thread } from "../../../domain/threads/model";
import type {
  ThreadLifecycleEvent,
  ThreadOperationCommitter,
  ThreadOperationEvent,
  ThreadOperationEventSink,
} from "./thread-operation-event";

interface ThreadForkPublication {
  record(thread: Thread): void;
  finish(options?: { sourceArchived?: boolean }): void;
}

export interface ThreadOperationCoordinator extends ThreadOperationEventSink {
  beginForkPublication(sourceThreadId: string): ThreadForkPublication;
}

type ForkedThreadState = "active" | "archived" | "deleted";

interface PendingForkPublication {
  child: PendingForkChild | null;
  finished: boolean;
}

interface PendingForkChild {
  thread: Thread;
  state: ForkedThreadState;
  eventsBeforeClaim: ThreadOperationEvent[] | null;
}

interface ForkSourceGroup {
  publications: Set<PendingForkPublication>;
  unclaimedChildren: Map<string, PendingForkChild>;
  sourceState: "active" | "archived" | null;
  restoredSource: Thread | null;
}

export function createThreadOperationCoordinator(committer: ThreadOperationCommitter): ThreadOperationCoordinator {
  const sourceGroups = new Map<string, ForkSourceGroup>();
  const pendingChildrenByThread = new Map<string, PendingForkChild>();

  const apply = (event: ThreadOperationEvent): void => {
    const pendingChild = pendingChildrenByThread.get(threadIdForEvent(event));
    if (pendingChild) {
      pendingChild.eventsBeforeClaim?.push(event);
      if (applyChildEvent(pendingChild, event)) return;
    }

    if (event.type === "thread-upserted" && event.forkedFromThreadId) {
      const group = sourceGroups.get(event.forkedFromThreadId);
      if (group) {
        const child = { thread: event.thread, state: "active", eventsBeforeClaim: [] } satisfies PendingForkChild;
        group.unclaimedChildren.set(event.thread.id, child);
        pendingChildrenByThread.set(event.thread.id, child);
        return;
      }
    }

    const sourceGroup = sourceGroups.get(threadIdForEvent(event));
    if (sourceGroup && applySourceEvent(sourceGroup, event)) return;
    committer([lifecycleEvent(event)]);
  };

  const beginForkPublication = (sourceThreadId: string): ThreadForkPublication => {
    const publication: PendingForkPublication = { child: null, finished: false };
    const group = sourceGroups.get(sourceThreadId) ?? createForkSourceGroup();
    group.publications.add(publication);
    sourceGroups.set(sourceThreadId, group);

    return {
      record: (thread) => {
        if (publication.finished) return;
        const child = group.unclaimedChildren.get(thread.id) ?? { thread, state: "active", eventsBeforeClaim: null };
        const eventsBeforeClaim = child.eventsBeforeClaim;
        child.thread = thread;
        child.state = "active";
        child.eventsBeforeClaim = null;
        for (const event of eventsBeforeClaim ?? []) applyChildEvent(child, event);
        publication.child = child;
        group.unclaimedChildren.delete(thread.id);
        pendingChildrenByThread.set(thread.id, child);
      },
      finish: (options = {}) => {
        if (publication.finished) return;
        publication.finished = true;
        if (publication.child) pendingChildrenByThread.delete(publication.child.thread.id);
        group.publications.delete(publication);
        if (group.sourceState === null && options.sourceArchived !== undefined) {
          group.sourceState = options.sourceArchived ? "archived" : "active";
        }

        const events = completedForkChildEvents(publication);
        if (group.publications.size === 0) events.push(...completedSourceEvents(group, sourceThreadId));
        if (events.length > 0) committer(events);

        if (group.publications.size > 0) return;
        sourceGroups.delete(sourceThreadId);
        for (const child of group.unclaimedChildren.values()) {
          pendingChildrenByThread.delete(child.thread.id);
          committer(completedChildEvents(child));
        }
      },
    };
  };

  return { apply, beginForkPublication };
}

function createForkSourceGroup(): ForkSourceGroup {
  return {
    publications: new Set(),
    unclaimedChildren: new Map(),
    sourceState: null,
    restoredSource: null,
  };
}

function applyChildEvent(child: PendingForkChild, event: ThreadOperationEvent): boolean {
  switch (event.type) {
    case "thread-upserted":
      child.thread = event.thread;
      return true;
    case "thread-renamed":
      child.thread = { ...child.thread, name: event.name };
      return true;
    case "thread-archived":
      child.state = "archived";
      return true;
    case "thread-deleted":
      child.state = "deleted";
      return true;
    case "thread-restored":
      child.thread = event.thread;
      child.state = "active";
      return true;
    case "thread-unarchived":
      child.state = "active";
      return true;
  }
}

function applySourceEvent(group: ForkSourceGroup, event: ThreadOperationEvent): boolean {
  switch (event.type) {
    case "thread-archived":
      group.sourceState = "archived";
      return true;
    case "thread-unarchived":
      if (group.sourceState !== "archived") return false;
      group.sourceState = "active";
      return true;
    case "thread-restored":
      if (group.sourceState) group.sourceState = "active";
      group.restoredSource = event.thread;
      return true;
    default:
      return false;
  }
}

function completedForkChildEvents(publication: PendingForkPublication): ThreadLifecycleEvent[] {
  return publication.child ? completedChildEvents(publication.child) : [];
}

function completedChildEvents(child: PendingForkChild): ThreadLifecycleEvent[] {
  const events: ThreadLifecycleEvent[] = [{ type: "thread-upserted", thread: child.thread }];
  if (child.state === "archived") events.push({ type: "thread-archived", threadId: child.thread.id });
  if (child.state === "deleted") events.push({ type: "thread-deleted", threadId: child.thread.id });
  return events;
}

function completedSourceEvents(group: ForkSourceGroup, sourceThreadId: string): ThreadLifecycleEvent[] {
  if (group.sourceState === "archived") return [{ type: "thread-archived", threadId: sourceThreadId }];
  if (group.restoredSource) return [{ type: "thread-restored", thread: group.restoredSource }];
  return [];
}

function lifecycleEvent(event: ThreadOperationEvent): ThreadLifecycleEvent {
  if (event.type === "thread-upserted") return { type: "thread-upserted", thread: event.thread };
  return event;
}

function threadIdForEvent(event: ThreadOperationEvent): string {
  return event.type === "thread-upserted" || event.type === "thread-restored" ? event.thread.id : event.threadId;
}
