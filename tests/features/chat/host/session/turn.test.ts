import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolInventorySnapshot } from "../../../../../src/domain/runtime/tool-inventory";
import type { Thread } from "../../../../../src/domain/threads/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { createSessionTurn } from "../../../../../src/features/chat/host/session/turn";
import { deferred } from "../../../../support/async";
import { panelThreadFixture } from "../../../../support/panel-thread";
import { threadActivationFixture } from "../../../../support/thread-activation";
import { contextProvider, installComposerInputFixtures } from "../../support/composer-input-fixture";

const createInput = installComposerInputFixtures();
afterEach(() => vi.restoreAllMocks());

describe("createSessionTurn", () => {
  it("sends only plan text without composer context when implementing a plan", async () => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const fixture = sessionTurnFixture({ stateStore });
    await fixture.turn.submissionCommands.planImplementation.implement("plan");
    expect(fixture.startTurn).toHaveBeenCalledWith({
      threadId: "thread",
      input: [{ type: "text", text: "Please implement this plan." }],
      clientUserMessageId: expect.any(String),
    });
  });

  it("prevents a direct send from overtaking a plan submission waiting for connection", async () => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const connection = deferred<boolean>();
    const ensureConnected = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockImplementation(() => connection.promise);
    const fixture = sessionTurnFixture({ stateStore, ensureConnected });
    const plan = fixture.turn.submissionCommands.planImplementation.implement("plan");
    await vi.waitFor(() => expect(ensureConnected).toHaveBeenCalledTimes(2));
    fixture.composer.setDraft("Another send");
    await fixture.submit();
    expect(fixture.composer.draft).toBe("Another send");
    connection.resolve(true);
    await plan;
    expect(fixture.startTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: [{ type: "text", text: "Please implement this plan." }] }),
    );
  });

  it.each(["connection", "turn"])("preserves the editable draft when implementing a plan fails at %s", async (failure) => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const fixture = sessionTurnFixture({
      stateStore,
      draft: "existing draft",
      ...(failure === "connection" ? { ensureConnected: vi.fn().mockResolvedValue(false) } : {}),
    });
    fixture.startTurn.mockRejectedValueOnce(new Error("turn failed"));
    await fixture.turn.submissionCommands.planImplementation.implement("plan");
    expect(fixture.composer.draft).toBe("existing draft");
    expect(fixture.composer.isSubmissionPreparing()).toBe(false);
    expect(fixture.status.addSystemMessage.mock.calls).toEqual(failure === "turn" ? [["turn failed"]] : []);
    expect(fixture.startTurn).toHaveBeenCalledTimes(failure === "turn" ? 1 : 0);
  });

  it("lets the query owner settle cached tool inventory before rendering /tools", async () => {
    const inventory = deferred<ToolInventorySnapshot>();
    const ensureToolInventory = vi.fn(() => inventory.promise);
    const fixture = sessionTurnFixture({ toolInventory: toolInventory(), ensureToolInventory });

    const submission = fixture.submit();
    await vi.waitFor(() => expect(ensureToolInventory).toHaveBeenCalledOnce());
    expect(fixture.runtimeProjection.toolInventoryDetails).not.toHaveBeenCalled();
    expect(fixture.status.addStructuredSystemMessage).not.toHaveBeenCalled();

    inventory.resolve(toolInventory());
    await submission;

    expect(fixture.ensureToolInventory).toHaveBeenCalledOnce();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
    expect(fixture.status.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] },
    ]);
  });

  it("routes reference preparation failures through the session turn", async () => {
    const stateStore = createChatStateStore();
    const thread = {
      id: "thread-1",
      preview: "Other",
      name: "Other",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      ephemeral: false,
      provenance: { kind: "interactive" as const },
    };
    const referThread = vi.fn().mockRejectedValue(new Error("history unavailable"));
    const fixture = sessionTurnFixture({
      stateStore,
      draft: "/refer Other summarize",
      referThread,
      threads: [thread],
    });

    await fixture.submit();

    expect(referThread).toHaveBeenCalledWith(thread, "summarize", expect.objectContaining({ sourcePath: "snapshot.md" }));
    expect(fixture.status.addSystemMessage).toHaveBeenCalledExactlyOnceWith("history unavailable");
  });
});

