import { describe, expect, it, vi } from "vitest";

import { createServerDiagnostics, diagnosticProbeOk, upsertMcpServerDiagnostic } from "../../../../../src/domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../../src/domain/server/mcp-status";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createServerDiagnosticsCoordinator } from "../../../../../src/features/chat/application/connection/server-diagnostics-coordinator";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { deferred } from "../../../../support/async";
import { chatStateFixture } from "../../support/state";

describe("server diagnostics coordinator", () => {
  it("keeps shared metadata probes out of panel diagnostics state", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const readServerDiagnostics = vi.fn().mockResolvedValue(serverDiagnosticsSnapshot());
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics },
    });

    await diagnostics.refreshServerDiagnostics();

    expect(readServerDiagnostics).toHaveBeenCalledWith({
      threadId: null,
      initialDiagnostics: expect.anything(),
    });
    expect(stateStore.getState().connection.serverDiagnostics.probes.skills.status).toBe("unknown");
    expect(stateStore.getState().connection.serverDiagnostics.probes.plugins.status).toBe("ok");
  });

  it("drops results after the active panel target changes or the coordinator is invalidated", async () => {
    const pending = deferred<ReturnType<typeof serverDiagnosticsSnapshot>>();
    const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread-1" } }));
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics: vi.fn(() => pending.promise) },
    });

    const refreshing = diagnostics.refreshServerDiagnostics();
    stateStore.dispatch({ type: "active-thread/cleared" });
    pending.resolve(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] }));
    await refreshing;

    expect(stateStore.getState().connection.serverDiagnostics.toolInventory).toBeNull();

    const secondPending = deferred<ReturnType<typeof serverDiagnosticsSnapshot>>();
    const second = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics: vi.fn(() => secondPending.promise) },
    });
    const invalidated = second.refreshServerDiagnostics();
    second.invalidate();
    secondPending.resolve(serverDiagnosticsSnapshot());
    await invalidated;
    expect(stateStore.getState().connection.serverDiagnostics.toolInventory).toBeNull();
  });

  it("replaces thread-scoped MCP status while retaining startup facts for present providers", async () => {
    let initial = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });
    initial = upsertMcpServerDiagnostic(initial, {
      name: "removed",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });
    const stateStore = createChatStateStore(chatStateFixture({ connection: { serverDiagnostics: initial } }));
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: {
        readServerDiagnostics: vi.fn().mockResolvedValue(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] })),
      },
    });

    await diagnostics.refreshServerDiagnostics();

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toEqual([
      expect.objectContaining({ name: "github", startupStatus: "ready", authStatus: "oAuth" }),
    ]);
  });
});

function serverDiagnosticsSnapshot(overrides: { mcpServerStatuses?: McpServerStatusSummary[] | null } = {}) {
  return {
    toolInventory: {
      inventory: toolInventory(),
      probes: [
        diagnosticProbeOk("plugins", "0 plugins", 1),
        diagnosticProbeOk("mcpServers", "0 servers", 1),
        diagnosticProbeOk("skills", "1 skill", 1),
      ],
      mcpServerStatuses: overrides.mcpServerStatuses ?? [],
    },
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

function mcpServerStatus(): McpServerStatusSummary {
  return {
    name: "github",
    authStatus: "oAuth",
    toolCount: 1,
    resourceCount: 0,
    resourceTemplateCount: 0,
  };
}
