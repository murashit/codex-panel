import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { StaleAppServerSharedQueryContextError } from "../../../../../src/app-server/query/shared-queries";
import {
  createServerDiagnostics,
  diagnosticProbeError,
  diagnosticProbeOk,
  diagnosticsWithProbe,
  type McpServerStatus,
} from "../../../../../src/domain/server/diagnostics";
import type { SharedServerMetadata } from "../../../../../src/domain/server/metadata";
import { emptyRuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../../src/domain/runtime/metrics";
import { threadFromThreadRecord } from "../../../../../src/app-server/protocol/thread";
import { createChatServerDiagnosticsActions } from "../../../../../src/features/chat/app-server/actions/diagnostics";
import { createChatServerMetadataActions } from "../../../../../src/features/chat/app-server/actions/metadata";
import { createChatServerThreadActions } from "../../../../../src/features/chat/app-server/actions/threads";
import { toolInventoryDiagnosticSections } from "../../../../../src/features/chat/application/connection/tool-inventory-display";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  modelMetadataFromCatalogModels,
  type CatalogModel,
  type CatalogSkillMetadata,
} from "../../../../../src/app-server/protocol/catalog";
import { chatStateFixture, chatStateWith } from "../../support/state";

type ThreadStartResponse = Awaited<ReturnType<AppServerClient["startThread"]>>;

