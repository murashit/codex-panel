import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../src/app-server/client";
import { ChatAppServerController } from "../../../src/features/chat/chat-app-server-controller";
import { createChatState, createChatStateStore } from "../../../src/features/chat/chat-state";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { McpServerStatus } from "../../../src/generated/app-server/v2/McpServerStatus";
import type { RateLimitSnapshot } from "../../../src/generated/app-server/v2/RateLimitSnapshot";
import type { SkillMetadata } from "../../../src/generated/app-server/v2/SkillMetadata";

describe("ChatAppServerController", () => {
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
    const stateStore = createChatStateStore(createChatState());
    const client = {
      listMcpServerStatus: vi.fn().mockResolvedValue({ data: [mcpServerStatus()] }),
    } as unknown as AppServerClient;
    const controller = new ChatAppServerController({
      stateStore,
      vaultPath: "/vault",
      currentClient: () => client,
      runtimeSnapshot: () => ({}) as never,
      forceMessagesToBottom: () => undefined,
      publishAppServerMetadata: () => undefined,
    });

    controller.recordMcpStartupStatus("github", "ready", null);

    await expect(controller.mcpStatusLines()).resolves.toEqual(["MCP servers", "github: ready, auth oAuth, 1 tool, 0 resources"]);
  });
});

function mcpServerStatus(): McpServerStatus {
  return {
    name: "github",
    tools: {
      search_issues: { name: "search_issues", inputSchema: {} },
    },
    resources: [],
    resourceTemplates: [],
    authStatus: "oAuth",
  } as McpServerStatus;
}
