import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/chat-state";
import { createComposerSubmissionActions } from "../../../../src/features/chat/turns/composer-submission-actions";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";

function thread(id: string): Thread & { archived: boolean } {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "test",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    archived: false,
    turns: [],
  };
}

function createController(draft: string) {
  const stateStore = createChatStateStore(createChatState());
  const interruptTurn = vi.fn().mockResolvedValue({});
  const client = { interruptTurn } as unknown as AppServerClient;
  const setDraft = vi.fn();
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const execute = vi.fn().mockResolvedValue(undefined);
  const forceBottom = vi.fn();
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
    scroll: { forceBottom },
  });
  return { controller, execute, forceBottom, interruptTurn, sendTurnText, setDraft, stateStore };
}

describe("createComposerSubmissionActions", () => {
  it("sends plain drafts as turn text", async () => {
    const { controller, forceBottom, sendTurnText } = createController("hello");

    await controller.submit();

    expect(forceBottom).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello");
    const [forceBottomOrder] = forceBottom.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (forceBottomOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected forceBottom and sendTurnText to be called");
    }
    expect(forceBottomOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { controller, execute, forceBottom, sendTurnText, setDraft } = createController("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await controller.submit();

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("clear", "hello");
    expect(forceBottom).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("restores slash command composer drafts from command results", async () => {
    const { controller, execute, forceBottom, sendTurnText, setDraft } = createController("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await controller.submit();

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(setDraft).toHaveBeenCalledWith("/goal set Current objective", { focus: true, clearSuggestions: true });
    expect(forceBottom).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { controller, forceBottom, interruptTurn, stateStore } = createController("");
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

    expect(forceBottom).not.toHaveBeenCalled();
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});