describe("chat server actions", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    let state = chatStateFixture();
    const existing = threadFixture("existing");
    state = chatStateWith(state, { threadList: { listedThreads: [threadFromThreadRecord(existing)] } });
    const stateStore = createChatStateStore(state);
    const started = threadFixture("started");
    const optimistic = threadFromThreadRecord({ ...started, preview: "first prompt" });
    const existingThread = threadFromThreadRecord(existing);
    const recordThreadStarted = vi.fn();
    const syncThreadGoal = vi.fn();
    const client = {
      startThread: vi.fn().mockResolvedValue({
        thread: started,
        cwd: "/vault",
        model: "gpt-5",
        serviceTier: null,
        approvalPolicy: null,
        approvalsReviewer: null,
        activePermissionProfile: null,
        reasoningEffort: null,
      }),
    } as unknown as AppServerClient;

    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      recordThreadStarted,
      syncThreadGoal,
    });

    await controller.startThread("first prompt");

    expect(stateStore.getState().threadList.listedThreads).toEqual([optimistic, existingThread]);
    expect(recordThreadStarted).toHaveBeenCalledWith(optimistic);
    expect(syncThreadGoal).toHaveBeenCalledWith("started");
  });

  it("keeps empty-panel runtime reservations when starting the first thread", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    stateStore.dispatch({ type: "runtime/model-requested", model: "gpt-5.5" });
    stateStore.dispatch({ type: "runtime/reasoning-effort-requested", effort: "high" });
    stateStore.dispatch({ type: "runtime/service-tier-requested", serviceTier: "fast" });
    stateStore.dispatch({ type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });
    stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "plan" });
    const started = threadFixture("started");
    const startThread = vi.fn().mockResolvedValue({
      thread: started,
      cwd: "/vault",
      model: "gpt-5",
      serviceTier: "fast",
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
      reasoningEffort: null,
    });
    const client = {
      startThread,
    } as unknown as AppServerClient;

    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      recordThreadStarted: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await controller.startThread("first prompt");

    expect(startThread).toHaveBeenCalledWith({ cwd: "/vault", serviceTier: "fast" });
    expect(stateStore.getState().runtime.activeModel).toBe("gpt-5");
    expect(stateStore.getState().runtime.requestedModel).toEqual({ kind: "set", value: "gpt-5.5" });
    expect(stateStore.getState().runtime.requestedReasoningEffort).toEqual({ kind: "set", value: "high" });
    expect(stateStore.getState().runtime.requestedServiceTier).toEqual({ kind: "set", value: "fast" });
    expect(stateStore.getState().runtime.requestedApprovalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(stateStore.getState().runtime.selectedCollaborationMode).toBe("plan");
  });

  it("can skip newly started thread goal sync when the caller sets the first goal", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started");
    const syncThreadGoal = vi.fn();
    const client = {
      startThread: vi.fn().mockResolvedValue({
        thread: started,
        cwd: "/vault",
        model: "gpt-5",
        serviceTier: null,
        approvalPolicy: null,
        approvalsReviewer: null,
        activePermissionProfile: null,
        reasoningEffort: null,
      }),
    } as unknown as AppServerClient;

    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      recordThreadStarted: vi.fn(),
      syncThreadGoal,
    });

    await controller.startThread("first goal", { syncGoal: false });

    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("starts threads with service tier from explicit effective config", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { connection: { runtimeConfig: { ...emptyRuntimeConfigSnapshot(), serviceTier: "flex" } } });
    const stateStore = createChatStateStore(state);
    const started = threadFixture("started");
    const startThread = vi.fn().mockResolvedValue({
      thread: started,
      cwd: "/vault",
      model: "gpt-5",
      serviceTier: "flex",
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
      reasoningEffort: null,
    });
    const client = {
      startThread,
    } as unknown as AppServerClient;

    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      recordThreadStarted: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await controller.startThread();

    expect(startThread).toHaveBeenCalledWith({ cwd: "/vault", serviceTier: "flex" });
  });

  it("keeps app-server preview when newly started threads already have one", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const started = threadFixture("started", { preview: "server preview" });
    const recordThreadStarted = vi.fn();
    const client = {
      startThread: vi.fn().mockResolvedValue({
        thread: started,
        cwd: "/vault",
        model: "gpt-5",
        serviceTier: null,
        approvalPolicy: null,
        approvalsReviewer: null,
        activePermissionProfile: null,
        reasoningEffort: null,
      }),
    } as unknown as AppServerClient;

    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      recordThreadStarted,
      syncThreadGoal: () => undefined,
    });

    await controller.startThread("local preview");

    expect(recordThreadStarted).toHaveBeenCalledWith(threadFromThreadRecord(started));
  });

  it("does not apply newly started threads after the client changes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const start = deferred<Awaited<ReturnType<AppServerClient["startThread"]>>>();
    const firstClient = {
      startThread: vi.fn().mockReturnValue(start.promise),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const recordThreadStarted = vi.fn();
    const syncThreadGoal = vi.fn();
    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      recordThreadStarted,
      syncThreadGoal,
    });

    const starting = controller.startThread("local preview");
    currentClient = secondClient;
    start.resolve({
      thread: threadFixture("stale-started"),
      cwd: "/vault",
      model: "gpt-5",
      modelProvider: "openai",
      serviceTier: null,
      runtimeWorkspaceRoots: [],
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: { type: "readOnly", networkAccess: false },
      activePermissionProfile: null,
      reasoningEffort: null,
    });

    await expect(starting).resolves.toBeNull();
    expect(stateStore.getState().activeThread.id).toBeNull();
    expect(stateStore.getState().threadList.listedThreads).toEqual([]);
    expect(recordThreadStarted).not.toHaveBeenCalled();
    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("reuses cached app-server metadata for deferred diagnostics", async () => {
    const state = chatStateFixture();
    const stateStore = createChatStateStore(state);

    const listMcpServerStatus = vi.fn().mockResolvedValue({ data: [] });
    const refreshedMetadata = serverMetadataFixture({
      availableModels: modelMetadataFromCatalogModels([modelFixture("gpt-5.1")]),
      availableSkills: [{ name: "writer", description: "", path: "/tmp/writer", enabled: true }],
      rateLimit: rateLimitFixture(),
      serverDiagnostics: diagnosticsWithProbe(
        diagnosticsWithProbe(
          diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("model/list", "1 models", 1)),
          diagnosticProbeOk("skills/list", "1 skills", 1),
        ),
        diagnosticProbeOk("account/rateLimits/read", "available", 1),
      ),
    });
    const refreshAppServerMetadata = vi.fn<() => Promise<SharedServerMetadata | null>>().mockResolvedValue(refreshedMetadata);
    const client = {
      listMcpServerStatus,
    } as unknown as AppServerClient;
    const metadataCache = metadataCacheHost({ current: null });

    const metadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCache,
      refreshAppServerMetadata: async () => {
        const next = await refreshAppServerMetadata();
        metadataCache.updateAppServerMetadata(() => next);
        return next;
      },
    });
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCache,
    });

    await metadata.refreshAppServerMetadata();

    await diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    expect(refreshAppServerMetadata).toHaveBeenCalledOnce();
    expect(listMcpServerStatus).toHaveBeenCalledWith({ detail: "toolsAndAuthOnly", limit: 100 });
    expect(stateStore.getState().connection.serverDiagnostics.probes["model/list"]).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
    expect(stateStore.getState().connection.serverDiagnostics.probes["skills/list"]).toMatchObject({
      status: "ok",
      summary: "1 skills",
    });
    expect(stateStore.getState().connection.serverDiagnostics.probes["account/rateLimits/read"]).toMatchObject({
      status: "ok",
      summary: "available",
    });
  });

  it("ignores stale shared app-server metadata refreshes without applying state", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const metadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => null,
      ...metadataCacheHost({ current: null }),
      refreshAppServerMetadata: async () => {
        throw new StaleAppServerSharedQueryContextError();
      },
    });

    await expect(metadata.refreshAppServerMetadata()).resolves.toBeNull();

    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.runtimeConfig).toBeNull();
  });

  it("uses metadata diagnostics as the default resource probe source", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const metadataCache = metadataCacheHost({
      current: serverMetadataFixture({
        serverDiagnostics: diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeOk("model/list", "cached models", 1)),
      }),
    });
    const listModels = vi.fn().mockResolvedValue({ data: [modelFixture("gpt-direct")] });
    const listSkills = vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("direct-skill")] }] });
    const readAccountRateLimits = vi.fn().mockResolvedValue({ rateLimits: rateLimitFixture(), rateLimitsByLimitId: null });
    const listMcpServerStatus = vi.fn().mockResolvedValue({ data: [] });
    const client = {
      listModels,
      listSkills,
      readAccountRateLimits,
      listMcpServerStatus,
    } as unknown as AppServerClient;
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCache,
    });

    await diagnostics.refreshServerDiagnostics();

    expect(listModels).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
    expect(readAccountRateLimits).not.toHaveBeenCalled();
    expect(stateStore.getState().connection.serverDiagnostics.probes["model/list"]).toMatchObject({
      status: "ok",
      summary: "cached models",
    });
    expect(listMcpServerStatus).toHaveBeenCalledWith({ detail: "toolsAndAuthOnly", limit: 100 });
  });

  it("can force resource probes for explicit health checks", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const listModels = vi.fn().mockResolvedValue({ data: [modelFixture("gpt-direct")] });
    const listSkills = vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("direct-skill")] }] });
    const readAccountRateLimits = vi.fn().mockResolvedValue({ rateLimits: rateLimitFixture(), rateLimitsByLimitId: null });
    const client = {
      listModels,
      listSkills,
      readAccountRateLimits,
      listMcpServerStatus: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as AppServerClient;
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCacheHost(),
    });

    await diagnostics.refreshServerDiagnostics({ forceResourceProbes: true });

    expect(listModels).toHaveBeenCalledWith(false);
    expect(listSkills).toHaveBeenCalledWith("/vault");
    expect(readAccountRateLimits).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.serverDiagnostics.probes["model/list"]).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
  });

  it("does not apply or publish diagnostic probes after the client changes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const mcpStatusRefresh = deferred<{ data: ReturnType<typeof mcpServerStatus>[] }>();
    const listMcpServerStatus = vi.fn().mockReturnValue(mcpStatusRefresh.promise);
    const firstClient = {
      listMcpServerStatus,
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const updateAppServerMetadata = vi.fn(() => null);
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      appServerMetadataSnapshot: () => null,
      updateAppServerMetadata,
    });

    const refreshing = diagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });
    currentClient = secondClient;
    mcpStatusRefresh.resolve({ data: [mcpServerStatus()] });

    await refreshing;
    expect(listMcpServerStatus).toHaveBeenCalledWith({ detail: "toolsAndAuthOnly", limit: 100 });
    expect(stateStore.getState().connection.serverDiagnostics.probes["mcpServerStatus/list"].status).toBe("unknown");
    expect(stateStore.getState().connection.serverDiagnostics.mcpServers).toEqual([]);
    expect(updateAppServerMetadata).not.toHaveBeenCalled();
  });

  it("does not apply or publish app-server metadata when the client changes before refresh completes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const refreshAppServerMetadata = vi.fn().mockResolvedValue(null);
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => ({}) as AppServerClient,
      ...metadataCacheHost(),
      refreshAppServerMetadata,
    });

    const refreshing = controller.refreshAppServerMetadata();

    await expect(refreshing).resolves.toBeNull();
    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.availableSkills).toEqual([]);
  });

  it("keeps query-cached models visible when metadata model refresh fails", async () => {
    const state = chatStateFixture();
    const stateStore = createChatStateStore(state);
    const metadata = serverMetadataFixture({
      availableModels: modelMetadataFromCatalogModels([modelFixture("gpt-cached")]),
      serverDiagnostics: diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeError("model/list", new Error("offline"), 1)),
    });
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => ({}) as AppServerClient,
      ...metadataCacheHost({ current: metadata }),
      refreshAppServerMetadata: async () => metadata,
    });

    await controller.refreshAppServerMetadata();

    expect(stateStore.getState().connection.availableModels.map((model) => model.model)).toEqual(["gpt-cached"]);
    expect(stateStore.getState().connection.serverDiagnostics.probes["model/list"].status).toBe("failed");
  });

  it("does not use chat state as a second model source when metadata model refresh fails", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { connection: { availableModels: modelMetadataFromCatalogModels([modelFixture("gpt-state-only")]) } });
    const stateStore = createChatStateStore(state);
    const metadata = serverMetadataFixture({
      availableModels: [],
      serverDiagnostics: diagnosticsWithProbe(createServerDiagnostics(), diagnosticProbeError("model/list", new Error("offline"), 1)),
    });
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => ({}) as AppServerClient,
      ...metadataCacheHost({ current: metadata }),
      refreshAppServerMetadata: async () => metadata,
    });

    await controller.refreshAppServerMetadata();

    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.serverDiagnostics.probes["model/list"].status).toBe("failed");
  });

  it("does not apply or publish refreshed skills after the client changes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const skillRefresh = deferred<{ data: { skills: CatalogSkillMetadata[] }[] }>();
    const listSkills = vi.fn().mockReturnValue(skillRefresh.promise);
    const firstClient = { listSkills } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const updateAppServerMetadata = vi.fn(() => null);
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      appServerMetadataSnapshot: () => null,
      updateAppServerMetadata,
      refreshAppServerMetadata: async () => null,
    });

    const refreshing = controller.refreshSkills(true);
    currentClient = secondClient;
    skillRefresh.resolve({ data: [{ skills: [skillFixture("stale-skill")] }] });

    await refreshing;
    expect(listSkills).toHaveBeenCalledWith("/vault", true);
    expect(stateStore.getState().connection.availableSkills).toEqual([]);
    expect(stateStore.getState().connection.serverDiagnostics.probes["skills/list"].status).toBe("unknown");
    expect(updateAppServerMetadata).not.toHaveBeenCalled();
  });

  it("publishes refreshed rate limits from sparse update notifications", async () => {
    const state = chatStateFixture();
    const stateStore = createChatStateStore(state);
    const rateLimit = rateLimitFixture({ primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: null } });
    const cachedMetadata = { current: serverMetadataFixture() as SharedServerMetadata | null };
    const client = {
      readAccountRateLimits: vi.fn().mockResolvedValue({ rateLimits: rateLimit, rateLimitsByLimitId: null }),
    } as unknown as AppServerClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCacheHost(cachedMetadata),
      refreshAppServerMetadata: async () => null,
    });

    await controller.refreshRateLimits({ preserveExistingOnFailure: true });

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
    const client = {
      readAccountRateLimits: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as AppServerClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCacheHost(),
      refreshAppServerMetadata: async () => null,
    });

    await controller.refreshRateLimits({ preserveExistingOnFailure: true });

    expect(stateStore.getState().connection.rateLimit).toBe(previousRateLimit);
    expect(stateStore.getState().connection.serverDiagnostics.probes["account/rateLimits/read"]).toMatchObject({ status: "failed" });
  });

  it("does not apply or publish sparse rate limit refreshes after the client changes", async () => {
    const stateStore = createChatStateStore(chatStateFixture());
    const rateLimitRefresh = deferred<{ rateLimits: RateLimitSnapshot; rateLimitsByLimitId: null }>();
    const firstClient = {
      readAccountRateLimits: vi.fn().mockReturnValue(rateLimitRefresh.promise),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const updateAppServerMetadata = vi.fn(() => null);
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      appServerMetadataSnapshot: () => null,
      updateAppServerMetadata,
      refreshAppServerMetadata: async () => null,
    });

    const refreshing = controller.refreshRateLimits({ preserveExistingOnFailure: true });
    currentClient = secondClient;
    rateLimitRefresh.resolve({
      rateLimits: rateLimitFixture({ primary: { usedPercent: 88, windowDurationMins: 300, resetsAt: null } }),
      rateLimitsByLimitId: null,
    });

    await refreshing;
    expect(stateStore.getState().connection.rateLimit).toBeNull();
    expect(stateStore.getState().connection.serverDiagnostics.probes["account/rateLimits/read"].status).toBe("unknown");
    expect(updateAppServerMetadata).not.toHaveBeenCalled();
  });

  it("refreshes tool provider snapshots with cached MCP startup diagnostics", async () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    const stateStore = createChatStateStore(state);
    const listMcpServerStatus = vi.fn().mockResolvedValue({ data: [mcpServerStatus()] });
    const client = {
      listApps: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      listInstalledPlugins: vi.fn().mockResolvedValue({ marketplaces: [], marketplaceLoadErrors: [] }),
      listMcpServerStatus,
      listSkills: vi.fn().mockResolvedValue({ data: [{ cwd: "/vault", skills: [] }] }),
    } as unknown as AppServerClient;
    const metadataCache = metadataCacheHost({ current: serverMetadataFixture() });
    const controller = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      ...metadataCache,
    });

    controller.recordMcpStartupStatus("github", "ready", null);

    await controller.refreshServerDiagnostics({ appServerMetadataSnapshot: true });

    const sections = toolInventoryDiagnosticSections(stateStore.getState().connection.serverDiagnostics);
    const providerRows = sections.find((section) => section.title === "Tool providers")?.rows ?? [];

    expect(sections.map((section) => section.title)).toEqual(["Plugins", "Tool providers", "Skills"]);
    expect(providerRows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      "codex_apps: (none)",
      "github: MCP server, ready, auth oAuth, 1 tool, 0 resources",
    ]);
    expect(listMcpServerStatus).toHaveBeenCalledWith({
      detail: "toolsAndAuthOnly",
      limit: 100,
      threadId: "thread-1",
    });
  });
});

function threadFixture(id: string, overrides: Partial<ThreadStartResponse["thread"]> = {}): ThreadStartResponse["thread"] {
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "test",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function modelFixture(model: string): CatalogModel {
  return {
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

function skillFixture(name: string): CatalogSkillMetadata {
  return {
    name,
    description: "",
    path: `/skills/${name}`,
    scope: "repo",
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
    availableModels: [],
    availableSkills: [],
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

function mcpServerStatus(): McpServerStatus {
  return {
    name: "github",
    serverInfo: null,
    tools: {
      search_issues: { name: "search_issues", inputSchema: {} },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
  } as McpServerStatus;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
