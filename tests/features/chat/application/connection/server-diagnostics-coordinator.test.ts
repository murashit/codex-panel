import { describe, expect, it, vi } from "vitest";

import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import {
  createServerDiagnostics,
  type DiagnosticProbeResult,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../../src/domain/server/mcp-status";
import type { SharedServerMetadata } from "../../../../../src/domain/server/metadata";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createServerDiagnosticsCoordinator } from "../../../../../src/features/chat/application/connection/server-diagnostics-coordinator";
import { createServerMetadataEffects } from "../../../../../src/features/chat/application/connection/server-metadata-effects";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/presentation/runtime/tool-inventory-diagnostic-sections";
import { deferred } from "../../../../support/async";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("server diagnostics coordinator", () => {
  it("reuses refreshed app-server metadata for deferred diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshedMetadata = serverMetadataFixture({
      availableSkills: [skillFixture("writer")],
      serverDiagnostics: diagnosticsWithProbe(
        diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("models", "1 models", 1)),
        diagnosticProbeOk("skills", "1 skills", 1),
      ),
    });
    const cache = { current: null as SharedServerMetadata | null };
    const metadataCache = metadataCacheHost(cache);
    const metadata = createServerMetadataEffects({
      stateStore,
      ...metadataCache,
      refreshAppServerMetadata: vi.fn().mockImplementation(async () => {
        cache.current = refreshedMetadata;
      }),
      isStaleRuntimeError: () => false,
    });
    const readServerDiagnostics = vi.fn().mockResolvedValue(serverDiagnosticsSnapshot());
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics },
      ...metadataCache,
    });

    await metadata.refreshAppServerMetadata();
    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    expect(readServerDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        appServerMetadataSnapshot: true,
        cachedSkills: [skillFixture("writer")],
        cachedSkillsProbe: expect.objectContaining({ status: "ok", summary: "1 skills" }),
      }),
    );
    expect(stateStore.getState().connection.serverDiagnostics.probes.models).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
  });

  it("uses metadata diagnostics as the default resource probe source", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const metadataCache = metadataCacheHost({
      current: serverMetadataFixture({
        serverDiagnostics: diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("models", "cached models", 1)),
      }),
    });
    const readServerDiagnostics = vi.fn().mockResolvedValue(serverDiagnosticsSnapshot());
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics },
      ...metadataCache,
    });

    await diagnostics.refreshServerDiagnostics();

    expect(readServerDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        appServerMetadataSnapshot: false,
        forceResourceProbes: false,
      }),
    );
    expect(stateStore.getState().connection.serverDiagnostics.probes.models).toMatchObject({
      status: "ok",
      summary: "cached models",
    });
  });

  it("can force resource probes for explicit health checks", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const readServerDiagnostics = vi.fn().mockResolvedValue(
      serverDiagnosticsSnapshot({
        resourceProbes: [diagnosticProbeOk("models", "1 models", 1), diagnosticProbeOk("rateLimits", "available", 1)],
      }),
    );
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics },
      ...metadataCacheHost(),
    });

    await diagnostics.refreshServerDiagnostics({ forceResourceProbes: true });

    expect(readServerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ forceResourceProbes: true }));
    expect(stateStore.getState().connection.serverDiagnostics.probes.models).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
  });

  it("does not apply diagnostic probes when the port returns no snapshot", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics: vi.fn().mockResolvedValue(null) },
      appServerMetadataSnapshot: () => null,
    });

    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    expect(stateStore.getState().connection.serverDiagnostics.probes.mcpServers.status).toBe("unknown");
  });

  it("refreshes tool provider snapshots with cached MCP startup diagnostics", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    const stateStore = createChatStateStore(state);
    const metadataCache = metadataCacheHost({ current: serverMetadataFixture() });
    const metadata = createServerMetadataEffects({
      stateStore,
      ...metadataCache,
      refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
      isStaleRuntimeError: () => false,
    });
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: {
        readServerDiagnostics: vi.fn().mockResolvedValue(
          serverDiagnosticsSnapshot({
            mcpServerStatuses: [mcpServerStatus()],
          }),
        ),
      },
      ...metadataCache,
    });

    await metadata.handleAppServerResourceFact({
      type: "mcp-startup-status-updated",
      name: "github",
      status: "ready",
      message: null,
    });
    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    const sections = toolInventoryDiagnosticSections(stateStore.getState().connection.serverDiagnostics);
    const toolProviderRows = sections.find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Plugins", "Tool providers", "Skills"]);
    expect(toolProviderRows.map((row) => `${row.label}: ${row.value}`)).toEqual(["github: MCP server, ready, auth oAuth, 1 tool"]);
  });

  it("drops a diagnostics result when its active thread is no longer current", async () => {
    const pending = deferred<ReturnType<typeof serverDiagnosticsSnapshot>>();
    const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread-1" } }));
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics: vi.fn(() => pending.promise) },
      ...metadataCacheHost(),
    });

    const refreshing = diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });
    stateStore.dispatch({ type: "active-thread/cleared" });
    pending.resolve(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] }));
    await refreshing;

    expect(stateStore.getState().connection.serverDiagnostics.toolInventory).toBeNull();
    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toEqual([]);
  });

  it("drops a diagnostics result after its connection scope is invalidated", async () => {
    const pending = deferred<ReturnType<typeof serverDiagnosticsSnapshot>>();
    const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread-1" } }));
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: { readServerDiagnostics: vi.fn(() => pending.promise) },
      ...metadataCacheHost(),
    });

    const refreshing = diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });
    diagnostics.invalidate();
    pending.resolve(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] }));
    await refreshing;

    expect(stateStore.getState().connection.serverDiagnostics.toolInventory).toBeNull();
    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toEqual([]);
  });

  it("removes MCP providers missing from the latest thread-scoped inventory", async () => {
    let initialDiagnostics = upsertMcpServerDiagnostic(createServerDiagnostics(), {
      name: "github",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });
    initialDiagnostics = upsertMcpServerDiagnostic(initialDiagnostics, {
      name: "removed-provider",
      startupStatus: "ready",
      authStatus: null,
      toolCount: null,
      message: null,
    });
    const stateStore = createChatStateStore(
      chatStateFixture({ activeThread: { id: "thread-1" }, connection: { serverDiagnostics: initialDiagnostics } }),
    );
    const diagnostics = createServerDiagnosticsCoordinator({
      stateStore,
      diagnosticsPort: {
        readServerDiagnostics: vi.fn().mockResolvedValue(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] })),
      },
      ...metadataCacheHost(),
    });

    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers.map((server) => server.name)).toEqual(["github"]);
  });
});

