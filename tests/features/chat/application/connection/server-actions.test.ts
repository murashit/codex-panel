import { describe, expect, it, vi } from "vitest";

import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import { emptyRuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../../src/domain/runtime/metrics";
import {
  createServerDiagnostics,
  type DiagnosticProbeResult,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  diagnosticsWithToolInventory,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/server/diagnostics";
import type { McpServerStatusSummary } from "../../../../../src/domain/server/mcp-status";
import type { SharedServerMetadata } from "../../../../../src/domain/server/metadata";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import type { MetadataResourceTransport } from "../../../../../src/features/chat/application/connection/metadata-transport";
import { createServerDiagnosticsActions } from "../../../../../src/features/chat/application/connection/server-diagnostics-actions";
import { createServerMetadataActions } from "../../../../../src/features/chat/application/connection/server-metadata-actions";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/presentation/runtime/tool-inventory-diagnostic-sections";
import { deferred } from "../../../../support/async";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("server metadata actions", () => {
  it("applies refreshed non-model app-server metadata", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const metadata = serverMetadataFixture({ availableSkills: [skillFixture("writer")] });
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(metadata),
      isStaleSharedQueryError: () => false,
    });

    await actions.refreshAppServerMetadata();

    expect(stateStore.getState().connection.availableSkills.map((skill) => skill.name)).toEqual(["writer"]);
  });

  it("preserves panel-local tool diagnostics when applying shared metadata", async () => {
    const localDiagnostics = diagnosticsWithToolInventory(
      upsertMcpServerDiagnostic(createServerDiagnostics(), {
        name: "github",
        startupStatus: "ready",
        authStatus: null,
        toolCount: null,
        message: null,
      }),
      toolInventory(),
    );
    const stateStore = createChatStateStore(chatStateFixture({ connection: { serverDiagnostics: localDiagnostics } }));
    const metadata = serverMetadataFixture({
      serverDiagnostics: diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("models", "1 model", 2)),
    });
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(metadata),
      isStaleSharedQueryError: () => false,
    });

    await actions.refreshAppServerMetadata();

    expect(stateStore.getState().connection.serverDiagnostics).toMatchObject({
      probes: { models: { status: "ok", summary: "1 model" } },
      mcpServers: [{ name: "github", startupStatus: "ready" }],
      toolInventory: { checkedAt: 1 },
    });
  });

  it("keeps MCP startup notifications out of shared metadata", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const cache = { current: serverMetadataFixture() as SharedServerMetadata | null };
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCacheHost(cache),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });

    await actions.applyAppServerResourceEvent({
      type: "mcp-startup-status-updated",
      name: "github",
      status: "ready",
      message: null,
    });

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toMatchObject([{ name: "github", startupStatus: "ready" }]);
    expect(cache.current?.serverDiagnostics.mcpServers).toEqual([]);
  });

  it("ignores stale shared app-server metadata refreshes without applying state", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const stale = new Error("stale");
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockRejectedValue(stale),
      isStaleSharedQueryError: (error) => error === stale,
    });

    await expect(actions.refreshAppServerMetadata()).resolves.toBeNull();

    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.runtimeConfig).toBeNull();
  });

  it("does not apply stale sparse skill refreshes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const updateAppServerMetadata = vi.fn(() => null);
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport({ readSkillMetadata: vi.fn().mockResolvedValue(null) }),
      appServerMetadataSnapshot: () => null,
      updateAppServerMetadata,
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });

    await actions.applyAppServerResourceEvent({ type: "skills-changed", forceReload: true });

    expect(stateStore.getState().connection.availableSkills).toEqual([]);
    expect(updateAppServerMetadata).not.toHaveBeenCalled();
  });

  it("keeps previous skills when sparse skill refresh fails", async () => {
    let state = chatStateFixture();
    const previousSkills = [skillFixture("writer")];
    state = chatStateWith(state, { connection: { availableSkills: previousSkills } });
    const stateStore = createChatStateStore(state);
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport({
        readSkillMetadata: vi.fn().mockResolvedValue({
          value: [],
          probe: diagnosticProbeError("skills", new Error("offline"), 1),
        }),
      }),
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });

    await actions.applyAppServerResourceEvent({ type: "skills-changed", forceReload: true });

    expect(stateStore.getState().connection.availableSkills).toEqual(previousSkills);
    expect(stateStore.getState().connection.serverDiagnostics.probes.skills).toMatchObject({ status: "failed" });
  });

  it("publishes refreshed rate limits from sparse update notifications", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const rateLimit = rateLimitFixture({ primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: null } });
    const cachedMetadata = { current: serverMetadataFixture() as SharedServerMetadata | null };
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport({
        readRateLimitMetadata: vi.fn().mockResolvedValue({
          value: rateLimit,
          probe: diagnosticProbeOk("rateLimits", "available", 1),
        }),
      }),
      ...metadataCacheHost(cachedMetadata),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });

    await actions.applyAppServerResourceEvent({ type: "rate-limits-updated", preserveExistingOnFailure: true });

    expect(stateStore.getState().connection.rateLimit).toMatchObject({ primary: { usedPercent: 64 } });
    expect(cachedMetadata.current?.rateLimit).toStrictEqual(rateLimit);
  });

  it("keeps the previous rate limit snapshot when sparse update refresh fails", async () => {
    let state = chatStateFixture();
    const previousRateLimit = rateLimitFixture({
      limitName: "Codex",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: null },
    });
    state = chatStateWith(state, { connection: { rateLimit: previousRateLimit } });
    const stateStore = createChatStateStore(state);
    const actions = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport({
        readRateLimitMetadata: vi.fn().mockResolvedValue({
          value: null,
          probe: diagnosticProbeError("rateLimits", new Error("offline"), 1),
        }),
      }),
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });

    await actions.applyAppServerResourceEvent({ type: "rate-limits-updated", preserveExistingOnFailure: true });

    expect(stateStore.getState().connection.rateLimit).toBe(previousRateLimit);
    expect(stateStore.getState().connection.serverDiagnostics.probes.rateLimits).toMatchObject({ status: "failed" });
  });
});

