import { describe, expect, it, vi } from "vitest";

import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createSessionTurn } from "../../../../../src/features/chat/host/session/turn";
import { deferred } from "../../../../support/async";

describe("createSessionTurn", () => {
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

  it("passes the callable thread reference port through the session turn", async () => {
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
    const referThread = vi.fn().mockResolvedValue(null);
    const fixture = sessionTurnFixture({
      stateStore,
      draft: "/refer Other summarize",
      referThread,
      threads: [thread],
    });

    await fixture.submit();

    expect(referThread).toHaveBeenCalledWith(thread, "summarize", { sourcePath: "snapshot.md" });
  });
});

function sessionTurnFixture(
  options: {
    stateStore?: ReturnType<typeof createChatStateStore>;
    draft?: string;
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
        turn: {},
      },
      ensureConnected: vi.fn().mockResolvedValue(true),
      status,
      inboundHandler: {},
      threadLifecycle: {
        restoration: { ensureLoaded: vi.fn().mockResolvedValue(true) },
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
        preparedInput: vi.fn(),
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
      runtimeSettings: {},
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
