import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { Thread, ThreadActivationSnapshot } from "../../../../../src/domain/threads/model";
import type { EffectOutcome } from "../../../../../src/features/chat/application/effect-outcome";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { activeThreadId } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createThreadCommands,
  type ThreadCommandEffects,
  type ThreadCommands,
  type ThreadCommandsHost,
} from "../../../../../src/features/chat/application/threads/thread-commands";
import { createThreadStartCommand } from "../../../../../src/features/chat/application/threads/thread-start-command";
import { resolveRuntimeControls } from "../../../../../src/features/chat/domain/runtime/resolution";
import { pendingRuntimeSettingsPatch } from "../../../../../src/features/chat/domain/runtime/thread-settings-patch";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { deferred, waitForAsyncWork } from "../../../../support/async";
import { runtimeConfigFixture } from "../../domain/runtime/support";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateStableThreadStreamItems } from "../../support/thread-stream";

type ThreadCommandEffectsMock = { compactThread: Mock<ThreadCommandEffects["compactThread"]> };
type ThreadMutationCommandsMock = { [Key in keyof ThreadCommandsHost["mutations"]]: Mock<ThreadCommandsHost["mutations"][Key]> };
type ThreadCommandsHostMock = Omit<
  ThreadCommandsHost,
  "mutations" | "effects" | "ensureConnected" | "addSystemMessage" | "setStatus" | "openForkDraft"
> & {
  mutations: ThreadMutationCommandsMock;
  effects: ThreadCommandEffectsMock;
  ensureConnected: Mock<ThreadCommandsHost["ensureConnected"]>;
  addSystemMessage: Mock<ThreadCommandsHost["addSystemMessage"]>;
  setStatus: Mock<ThreadCommandsHost["setStatus"]>;
  openForkDraft: Mock<ThreadCommandsHost["openForkDraft"]>;
};