function serverDiagnosticsSnapshot(
  overrides: { resourceProbes?: DiagnosticProbeResult[]; mcpServerStatuses?: McpServerStatusSummary[] | null } = {},
) {
  return {
    resourceProbes: overrides.resourceProbes ?? [],
    toolInventory: {
      inventory: toolInventory(),
      probes: [
        diagnosticProbeOk("plugins", "0 plugins", 1),
        diagnosticProbeOk("mcpServers", "0 servers", 1),
        diagnosticProbeOk("skills", "0 skills", 1),
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
    skills: [],
    skillsError: null,
  };
}

function skillFixture(name: string): SkillMetadata {
  return {
    name,
    description: "",
    path: `/skills/${name}`,
    enabled: true,
  };
}

function serverMetadataFixture(overrides: Partial<SharedServerMetadata> = {}): SharedServerMetadata {
  return {
    runtimeConfig: runtimeConfigFixture(),
    availableSkills: [],
    availablePermissionProfiles: [],
    rateLimit: null,
    serverDiagnostics: createServerDiagnostics(),
    ...overrides,
  };
}

function metadataCacheHost(cache: { current: SharedServerMetadata | null } = { current: null }): {
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  refreshAppServerMetadata: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  isStaleRuntimeError: (error: unknown) => boolean;
} {
  return {
    appServerMetadataSnapshot: () => cache.current,
    refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
    refreshSkills: vi.fn().mockResolvedValue(undefined),
    refreshRateLimits: vi.fn().mockResolvedValue(undefined),
    isStaleRuntimeError: () => false,
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
