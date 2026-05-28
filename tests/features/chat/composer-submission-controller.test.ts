import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import { ComposerSubmissionController } from "../../../src/features/chat/composer-submission-controller";
import type { ChatComposerController } from "../../../src/features/chat/chat-composer-controller";
import type { SlashCommandController } from "../../../src/features/chat/slash-command-controller";
import type { TurnSubmissionController } from "../../../src/features/chat/turn-submission-controller";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";

function thread(id: string): Thread {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
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
  const controller = new ComposerSubmissionController({
    stateStore,
    composer: {
      get trimmedDraft() {
        return draft;
      },
      setDraft,
    } as unknown as ChatComposerController,
    slashCommands: { execute } as unknown as SlashCommandController,
    turnSubmission: { sendTurnText } as unknown as TurnSubmissionController,
    currentClient: () => client,
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
  });
  return { controller, execute, interruptTurn, sendTurnText, setDraft, stateStore };
}

describe("ComposerSubmissionController", () => {
  it("sends plain drafts as turn text", async () => {
    const { controller, sendTurnText } = createController("hello");

    await controller.submit();

    expect(sendTurnText).toHaveBeenCalledWith("hello");
  });

  it("executes slash commands and forwards command send results", async () => {
    const { controller, execute, sendTurnText, setDraft } = createController("/new hello");
    execute.mockResolvedValue({ sendText: "hello" });

    await controller.submit();

    expect(setDraft).toHaveBeenCalledWith("", { clearSuggestions: true });
    expect(execute).toHaveBeenCalledWith("new", "hello");
    expect(sendTurnText).toHaveBeenCalledWith("hello", undefined, undefined);
  });

  it("interrupts a running turn when submitting an empty draft", async () => {
    const { controller, interruptTurn, stateStore } = createController("");
    stateStore.dispatch({
      type: "thread/resumed",
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

    expect(interruptTurn).toHaveBeenCalledWith("thread", "turn");
  });
});
