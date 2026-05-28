// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatViewDeferredTasks,
  transitionChatConnectionLifecycle,
  transitionChatResumeLifecycle,
  transitionRestoredThreadLifecycle,
  type ActiveChatConnection,
} from "../../../src/features/chat/view-lifecycle";

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
