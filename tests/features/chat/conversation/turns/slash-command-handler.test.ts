import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import type { CodexInput } from "../../../../../src/app-server/protocol/request-input";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/state/reducer";
import {
  createSlashCommandHandler,
  type SlashCommandHandlerHost,
  type SlashCommandGoalPort,
  type SlashCommandRuntimePort,
  type SlashCommandStatusPort,
  type SlashCommandThreadPort,
} from "../../../../../src/features/chat/conversation/turns/slash-command-handler";
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

interface SlashCommandHostOverrides extends Partial<Omit<SlashCommandHandlerHost, "threads" | "runtime" | "goals" | "status">> {
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
    requestModel: vi.fn(),
    resetModelToConfig: vi.fn(),
    requestReasoningEffort: vi.fn(),
    resetReasoningEffortToConfig: vi.fn(),
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
  const host: SlashCommandHandlerHost = {
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

describe("createSlashCommandHandler", () => {
  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();
    const controller = createSlashCommandHandler(host);

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
    const controller = createSlashCommandHandler(host);

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
    const controller = createSlashCommandHandler(host);

    await controller.execute("compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("starts an empty panel before setting a slash command goal", async () => {
    const { host } = createHost();
    const controller = createSlashCommandHandler(host);

    await controller.execute("goal", "set Ship this");

    expect(host.threads.startThreadForGoal).toHaveBeenCalledWith("Ship this");
    expect(host.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
  });

  it("runs reconnect even when there is no current app-server client", async () => {
    const { host } = createHost({ currentClient: () => null });
    const controller = createSlashCommandHandler(host);

    await controller.execute("reconnect", "");

    expect(host.threads.reconnect).toHaveBeenCalledOnce();
  });

  it("reports unreadable referenced threads", async () => {
    const { host, stateStore, threadTurnsList } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("other", "Other")],
    });
    const controller = createSlashCommandHandler(host);

    const result = await controller.execute("refer", "Other summarize");

    expect(threadTurnsList).toHaveBeenCalledWith("other", null, 20);
    expect(result).toBeUndefined();
    expect(host.status.addSystemMessage).toHaveBeenCalledWith("Referenced thread has no readable conversation turns.");
  });
});
