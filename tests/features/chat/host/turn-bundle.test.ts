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

    await fixture.bundle.turnCommands.composerSubmit.submit();

    expect(fixture.refreshDiagnostics).not.toHaveBeenCalled();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
    expect(fixture.status.addStructuredSystemMessage).toHaveBeenCalledWith("Codex capabilities", [
      { title: "Tool providers", auditFacts: [{ key: "codex_apps", value: "github, gmail" }] },
    ]);
  });

  it("refreshes diagnostics for /tools when tool inventory is not loaded", async () => {
    const fixture = turnBundleFixture();

    await fixture.bundle.turnCommands.composerSubmit.submit();

    expect(fixture.refreshDiagnostics).toHaveBeenCalledOnce();
    expect(fixture.runtimeProjection.toolInventoryDetails).toHaveBeenCalledOnce();
  });

  it("passes the callable thread reference port through the bundle", async () => {
    const stateStore = createChatStateStore();
    const thread = {
      id: "thread-1",
      preview: "Other",
      name: "Other",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      canAcceptDirectInput: null,
      provenance: { kind: "interactive" as const },
    };
    stateStore.dispatch({ type: "thread-list/applied", threads: [thread] });
    const referThread = vi.fn().mockResolvedValue(null);
    const fixture = turnBundleFixture({
      stateStore,
      draft: "/refer Other summarize",
      referThread,
    });

    await fixture.bundle.turnCommands.composerSubmit.submit();

    expect(referThread).toHaveBeenCalledWith(thread, "summarize", { sourcePath: "snapshot.md" });
  });
});

function turnBundleFixture(
  options: { stateStore?: ReturnType<typeof createChatStateStore>; draft?: string; referThread?: ReturnType<typeof vi.fn> } = {},
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
  const bundle = createTurnBundle(
    {
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
        turn: { ensureConnected: vi.fn().mockResolvedValue(true) },
      },
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