describe("server diagnostics actions", () => {
  it("reuses refreshed app-server metadata for deferred diagnostics", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshedMetadata = serverMetadataFixture({
      availableSkills: [skillFixture("writer")],
      serverDiagnostics: diagnosticsWithProbe(
        diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("models", "1 models", 1)),
        diagnosticProbeOk("skills", "1 skills", 1),
      ),
    });
    const metadataCache = metadataCacheHost({ current: null });
    const metadata = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCache,
      refreshAppServerMetadata: vi.fn().mockImplementation(async () => {
        metadataCache.updateAppServerMetadata(() => refreshedMetadata);
        return refreshedMetadata;
      }),
      isStaleSharedQueryError: () => false,
    });
    const readServerDiagnostics = vi.fn().mockResolvedValue(serverDiagnosticsSnapshot());
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics },
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
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics },
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
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics },
      ...metadataCacheHost(),
    });

    await diagnostics.refreshServerDiagnostics({ forceResourceProbes: true });

    expect(readServerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ forceResourceProbes: true }));
    expect(stateStore.getState().connection.serverDiagnostics.probes.models).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
  });

  it("does not apply diagnostic probes when the transport returns no snapshot", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics: vi.fn().mockResolvedValue(null) },
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
    const metadata = createServerMetadataActions({
      stateStore,
      metadataResourceTransport: metadataResourceTransport(),
      ...metadataCache,
      refreshAppServerMetadata: vi.fn().mockResolvedValue(null),
      isStaleSharedQueryError: () => false,
    });
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: {
        readServerDiagnostics: vi.fn().mockResolvedValue(
          serverDiagnosticsSnapshot({
            mcpServerStatuses: [mcpServerStatus()],
          }),
        ),
      },
      ...metadataCache,
    });

    await metadata.applyAppServerResourceEvent({
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
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics: vi.fn(() => pending.promise) },
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
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: { readServerDiagnostics: vi.fn(() => pending.promise) },
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
    const diagnostics = createServerDiagnosticsActions({
      stateStore,
      diagnosticsTransport: {
        readServerDiagnostics: vi.fn().mockResolvedValue(serverDiagnosticsSnapshot({ mcpServerStatuses: [mcpServerStatus()] })),
      },
      ...metadataCacheHost(),
    });

    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    expect(stateStore.getState().connection.serverDiagnostics.mcpServers.map((server) => server.name)).toEqual(["github"]);
  });
});

function metadataResourceTransport(overrides: Partial<MetadataResourceTransport> = {}): MetadataResourceTransport {
  return {
    readSkillMetadata: vi.fn().mockResolvedValue({ value: [], probe: diagnosticProbeOk("skills", "0 skills", 1) }),
    readRateLimitMetadata: vi.fn().mockResolvedValue({ value: null, probe: diagnosticProbeOk("rateLimits", "unavailable", 1) }),
    ...overrides,
  };
}

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

function rateLimitFixture(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: "Codex",
    primary: null,
    secondary: null,
    individualLimit: null,
    rateLimitReachedType: null,
    ...overrides,
  };
}

function serverMetadataFixture(overrides: Partial<SharedServerMetadata> = {}): SharedServerMetadata {
  return {
    runtimeConfig: emptyRuntimeConfigSnapshot(),
    availableSkills: [],
    availablePermissionProfiles: [],
    rateLimit: null,
    serverDiagnostics: createServerDiagnostics(),
    ...overrides,
  };
}

function metadataCacheHost(cache: { current: SharedServerMetadata | null } = { current: null }): {
  appServerMetadataSnapshot: () => SharedServerMetadata | null;
  updateAppServerMetadata: (updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null) => SharedServerMetadata | null;
} {
  return {
    appServerMetadataSnapshot: () => cache.current,
    updateAppServerMetadata: (updater) => {
      const next = updater(cache.current);
      cache.current = next;
      return next;
    },
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
