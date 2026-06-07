// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  transitionChatConnectionLifecycle,
  transitionChatResumeLifecycle,
  transitionRestoredThreadLifecycle,
  type ActiveChatConnection,
} from "../../../src/features/chat/panel/lifecycle";

describe("ChatViewDeferredTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("coalesces scheduled renders and preserves forced slot rendering", async () => {
    const tasks = new ChatViewDeferredTasks(() => window);
    const render = vi.fn();

    tasks.scheduleRender(render);
    tasks.scheduleRender(render, { forceSlots: true });

    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith({ forceSlots: true });
  });

  it("clears scheduled deferred work", async () => {
    const tasks = new ChatViewDeferredTasks(() => window);
    const render = vi.fn();
    const diagnostics = vi.fn();
    const hydration = vi.fn();
    const warmup = vi.fn();

    tasks.scheduleRender(render, { forceSlots: true });
    tasks.scheduleDiagnostics(diagnostics);
    tasks.scheduleRestoredThreadHydration(hydration);
    tasks.scheduleAppServerWarmup(warmup);
    tasks.clearAll();

    await vi.advanceTimersByTimeAsync(1_500);

    expect(render).not.toHaveBeenCalled();
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

  it("tracks resume work and calls the invalidation hook", () => {
    const invalidate = vi.fn();
    const tracker = new ChatResumeWorkTracker(invalidate);
    const resume = tracker.begin("thread");

    expect(invalidate).toHaveBeenCalledOnce();
    expect(tracker.isStale(resume)).toBe(false);
    tracker.invalidate();
    expect(invalidate).toHaveBeenCalledTimes(2);
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
