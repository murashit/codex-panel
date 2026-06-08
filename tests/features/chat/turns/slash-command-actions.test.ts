import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/chat-state";
import {
  createSlashCommandActions,
  type SlashCommandActionsHost,
  type SlashCommandGoalPort,
  type SlashCommandRuntimePort,
  type SlashCommandStatusPort,
  type SlashCommandThreadPort,
} from "../../../../src/features/chat/turns/slash-command-actions";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";
import type { UserInput } from "../../../../src/generated/app-server/v2/UserInput";

const textInput = (text: string): UserInput[] => [{ type: "text", text, text_elements: [] }];

function thread(id: string, name: string | null = null): Thread {
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
    name,
    turns: [],
  };
}

interface SlashCommandHostOverrides extends Partial<Omit<SlashCommandActionsHost, "threads" | "runtime" | "goals" | "status">> {
  threads?: Partial<SlashCommandThreadPort>;
  runtime?: Partial<SlashCommandRuntimePort>;
  goals?: Partial<SlashCommandGoalPort>;
  status?: Partial<SlashCommandStatusPort>;
}

function createHost(overrides: SlashCommandHostOverrides = {}) {
  const {
    threads: threadOverrides,
    runtime: runtimeOverrides,
    goals: goalOverrides,
    status: statusOverrides,
    ...hostOverrides
  } = overrides;
  const stateStore = createChatStateStore(createChatState());
  const threadTurnsList = vi.fn().mockResolvedValue({ data: [] });
  const client = { threadTurnsList } as unknown as AppServerClient;
  const compactThread = vi.fn().mockResolvedValue(undefined);
  const threads: SlashCommandThreadPort = {
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    compactThread,
    archiveThread: vi.fn().mockResolvedValue(undefined),
    renameThread: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    ...threadOverrides,
  };
  const runtime: SlashCommandRuntimePort = {
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    toggleAutoReview: vi.fn(),
    setRequestedModel: vi.fn(),
    setRequestedReasoningEffort: vi.fn(),
    ...runtimeOverrides,
  };
  const status: SlashCommandStatusPort = {
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    statusSummaryLines: () => [],
    connectionDiagnosticDetails: () => [],
    mcpStatusLines: vi.fn().mockResolvedValue([]),
    modelStatusLines: () => [],
    effortStatusLines: () => [],
    ...statusOverrides,
  };
  const goals: SlashCommandGoalPort = {
    activeGoal: vi.fn(() => stateStore.getState().activeThread.goal),
    setObjective: vi.fn().mockResolvedValue(true),
    setStatus: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(true),
    ...goalOverrides,
  };
  const host: SlashCommandActionsHost = {
    stateStore,
    currentClient: () => client,
    codexInput: vi.fn((text: string) => textInput(text)),
    threads,
    runtime,
    goals,
    status,
    ...hostOverrides,
  };
  return { compactThread, host, stateStore, threadTurnsList };
}

describe("createSlashCommandActions", () => {
  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();
    const controller = createSlashCommandActions(host);

    const result = await controller.execute("clear", "");

    expect(host.threads.startNewThread).toHaveBeenCalledOnce();
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
    const controller = createSlashCommandActions(host);

    await controller.execute("compact", "");

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
    const controller = createSlashCommandActions(host);

    await controller.execute("compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("starts an empty panel before setting a slash command goal", async () => {
    const { host } = createHost();
    const controller = createSlashCommandActions(host);

    await controller.execute("goal", "set Ship this");

    expect(host.threads.startThreadForGoal).toHaveBeenCalledWith("Ship this");
    expect(host.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
  });

  it("runs reconnect even when there is no current app-server client", async () => {
    const { host } = createHost({ currentClient: () => null });
    const controller = createSlashCommandActions(host);

    await controller.execute("reconnect", "");

    expect(host.threads.reconnect).toHaveBeenCalledOnce();
  });

  it("reports unreadable referenced threads", async () => {
    const { host, stateStore, threadTurnsList } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("other", "Other")],
    });
    const controller = createSlashCommandActions(host);

    const result = await controller.execute("refer", "Other summarize");

    expect(threadTurnsList).toHaveBeenCalledWith("other", null, 20);
    expect(result).toBeUndefined();
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("Referenced thread has no readable conversation turns.");
  });
});
