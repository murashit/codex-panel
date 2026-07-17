import { describe, expect, it, vi } from "vitest";

import type { CodexInput } from "../../../../../src/domain/chat/input";
import type { Thread } from "../../../../../src/domain/threads/model";
import { activeThreadState, createChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  executeSlashCommandWithState,
  type SlashCommandExecutorHost,
} from "../../../../../src/features/chat/application/turns/slash-command-executor";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

function thread(id: string, name: string | null = null): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name,
    archived: false,
    provenance: { kind: "interactive" },
  };
}

type SlashCommandExecutorHostOverrides = Partial<SlashCommandExecutorHost>;

function createHost(overrides: SlashCommandExecutorHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const compactThread = vi.fn().mockResolvedValue(undefined);
  const referThread = vi.fn().mockResolvedValue(null);
  const readWebUrl = vi.fn();
  const host: SlashCommandExecutorHost = {
    stateStore,
    connectionAvailable: () => true,
    referThread,
    readWebUrl,
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    threadActions: {
      forkThread: vi.fn().mockResolvedValue(undefined),
      rollbackThread: vi.fn().mockResolvedValue(undefined),
      compactThread,
      archiveThread: vi.fn().mockResolvedValue(undefined),
      renameThread: vi.fn().mockResolvedValue(true),
    },
    reconnect: vi.fn().mockResolvedValue(undefined),
    runtimeSettings: {
      toggleFastMode: vi.fn(),
      toggleCollaborationMode: vi.fn(),
      toggleAutoReview: vi.fn(),
      requestModel: vi.fn(),
      resetModelToConfig: vi.fn(),
      requestPermissionProfile: vi.fn(),
      resetPermissionProfileToConfig: vi.fn(),
      requestReasoningEffort: vi.fn(),
      resetReasoningEffortToConfig: vi.fn(),
    },
    goals: {
      activeGoal: vi.fn(() => activeThreadState(stateStore.getState())?.goal ?? null),
      setObjective: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    statusDetails: () => [],
    permissionDetails: () => [],
    connectionDiagnosticDetails: () => [],
    toolInventoryDetails: vi.fn(() => []),
    modelStatusDetails: () => [],
    effortStatusDetails: () => [],
    ...overrides,
  };
  return { compactThread, host, readWebUrl, referThread, stateStore };
}

describe("executeSlashCommandWithState", () => {
  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();

    const result = await executeSlashCommandWithState(host, "clear", "");

    expect(host.startNewThread).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("routes compact through the shared thread action port before a client is connected", async () => {
    const { compactThread, host, stateStore } = createHost({ connectionAvailable: () => false });
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread", "Thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    await executeSlashCommandWithState(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("starts an empty panel before setting a slash command goal", async () => {
    const { host } = createHost();

    await executeSlashCommandWithState(host, "goal", "set Ship this");

    expect(host.startThreadForGoal).toHaveBeenCalledWith("Ship this");
    expect(host.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
  });

  it("rejects a directly typed goal command in a side chat before it reaches the goal transport", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("side", "Side chat"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await expect(executeSlashCommandWithState(host, "goal", "")).rejects.toThrow("Goals are unavailable in side chats.");
    await expect(executeSlashCommandWithState(host, "goal", "set Ship this")).rejects.toThrow("Goals are unavailable in side chats.");

    expect(host.goals.setObjective).not.toHaveBeenCalled();
  });

  it("allows directly typed goal display in a persistent subagent panel", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: {
        ...thread("child", "Child"),
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: "Scout",
          agentRole: "explorer",
        },
      },
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    stateStore.dispatch({
      type: "active-thread/goal-set",
      goal: {
        threadId: "child",
        objective: "Inspect",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    await expect(executeSlashCommandWithState(host, "goal", "")).resolves.toBeUndefined();

    expect(host.addStructuredSystemMessage).toHaveBeenCalledWith("Thread goal", expect.any(Array));
    expect(host.goals.setObjective).not.toHaveBeenCalled();
  });

  it("keeps directly typed compact available in a side chat", async () => {
    const { compactThread, host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("side", "Side chat"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await executeSlashCommandWithState(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("side");
  });

  it("runs reconnect even when there is no current app-server client", async () => {
    const { host } = createHost({ connectionAvailable: () => false });

    await executeSlashCommandWithState(host, "reconnect", "");

    expect(host.reconnect).toHaveBeenCalledOnce();
  });

  it("does not reference threads without a captured input snapshot", async () => {
    const { host, referThread, stateStore } = createHost();
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("other", "Other")],
    });

    const result = await executeSlashCommandWithState(host, "refer", "Other summarize");

    expect(referThread).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Cannot reference a thread without composer input context.");
    expect(result).toBeUndefined();
  });

  it("forwards readable referenced thread input to turn submission", async () => {
    const { host, referThread, stateStore } = createHost();
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    stateStore.dispatch({
      type: "thread-list/applied",
      threads: [thread("019abcde-0000-7000-8000-000000000001", "Other")],
    });
    referThread.mockResolvedValue({
      text: "prepared summarize",
      input: textInput("referenced summarize"),
      referencedThread: {
        threadId: "019abcde-0000-7000-8000-000000000001",
        title: "Other",
        includedTurns: 1,
        turnLimit: 20,
      },
    });

    const result = await executeSlashCommandWithState(host, "refer", "Other summarize", inputSnapshot);

    expect(referThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "019abcde-0000-7000-8000-000000000001" }),
      "summarize",
      inputSnapshot,
    );
    expect(result?.sendText).toBe("prepared summarize");
    expect(result?.sendInput).toEqual(textInput("referenced summarize"));
    expect(result?.referencedThread?.title).toBe("Other");
  });
});
