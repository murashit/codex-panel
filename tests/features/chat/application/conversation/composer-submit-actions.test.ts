import { describe, expect, it, vi } from "vitest";

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
  const setDraft = vi.fn();
  const sendTurnText = vi.fn().mockResolvedValue(undefined);
  const execute = vi.fn().mockResolvedValue(undefined);
  const showLatest = vi.fn();
  const ensureConnected = vi.fn().mockResolvedValue(true);
  const host = {
    stateStore,
    composer: {
      get trimmedDraft() {
        return draft;
      },
      setDraft,
      withPreservedContextReferences: <T>(operation: () => Promise<T>) => operation(),
    },
    slashCommandExecutor: { execute },
    turnSubmission: { sendTurnText },
    connection: {
      ensureConnected,
    },
    turnTransport: { interruptTurn },
    status: {
      setStatus: vi.fn(),
      addSystemMessage: vi.fn(),
    },
    scroll: { showLatest },
  };
  return { host, ensureConnected, execute, interruptTurn, sendTurnText, setDraft, showLatest, stateStore };
}

describe("submitComposer", () => {
  it("sends plain drafts as turn text", async () => {
    const { host, ensureConnected, sendTurnText, showLatest } = createHost("hello");

    await submitComposer(host);

    expect(showLatest).toHaveBeenCalledOnce();
    expect(ensureConnected).not.toHaveBeenCalled();
    expect(sendTurnText).toHaveBeenCalledWith("hello");
    const [showLatestOrder] = showLatest.mock.invocationCallOrder;
    const [sendTurnTextOrder] = sendTurnText.mock.invocationCallOrder;
    if (showLatestOrder === undefined || sendTurnTextOrder === undefined) {
      throw new Error("Expected showLatest and sendTurnText to be called");
    }
    expect(showLatestOrder).toBeLessThan(sendTurnTextOrder);
  });

  it("executes slash commands and forwards command send results", async () => {
    const { host, ensureConnected, execute, sendTurnText, setDraft, showLatest } = createHost("/clear hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("clear", "hello");
    expect(showLatest).toHaveBeenCalledOnce();
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("preserves composer context references until slash command send results are submitted", async () => {
    const { host, execute, sendTurnText } = createHost("/refer Other [[Note]] (L1:C1-L1:C2)");
    let preserving = false;
    host.composer.withPreservedContextReferences = async (operation) => {
      preserving = true;
      try {
        return await operation();
      } finally {
        preserving = false;
      }
    };
    execute.mockImplementation(async () => {
      expect(preserving).toBe(true);
      return { sendText: "[[Note]] (L1:C1-L1:C2)", sendInput: [{ type: "text", text: "referenced input" }] };
    });
    sendTurnText.mockImplementation(async () => {
      expect(preserving).toBe(true);
    });

    await submitComposer(host);

    expect(preserving).toBe(false);
    expect(sendTurnText).toHaveBeenCalledWith("[[Note]] (L1:C1-L1:C2)", [{ type: "text", text: "referenced input" }], undefined);
  });

  it("does not execute connection-dependent slash commands when connection fails", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/clear");
    ensureConnected.mockResolvedValue(false);

    await submitComposer(host);

    expect(ensureConnected).toHaveBeenCalledOnce();
    expect(setDraft).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes reconnect without a connected client preflight", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/reconnect");

    await submitComposer(host);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("reconnect", "");
  });

  it("executes compact without a connected client preflight", async () => {
    const { host, ensureConnected, execute, setDraft } = createHost("/compact");

    await submitComposer(host);

    expect(ensureConnected).not.toHaveBeenCalled();
    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("compact", "");
  });

  it("restores slash command composer drafts from command results", async () => {
    const { host, ensureConnected, execute, sendTurnText, setDraft, showLatest } = createHost("/goal edit");
    execute.mockResolvedValue({ composerDraft: "/goal set Current objective" });

    await submitComposer(host);

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(ensureConnected).toHaveBeenCalledOnce();
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
