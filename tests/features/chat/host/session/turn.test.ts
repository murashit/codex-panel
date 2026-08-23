import { describe, expect, it, vi } from "vitest";

import { createServerDiagnostics, diagnosticsWithToolInventory } from "../../../../../src/domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createSessionTurn } from "../../../../../src/features/chat/host/session/turn";

describe("createSessionTurn", () => {
  it("uses cached tool inventory for /tools without refreshing diagnostics", async () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({
      type: "connection/diagnostics-applied",
      serverDiagnostics: diagnosticsWithToolInventory(createServerDiagnostics(), toolInventory()),
    });
    const fixture = sessionTurnFixture({ stateStore });

    await fixture.submit();

    expect(fixture.refreshDiagnostics).not.toHaveBeenCalled();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
    expect(fixture.status.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] },
    ]);
  });

  it("refreshes diagnostics for /tools when tool inventory is not loaded", async () => {
    const fixture = sessionTurnFixture();

    await fixture.submit();

    expect(fixture.refreshDiagnostics).toHaveBeenCalledOnce();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
  });

  it("shows refreshed tool inventory when only shared metadata refresh fails", async () => {
    const stateStore = createChatStateStore();
    const fixture = sessionTurnFixture({ stateStore });
    fixture.refreshDiagnostics.mockImplementationOnce(async () => {
      stateStore.dispatch({
        type: "connection/diagnostics-applied",
        serverDiagnostics: diagnosticsWithToolInventory(createServerDiagnostics(), toolInventory()),
      });
      throw new Error("config unavailable");
    });

    await fixture.submit();

    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
    expect(fixture.status.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] },
    ]);
    expect(fixture.status.addSystemMessage).not.toHaveBeenCalledWith("config unavailable");
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
  const refreshDiagnostics = vi.fn().mockResolvedValue(undefined);
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
      refreshDiagnostics,
      notifyActiveThreadIdentityChanged: vi.fn(),
    } as never,
  );
  return {
    submit: () => turn.submissionCommands.composerSubmit.submit(),
    refreshDiagnostics,
    runtimeProjection,
    status,
  };
}

function toolInventory(): ToolInventorySnapshot {
  return {
    checkedAt: 1,
    plugins: [],
    pluginMarketplaceErrors: [],
    pluginsError: null,
    mcpServers: [],
    mcpDiagnostics: [],
    mcpError: null,
  };
}
