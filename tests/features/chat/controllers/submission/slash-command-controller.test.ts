import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/client";
import { createChatState, createChatStateStore } from "../../../../../src/features/chat/chat-state";
import {
  SlashCommandController,
  type SlashCommandControllerHost,
} from "../../../../../src/features/chat/controllers/submission/slash-command-controller";
import { createSubmissionStatePort } from "../../../../../src/features/chat/controllers/state-ports";
import type { Thread } from "../../../../../src/generated/app-server/v2/Thread";
import type { UserInput } from "../../../../../src/generated/app-server/v2/UserInput";

const textInput = (text: string): UserInput[] => [{ type: "text", text, text_elements: [] }];

function thread(id: string, name: string | null = null): Thread {
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
    name,
    turns: [],
  };
}

function createHost(overrides: Partial<SlashCommandControllerHost> = {}) {
  const stateStore = createChatStateStore(createChatState());
  const compactThread = vi.fn().mockResolvedValue({});
  const threadTurnsList = vi.fn().mockResolvedValue({ data: [] });
  const client = { compactThread, threadTurnsList } as unknown as AppServerClient;
  const host: SlashCommandControllerHost = {
    state: createSubmissionStatePort(stateStore),
    currentClient: () => client,
    codexInput: vi.fn((text: string) => textInput(text)),
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    forkThread: vi.fn().mockResolvedValue(undefined),
    rollbackThread: vi.fn().mockResolvedValue(undefined),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    toggleFastMode: vi.fn(),
    toggleCollaborationMode: vi.fn(),
    toggleAutoReview: vi.fn(),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    setRequestedModel: vi.fn(),
    setRequestedReasoningEffort: vi.fn(),
    statusSummaryLines: () => [],
    connectionDiagnosticDetails: () => [],
    mcpStatusLines: vi.fn().mockResolvedValue([]),
    modelStatusLines: () => [],
    effortStatusLines: () => [],
    ...overrides,
  };
  return { compactThread, host, stateStore, threadTurnsList };
}

describe("SlashCommandController", () => {
  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();
    const controller = new SlashCommandController(host);

    const result = await controller.execute("new", "hello");

    expect(host.startNewThread).toHaveBeenCalledOnce();
    expect(result).toEqual({ sendText: "hello" });
  });

  it("uses the current client for app-server commands", async () => {
    const { compactThread, host, stateStore } = createHost();
    stateStore.dispatch({
      type: "thread/list-applied",
      threads: [thread("thread", "Thread")],
    });
    stateStore.dispatch({
      type: "thread/resumed",
      thread: thread("thread", "Thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    const controller = new SlashCommandController(host);

    await controller.execute("compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports unreadable referenced threads", async () => {
    const { host, stateStore, threadTurnsList } = createHost();
    stateStore.dispatch({
      type: "thread/list-applied",
      threads: [thread("other", "Other")],
    });
    const controller = new SlashCommandController(host);

    const result = await controller.execute("refer", "Other summarize");

    expect(threadTurnsList).toHaveBeenCalledWith("other", null, 20);
    expect(result).toBeUndefined();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Referenced thread has no readable conversation turns.");
  });
});
