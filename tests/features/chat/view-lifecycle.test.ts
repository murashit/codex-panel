// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  transitionChatConnectionLifecycle,
  transitionChatResumeLifecycle,
  transitionRestoredThreadLifecycle,
  type ActiveChatConnection,
} from "../../../src/features/chat/application/lifecycle";
import { createChatViewDeferredTasks } from "../../../src/features/chat/host/lifecycle";

describe("createChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("clears scheduled deferred work", async () => {
    const tasks = createChatViewDeferredTasks(() => window);
    const diagnostics = vi.fn();
    const hydration = vi.fn();
    const warmup = vi.fn();

    tasks.scheduleDiagnostics(diagnostics);
    tasks.scheduleRestoredThreadHydration(hydration);
    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(diagnostics).not.toHaveBeenCalled();
    expect(hydration).not.toHaveBeenCalled();
    expect(warmup).not.toHaveBeenCalled();
  });
});

describe("chat view lifecycle transitions", () => {
  it("tracks active connection work by identity", () => {
    const tracker = new ChatConnectionWorkTracker();
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
    const first: ActiveChatConnection = { kind: "connecting", promise: firstPromise };
    const second: ActiveChatConnection = { kind: "connecting", promise: secondPromise };
    const state = transitionChatConnectionLifecycle({ kind: "idle" }, { type: "started", connection: second });

    expect(transitionChatConnectionLifecycle(state, { type: "finished", connection: first, promise: firstPromise })).toBe(state);
    expect(transitionChatConnectionLifecycle(state, { type: "finished", connection: second, promise: firstPromise })).toBe(state);
    expect(transitionChatConnectionLifecycle(state, { type: "finished", connection: second, promise: secondPromise })).toEqual({
      kind: "idle",
    });
  });

  it("invalidates resume work explicitly", () => {
    const resume = { kind: "resuming" as const, threadId: "thread" };

    expect(transitionChatResumeLifecycle({ kind: "idle" }, { type: "started", resume })).toBe(resume);
    expect(transitionChatResumeLifecycle(resume, { type: "invalidated" })).toEqual({ kind: "idle" });
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
