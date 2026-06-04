import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { ChatAppServerController } from "../../../src/features/chat/chat-app-server-controller";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { McpServerStatus } from "../../../src/generated/app-server/v2/McpServerStatus";
import type { RateLimitSnapshot } from "../../../src/generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../../src/generated/app-server/v2/SkillMetadata";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";

describe("ChatAppServerController", () => {
  it("publishes newly started threads before the first turn completes", async () => {
    const state = createChatState();
    const existing = threadFixture("existing");
    state.listedThreads = [existing];
    const stateStore = createChatStateStore(state);
    const started = threadFixture("started");
    const optimistic = { ...started, preview: "first prompt" };
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

    const controller = new ChatAppServerController({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshot: () => ({ requestedServiceTier: { kind: "unchanged" }, effectiveConfig: null }) as never,
      forceMessagesToBottom: () => undefined,
      publishThreadList,
      publishAppServerMetadata: () => undefined,
    });

    await controller.startThread("first prompt");

    expect(stateStore.getState().listedThreads.map((thread) => thread.id)).toEqual(["started", "existing"]);
    expect(publishThreadList).toHaveBeenCalledWith([optimistic, existing]);
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

    const controller = new ChatAppServerController({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshot: () => ({ requestedServiceTier: { kind: "unchanged" }, effectiveConfig: null }) as never,
      forceMessagesToBottom: () => undefined,
      publishThreadList,
      publishAppServerMetadata: () => undefined,
    });

    await controller.startThread("local preview");

    expect(publishThreadList).toHaveBeenCalledWith([started]);
  });

  it("reuses cached app-server metadata for deferred diagnostics", async () => {
    const state = createChatState();
    const stateStore = createChatStateStore(state);

    const listModels = vi.fn().mockResolvedValue({ data: [{ model: "gpt-5.1" } as Model] });
    const listSkills = vi.fn().mockResolvedValue({ data: [{ skills: [{ name: "writer", enabled: true } as SkillMetadata] }] });
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

    const controller = new ChatAppServerController({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshot: () => ({}) as never,
      forceMessagesToBottom: () => undefined,
      publishThreadList: () => undefined,
      publishAppServerMetadata: () => undefined,
    });

    await controller.refreshAppServerMetadata();
    listModels.mockClear();
    listSkills.mockClear();
    readAccountRateLimits.mockClear();

    await controller.refreshCapabilityDiagnostics({ cachedAppServerMetadata: true });

    expect(listModels).not.toHaveBeenCalled();
    expect(listSkills).not.toHaveBeenCalled();
    expect(readAccountRateLimits).not.toHaveBeenCalled();
    expect(listHooks).toHaveBeenCalledWith("/vault");
    expect(stateStore.getState().appServerDiagnostics.probes["model/list"]).toMatchObject({
      status: "ok",
      summary: "1 models",
    });
    expect(stateStore.getState().appServerDiagnostics.probes["skills/list"]).toMatchObject({
      status: "ok",
      summary: "1 skills",
    });
    expect(stateStore.getState().appServerDiagnostics.probes["account/rateLimits/read"]).toMatchObject({
      status: "ok",
      summary: "available",
    });
  });

  it("loads MCP status lines with cached startup diagnostics", async () => {
    const state = createChatState();
    state.activeThreadId = "thread-1";
    const stateStore = createChatStateStore(state);
    const listMcpServerStatus = vi.fn().mockResolvedValue({ data: [mcpServerStatus()] });
    const client = {
      listMcpServerStatus,
    } as unknown as AppServerClient;
    const controller = new ChatAppServerController({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshot: () => ({}) as never,
      forceMessagesToBottom: () => undefined,
      publishThreadList: () => undefined,
      publishAppServerMetadata: () => undefined,
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
