import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";

import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createAutoTitleCoordinator } from "../../../../../src/features/chat/application/threads/auto-title-coordinator";

describe("AutoTitleCoordinator", () => {
  it("captures visible first-turn context and hands it to shared title work", () => {
    const stateStore = listedThreadState();
    const submitTitleWork = vi.fn();
    const coordinator = createAutoTitleCoordinator({
      stateStore,
      completedTurnTitleContext: () => ({
        userRequest: "Visible streamed request.",
        assistantResponse: "Visible streamed response.",
      }),
      submitTitleWork,
      threadById: catalogThreadById(),
    });

    coordinator.maybeAutoTitleThread("thread", "turn", {
      userText: "Completed payload request.",
      assistantText: "Completed payload response.",
    });

    expect(submitTitleWork).toHaveBeenCalledWith("thread", {
      userRequest: "Visible streamed request.",
      assistantResponse: "Visible streamed response.",
    });
  });

  it("does not submit a title when the thread already has one", () => {
    const stateStore = listedThreadState("Manual title");
    const submitTitleWork = vi.fn();
    const coordinator = createAutoTitleCoordinator({
      stateStore,
      completedTurnTitleContext: vi.fn(() => ({
        userRequest: "Request",
        assistantResponse: "Response",
      })),
      submitTitleWork,
      threadById: catalogThreadById("Manual title"),
    });

    coordinator.maybeAutoTitleThread("thread", "turn", { userText: "Request", assistantText: "Response" });

    expect(submitTitleWork).not.toHaveBeenCalled();
  });

  it("submits only the first completed turn for the active thread", () => {
    const stateStore = listedThreadState();
    const submitTitleWork = vi.fn();
    const coordinator = createAutoTitleCoordinator({
      stateStore,
      completedTurnTitleContext: (_turnId, summary) =>
        summary?.userText && summary.assistantText ? { userRequest: summary.userText, assistantResponse: summary.assistantText } : null,
      submitTitleWork,
      threadById: catalogThreadById(),
    });

    coordinator.maybeAutoTitleThread("thread", "turn-1", { userText: "First", assistantText: "Done" });
    coordinator.maybeAutoTitleThread("thread", "turn-2", { userText: "Second", assistantText: "Done again" });

    expect(submitTitleWork).toHaveBeenCalledOnce();
  });

  it("tracks first-turn presence independently after switching active threads", () => {
    const stateStore = listedThreadState();
    const submitTitleWork = vi.fn();
    const coordinator = createAutoTitleCoordinator({
      stateStore,
      completedTurnTitleContext: (_turnId, summary) =>
        summary?.userText && summary.assistantText ? { userRequest: summary.userText, assistantResponse: summary.assistantText } : null,
      submitTitleWork,
      threadById: catalogThreadById(),
    });

    coordinator.maybeAutoTitleThread("thread", "turn-a", { userText: "Thread A", assistantText: "Done" });
    coordinator.resetThreadTurnPresence(false);
    coordinator.maybeAutoTitleThread("thread-b", "turn-b", { userText: "Thread B", assistantText: "Done" });

    expect(submitTitleWork).toHaveBeenNthCalledWith(1, "thread", {
      userRequest: "Thread A",
      assistantResponse: "Done",
    });
    expect(submitTitleWork).toHaveBeenNthCalledWith(2, "thread-b", {
      userRequest: "Thread B",
      assistantResponse: "Done",
    });
  });
});

function listedThreadState(_name: string | null = null) {
  return createChatStateStore();
}

function catalogThreadById(name: string | null = null) {
  const threads: Thread[] = [
    {
      id: "thread",
      preview: "Thread preview",
      name,
      archived: false,
      provenance: { kind: "interactive" },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "thread-b",
      preview: "Another thread",
      name: null,
      archived: false,
      provenance: { kind: "interactive" },
      createdAt: 2,
      updatedAt: 2,
    },
  ];
  return (threadId: string) => threads.find((thread) => thread.id === threadId);
}
