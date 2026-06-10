import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { threadFromAppServerThread } from "../../../src/app-server/thread-model";
import { createChatServerDiagnosticsActions } from "../../../src/features/chat/server-actions/diagnostics-actions";
import { createChatServerMetadataActions } from "../../../src/features/chat/server-actions/metadata-actions";
import { createChatServerThreadActions } from "../../../src/features/chat/server-actions/thread-actions";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { McpServerStatus } from "../../../src/generated/app-server/v2/McpServerStatus";
import type { RateLimitSnapshot } from "../../../src/generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../../src/generated/app-server/v2/SkillMetadata";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";

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
      runtimeSnapshot: () => ({ requestedServiceTier: { kind: "unchanged" }, effectiveConfig: null }) as never,
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
      runtimeSnapshot: () => ({ requestedServiceTier: { kind: "unchanged" }, effectiveConfig: null }) as never,
      publishThreadList: vi.fn(),
      syncThreadGoal,
    });

    await controller.startThread("first goal", { syncGoal: false });

    expect(syncThreadGoal).not.toHaveBeenCalled();
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
      runtimeSnapshot: () => ({ requestedServiceTier: { kind: "unchanged" }, effectiveConfig: null }) as never,
      publishThreadList,
      syncThreadGoal: () => undefined,
    });

    await controller.startThread("local preview");

    expect(publishThreadList).toHaveBeenCalledWith([threadFromAppServerThread(started)]);
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

function threadFixture(id: string, overrides: Partial<Thread> = {}): Thread {
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

function modelFixture(model: string): Model {
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

function skillFixture(name: string): SkillMetadata {
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
    credits: null,
    individualLimit: null,
    planType: null,
    rateLimitReachedType: null,
    ...overrides,
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
