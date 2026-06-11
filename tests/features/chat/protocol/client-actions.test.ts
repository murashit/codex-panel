import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/client";
import type { AppServerMcpServerStatus } from "../../../../src/app-server/diagnostics";
import { emptyRuntimeConfigSnapshot } from "../../../../src/app-server/runtime-config";
import type { RateLimitSnapshot } from "../../../../src/app-server/runtime-metrics";
import { threadFromAppServerThread, type AppServerThread } from "../../../../src/app-server/thread-model";
import { createChatServerDiagnosticsActions } from "../../../../src/features/chat/protocol/client-actions/diagnostics-actions";
import { createChatServerMetadataActions } from "../../../../src/features/chat/protocol/client-actions/metadata-actions";
import { createChatServerThreadActions } from "../../../../src/features/chat/protocol/client-actions/thread-actions";
import { createChatState, createChatStateStore } from "../../../../src/features/chat/state/reducer";
import type { AppServerModel, AppServerSkillMetadata } from "../../../../src/app-server/catalog-model";

describe("chat server actions", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    const state = createChatState();
    const existing = threadFixture("existing");
    state.threadList.listedThreads = [threadFromAppServerThread(existing)];
    const stateStore = createChatStateStore(state);
    const started = threadFixture("started");
    const optimistic = threadFromAppServerThread({ ...started, preview: "first prompt" });
    const existingThread = threadFromAppServerThread(existing);
    const publishThreadList = vi.fn();
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
      publishThreadList,
      syncThreadGoal,
    });

    await controller.startThread("first prompt");

    expect(stateStore.getState().threadList.listedThreads).toEqual([optimistic, existingThread]);
    expect(publishThreadList).toHaveBeenCalledWith([optimistic, existingThread]);
    expect(syncThreadGoal).toHaveBeenCalledWith("started");
  });

  it("can skip newly started thread goal sync when the caller sets the first goal", async () => {
    const stateStore = createChatStateStore(createChatState());
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
      publishThreadList: vi.fn(),
      syncThreadGoal,
    });

    await controller.startThread("first goal", { syncGoal: false });

    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("starts threads with service tier from explicit effective config", async () => {
    const state = createChatState();
    state.connection.runtimeConfig = { ...emptyRuntimeConfigSnapshot(), serviceTier: "flex" };
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
      publishThreadList: vi.fn(),
      syncThreadGoal: vi.fn(),
    });

    await controller.startThread();

    expect(startThread).toHaveBeenCalledWith({ cwd: "/vault", serviceTier: "flex" });
  });

  it("keeps app-server preview when newly started threads already have one", async () => {
    const stateStore = createChatStateStore(createChatState());
    const started = threadFixture("started", { preview: "server preview" });
    const publishThreadList = vi.fn();
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
      publishThreadList,
      syncThreadGoal: () => undefined,
    });

    await controller.startThread("local preview");

    expect(publishThreadList).toHaveBeenCalledWith([threadFromAppServerThread(started)]);
  });

  it("does not apply newly started threads after the client changes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const start = deferred<Awaited<ReturnType<AppServerClient["startThread"]>>>();
    const firstClient = {
      startThread: vi.fn().mockReturnValue(start.promise),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const publishThreadList = vi.fn();
    const syncThreadGoal = vi.fn();
    const controller = createChatServerThreadActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      runtimeSnapshotForState: () => ({ requestedServiceTier: { kind: "unchanged" }, runtimeConfig: null }) as never,
      publishThreadList,
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
    expect(publishThreadList).not.toHaveBeenCalled();
    expect(syncThreadGoal).not.toHaveBeenCalled();
  });

  it("reuses cached app-server metadata for deferred diagnostics", async () => {
    const state = createChatState();
    const stateStore = createChatStateStore(state);

    const listModels = vi.fn().mockResolvedValue({ data: [modelFixture("gpt-5.1")] });
    const listSkills = vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("writer")] }] });
    const readAccountRateLimits = vi.fn().mockResolvedValue({ rateLimits: {} as RateLimitSnapshot });
    const listHooks = vi.fn().mockResolvedValue({ data: [{ cwd: "/vault", hooks: [] }] });
    const client = {
      readEffectiveConfig: vi.fn().mockResolvedValue({}),
      listModels,
      listSkills,
      readAccountRateLimits,
      listHooks,
      listMcpServerStatus: vi.fn().mockResolvedValue({ data: [] }),
      listCollaborationModes: vi.fn().mockResolvedValue({ data: [] }),
      readModelProviderCapabilities: vi.fn().mockResolvedValue({}),
    } as unknown as AppServerClient;

    const metadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata: () => undefined,
    });
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata: () => undefined,
      serverMetadataSnapshot: () => metadata.serverMetadataSnapshot(),
    });

    await metadata.refreshAppServerMetadata();
    listModels.mockClear();
    listSkills.mockClear();
    readAccountRateLimits.mockClear();

    await diagnostics.refreshDiagnosticProbes({ cachedAppServerMetadata: true });

    expect(listModels).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
    expect(readAccountRateLimits).not.toHaveBeenCalled();
    expect(listHooks).toHaveBeenCalledWith("/vault");
    expect(stateStore.getState().connection.appServerDiagnostics.probes["model/list"]).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
    expect(stateStore.getState().connection.appServerDiagnostics.probes["skills/list"]).toMatchObject({
      status: "ok",
      summary: "1 skills",
    });
    expect(stateStore.getState().connection.appServerDiagnostics.probes["account/rateLimits/read"]).toMatchObject({
      status: "ok",
      summary: "available",
    });
  });

  it("does not apply or publish diagnostic probes after the client changes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const hooksRefresh = deferred<{ data: { cwd: string; hooks: unknown[] }[] }>();
    const listHooks = vi.fn().mockReturnValue(hooksRefresh.promise);
    const firstClient = {
      listHooks,
      listMcpServerStatus: vi.fn().mockResolvedValue({ data: [mcpServerStatus()] }),
      listCollaborationModes: vi.fn().mockResolvedValue({ data: [{ mode: "default" }] }),
      readModelProviderCapabilities: vi.fn().mockResolvedValue({ namespaceTools: true, imageGeneration: false, webSearch: false }),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const publishAppServerMetadata = vi.fn();
    const metadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata: () => undefined,
    });
    const diagnostics = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata,
      serverMetadataSnapshot: () => metadata.serverMetadataSnapshot(),
    });

    const refreshing = diagnostics.refreshPublishedDiagnosticProbes({ cachedAppServerMetadata: true });
    currentClient = secondClient;
    hooksRefresh.resolve({ data: [{ cwd: "/vault", hooks: [{}] }] });

    await refreshing;
    expect(listHooks).toHaveBeenCalledWith("/vault");
    expect(stateStore.getState().connection.appServerDiagnostics.probes["hooks/list"].status).toBe("unknown");
    expect(stateStore.getState().connection.appServerDiagnostics.probes["mcpServerStatus/list"].status).toBe("unknown");
    expect(stateStore.getState().connection.appServerDiagnostics.mcpServers).toEqual([]);
    expect(publishAppServerMetadata).not.toHaveBeenCalled();
  });

  it("loads one app-server metadata snapshot from the initially captured client", async () => {
    const stateStore = createChatStateStore(createChatState());
    const readEffectiveConfig = deferred<Record<string, never>>();
    const firstListModels = vi.fn().mockResolvedValue({ data: [modelFixture("gpt-first")] });
    const firstListSkills = vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("first-skill")] }] });
    const firstReadAccountRateLimits = vi.fn().mockResolvedValue({ rateLimits: rateLimitFixture() });
    const secondListModels = vi.fn().mockResolvedValue({ data: [modelFixture("gpt-second")] });
    const secondListSkills = vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("second-skill")] }] });
    const secondReadAccountRateLimits = vi.fn().mockResolvedValue({ rateLimits: rateLimitFixture({ limitName: "Second" }) });
    const firstClient = {
      readEffectiveConfig: vi.fn().mockReturnValue(readEffectiveConfig.promise),
      listModels: firstListModels,
      listSkills: firstListSkills,
      readAccountRateLimits: firstReadAccountRateLimits,
    } as unknown as AppServerClient;
    const secondClient = {
      listModels: secondListModels,
      listSkills: secondListSkills,
      readAccountRateLimits: secondReadAccountRateLimits,
    } as unknown as AppServerClient;
    let currentClient = firstClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata: () => undefined,
    });

    const loading = controller.loadAppServerMetadata();
    currentClient = secondClient;
    readEffectiveConfig.resolve({});

    await expect(loading).resolves.toMatchObject({
      availableModels: [{ model: "gpt-first" }],
      availableSkills: [{ name: "first-skill" }],
    });
    expect(firstListModels).toHaveBeenCalledOnce();
    expect(firstListSkills).toHaveBeenCalledOnce();
    expect(firstReadAccountRateLimits).toHaveBeenCalledOnce();
    expect(secondListModels).not.toHaveBeenCalled();
    expect(secondListSkills).not.toHaveBeenCalled();
    expect(secondReadAccountRateLimits).not.toHaveBeenCalled();
  });

  it("does not apply or publish app-server metadata when the client changes before refresh completes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const readEffectiveConfig = deferred<Record<string, never>>();
    const firstClient = {
      readEffectiveConfig: vi.fn().mockReturnValue(readEffectiveConfig.promise),
      listModels: vi.fn().mockResolvedValue({ data: [modelFixture("gpt-stale")] }),
      listSkills: vi.fn().mockResolvedValue({ data: [{ skills: [skillFixture("stale-skill")] }] }),
      readAccountRateLimits: vi.fn().mockResolvedValue({ rateLimits: rateLimitFixture() }),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const publishAppServerMetadata = vi.fn();
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata,
    });

    const refreshing = controller.refreshPublishedAppServerMetadata();
    currentClient = secondClient;
    readEffectiveConfig.resolve({});

    await expect(refreshing).resolves.toBeNull();
    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.availableSkills).toEqual([]);
    expect(publishAppServerMetadata).not.toHaveBeenCalled();
  });

  it("does not apply refreshed models after the client changes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const modelRefresh = deferred<{ data: AppServerModel[] }>();
    const listModels = vi.fn().mockReturnValue(modelRefresh.promise);
    const firstClient = { listModels } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata: () => undefined,
    });

    const refreshing = controller.refreshModels();
    currentClient = secondClient;
    modelRefresh.resolve({ data: [modelFixture("gpt-stale")] });

    await refreshing;
    expect(listModels).toHaveBeenCalledOnce();
    expect(stateStore.getState().connection.availableModels).toEqual([]);
    expect(stateStore.getState().connection.appServerDiagnostics.probes["model/list"].status).toBe("unknown");
  });

  it("does not apply or publish refreshed skills after the client changes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const skillRefresh = deferred<{ data: { skills: AppServerSkillMetadata[] }[] }>();
    const listSkills = vi.fn().mockReturnValue(skillRefresh.promise);
    const firstClient = { listSkills } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const publishAppServerMetadata = vi.fn();
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata,
    });

    const refreshing = controller.refreshPublishedSkills(true);
    currentClient = secondClient;
    skillRefresh.resolve({ data: [{ skills: [skillFixture("stale-skill")] }] });

    await refreshing;
    expect(listSkills).toHaveBeenCalledWith("/vault", true);
    expect(stateStore.getState().connection.availableSkills).toEqual([]);
    expect(stateStore.getState().connection.appServerDiagnostics.probes["skills/list"].status).toBe("unknown");
    expect(publishAppServerMetadata).not.toHaveBeenCalled();
  });

  it("publishes refreshed rate limits from sparse update notifications", async () => {
    const state = createChatState();
    const stateStore = createChatStateStore(state);
    const rateLimit = rateLimitFixture({ primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: null } });
    const publishAppServerMetadata = vi.fn();
    const client = {
      readAccountRateLimits: vi.fn().mockResolvedValue({ rateLimits: rateLimit, rateLimitsByLimitId: null }),
    } as unknown as AppServerClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata,
    });

    await controller.refreshPublishedRateLimits();

    expect(stateStore.getState().connection.rateLimit).toMatchObject({ primary: { usedPercent: 64 } });
    expect(publishAppServerMetadata).toHaveBeenCalledWith(expect.objectContaining({ rateLimit }));
  });

  it("keeps the previous rate limit snapshot when sparse update refresh fails", async () => {
    const state = createChatState();
    const previousRateLimit = rateLimitFixture({
      limitName: "Codex",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: null },
    });
    state.connection.rateLimit = previousRateLimit;
    const stateStore = createChatStateStore(state);
    const publishAppServerMetadata = vi.fn();
    const client = {
      readAccountRateLimits: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as AppServerClient;
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata,
    });

    await controller.refreshPublishedRateLimits();

    expect(stateStore.getState().connection.rateLimit).toBe(previousRateLimit);
    expect(stateStore.getState().connection.appServerDiagnostics.probes["account/rateLimits/read"]).toMatchObject({ status: "failed" });
    expect(publishAppServerMetadata).not.toHaveBeenCalled();
  });

  it("does not apply or publish sparse rate limit refreshes after the client changes", async () => {
    const stateStore = createChatStateStore(createChatState());
    const rateLimitRefresh = deferred<{ rateLimits: RateLimitSnapshot; rateLimitsByLimitId: null }>();
    const firstClient = {
      readAccountRateLimits: vi.fn().mockReturnValue(rateLimitRefresh.promise),
    } as unknown as AppServerClient;
    const secondClient = {} as unknown as AppServerClient;
    let currentClient = firstClient;
    const publishAppServerMetadata = vi.fn();
    const controller = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => currentClient,
      publishAppServerMetadata,
    });

    const refreshing = controller.refreshPublishedRateLimits();
    currentClient = secondClient;
    rateLimitRefresh.resolve({
      rateLimits: rateLimitFixture({ primary: { usedPercent: 88, windowDurationMins: 300, resetsAt: null } }),
      rateLimitsByLimitId: null,
    });

    await refreshing;
    expect(stateStore.getState().connection.rateLimit).toBeNull();
    expect(stateStore.getState().connection.appServerDiagnostics.probes["account/rateLimits/read"].status).toBe("unknown");
    expect(publishAppServerMetadata).not.toHaveBeenCalled();
  });

  it("loads MCP status lines with cached startup diagnostics", async () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    const stateStore = createChatStateStore(state);
    const listMcpServerStatus = vi.fn().mockResolvedValue({ data: [mcpServerStatus()] });
    const client = {
      listMcpServerStatus,
    } as unknown as AppServerClient;
    const metadata = createChatServerMetadataActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata: () => undefined,
    });
    const controller = createChatServerDiagnosticsActions({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      publishAppServerMetadata: () => undefined,
      serverMetadataSnapshot: () => metadata.serverMetadataSnapshot(),
    });

    controller.recordMcpStartupStatus("github", "ready", null);

    await expect(controller.mcpStatusLines()).resolves.toEqual(["MCP servers", "github: ready, auth oAuth, 1 tool, 0 resources"]);
    expect(listMcpServerStatus).toHaveBeenCalledWith({
      detail: "toolsAndAuthOnly",
      limit: 100,
      threadId: "thread-1",
    });
  });
});

function threadFixture(id: string, overrides: Partial<AppServerThread> = {}): AppServerThread {
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
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function modelFixture(model: string): AppServerModel {
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

function skillFixture(name: string): AppServerSkillMetadata {
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

function mcpServerStatus(): AppServerMcpServerStatus {
  return {
    name: "github",
    serverInfo: null,
    tools: {
      search_issues: { name: "search_issues", inputSchema: {} },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
  } as AppServerMcpServerStatus;
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
