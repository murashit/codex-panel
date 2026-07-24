import { describe, expect, it, vi } from "vitest";

import type { SkillMetadata } from "../../../../../src/domain/catalog/metadata";
import {
  createServerDiagnostics,
  diagnosticProbeOk,
  diagnosticsWithToolInventory,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../../src/domain/server/metadata";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createServerMetadataEffects } from "../../../../../src/features/chat/application/connection/server-metadata-effects";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { runtimeConfigFixture } from "../../../../support/runtime-config";
import { chatStateFixture, chatStateWith } from "../../support/state";

describe("server metadata effects", () => {
  it("leaves metadata publication to query observers after a refresh command", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshAppServerMetadata = vi.fn().mockResolvedValue(undefined);
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      refreshAppServerMetadata,
      isStaleRuntimeError: () => false,
    });

    await effects.refreshAppServerMetadata();

    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.availableSkills).toEqual([]);
  });

  it("preserves panel-local tool diagnostics when applying a resource observation", () => {
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
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      isStaleRuntimeError: () => false,
    });

    effects.applyAppServerMetadataResource({
      id: "models",
      value: undefined,
      probe: diagnosticProbeOk("models", "1 model", 2),
    });

    expect(stateStore.getState().connection.serverDiagnostics).toMatchObject({
      probes: { models: { status: "ok", summary: "1 model" } },
      mcpServers: [{ name: "github", startupStatus: "ready" }],
      toolInventory: { checkedAt: 1 },
    });
  });

  it("keeps MCP startup notifications out of shared metadata", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const cache = { current: serverMetadataFixture() as SharedServerMetadata | null };
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(cache),
      refreshAppServerMetadata: vi.fn().mockResolvedValue(undefined),
      isStaleRuntimeError: () => false,
    });

    await effects.handleAppServerResourceFact({
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
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      refreshAppServerMetadata: vi.fn().mockRejectedValue(stale),
      isStaleRuntimeError: (error) => error === stale,
    });

    await expect(effects.refreshAppServerMetadata()).resolves.toBeUndefined();

    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.runtimeConfig).toBeNull();
  });

  it("does not apply stale skill refreshes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const stale = new Error("stale");
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      refreshSkills: vi.fn().mockRejectedValue(stale),
      isStaleRuntimeError: (error) => error === stale,
    });

    await effects.handleAppServerResourceFact({ type: "skills-changed" });

    expect(stateStore.getState().connection.availableSkills).toEqual([]);
  });

  it("requests an authoritative skills refresh without publishing from the command", async () => {
    let state = chatStateFixture();
    const previousSkills = [skillFixture("writer")];
    state = chatStateWith(state, { connection: { availableSkills: previousSkills } });
    const stateStore = createChatStateStore(state);
    const refreshSkills = vi.fn().mockResolvedValue(undefined);
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      refreshSkills,
    });

    await effects.handleAppServerResourceFact({ type: "skills-changed" });

    expect(refreshSkills).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.availableSkills).toEqual(previousSkills);
  });

  it("requests a rate-limit refresh without publishing from the command", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshRateLimits = vi.fn().mockResolvedValue(undefined);
    const effects = createServerMetadataEffects({
      stateStore,
      ...metadataCacheHost(),
      refreshRateLimits,
    });

    await effects.handleAppServerResourceFact({ type: "rate-limits-updated" });

    expect(refreshRateLimits).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.rateLimit).toBeNull();
  });
});

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
