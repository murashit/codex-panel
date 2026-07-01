import { describe, expect, it } from "vitest";

import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import { createChatPanelRuntimeProjection } from "../../../../src/features/chat/panel/runtime-status-projection";
import { chatStateFixture, chatStateWith } from "../support/state";

describe("createChatPanelRuntimeProjection", () => {
  it("builds slash-command status lines from chat state", () => {
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
    const projection = createChatPanelRuntimeProjection({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      nowMs: () => 0,
    });

    expect(projection.statusSummaryLines()[1]).toBe("Thread: thread-1");
    expect(projection.modelStatusLines()).toContain("Model: gpt-5.5");
    expect(projection.modelStatusLines()).toContain("Mode: Default");
    expect(projection.effortStatusLines()).toContain("Supported: high");
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
    const projection = createChatPanelRuntimeProjection({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      nowMs: () => 0,
    });

    expect(projection.permissionDetails()).toEqual([
      {
        title: "Permissions",
        auditFacts: [
          { key: "Profile", value: "workspace-write" },
          { key: "Sandbox", value: "workspace-write" },
          { key: "Network", value: "blocked" },
          { key: "Extra writable roots", value: "Vault/Notes" },
        ],
      },
      {
        title: "Approvals",
        auditFacts: [
          { key: "Approval policy", value: "on-request" },
          { key: "Reviewer", value: "auto_review" },
        ],
      },
    ]);
  });
});

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
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
