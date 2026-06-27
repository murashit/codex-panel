import { describe, expect, it } from "vitest";

import {
  parseRestoredThreadState,
  transitionRestoredThreadLifecycle,
} from "../../../../../src/features/chat/application/threads/restored-thread-lifecycle";

describe("transitionRestoredThreadLifecycle", () => {
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

  it("parses restored thread view state defensively", () => {
    expect(parseRestoredThreadState({ threadId: "thread", threadTitle: "Title" })).toEqual({
      threadId: "thread",
      title: "Title",
      explicitName: null,
    });
    expect(parseRestoredThreadState({ threadId: "" })).toBeNull();
    expect(parseRestoredThreadState(null)).toBeNull();
  });
});
