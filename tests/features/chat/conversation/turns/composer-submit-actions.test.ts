import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { submitComposer } from "../../../../../src/features/chat/application/conversation/composer-submit-actions";
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

function createHost(draft: string) {
  const stateStore = createChatStateStore(createChatState());
  const interruptTurn = vi.fn().mockResolvedValue({});
  const client = { interruptTurn } as unknown as AppServerClient;
  const setDraft = vi.fn();
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const execute = vi.fn().mockResolvedValue(undefined);
  const followBottom = vi.fn();
  const connectedClient = vi.fn().mockResolvedValue(client);
  const host = {
    stateStore,
    composer: {
      get trimmedDraft() {
        return draft;
      },
      setDraft,
    },
    slashCommandExecutor: { execute },
    turnSubmission: { sendTurnText },
    connection: {
      connectedClient,
      currentClient: () => client,
    },
    status: {
      setStatus: vi.fn(),
      addSystemMessage: vi.fn(),
    },
    scroll: { followBottom },
  };
  return { host, connectedClient, execute, followBottom, interruptTurn, sendTurnText, setDraft, stateStore };
}

describe("submitComposer", () => {
  it("sends plain drafts as turn text", async () => {
    const { host, connectedClient, followBottom, sendTurnText } = createHost("hello");

    await submitComposer(host);

    expect(followBottom).toHaveBeenCalledOnce();
    expect(connectedClient).not.toHaveBeenCalled();
    expect(sendTurnText).toHaveBeenCalledWith("hello");
    const [followBottomOrder] = followBottom.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (followBottomOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected followBottom and sendTurnText to be called");
    }
    expect(followBottomOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { host, connectedClient, execute, followBottom, sendTurnText, setDraft } = createHost("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(connectedClient).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("clear", "hello");
    expect(followBottom).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("restores slash command composer drafts from command results", async () => {
    const { host, connectedClient, execute, followBottom, sendTurnText, setDraft } = createHost("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(connectedClient).toHaveBeenCalledOnce();
    expect(setDraft).toHaveBeenCalledWith("/goal set Current objective", { focus: true, clearSuggestions: true });
    expect(followBottom).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { host, followBottom, interruptTurn, stateStore } = createHost("");
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

    await submitComposer(host);

    expect(followBottom).not.toHaveBeenCalled();
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});
