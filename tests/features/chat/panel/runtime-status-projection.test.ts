import { describe, expect, it } from "vitest";

import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../src/domain/runtime/config";
import { createChatPanelRuntimeProjection } from "../../../../src/features/chat/panel/runtime-status-projection";
import { chatStateFixture, chatStateWith } from "../support/state";

describe("createChatPanelRuntimeProjection", () => {
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
    const projection = createChatPanelRuntimeProjection({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      nowMs: () => 0,
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
    const projection = createChatPanelRuntimeProjection({
      state: () => state,
      connected: () => true,
      configuredCommand: () => "codex",
      vaultPath: () => "/vault",
      nowMs: () => 0,
    });

    expect(projection.permissionDetails()[0]?.auditFacts).toEqual([
      { key: "Profile", value: ":workspace" },
      { key: "Sandbox", value: "(not reported)" },
      { key: "Codex network", value: "(not reported)" },
      { key: "Extra writable roots", value: "(not reported)" },
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
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