describe("thread management commands", () => {
  it("allows direct compaction of an active side chat", async () => {
    const host = hostMock({
      items: [],
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });

    await threadCommands(host).compactThread("side-thread");

    expect(host.effects.compactThread).toHaveBeenCalledWith("side-thread");
  });

  it("does not compact an old panel target after connection completes", async () => {
    const connection = deferred<boolean>();
    const host = hostMock({
      items: [],
      activeThread: { id: "source" },
      ensureConnected: vi.fn(() => connection.promise),
    });
    const compacting = threadCommands(host).compactThread("source");
    await waitForAsyncWork(() => expect(host.ensureConnected).toHaveBeenCalledOnce());

    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    connection.resolve(true);
    await compacting;

    expect(host.effects.compactThread).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("other");
  });

  it("requests thread compaction and reports the shared status", async () => {
    const host = hostMock({ items: [] });
    const controller = threadCommands(host);

    await controller.compactThread("source");

    expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports compacting without an active thread", async () => {
    const host = hostMock({ items: [] });
    const controller = threadCommands(host);

    await controller.compactActiveThread();

    expect(host.addSystemMessage).toHaveBeenCalledWith("No active thread to compact.");
    expect(host.effects.compactThread).not.toHaveBeenCalled();
  });

  it("does not report compaction completion after the panel switches threads", async () => {
    const compact = deferred<EffectOutcome<void>>();
    const host = hostMock({ items: [] });
    host.effects.compactThread.mockReturnValue(compact.promise);
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    const controller = threadCommands(host);

    const pendingCompact = controller.compactThread("source");
    await waitForAsyncWork(() => {
      expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    });
    host.stateStore.dispatch({
      type: "active-thread/resumed",
      canAcceptDirectInput: null,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: null,
      sandboxPolicy: null,
      activePermissionProfile: null,
      thread: panelThread("other"),
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalsReviewer: null,
    });
    compact.resolve(completed(undefined));
    await pendingCompact;

    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("does not report compaction completion when the method rejects the mutation", async () => {
    const host = hostMock({
      items: [],
      effects: {
        compactThread: vi.fn<ThreadCommandEffects["compactThread"]>().mockResolvedValue({ kind: "not-started" }),
      },
    });
    const controller = threadCommands(host);

    await controller.compactThread("source");

    expect(host.effects.compactThread).toHaveBeenCalledWith("source");
    expect(host.addSystemMessage).not.toHaveBeenCalledWith("Compaction requested.");
    expect(host.setStatus).not.toHaveBeenCalledWith("Compaction requested.");
  });

  it("reports archive operation failures", async () => {
    const host = hostMock({
      items: [],
      mutations: {
        archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockRejectedValue(new Error("disk full")),
      },
    });
    const controller = threadCommands(host);

    await controller.archiveThread("source");

    expect(host.mutations.archiveThread).toHaveBeenCalledWith("source", {});
    expect(host.addSystemMessage).toHaveBeenCalledWith("disk full");
  });

  it("prepares a fork at the current latest turn without connecting or mutating server state", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source", title: "Source title" } });
    await threadCommands(host).forkThread("source");
    expect(host.openForkDraft).toHaveBeenCalledExactlyOnceWith(
      {
        draft: {
          sourceThreadId: "source",
          boundary: { kind: "through-turn", turnId: "turn-3" },
        },
        runtime: expect.objectContaining({ active: host.stateStore.getState().runtime.active }),
        display: { items: turnItems(), turnDiffs: new Map(), historyCursor: null },
      },
      true,
    );
    expect(host.ensureConnected).not.toHaveBeenCalled();
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
    expect(activeThreadId(host.stateStore.getState())).toBe("source");
  });

  it("keeps only the selected turn prefix and its display metadata", async () => {
    const items = [...turnItems().slice(0, 2), taskProgress("turn-1"), ...turnItems().slice(2)];
    const host = hostMock({ items, activeThread: { id: "source" } });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-1", diff: "diff one" });
    host.stateStore.dispatch({ type: "thread-stream/turn-diff-updated", turnId: "turn-2", diff: "diff two" });
    await threadCommands(host).forkThreadFromTurn("source", "turn-1", false);
    expect(host.openForkDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ boundary: { kind: "through-turn", turnId: "turn-1" } }),
        display: { items: items.slice(0, 3), turnDiffs: new Map([["turn-1", "diff one"]]), historyCursor: null },
      }),
      true,
    );
  });

  it("prepares fork-and-archive in the current panel without archiving its source", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    await threadCommands(host).forkThreadFromTurn("source", "turn-2", true);
    expect(host.openForkDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          sourceThreadId: "source",
          replacement: { sourceThreadId: "source", sourceLatestTurnId: "turn-3", saveMarkdown: true },
        }),
      }),
      false,
    );
    expect(host.stateStore.getState().panelThread.kind).toBe("fork-draft");
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it.each([{ items: [] }, { items: turnItems() }])("does not create a draft without a valid loaded boundary", async ({ items }) => {
    const host = hostMock({ items, activeThread: { id: "source" } });
    await threadCommands(host).forkThreadFromTurn("source", "missing", false);
    expect(host.openForkDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Could not find a completed turn to fork.");
  });

  it("does not fork a thread other than the panel source", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    await threadCommands(host).forkThread("other");
    expect(host.openForkDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Open the source thread before forking it.");
  });

  it.each(["forkThread", "rollbackThread"] as const)("blocks %s for ephemeral side chats", async (method) => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "side",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    await threadCommands(host)[method]("side");
    expect(host.openForkDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith(
      method === "forkThread" ? "Side chats cannot be forked." : "Side chats cannot be rolled back.",
    );
  });

  it("allows a subagent fork but rejects subagent rollback", async () => {
    const host = hostMock({
      items: turnItems(),
      activeThread: {
        id: "agent",
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
    });
    await threadCommands(host).forkThread("agent");
    expect(host.openForkDraft).toHaveBeenCalledOnce();
    host.openForkDraft.mockClear();
    await threadCommands(host).rollbackThread("agent");
    expect(host.openForkDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalledWith("Agent threads cannot be rolled back.");
  });

  it.each(["forkThread", "rollbackThread"] as const)("blocks %s while a turn is busy", async (method) => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.stateStore.dispatch({ type: "turn/started", threadId: "source", turnId: "running" });
    await threadCommands(host)[method]("source");
    expect(host.openForkDraft).not.toHaveBeenCalled();
    expect(host.addSystemMessage).toHaveBeenCalled();
  });

  it("rolls back locally before the latest turn and restores its prompt", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    await threadCommands(host).rollbackThread("source");
    expect(host.openForkDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          boundary: { kind: "before-turn", turnId: "turn-3" },
          replacement: { sourceThreadId: "source", sourceLatestTurnId: "turn-3", saveMarkdown: false },
          initialPrompt: "three",
        }),
        display: { items: turnItems().slice(0, 4), turnDiffs: new Map(), historyCursor: null },
      }),
      false,
    );
    expect(host.ensureConnected).not.toHaveBeenCalled();
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it("flattens repeated rollbacks onto the original source and its original latest turn", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const commands = threadCommands(host);
    await commands.rollbackThread("source");
    await commands.rollbackThread("source");
    expect(host.openForkDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          sourceThreadId: "source",
          replacement: { sourceThreadId: "source", sourceLatestTurnId: "turn-3", saveMarkdown: false },
          boundary: { kind: "before-turn", turnId: "turn-2" },
          initialPrompt: "two",
        }),
        display: { items: turnItems().slice(0, 2), turnDiffs: new Map(), historyCursor: null },
      }),
      false,
    );
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });

  it("does not turn an independent draft into a source replacement when rolling back", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const commands = threadCommands(host);
    await commands.forkThread("source");
    const preparation = host.openForkDraft.mock.calls[0]?.[0];
    if (!preparation) throw new Error("Fork draft was not opened");
    host.stateStore.dispatch({ type: "panel/fork-draft-applied", preparation });
    await commands.rollbackThread("source");
    expect(host.openForkDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: { sourceThreadId: "source", boundary: { kind: "before-turn", turnId: "turn-3" }, initialPrompt: "three" },
      }),
      false,
    );
  });

  it("retains the displayed prefix when forking an unsubmitted rollback", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const commands = threadCommands(host);
    await commands.rollbackThread("source");
    await commands.forkThread("source");
    expect(host.openForkDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          sourceThreadId: "source",
          boundary: { kind: "before-turn", turnId: "turn-3" },
        }),
        display: { items: turnItems().slice(0, 4), turnDiffs: new Map(), historyCursor: null },
      }),
      true,
    );
  });

  it("rolls back the first turn to an empty local prefix", async () => {
    const host = hostMock({ items: turnItems().slice(0, 2), activeThread: { id: "source" } });
    await threadCommands(host).rollbackThread("source");
    expect(host.openForkDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({ boundary: { kind: "before-turn", turnId: "turn-1" }, initialPrompt: "one" }),
        display: { items: [], turnDiffs: new Map(), historyCursor: null },
      }),
      false,
    );
    await threadCommands(host).rollbackThread("source");
    expect(host.openForkDraft).toHaveBeenCalledOnce();
    expect(host.addSystemMessage).toHaveBeenCalledWith("No completed turn to roll back.");
  });

  it.each([
    { serviceTier: "flex", intent: "unchanged" },
    { serviceTier: "priority", intent: "unchanged" },
    { serviceTier: null, intent: "unchanged" },
    { serviceTier: "flex", intent: "set" },
    { serviceTier: "priority", intent: "reset" },
  ])("preserves inherited runtime through preparation and creation without resending it (%j)", async ({ serviceTier, intent }) => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const activation: ThreadActivationSnapshot = {
      canAcceptDirectInput: true,
      approvalPolicyKnown: true,
      sandboxPolicyKnown: true,
      permissionProfileKnown: true,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      activePermissionProfile: null,
      thread: panelThread("source"),
      model: "gpt-5.6",
      reasoningEffort: null,
      serviceTier,
      approvalsReviewer: "auto_review",
    };
    host.stateStore.dispatch({ type: "active-thread/resumed", ...activation, items: turnItems() });
    host.stateStore.dispatch({ type: "active-thread/settings-applied", ...activation, collaborationMode: "plan" });
    if (intent !== "unchanged")
      host.stateStore.dispatch({
        type: "runtime/pending-intent-patched",
        patch:
          intent === "reset"
            ? {
                model: { kind: "resetToConfig" },
                fastMode: { kind: "resetToConfig" },
                permissionProfile: { kind: "resetToConfig" },
              }
            : {
                model: { kind: "set", value: "chosen-model" },
                fastMode: { kind: "set", value: "disabled" },
                collaborationMode: { kind: "set", value: "default" },
              },
      });
    const config = runtimeConfigFixture({
      model: "configured-model",
      model_reasoning_effort: "high",
      default_permissions: ":workspace",
      approval_policy: "on-request",
      service_tier: "flex",
    });
    const shared = { runtimeConfigSnapshot: () => config, rateLimitsSnapshot: () => null, modelsSnapshot: () => [] };
    const snapshot = () => runtimeSnapshotForChatState(host.stateStore.getState(), shared);
    const source = resolveRuntimeControls(snapshot(), config);
    await threadCommands(host).rollbackThread("source");
    const draft = resolveRuntimeControls(snapshot(), config);
    for (const field of [
      "model",
      "reasoningEffort",
      "serviceTier",
      "permissionProfile",
      "sandboxPolicy",
      "approvalPolicy",
      "approvalsReviewer",
    ] as const) {
      expect(draft[field]).toEqual(source[field]);
    }
    const forkThread = vi.fn(async () => completed({ ...activation, thread: panelThread("child") }));
    const starter = createThreadStartCommand({
      stateStore: host.stateStore,
      effects: { forkThread, startThread: vi.fn() },
      runtimeSnapshotForState: (state) => runtimeSnapshotForChatState(state, shared),
      recordStartedThread: vi.fn(),
      hydrateCreatedFork: vi.fn(),
      onThreadActivated: vi.fn(),
    });
    await starter.startThread("edited prompt");
    expect(forkThread).toHaveBeenCalledWith(
      "source",
      expect.objectContaining({
        runtime: expect.objectContaining({
          model: "gpt-5.6",
          reasoningEffort: null,
          serviceTier,
          approvalPolicy: "never",
          approvalsReviewer: "auto_review",
          sandboxPolicy: activation.sandboxPolicy,
        }),
      }),
    );
    expect(pendingRuntimeSettingsPatch(snapshot(), config).update).toEqual({
      ...(intent === "set"
        ? { model: "chosen-model", serviceTier: null }
        : intent === "reset"
          ? { model: null, serviceTier: null, permissions: null }
          : {}),
      collaborationMode: {
        mode: intent === "set" ? "default" : "plan",
        settings: {
          model: intent === "set" ? "chosen-model" : intent === "reset" ? "configured-model" : "gpt-5.6",
          reasoningEffort: "high",
          developerInstructions: null,
        },
      },
    });
  });

  it("hands the restored rollback prompt to the submission claim before adopting the local target", async () => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    const adoptPanelTarget = vi.fn(() => expect(activeThreadId(host.stateStore.getState())).toBe("source"));
    await threadCommands(host).rollbackThread("source", { adoptPanelTarget });
    expect(adoptPanelTarget).toHaveBeenCalledWith(null, "three");
    expect(host.stateStore.getState().panelThread.kind).toBe("fork-draft");
  });

  it.each(["forkThread", "rollbackThread"] as const)("reports %s draft opening failure without changing source state", async (method) => {
    const host = hostMock({ items: turnItems(), activeThread: { id: "source" } });
    host.openForkDraft.mockRejectedValue(new Error("panel unavailable"));
    await threadCommands(host)[method]("source");
    expect(host.addSystemMessage).toHaveBeenCalledWith("panel unavailable");
    expect(activeThreadId(host.stateStore.getState())).toBe("source");
    expect(host.mutations.archiveThread).not.toHaveBeenCalled();
  });
});

