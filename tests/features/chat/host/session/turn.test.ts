import { describe, expect, it, vi } from "vitest";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ComposerInputSnapshot } from "../../../../../src/features/chat/application/composer/input-snapshot";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { createSessionTurn } from "../../../../../src/features/chat/host/session/turn";
import { deferred } from "../../../../support/async";

describe("createSessionTurn", () => {
  it("sends only plan text without composer context when implementing a plan", async () => {
    const stateStore = createChatStateStore();
    resumeThread(stateStore, [
      { id: "plan", kind: "dialogue", role: "assistant", text: "Plan", dialogueKind: "proposedPlan", dialogueState: "completed" },
    ]);
    const prepareInput = vi.fn((text: string, _snapshot: ComposerInputSnapshot) => ({
      text,
      input: [
        { type: "text", text },
        { type: "fileReference", name: "unexpected", path: "notes/Alpha.md" },
      ],
    }));
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
    await expect(fixture.turn.submissionCommands.sendTurnText({ text: "Another send" })).resolves.toBe(false);
    connection.resolve(true);
    await plan;
    expect(fixture.startTurn).toHaveBeenCalledOnce();
    expect(fixture.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ input: [{ type: "text", text: "Please implement this plan." }] }),
    );
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

    expect(referThread).toHaveBeenCalledWith(thread, "summarize", { sourcePath: "snapshot.md" });
    expect(fixture.status.addSystemMessage).toHaveBeenCalledExactlyOnceWith("history unavailable");
  });
});

function sessionTurnFixture(
  options: {
    stateStore?: ReturnType<typeof createChatStateStore>;
    draft?: string;
    prepareInput?: ReturnType<typeof vi.fn>;
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
      composerController: {
        get draft() {
          return draft;
        },
        get trimmedDraft() {
          return draft;
        },
        setDraft: vi.fn(),
        preparedInput: options.prepareInput ?? vi.fn(),
        captureInputSnapshot: vi.fn(() => ({ sourcePath: "snapshot.md" })),
        claimSubmission: vi.fn(() => ({
          text: draft,
          inputSnapshot: { sourcePath: "snapshot.md" } as never,
          isCurrent: vi.fn(() => true),
          markAdopted: vi.fn(),
          adoptPanelTarget: vi.fn(),
          settle: vi.fn(),
        })),
        isSubmissionPreparing: vi.fn(() => false),
        hasFocus: vi.fn(() => false),
        focusComposer: vi.fn(),
      },
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
    pluginMarketplaceErrors: [],
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
    type: "active-thread/resumed",
    canAcceptDirectInput: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: thread("thread"),
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
    items,
  });
  stateStore.dispatch({
    type: "runtime/pending-intent-patched",
    patch: { collaborationMode: { kind: "set", value: "plan" } },
  });
}
