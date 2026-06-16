import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { CodexInput } from "../../../../../src/domain/chat/input";
import type { TurnItem, TurnRecord } from "../../../../../src/app-server/protocol/turn";
import { createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  executeSlashCommandWithState,
  type SlashCommandHandlerHost,
} from "../../../../../src/features/chat/application/conversation/slash-command-handler";
import type { Thread } from "../../../../../src/domain/threads/model";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

function thread(id: string, name: string | null = null): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name,
    archived: false,
  };
}

type SlashCommandHostOverrides = Partial<SlashCommandHandlerHost>;

function createHost(overrides: SlashCommandHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const threadTurnsList = vi.fn().mockResolvedValue({ data: [] });
  const client = { threadTurnsList } as unknown as AppServerClient;
  const compactThread = vi.fn().mockResolvedValue(undefined);
  const host: SlashCommandHandlerHost = {
    stateStore,
    currentClient: () => client,
    codexInput: vi.fn((text: string) => textInput(text)),
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    compactThread,
    archiveThread: vi.fn().mockResolvedValue(undefined),
    renameThread: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    toggleAutoReview: vi.fn(),
    requestModel: vi.fn(),
    resetModelToConfig: vi.fn(),
    requestReasoningEffort: vi.fn(),
    resetReasoningEffortToConfig: vi.fn(),
    activeGoal: vi.fn(() => stateStore.getState().activeThread.goal),
    setGoalObjective: vi.fn().mockResolvedValue(true),
    setGoalStatus: vi.fn().mockResolvedValue(true),
    clearGoal: vi.fn().mockResolvedValue(true),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    statusSummaryLines: () => [],
    connectionDiagnosticDetails: () => [],
    mcpStatusLines: vi.fn().mockResolvedValue([]),
    modelStatusLines: () => [],
    effortStatusLines: () => [],
    ...overrides,
  };
  return { compactThread, host, stateStore, threadTurnsList };
}

describe("executeSlashCommandWithState", () => {
  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();

    const result = await executeSlashCommandWithState(host, "clear", "");

    expect(host.startNewThread).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("routes compact through the shared thread action port", async () => {
    const { compactThread, host, stateStore } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("thread", "Thread")],
    });
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread", "Thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    await executeSlashCommandWithState(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("routes compact through the shared thread action port before a client is connected", async () => {
    const { compactThread, host, stateStore } = createHost({ currentClient: () => null });
    stateStore.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread", "Thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    await executeSlashCommandWithState(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("starts an empty panel before setting a slash command goal", async () => {
    const { host } = createHost();

    await executeSlashCommandWithState(host, "goal", "set Ship this");

    expect(host.startThreadForGoal).toHaveBeenCalledWith("Ship this");
    expect(host.setGoalObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
  });

  it("runs reconnect even when there is no current app-server client", async () => {
    const { host } = createHost({ currentClient: () => null });

    await executeSlashCommandWithState(host, "reconnect", "");

    expect(host.reconnect).toHaveBeenCalledOnce();
  });

  it("reports unreadable referenced threads", async () => {
    const { host, stateStore, threadTurnsList } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("other", "Other")],
    });

    const result = await executeSlashCommandWithState(host, "refer", "Other summarize");

    expect(threadTurnsList).toHaveBeenCalledWith("other", null, 20);
    expect(result).toBeUndefined();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Referenced thread has no readable conversation turns.");
  });

  it("sets chat-owned status copy for readable referenced threads", async () => {
    const { host, stateStore, threadTurnsList } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("019abcde-0000-7000-8000-000000000001", "Other")],
    });
    threadTurnsList.mockResolvedValue({
      data: [turn([userMessage("u1", "元の依頼"), agentMessage("a1", "回答")])],
      nextCursor: null,
    });

    const result = await executeSlashCommandWithState(host, "refer", "Other summarize");

    expect(result?.sendText).toBe("summarize");
    expect(host.setStatus).toHaveBeenCalledWith("Referencing 019abcde (1/20 turns).");
  });
});

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...overrides,
  };
}

function userMessage(id: string, text: string): TurnItem {
  return { type: "userMessage", id, clientId: null, content: [{ type: "text", text, text_elements: [] }] };
}

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}
