import type { Thread } from "../../../domain/threads/model";
import type { ThreadFact, ThreadFactCommitter, ThreadFactInput, ThreadFactSink } from "./thread-facts";

interface ThreadForkPublication {
  record(thread: Thread): void;
  finish(options?: { sourceArchived?: boolean }): void;
}

export interface ThreadFactCoordinator extends ThreadFactSink {
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
  factsBeforeClaim: ThreadFactInput[] | null;
}

interface ForkSourceGroup {
  publications: Set<PendingForkPublication>;
  unclaimedChildren: Map<string, PendingForkChild>;
  sourceState: "active" | "archived" | null;
  restoredSource: Thread | null;
}

export function createThreadFactCoordinator(committer: ThreadFactCommitter): ThreadFactCoordinator {
  const sourceGroups = new Map<string, ForkSourceGroup>();
  const pendingChildrenByThread = new Map<string, PendingForkChild>();

  const apply = (fact: ThreadFactInput): void => {
    const pendingChild = pendingChildrenByThread.get(threadIdForFact(fact));
    if (pendingChild) {
      pendingChild.factsBeforeClaim?.push(fact);
      if (applyChildFact(pendingChild, fact)) return;
    }

    if (fact.type === "thread-upserted" && fact.forkedFromThreadId) {
      const group = sourceGroups.get(fact.forkedFromThreadId);
      if (group) {
        const child = { thread: fact.thread, state: "active", factsBeforeClaim: [] } satisfies PendingForkChild;
        group.unclaimedChildren.set(fact.thread.id, child);
        pendingChildrenByThread.set(fact.thread.id, child);
        return;
      }
    }

    const sourceGroup = sourceGroups.get(threadIdForFact(fact));
    if (sourceGroup && applySourceFact(sourceGroup, fact)) return;
    committer([committedFact(fact)]);
  };

  const beginForkPublication = (sourceThreadId: string): ThreadForkPublication => {
    const publication: PendingForkPublication = { child: null, finished: false };
    const group = sourceGroups.get(sourceThreadId) ?? createForkSourceGroup();
    group.publications.add(publication);
    sourceGroups.set(sourceThreadId, group);

    return {
      record: (thread) => {
        if (publication.finished) return;
        const child = group.unclaimedChildren.get(thread.id) ?? { thread, state: "active", factsBeforeClaim: null };
        const factsBeforeClaim = child.factsBeforeClaim;
        child.thread = thread;
        child.state = "active";
        child.factsBeforeClaim = null;
        for (const fact of factsBeforeClaim ?? []) applyChildFact(child, fact);
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

        const facts = completedForkChildFacts(publication);
        if (group.publications.size === 0) facts.push(...completedSourceFacts(group, sourceThreadId));
        if (facts.length > 0) committer(facts);

        if (group.publications.size > 0) return;
        sourceGroups.delete(sourceThreadId);
        for (const child of group.unclaimedChildren.values()) {
          pendingChildrenByThread.delete(child.thread.id);
          committer(completedChildFacts(child));
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

function applyChildFact(child: PendingForkChild, fact: ThreadFactInput): boolean {
  switch (fact.type) {
    case "thread-upserted":
      child.thread = fact.thread;
      return true;
    case "thread-renamed":
      child.thread = { ...child.thread, name: fact.name };
      return true;
    case "thread-archived":
      child.state = "archived";
      return true;
    case "thread-deleted":
      child.state = "deleted";
      return true;
    case "thread-restored":
      child.thread = fact.thread;
      child.state = "active";
      return true;
    case "thread-unarchived":
      child.state = "active";
      return true;
  }
}

function applySourceFact(group: ForkSourceGroup, fact: ThreadFactInput): boolean {
  switch (fact.type) {
    case "thread-archived":
      group.sourceState = "archived";
      return true;
    case "thread-unarchived":
      if (group.sourceState !== "archived") return false;
      group.sourceState = "active";
      return true;
    case "thread-restored":
      if (group.sourceState) group.sourceState = "active";
      group.restoredSource = fact.thread;
      return true;
    default:
      return false;
  }
}

function completedForkChildFacts(publication: PendingForkPublication): ThreadFact[] {
  return publication.child ? completedChildFacts(publication.child) : [];
}

function completedChildFacts(child: PendingForkChild): ThreadFact[] {
  const facts: ThreadFact[] = [{ type: "thread-upserted", thread: child.thread }];
  if (child.state === "archived") facts.push({ type: "thread-archived", threadId: child.thread.id });
  if (child.state === "deleted") facts.push({ type: "thread-deleted", threadId: child.thread.id });
  return facts;
}

function completedSourceFacts(group: ForkSourceGroup, sourceThreadId: string): ThreadFact[] {
  if (group.sourceState === "archived") return [{ type: "thread-archived", threadId: sourceThreadId }];
  if (group.restoredSource) return [{ type: "thread-restored", thread: group.restoredSource }];
  return [];
}

function committedFact(fact: ThreadFactInput): ThreadFact {
  if (fact.type === "thread-upserted") return { type: "thread-upserted", thread: fact.thread };
  return fact;
}

function threadIdForFact(fact: ThreadFactInput): string {
  return fact.type === "thread-upserted" || fact.type === "thread-restored" ? fact.thread.id : fact.threadId;
}
