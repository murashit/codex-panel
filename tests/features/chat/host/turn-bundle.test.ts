import { describe, expect, it, vi } from "vitest";

import { createServerDiagnostics, diagnosticsWithToolInventory } from "../../../../src/domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../src/domain/server/tool-inventory";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import { createTurnBundle } from "../../../../src/features/chat/host/bundles/turn-bundle";

describe("createTurnBundle", () => {
  it("uses cached tool inventory for /tools without refreshing diagnostics", async () => {
    const stateStore = createChatStateStore();
    stateStore.dispatch({
      type: "connection/metadata-applied",
      serverDiagnostics: diagnosticsWithToolInventory(createServerDiagnostics(), toolInventory()),
    });
    const fixture = turnBundleFixture({ stateStore });

    await fixture.bundle.turnActions.composerSubmit.submit();

    expect(fixture.refreshDiagnostics).not.toHaveBeenCalled();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
    expect(fixture.status.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] },
    ]);
  });

  it("refreshes diagnostics for /tools when tool inventory is not loaded", async () => {
    const fixture = turnBundleFixture();

    await fixture.bundle.turnActions.composerSubmit.submit();

    expect(fixture.refreshDiagnostics).toHaveBeenCalledOnce();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
  });
});

function turnBundleFixture(options: { stateStore?: ReturnType<typeof createChatStateStore> } = {}) {
  const stateStore = options.stateStore ?? createChatStateStore();
  const status = {
    set: vi.fn(),
    addSystemMessage: vi.fn(),
    addStructuredSystemMessage: vi.fn(),
  };
  const runtimeProjection = {
    connectionDiagnosticDetails: vi.fn(() => []),
    modelStatusLines: vi.fn(() => []),
    effortStatusLines: vi.fn(() => []),
    statusSummaryLines: vi.fn(() => []),
    permissionDetails: vi.fn(() => []),
    toolInventoryDetails: vi.fn(() => [{ title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] }]),
  };
  const refreshDiagnostics = vi.fn().mockResolvedValue(undefined);
  const bundle = createTurnBundle(
    {
      stateStore,
      messageScrollController: {
        showLatest: vi.fn(),
      },
    } as never,
    {
      localItemIds: { next: vi.fn(() => "local-id") },
      appServer: {
        connectionAvailable: vi.fn(() => true),
        threadReferences: vi.fn(() => ({ referThread: vi.fn() })),
        turn: { ensureConnected: vi.fn().mockResolvedValue(true) },
      },
      status,
      inboundHandler: {},
      threadLifecycle: {
        restoration: { ensureLoaded: vi.fn().mockResolvedValue(true) },
        resume: { resumeThread: vi.fn() },
      },
      threadActions: {},
      navigation: {
        startNewThread: vi.fn(),
        selectThread: vi.fn(),
      },
      composerController: {
        get trimmedDraft() {
          return "/tools";
        },
        setDraft: vi.fn(),
        codexInput: vi.fn(),
        preparedInput: vi.fn(),
        withPreservedComposerReferences: vi.fn((operation) => operation()),
        hasFocus: vi.fn(() => false),
        focusComposer: vi.fn(),
      },
      runtimeSettings: {},
      serverThreads: {},
      goals: {},
      autoTitleCoordinator: { resetThreadTurnPresence: vi.fn() },
      reconnect: vi.fn(),
      runtimeProjection,
      refreshDiagnostics,
      refreshLiveState: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
    } as never,
  );
  return { bundle, refreshDiagnostics, runtimeProjection, status };
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
    skills: [],
    skillsError: null,
  };
}
