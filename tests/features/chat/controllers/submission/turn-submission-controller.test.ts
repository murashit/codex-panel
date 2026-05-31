import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import {
  TurnSubmissionController,
  type TurnSubmissionControllerHost,
} from "../../../../../src/features/chat/controllers/submission/turn-submission-controller";
import { createSubmissionStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";
import type { UserInput } from "../../../../../src/generated/app-server/v2/UserInput";

const textInput = (text: string): UserInput[] => [{ type: "text", text, text_elements: [] }];

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

function createHost(overrides: Partial<TurnSubmissionControllerHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const startTurn = vi.fn().mockResolvedValue({ turn: { id: "turn" } });
  const steerTurn = vi.fn().mockResolvedValue({});
  const client = {
    startTurn,
    steerTurn,
  } as unknown as AppServerClient;
  const host: TurnSubmissionControllerHost = {
    state: createSubmissionStatePort(stateStore),
    vaultPath: "/vault",
    currentClient: () => client,
    ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
    startThread: vi.fn().mockImplementation(async () => {
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
      return {};
    }),
    notifyActiveThreadIdentityChanged: vi.fn(),
    resetThreadTurnPresence: vi.fn(),
    applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
    codexInput: vi.fn((text: string) => textInput(text)),
    setDraft: vi.fn(),
    forceMessagesToBottom: vi.fn(),
    render: vi.fn(),
    scheduleRender: vi.fn(),
    setStatus: vi.fn(),
    addSystemMessage: vi.fn(),
    ...overrides,
  };
  return { host, startTurn, stateStore, steerTurn };
}

describe("TurnSubmissionController", () => {
  it("starts a thread when needed and acknowledges the optimistic turn", async () => {
    const { host, startTurn, stateStore } = createHost();
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("hello");

    expect(host.startThread).toHaveBeenCalledWith("hello");
    expect(host.notifyActiveThreadIdentityChanged).toHaveBeenCalledOnce();
    expect(host.resetThreadTurnPresence).toHaveBeenCalledWith(false);
    expect(startTurn).toHaveBeenCalledWith("thread", "/vault", textInput("hello"));
    expect(stateStore.getState().turnLifecycle).toEqual({ kind: "running", turnId: "turn" });
    expect(host.setDraft).toHaveBeenCalledWith("");
    expect(host.setStatus).toHaveBeenCalledWith("Turn running...");
    expect(host.scheduleRender).toHaveBeenCalledOnce();
  });

  it("steers a running turn instead of starting another turn", async () => {
    const { host, startTurn, stateStore, steerTurn } = createHost();
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
    const controller = new TurnSubmissionController(host);

    await controller.sendTurnText("follow up");

    expect(steerTurn).toHaveBeenCalledWith("thread", "turn", textInput("follow up"));
    expect(startTurn).not.toHaveBeenCalled();
    expect(host.setStatus).toHaveBeenCalledWith("Steered current turn.");
    expect(stateStore.getState().displayItems.some((item) => item.kind === "message" && item.text === "follow up")).toBe(true);
  });
});