function sessionTurnFixture(
  options: {
    stateStore?: ReturnType<typeof createChatStateStore>;
    draft?: string;
    ensureConnected?: ReturnType<typeof vi.fn>;
    referThread?: ReturnType<typeof vi.fn>;
    threads?: readonly import("../../../../../src/domain/threads/model").Thread[];
    toolInventory?: ToolInventorySnapshot | null;
    ensureToolInventory?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const stateStore = options.stateStore ?? createChatStateStore();
  const draft = options.draft ?? "/tools";
  const referThread = options.referThread ?? vi.fn();
  const status = {
    set: vi.fn(),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
  };
  const runtimeProjection = {
    connectionDiagnosticDetails: vi.fn(() => []),
    modelStatusDetails: vi.fn(() => []),
    effortStatusDetails: vi.fn(() => []),
    statusDetails: vi.fn(() => []),
    permissionDetails: vi.fn(() => []),
    toolInventoryDetails: vi.fn(() => [{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] }]),
  };
  const ensureToolInventory = options.ensureToolInventory ?? vi.fn().mockResolvedValue(toolInventory());
  const startTurn = vi.fn().mockResolvedValue({ kind: "completed", value: { turnId: "turn" } });
  const sharedResources = {
    runtimeConfigSnapshot: () => null,
    rateLimitsSnapshot: () => undefined,
    modelsSnapshot: () => null,
    skillsSnapshot: () => [],
    permissionProfilesSnapshot: () => [],
    activeThreadsSnapshot: () => options.threads ?? null,
    subscribe: () => () => {},
    toolInventorySnapshot: () => options.toolInventory ?? null,
    ensureToolInventory,
  };
  const { input: composer } = createInput({
    stateStore,
    sharedResources,
    contextReferenceProvider: contextProvider(() => ({
      activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
      selection: null,
    })),
    sourcePath: () => "snapshot.md",
    referenceActiveNoteOnSend: () => true,
  });
  composer.setDraft(draft);
  const turn = createSessionTurn(
    {
      environment: {
        plugin: {
          appServerQueries: {
            runtimeConfigSnapshot: () => null,
            rateLimitsSnapshot: () => undefined,
            modelsSnapshot: () => null,
          },
          threadCatalog: {
            activeThreadsSnapshot: () => options.threads ?? null,
          },
        },
      },
      stateStore,
      threadStreamScrollBinding: {
        showLatest: vi.fn(),
      },
    } as never,
    {
      localItemIds: { next: vi.fn(() => "local-id") },
      appServer: {
        connectionAvailable: vi.fn(() => true),
        threadReferences: vi.fn(() => referThread),
        turn: { startTurn },
      },
      ensureConnected: options.ensureConnected ?? vi.fn().mockResolvedValue(true),
      status,
      inboundHandler: {},
      threadLifecycle: {
        ensureRestoredThreadLoaded: vi.fn().mockResolvedValue(true),
      },
      threadCommands: {},
      navigation: {
        startNewThread: vi.fn(),
        selectThread: vi.fn(),
      },
      composerInput: composer,
      composerController: { hasFocus: () => false, focusComposer: () => {} },
      resolveFileReference: () => ({ name: "unexpected", path: "notes/Alpha.md" }),
      runtimeSettings: {
        applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
        toggleCollaborationMode: vi.fn().mockResolvedValue(undefined),
        requestDefaultCollaborationModeForNextTurn: () =>
          stateStore.dispatch({
            type: "runtime/pending-intent-patched",
            patch: { collaborationMode: { kind: "set", value: "default" } },
          }),
      },
      threadStart: {},
      goals: {},
      reconnect: vi.fn(),
      runtimeProjection,
      sharedResources,
    } as never,
  );
  return {
    turn,
    composer,
    startTurn,
    submit: () => turn.submissionCommands.composerSubmit.submit(),
    ensureToolInventory,
    runtimeProjection,
    status,
  };
}

function toolInventory(): ToolInventorySnapshot {
  return {
    plugins: [],
    pluginsError: null,
    mcpServers: [],
    mcpDiagnostics: [],
    mcpError: null,
  };
}

function thread(id: string): Thread {
  return panelThreadFixture({
    id,
    createdAt: 0,
    updatedAt: 0,
  });
}

function resumeThread(stateStore: ReturnType<typeof createChatStateStore>, items: readonly ThreadStreamItem[]): void {
  stateStore.dispatch({
    ...threadActivationFixture(thread("thread")),
    type: "active-thread/resumed",
    items,
  });
  stateStore.dispatch({
    type: "runtime/pending-intent-patched",
    patch: { collaborationMode: { kind: "set", value: "plan" } },
  });
}