function turnItems(): ThreadStreamItem[] {
  return [
    { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "one", turnId: "turn-1" },
    {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      text: "one answer",
      turnId: "turn-1",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "two", turnId: "turn-2" },
    {
      id: "a2",
      kind: "dialogue",
      role: "assistant",
      text: "two answer",
      turnId: "turn-2",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
    { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "three", turnId: "turn-3" },
    {
      id: "a3",
      kind: "dialogue",
      role: "assistant",
      text: "three answer",
      turnId: "turn-3",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
    },
  ];
}

function taskProgress(turnId: string): ThreadStreamItem {
  return {
    id: `plan-progress-${turnId}`,
    kind: "taskProgress",
    role: "tool",
    turnId,
    explanation: null,
    steps: [{ step: "Keep this", status: "completed" }],
    executionState: "completed",
  };
}

function threadCommands(host: ThreadCommandsHost): ThreadCommands {
  return createThreadCommands(host);
}

function hostMock({
  items,
  activeThread,
  mutations: mutationOverrides = {},
  effects: effectsOverrides = {},
  ensureConnected = vi.fn<ThreadCommandsHost["ensureConnected"]>().mockResolvedValue(true),
}: {
  items: ThreadStreamItem[];
  activeThread?: NonNullable<Parameters<typeof chatStateWith>[1]["activeThread"]>;
  mutations?: Partial<ThreadMutationCommandsMock>;
  effects?: Partial<ThreadCommandEffectsMock>;
  ensureConnected?: ThreadCommandsHostMock["ensureConnected"];
}): ThreadCommandsHostMock {
  let state = withChatStateStableThreadStreamItems(chatStateFixture(), items);
  if (activeThread) state = chatStateWith(state, { activeThread });
  const stateStore = createChatStateStore(state);
  return {
    stateStore,
    effects: { compactThread: vi.fn<ThreadCommandEffects["compactThread"]>().mockResolvedValue(completed(undefined)), ...effectsOverrides },
    mutations: {
      archiveThread: vi.fn<ThreadCommandsHost["mutations"]["archiveThread"]>().mockResolvedValue(true),
      renameThread: vi.fn<ThreadCommandsHost["mutations"]["renameThread"]>().mockResolvedValue(true),
      setThreadPinned: vi.fn<ThreadCommandsHost["mutations"]["setThreadPinned"]>().mockResolvedValue(undefined),
      ...mutationOverrides,
    },
    ensureConnected,
    addSystemMessage: vi.fn(),
    setStatus: vi.fn(),
    openForkDraft: vi.fn<ThreadCommandsHost["openForkDraft"]>().mockImplementation(async (preparation, inNewPanel) => {
      if (!inNewPanel) stateStore.dispatch({ type: "panel/fork-draft-applied", preparation });
    }),
  };
}
function panelThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}

function completed<T>(value: T): EffectOutcome<T> {
  return { kind: "completed", value };
}
