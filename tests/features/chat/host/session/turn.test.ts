import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolInventorySnapshot } from "../../../../../src/domain/runtime/tool-inventory";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ComposerInputSnapshot } from "../../../../../src/features/chat/application/composer/input-snapshot";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { ChatComposerController } from "../../../../../src/features/chat/host/composer/controller";
import { createSessionTurn } from "../../../../../src/features/chat/host/session/turn";
import { deferred } from "../../../../support/async";
import { threadActivationFixture } from "../../../../support/thread-activation";

const composers: ChatComposerController[] = [];
afterEach(() => {
  for (const composer of composers.splice(0)) composer.dispose();
  vi.restoreAllMocks();
});

describe("createSessionTurn", () => {
  it("sends only plan text without composer context when implementing a plan", async () => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const prepareInput = vi.fn(
      (text: string, _snapshot: ComposerInputSnapshot): ReturnType<ChatComposerController["preparedInput"]> => ({
        text,
        input: [
          { type: "text", text },
          { type: "fileReference", name: "unexpected", path: "notes/Alpha.md" },
        ],
      }),
    );
    const fixture = sessionTurnFixture({ stateStore, prepareInput });
    await fixture.turn.submissionCommands.planImplementation.implement("plan");
    expect(prepareInput).not.toHaveBeenCalled();
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
    expect(fixture.startTurn).toHaveBeenCalledOnce();
    expect(fixture.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ input: [{ type: "text", text: "Please implement this plan." }] }),
    );
  });

  it("does not change plan mode while the composer already owns a submission", async () => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const fixture = sessionTurnFixture({ stateStore, draft: "existing draft" });
    const claim = fixture.composer.claimSubmission();
    stateStore.dispatch({ type: "ui/panel-set", panel: "status-panel" });
    await fixture.turn.submissionCommands.planImplementation.implement("plan");
    expect(stateStore.getState().runtime.pending.collaborationMode).toEqual({ kind: "set", value: "plan" });
    expect(stateStore.getState().ui.toolbarPanel).toBe("status-panel");
    expect(fixture.startTurn).not.toHaveBeenCalled();
    claim?.settle("failed");
    expect(fixture.composer.draft).toBe("existing draft");
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
    if (failure === "turn") expect(fixture.status.addSystemMessage).toHaveBeenCalledWith("turn failed");
    else expect(fixture.startTurn).not.toHaveBeenCalled();
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
    prepareInput?: (text: string, snapshot: ComposerInputSnapshot) => ReturnType<ChatComposerController["preparedInput"]>;
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
  const composer = new ChatComposerController({
    stateStore,
    sharedResources: { skillsSnapshot: () => [], subscribe: () => () => {} },
    noteCandidateProvider: {
      candidates: () => [],
      dailyNoteReferences: () => [],
      tags: () => [],
      resolveFileReference: () => null,
      dispose: () => {},
    },
    contextReferenceProvider: {
      contextReferences: () => ({ activeNote: null, selection: null }),
      retainSelectionEmphasis: () => null,
      dispose: () => {},
    },
    sourcePath: () => "snapshot.md",
    referenceActiveNoteOnSend: () => true,
    canFocus: () => false,
  } as never);
  composers.push(composer);
  composer.setDraft(draft);
  vi.spyOn(composer, "preparedInput").mockImplementation((text, snapshot) =>
    options.prepareInput
      ? options.prepareInput(text, snapshot ?? composer.captureInputSnapshot())
      : { text, input: [{ type: "text", text }] },
  );
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
        resume: { resumeThread: vi.fn() },
      },
      threadCommands: {},
      navigation: {
        startNewThread: vi.fn(),
        selectThread: vi.fn(),
      },
      composerController: composer,
      runtimeSettings: {
        applyPendingThreadSettings: vi.fn().mockResolvedValue(true),
        requestDefaultCollaborationModeForNextTurn: () =>
          stateStore.dispatch({
            type: "runtime/pending-intent-patched",
            patch: { collaborationMode: { kind: "set", value: "default" } },
          }),
      },
      threadStart: {},
      goals: {},
      autoTitleCoordinator: { resetThreadTurnPresence: vi.fn() },
      reconnect: vi.fn(),
      runtimeProjection,
      sharedResources: {
        runtimeConfigSnapshot: () => null,
        rateLimitsSnapshot: () => undefined,
        modelsSnapshot: () => null,
        toolInventorySnapshot: () => options.toolInventory ?? null,
        ensureToolInventory,
      },
      notifyActiveThreadIdentityChanged: vi.fn(),
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
  return {
    id,
    preview: "",
    createdAt: 0,
    updatedAt: 0,
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
  };
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
