import { describe, expect, it, vi } from "vitest";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { CodexInput } from "../../../../../src/domain/turns/input";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import {
  executePanelSlashCommand,
  type PanelSlashCommandHost,
} from "../../../../../src/features/chat/application/slash-commands/execute-with-state";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { submitComposer } from "../../../../../src/features/chat/application/submission/composer-submit-command";
import { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import { deferred } from "../../../../support/async";

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

type PanelSlashCommandHostOverrides = Partial<PanelSlashCommandHost>;

function createHost(overrides: PanelSlashCommandHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const compactThread = vi.fn().mockResolvedValue(undefined);
  const referThread = vi.fn().mockResolvedValue({ text: "summarize", input: [{ type: "text", text: "summarize" }] });
  const readWebUrl = vi.fn();
  const host: PanelSlashCommandHost = {
    stateStore,
    sharedResources: {
      runtimeConfigSnapshot: () => null,
      rateLimitsSnapshot: () => undefined,
      modelsSnapshot: () => null,
    },
    listedThreads: () => [],
    connectionAvailable: () => true,
    referThread,
    readWebUrl,
    startNewThread: vi.fn().mockResolvedValue(undefined),
    startThreadForGoal: vi.fn().mockResolvedValue("thread-new"),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    threadCommands: {
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
      activeGoal: vi.fn(() => null),
      setObjective: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
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

describe("executePanelSlashCommand", () => {
  it.each(["help", "doctor", "reconnect", "clear", "resume"] as const)(
    "executes /%s without first restoring an unavailable saved thread",
    async (command) => {
      const { host, stateStore } = createHost({
        connectionAvailable: () => command === "resume",
        listedThreads: () => [thread("other", "Other")],
      });
      stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "unavailable", fallbackTitle: "Old thread" });
      const restoration = new RestorationController({ stateStore });
      const loadSavedThread = vi.fn(async () => undefined);
      const ensureConnected = vi.fn(async () => command === "resume");
      const draft = command === "resume" ? "/resume Other" : `/${command}`;
      await submitComposer({
        stateStore,
        localItemIds: createLocalIdSource(),
        ensureRestoredThreadLoaded: () => restoration.ensureLoaded(loadSavedThread),
        composer: {
          draft,
          trimmedDraft: draft,
          claimSubmission: () => ({
            text: draft,
            inputSnapshot: {
              sourcePath: "",
              availableSkills: [],
              referenceActiveNoteOnSend: false,
              contextReferences: { activeNote: null, selection: null },
              activeNoteSnapshots: [],
              selectionSnapshots: [],
              attachments: [],
            },
            isCurrent: () => true,
            markAdopted: vi.fn(),
            adoptPanelTarget: vi.fn(),
            settle: vi.fn(),
          }),
          isSubmissionPreparing: () => false,
          failActiveSubmissionClaim: vi.fn(),
        },
        slashCommandExecutor: {
          execute: (name, args, snapshot, submission) => executePanelSlashCommand(host, name, args, snapshot, submission),
        },
        turnSubmissionCommand: { sendTurnText: vi.fn() },
        connection: { ensureConnected },
        turnPort: { interruptTurn: vi.fn() },
        status: { setStatus: vi.fn(), addSystemMessage: host.addSystemMessage },
        scroll: { showLatest: vi.fn() },
      });

      expect(loadSavedThread).not.toHaveBeenCalled();
      if (command === "resume") {
        expect(ensureConnected).toHaveBeenCalledOnce();
        expect(host.resumeThread).toHaveBeenCalledWith("other");
      } else {
        expect(ensureConnected).not.toHaveBeenCalled();
        if (command === "reconnect") expect(host.reconnect).toHaveBeenCalledOnce();
        else if (command === "clear") expect(host.startNewThread).toHaveBeenCalledOnce();
        else
          expect(host.addStructuredSystemMessage).toHaveBeenCalledWith(
            command === "help" ? "Available slash commands" : "Connection diagnostics",
            expect.any(Array),
          );
      }
    },
  );

  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();
    const adoptPanelTarget = vi.fn();
    host.startNewThread = vi.fn().mockResolvedValue(undefined);

    const result = await executePanelSlashCommand(host, "clear", "", undefined, {
      isCurrent: () => true,
      markAdopted: vi.fn(),
      adoptPanelTarget,
    });

    expect(adoptPanelTarget).toHaveBeenCalledOnce();
    expect(host.startNewThread).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("routes compact through the shared thread action port before a client is connected", async () => {
    const { compactThread, host, stateStore } = createHost({ connectionAvailable: () => false });
    stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("thread", "Thread"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });

    await executePanelSlashCommand(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("starts an empty panel before setting a slash command goal", async () => {
    const { host } = createHost();

    await executePanelSlashCommand(host, "goal", "set Ship this");

    expect(host.startThreadForGoal).toHaveBeenCalledWith("Ship this", expect.any(Function));
    expect(host.goals.setObjective).toHaveBeenCalledWith("thread-new", "Ship this", null);
  });

  it("rejects a directly typed goal command in a side chat before it reaches the goal port", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("side", "Side chat"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await expect(executePanelSlashCommand(host, "goal", "")).rejects.toThrow("Goals are unavailable in side chats.");
    await expect(executePanelSlashCommand(host, "goal", "set Ship this")).rejects.toThrow("Goals are unavailable in side chats.");

    expect(host.goals.setObjective).not.toHaveBeenCalled();
  });

  it("allows directly typed goal display in a persistent subagent panel", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
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
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    vi.mocked(host.goals.activeGoal).mockReturnValue({
      threadId: "child",
      objective: "Inspect",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(executePanelSlashCommand(host, "goal", "")).resolves.toBeUndefined();

    expect(host.addStructuredSystemMessage).toHaveBeenCalledWith("Thread goal", expect.any(Array));
    expect(host.goals.setObjective).not.toHaveBeenCalled();
  });

  it("keeps directly typed compact available in a side chat", async () => {
    const { compactThread, host, stateStore } = createHost();
    stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: thread("side", "Side chat"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await executePanelSlashCommand(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("side");
  });

  it("does not publish async slash output after its initiating target becomes stale", async () => {
    const details = deferred<[]>();
    const toolInventoryDetails = vi.fn(() => details.promise);
    const { host } = createHost({ toolInventoryDetails });
    let current = true;

    const executing = executePanelSlashCommand(host, "tools", "", undefined, {
      isCurrent: () => current,
      markAdopted: vi.fn(),
      adoptPanelTarget: vi.fn(),
    });
    await vi.waitFor(() => expect(toolInventoryDetails).toHaveBeenCalledOnce());
    current = false;
    details.resolve([]);
    await executing;

    expect(host.addStructuredSystemMessage).not.toHaveBeenCalled();
  });

  it("forwards readable referenced thread input to turn submission", async () => {
    const { host, referThread } = createHost({
      listedThreads: () => [thread("019abcde-0000-7000-8000-000000000001", "Other")],
    });
    const inputSnapshot = { sourcePath: "snapshot.md" } as never;
    referThread.mockResolvedValue({
      text: "prepared summarize",
      input: textInput("referenced summarize"),
    });

    const result = await executePanelSlashCommand(host, "refer", "Other summarize", inputSnapshot);

    expect(referThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: "019abcde-0000-7000-8000-000000000001" }),
      "summarize",
      inputSnapshot,
    );
    expect(result?.sendText).toBe("prepared summarize");
    expect(result?.sendInput).toEqual(textInput("referenced summarize"));
  });
});
