// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatResumeWorkTracker, transitionRestoredThreadLifecycle } from "../../../src/features/chat/application/lifecycle";
import { createChatViewDeferredTasks } from "../../../src/features/chat/host/deferred-tasks";
import { ConnectionWorkTracker } from "../../../src/shared/lifecycle/connection-work";

describe("createChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("clears scheduled deferred work", async () => {
    const tasks = createChatViewDeferredTasks(() => window);
    const diagnostics = vi.fn();
    const warmup = vi.fn();

    tasks.scheduleDiagnostics(diagnostics);
    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(diagnostics).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });
});

describe("chat view lifecycle transitions", () => {
  it("tracks active connection work by identity", () => {
    const tracker = new ConnectionWorkTracker();
    const connection = tracker.begin();
    const stale = { kind: "connecting" as const, promise: Promise.resolve() };

    expect(tracker.active()).toBe(connection);
    expect(tracker.isStale(connection)).toBe(false);
    expect(tracker.isStale(stale)).toBe(true);

    const promise = Promise.resolve();
    connection.promise = promise;
    tracker.finish(connection, Promise.resolve());
    expect(tracker.active()).toBe(connection);
    tracker.finish(connection, promise);
    expect(tracker.active()).toBeNull();
  });

  it("tracks resume work by identity", () => {
    const tracker = new ChatResumeWorkTracker();
    const resume = tracker.begin("thread");

    expect(tracker.isStale(resume)).toBe(false);
    tracker.invalidate();
    expect(tracker.isStale(resume)).toBe(true);
  });

  it("keeps stale connection completions from clearing the active connection", () => {
    const firstPromise = Promise.resolve();
    const secondPromise = Promise.resolve();
    const tracker = new ConnectionWorkTracker();
    const first = tracker.begin();
    first.promise = firstPromise;
    const second = tracker.begin();
    second.promise = secondPromise;

    tracker.finish(first, firstPromise);
    expect(tracker.active()).toBe(second);
    tracker.finish(second, firstPromise);
    expect(tracker.active()).toBe(second);
    tracker.finish(second, secondPromise);
    expect(tracker.active()).toBeNull();
  });

  it("clears restored-thread loading only for the active loading promise", () => {
    const firstLoading = Promise.resolve();
    const secondLoading = Promise.resolve();
    const placeholder = transitionRestoredThreadLifecycle(
      { kind: "idle" },
      { type: "placeholder-restored", restoredThread: { threadId: "thread", title: "Old", explicitName: null } },
    );
    const loading = transitionRestoredThreadLifecycle(placeholder, { type: "loading-started", loading: secondLoading });

    expect(transitionRestoredThreadLifecycle(loading, { type: "loading-finished", loading: firstLoading })).toBe(loading);
    expect(transitionRestoredThreadLifecycle(loading, { type: "renamed", threadId: "thread", name: "New" })).toMatchObject({
      title: "New",
      explicitName: "New",
      loading: secondLoading,
    });
    expect(transitionRestoredThreadLifecycle(loading, { type: "loading-finished", loading: secondLoading })).toMatchObject({
      kind: "placeholder",
      loading: null,
    });
  });
});
