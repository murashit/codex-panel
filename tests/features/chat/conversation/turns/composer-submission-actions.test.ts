import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/state/reducer";
import { createComposerSubmissionActions } from "../../../../../src/features/chat/conversation/turns/composer-submission-actions";
import type { Thread } from "../../../../../src/domain/threads/model";

function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
  };
}

function createController(draft: string) {
  const stateStore = createChatStateStore(createChatState());
  const interruptTurn = vi.fn().mockResolvedValue({});
  const client = { interruptTurn } as unknown as AppServerClient;
  const setDraft = vi.fn();
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const execute = vi.fn().mockResolvedValue(undefined);
  const followBottom = vi.fn();
  const controller = createComposerSubmissionActions({
    stateStore,
    composer: {
      get trimmedDraft() {
        return draft;
      },
      setDraft,
    },
    slashCommands: { execute },
    turnSubmission: { sendTurnText },
    connection: {
      currentClient: () => client,
      ensureConnected: vi.fn().mockResolvedValue(undefined),
    },
    status: {
      setStatus: vi.fn(),
      addSystemMessage: vi.fn(),
    },
    scroll: { followBottom },
  });
  return { controller, execute, followBottom, interruptTurn, sendTurnText, setDraft, stateStore };
}

describe("createComposerSubmissionActions", () => {
  it("sends plain drafts as turn text", async () => {
    const { controller, followBottom, sendTurnText } = createController("hello");

    await controller.submit();

    expect(followBottom).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello");
    const [followBottomOrder] = followBottom.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (followBottomOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected followBottom and sendTurnText to be called");
    }
    expect(followBottomOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { controller, execute, followBottom, sendTurnText, setDraft } = createController("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await controller.submit();

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("clear", "hello");
    expect(followBottom).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("restores slash command composer drafts from command results", async () => {
    const { controller, execute, followBottom, sendTurnText, setDraft } = createController("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await controller.submit();

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(setDraft).toHaveBeenCalledWith("/goal set Current objective", { focus: true, clearSuggestions: true });
    expect(followBottom).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { controller, followBottom, interruptTurn, stateStore } = createController("");
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    await controller.submit();

    expect(followBottom).not.toHaveBeenCalled();
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});
