import { describe, expect, it } from "vitest";

import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import {
  createServerDiagnostics,
  diagnosticsWithToolInventory,
  upsertMcpServerDiagnostic,
} from "../../../../../src/domain/server/diagnostics";
import type { ToolInventorySnapshot } from "../../../../../src/domain/server/tool-inventory";
import { createChatPanelRuntimeNotices } from "../../../../../src/features/chat/host/runtime/notices";
import { chatStateFixture, chatStateWith, sharedResourcesForChatState } from "../../support/state";

describe("createChatPanelRuntimeNotices", () => {
  it("builds slash-command runtime details from chat state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, {
      connection: {
        runtimeConfig: runtimeConfigFixture({
          model: "gpt-5.5",
          model_provider: "openai",
          model_reasoning_effort: "high",
          service_tier: "fast",
        }),
      },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5")] } });
    const projection = createChatPanelRuntimeNotices({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      sharedResources: runtimeShared(state),
    });

    expect(projection.statusDetails()).toEqual([
      {
        auditFacts: [
          { key: "Thread", value: "thread-1" },
          { key: "Context", value: "0 tokens. No turns in this thread yet." },
          { key: "Usage Limits", value: "not available" },
        ],
      },
    ]);
    expect(projection.modelStatusDetails()).toEqual([
      {
        auditFacts: [
          { key: "Model", value: "gpt-5.5" },
          { key: "Override", value: "(none)" },
          { key: "Provider", value: "openai" },
          { key: "Effort", value: "high" },
          { key: "Mode", value: "Default" },
          { key: "Service tier", value: "fast" },
        ],
      },
    ]);
    expect(projection.effortStatusDetails()).toEqual([
      {
        auditFacts: [
          { key: "Effort", value: "high" },
          { key: "Override", value: "(none)" },
          { key: "Supported", value: "high" },
        ],
      },
    ]);
  });

  it("builds slash-command permission details from chat state", () => {
    const state = chatStateWith(chatStateFixture(), {
      activeThread: { id: "thread-1" },
      runtime: {
        active: {
          activePermissionProfile: { id: "workspace-write", extends: null },
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: ["/vault/Notes"],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
        },
      },
    });
    const projection = createChatPanelRuntimeNotices({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      sharedResources: runtimeShared(state),
    });

    expect(projection.permissionDetails()).toEqual([
      {
        title: "Permissions",
        auditFacts: [
          { key: "Profile", value: "workspace-write" },
          { key: "Sandbox", value: "workspace-write" },
          { key: "Codex network", value: "blocked" },
          { key: "Extra writable roots", value: "Vault/Notes" },
        ],
      },
      {
        title: "Approvals",
        auditFacts: [
          { key: "Approval policy", value: "on-request" },
          { key: "Auto review", value: "on" },
        ],
      },
    ]);
  });

  it("keeps pending approval reviewer out of diagnostic permission details", () => {
    const state = chatStateWith(chatStateFixture(), {
      activeThread: { id: "thread-1" },
      connection: {
        runtimeConfig: runtimeConfigFixture({
          approvals_reviewer: "user",
          approval_policy: "on-request",
        }),
      },
      runtime: {
        pending: {
          approvalsReviewer: { kind: "set", value: "auto_review" },
        },
      },
    });
    const projection = createChatPanelRuntimeNotices({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      sharedResources: runtimeShared(state),
    });

    expect(projection.permissionDetails()).toEqual([
      {
        title: "Permissions",
        auditFacts: [
          { key: "Profile", value: "(not reported)" },
          { key: "Sandbox", value: "(not reported)" },
          { key: "Codex network", value: "(not reported)" },
          { key: "Extra writable roots", value: "(not reported)" },
        ],
      },
      {
        title: "Approvals",
        auditFacts: [
          { key: "Approval policy", value: "on-request" },
          { key: "Auto review", value: "off" },
        ],
      },
    ]);
  });

  it("shows pending permission profile reservations in an empty panel", () => {
    const state = chatStateWith(chatStateFixture(), {
      runtime: {
        pending: {
          permissionProfile: { kind: "set", value: ":workspace" },
        },
      },
    });
    const projection = createChatPanelRuntimeNotices({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      sharedResources: runtimeShared(state),
    });

    expect(projection.permissionDetails()[0]?.auditFacts).toEqual([
      { key: "Profile", value: ":workspace" },
      { key: "Sandbox", value: "(not reported)" },
      { key: "Codex network", value: "(not reported)" },
      { key: "Extra writable roots", value: "(not reported)" },
    ]);
  });

  it("projects connection and tool inventory diagnostics into runtime notices", () => {
    const inventory: ToolInventorySnapshot = {
      checkedAt: 1,
      plugins: [],
      pluginMarketplaceErrors: [],
      pluginsError: null,
      mcpServers: [
        {
          name: "github",
          authStatus: "oAuth",
          toolCount: 1,
          resourceCount: 0,
          resourceTemplateCount: 0,
        },
      ],
      mcpDiagnostics: [
        {
          name: "github",
          startupStatus: "ready",
          authStatus: "oAuth",
          toolCount: 1,
          message: null,
        },
      ],
      mcpError: null,
    };
    const githubDiagnostic = inventory.mcpDiagnostics.at(0);
    if (!githubDiagnostic) throw new Error("Expected MCP diagnostic fixture");
    const diagnostics = upsertMcpServerDiagnostic(diagnosticsWithToolInventory(createServerDiagnostics(), inventory), githubDiagnostic);
    const state = chatStateWith(chatStateFixture(), {
      connection: {
        initializeResponse: {
          userAgent: "codex-cli/test",
          codexHome: "/codex",
          platformFamily: "unix",
          platformOs: "macos",
        },
        serverDiagnostics: diagnostics,
      },
    });
    const projection = createChatPanelRuntimeNotices({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      sharedResources: runtimeShared(state),
    });

    expect(projection.connectionDiagnosticDetails()[0]).toMatchObject({
      title: "Process",
      auditFacts: expect.arrayContaining([
        { key: "connection", value: "connected" },
        { key: "Codex App Server", value: "codex-cli/test" },
      ]),
    });
    const toolSections = projection.toolInventoryDetails();
    expect(toolSections.map((section) => section.title)).toEqual(["Plugins", "Tool providers", "Skills"]);
    expect(toolSections.slice(0, 2)).toEqual([
      { title: "Plugins", auditFacts: [{ key: "Plugins", value: "(none)" }] },
      { title: "Tool providers", auditFacts: [{ key: "github", value: "MCP server, ready, auth oAuth, 1 tool, 0 resources" }] },
    ]);
  });
});

function runtimeShared(state: Parameters<typeof sharedResourcesForChatState>[0]) {
  const shared = sharedResourcesForChatState(state);
  return {
    runtimeConfigSnapshot: () => shared.runtimeConfig,
    skillsSnapshot: () => shared.availableSkills,
    rateLimitsSnapshot: () => shared.rateLimit,
    modelsSnapshot: () => shared.availableModels,
    metadataDiagnosticsSnapshot: () => shared.metadataDiagnostics ?? createServerDiagnostics(),
  };
}

function runtimeConfigFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
}

function modelFixture(model: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: ["high"],
    defaultReasoningEffort: "high",
    inputModalities: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
