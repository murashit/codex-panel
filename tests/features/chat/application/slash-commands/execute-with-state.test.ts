import { describe, expect, it, vi } from "vitest";
import type { CodexInput } from "../../../../../src/domain/input/input";
import type { Thread } from "../../../../../src/domain/threads/model";
import { createLocalIdSource } from "../../../../../src/features/chat/application/local-id-source";
import {
  executePanelSlashCommand,
  type PanelSlashCommandHost,
} from "../../../../../src/features/chat/application/slash-commands/execute-with-state";
import { createChatState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { submitComposer } from "../../../../../src/features/chat/application/submission/composer-submit-command";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { createThreadActivationFixture } from "../../support/activation";
import { slashGoalsFixture, slashRuntimeSettingsFixture } from "../../support/slash-command-ports";

const textInput = (text: string): CodexInput => [{ type: "text", text }];

function thread(id: string, name: string | null = null): Thread {
  return panelThreadFixture({
    id,
    createdAt: 0,
    updatedAt: 0,
    name,
  });
}

type PanelSlashCommandHostOverrides = Partial<PanelSlashCommandHost>;

function createHost(overrides: PanelSlashCommandHostOverrides = {}) {
  const stateStore = createChatStateStore(createChatState());
  const compactThread = vi.fn().mockResolvedValue(undefined);
  const referThread = vi.fn().mockResolvedValue({ text: "summarize", input: [{ type: "text", text: "summarize" }] });
  const readWebUrl = vi.fn();
  const host: PanelSlashCommandHost = {
    stateStore,
    listedThreads: () => [],
    connectionAvailable: () => true,
    referThread,
    readWebUrl,
    startNewThread: vi.fn().mockResolvedValue(undefined),
    resumeThread: vi.fn().mockResolvedValue(undefined),
    threadCommands: {
      forkThread: vi.fn().mockResolvedValue(undefined),
      rollbackThread: vi.fn().mockResolvedValue(undefined),
      compactThread,
      archiveThread: vi.fn().mockResolvedValue(undefined),
      renameThread: vi.fn().mockResolvedValue(true),
    },
    reconnect: vi.fn().mockResolvedValue(undefined),
    runtimeSettings: slashRuntimeSettingsFixture(),
    goals: slashGoalsFixture(),
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
      const { commands: activation, resumeThread: loadSavedThread } = createThreadActivationFixture({ stateStore });
      const ensureConnected = vi.fn(async () => command === "resume");
      const draft = command === "resume" ? "/resume Other" : `/${command}`;
      await submitComposer({
        stateStore,
        localItemIds: createLocalIdSource(),
        resolveFileReference: () => null,
        ensureRestoredThreadLoaded: () => activation.ensureRestoredThreadLoaded(),
        composer: {
          draft,
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
      expect(ensureConnected).toHaveBeenCalledTimes(command === "resume" ? 1 : 0);
      expect(vi.mocked(host.resumeThread).mock.calls).toEqual(command === "resume" ? [["other"]] : []);
      expect(host.reconnect).toHaveBeenCalledTimes(command === "reconnect" ? 1 : 0);
      expect(host.startNewThread).toHaveBeenCalledTimes(command === "clear" ? 1 : 0);
      const expectedDetails = expect.any(Array);
      const expectedMessages = {
        help: [["Available slash commands", expectedDetails]],
        doctor: [["Connection diagnostics", expectedDetails]],
        reconnect: [],
        clear: [],
        resume: [],
      };
      expect(vi.mocked(host.addStructuredSystemMessage).mock.calls).toEqual(expectedMessages[command]);
    },
  );

  it("executes slash commands against the current chat state", async () => {
    const { host } = createHost();
    const adoptPanelTarget = vi.fn();
    host.startNewThread = vi.fn().mockResolvedValue(undefined);

    const result = await executePanelSlashCommand(host, "clear", "", undefined, {
      isCurrent: () => true,
      adoptPanelTarget,
    });

    expect(adoptPanelTarget).toHaveBeenCalledOnce();
    expect(host.startNewThread).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
  });

  it("routes compact through the shared thread action port before a client is connected", async () => {
    const { compactThread, host, stateStore } = createHost({ connectionAvailable: () => false });
    stateStore.dispatch({
      ...threadActivationFixture(thread("thread", "Thread")),
      type: "active-thread/resumed",
    });

    await executePanelSlashCommand(host, "compact", "");

    expect(compactThread).toHaveBeenCalledWith("thread");
  });

  it("routes an empty panel goal command to the goal workflow", async () => {
    const { host } = createHost();

    await executePanelSlashCommand(host, "goal", "set Ship this");

    expect(host.goals.setObjective).toHaveBeenCalledWith(
      "Ship this",
      null,
      expect.objectContaining({ adoptPanelTarget: expect.any(Function) }),
    );
  });

  it("rejects directly typed goal and side-chat commands in a side chat", async () => {
    const openSideChat = vi.fn();
    const { host, stateStore } = createHost({ openSideChat });
    stateStore.dispatch({
      ...threadActivationFixture(thread("side", "Side chat")),
      type: "active-thread/resumed",
      lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });

    await expect(executePanelSlashCommand(host, "goal", "")).rejects.toThrow("Goals are unavailable in side chats.");
    await expect(executePanelSlashCommand(host, "goal", "set Ship this")).rejects.toThrow("Goals are unavailable in side chats.");
    await expect(executePanelSlashCommand(host, "btw", "")).rejects.toThrow("Side chats cannot be started from another side chat.");

    expect(host.goals.setObjective).not.toHaveBeenCalled();
    expect(openSideChat).not.toHaveBeenCalled();
  });

  it("allows directly typed goal display in a persistent subagent panel", async () => {
    const { host, stateStore } = createHost();
    stateStore.dispatch({
      ...threadActivationFixture({
        ...thread("child", "Child"),
        provenance: {
          kind: "subagent",
          parentThreadId: "parent",
        },
      }),
      type: "active-thread/resumed",
    });
    vi.mocked(host.goals.activeGoal).mockReturnValue({
      threadId: "child",
      objective: "Inspect",
      status: "active",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    });

    await expect(executePanelSlashCommand(host, "goal", "")).resolves.toBeUndefined();

    expect(host.addStructuredSystemMessage).toHaveBeenCalledWith("Thread goal", expect.any(Array));
    expect(host.goals.setObjective).not.toHaveBeenCalled();
  });

  it("keeps directly typed compact available in a side chat", async () => {
    const { compactThread, host, stateStore } = createHost();
    stateStore.dispatch({
      ...threadActivationFixture(thread("side", "Side chat")),
      type: "active-thread/resumed",
      lifetime: { kind: "ephemeral", mode: "side-chat", sourceThreadId: "source", sourceThreadTitle: "Source" },
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
    expect(result).toEqual({ sendInput: { text: "prepared summarize", input: textInput("referenced summarize") } });
  });
});
