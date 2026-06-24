import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { Thread } from "../../../../../src/domain/threads/model";
import { submitComposer } from "../../../../../src/features/chat/application/conversation/composer-submit-actions";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";

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
  const showLatest = vi.fn();
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
    scroll: { showLatest },
  };
  return { host, connectedClient, execute, interruptTurn, sendTurnText, setDraft, showLatest, stateStore };
}

describe("submitComposer", () => {
  it("sends plain drafts as turn text", async () => {
    const { host, connectedClient, sendTurnText, showLatest } = createHost("hello");

    await submitComposer(host);

    expect(showLatest).toHaveBeenCalledOnce();
    expect(connectedClient).not.toHaveBeenCalled();
    expect(sendTurnText).toHaveBeenCalledWith("hello");
    const [showLatestOrder] = showLatest.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (showLatestOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected showLatest and sendTurnText to be called");
    }
    expect(showLatestOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { host, connectedClient, execute, sendTurnText, setDraft, showLatest } = createHost("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(connectedClient).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("clear", "hello");
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("does not execute connection-dependent slash commands when connection fails", async () => {
    const { host, connectedClient, execute, setDraft } = createHost("/clear");
    connectedClient.mockResolvedValue(null);

    await submitComposer(host);

    expect(connectedClient).toHaveBeenCalledOnce();
    expect(setDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes reconnect without a connected client preflight", async () => {
    const { host, connectedClient, execute, setDraft } = createHost("/reconnect");

    await submitComposer(host);

    expect(connectedClient).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("reconnect", "");
  });

  it("executes compact without a connected client preflight", async () => {
    const { host, connectedClient, execute, setDraft } = createHost("/compact");

    await submitComposer(host);

    expect(connectedClient).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("compact", "");
  });

  it("restores slash command composer drafts from command results", async () => {
    const { host, connectedClient, execute, sendTurnText, setDraft, showLatest } = createHost("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(connectedClient).toHaveBeenCalledOnce();
    expect(setDraft).toHaveBeenCalledWith("/goal set Current objective", { focus: true, clearSuggestions: true });
    expect(showLatest).not.toHaveBeenCalled();
    expect(sendTurnText).not.toHaveBeenCalled();
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { host, interruptTurn, showLatest, stateStore } = createHost("");
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({ type: "turn/started", threadId: "thread", turnId: "turn" });

    await submitComposer(host);

    expect(showLatest).not.toHaveBeenCalled();
    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});
