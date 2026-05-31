import { describe, expect, it } from "vitest";

import { capabilityProbeError, createAppServerDiagnostics, upsertMcpServerDiagnostic } from "../../../src/app-server/compatibility";
import { createChatState } from "../../../src/features/chat/chat-state";
import {
  activeComposerThreadName,
  activeThreadTitle,
  chatViewDisplayTitle,
  composerPlaceholder,
  effortStatusLines,
  runtimeToolbarChoices,
  modelStatusLines,
  runtimeSnapshotForChatState,
  statusDotState,
  statusSummaryLines,
  toolbarViewModel,
} from "../../../src/features/chat/view-model";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { ConfigReadResponse } from "../../../src/generated/app-server/v2/ConfigReadResponse";

describe("chat view model", () => {
  it("builds toolbar rows from immutable chat state snapshots", () => {
    const state = createChatState();
    state.activeThreadId = "thread-1";
    state.listedThreads = [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")];
    state.turnLifecycle = { kind: "running", turnId: "turn" };
    state.openDetails = new Set(["history"]);
    state.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.appServerDiagnostics = createAppServerDiagnostics();

    const model = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      connected: true,
      turnBusy: true,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: "thread-2",
      archiveExportEnabled: true,
      modelChoices: [{ label: "gpt-5.5", selected: true, onClick: () => undefined }],
      effortChoices: [{ label: "high", selected: true, onClick: () => undefined }],
      renameState: (threadId) => (threadId === "thread-1" ? { draft: "Active", generating: false } : null),
    });

    expect(model.statusState).toBe("running");
    expect(model.openPanel).toBe("history");
    expect(model.threads).toMatchObject([
      { threadId: "thread-1", title: "Active", selected: true, disabled: false, rename: { draft: "Active" } },
      { threadId: "thread-2", title: "Other", selected: false, disabled: true, archiveConfirm: { active: true } },
    ]);
    expect(model.modelChoices).toHaveLength(1);
  });

  it("marks fast active for the catalog Fast service tier id", () => {
    const state = createChatState();
    state.activeModel = "gpt-5.5";
    state.activeServiceTier = "priority";
    state.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.availableModels = [modelFixture("gpt-5.5", "priority")];

    const model = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      connected: true,
      turnBusy: false,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: null,
      archiveExportEnabled: true,
      modelChoices: [],
      effortChoices: [],
      renameState: () => null,
    });

    expect(model.fastActive).toBe(true);
  });

  it("derives status dot state with running and offline priority", () => {
    const diagnostics = createAppServerDiagnostics();

    expect(statusDotState({ connected: true, turnBusy: true, diagnostics })).toBe("running");
    expect(statusDotState({ connected: false, turnBusy: false, diagnostics })).toBe("offline");
    expect(statusDotState({ connected: false, turnBusy: false, diagnostics, connectionFailed: true })).toBe("blocked");
    expect(statusDotState({ connected: true, turnBusy: false, diagnostics })).toBe("ready");
    expect(statusDotState({ connected: true, turnBusy: false, diagnostics, turnStartBlocked: true })).toBe("blocked");
  });

  it("marks connected status dot as degraded for non-fatal diagnostic issues", () => {
    const failedProbe = createAppServerDiagnostics();
    failedProbe.probes["model/list"] = capabilityProbeError("model/list", new Error("network down"), 1);
    expect(statusDotState({ connected: true, turnBusy: false, diagnostics: failedProbe })).toBe("degraded");
    expect(statusDotState({ connected: true, turnBusy: true, diagnostics: failedProbe })).toBe("running");

    const authIssue = upsertMcpServerDiagnostic(createAppServerDiagnostics(), {
      name: "docs",
      startupStatus: "ready",
      authStatus: "notLoggedIn",
      toolCount: 0,
      message: null,
    });
    expect(statusDotState({ connected: true, turnBusy: false, diagnostics: authIssue })).toBe("degraded");
  });

  it("wires status dot state into the toolbar model", () => {
    const state = createChatState();
    state.appServerDiagnostics.probes["model/list"] = capabilityProbeError("model/list", new Error("network down"), 1);

    const model = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      connected: true,
      turnBusy: false,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: null,
      archiveExportEnabled: true,
      modelChoices: [],
      effortChoices: [],
      renameState: () => null,
    });

    expect(model.statusState).toBe("degraded");

    const runningModel = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      connected: true,
      turnBusy: true,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: null,
      archiveExportEnabled: true,
      modelChoices: [],
      effortChoices: [],
      renameState: () => null,
    });

    expect(runningModel.statusState).toBe("running");
  });

  it("marks connection failure status as blocked in the toolbar model", () => {
    const state = createChatState();
    state.status = "Connection failed.";

    const model = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      connected: false,
      turnBusy: false,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: null,
      archiveExportEnabled: true,
      modelChoices: [],
      effortChoices: [],
      renameState: () => null,
    });

    expect(model.statusState).toBe("blocked");
  });

  it("builds slash-command status lines from chat state", () => {
    const state = createChatState();
    state.activeThreadId = "thread-1";
    state.effectiveConfig = effectiveConfigFixture({
      model: "gpt-5.5",
      model_provider: "openai",
      model_reasoning_effort: "high",
      service_tier: "fast",
    });
    state.availableModels = [modelFixture("gpt-5.5")];
    const snapshot = runtimeSnapshotForChatState({ state });

    expect(statusSummaryLines(state, snapshot)[1]).toBe("Thread: thread-1");
    expect(modelStatusLines(state, snapshot, "Default")).toContain("Model: gpt-5.5");
    expect(modelStatusLines(state, snapshot, "Default")).toContain("Mode: Default");
    expect(effortStatusLines(state, snapshot)).toContain("Supported: high");
  });

  it("builds runtime toolbar choices from immutable chat state snapshots", () => {
    const state = createChatState();
    state.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.availableModels = [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")];
    const selectedModels: (string | null)[] = [];
    const selectedEfforts: string[] = [];

    const choices = runtimeToolbarChoices({
      state,
      snapshot: runtimeSnapshotForChatState({ state }),
      setRequestedModel: (model) => {
        selectedModels.push(model);
      },
      setRequestedReasoningEffort: (effort) => {
        if (effort) selectedEfforts.push(effort);
      },
    });

    expect(choices.modelChoices).toMatchObject([
      { label: "gpt-5-mini", selected: false },
      { label: "gpt-5.5", selected: true },
    ]);
    expect(choices.effortChoices).toMatchObject([{ label: "high", selected: true }]);

    choices.modelChoices[0]?.onClick();
    choices.effortChoices[0]?.onClick();
    expect(selectedModels).toEqual(["gpt-5-mini"]);
    expect(selectedEfforts).toEqual(["high"]);
  });

  it("derives active thread titles and composer placeholders", () => {
    const state = createChatState();
    state.activeThreadId = "thread-1";
    state.listedThreads = [threadFixture("thread-1", "Active")];

    expect(chatViewDisplayTitle(state, null)).toBe("Codex: Active");
    expect(activeThreadTitle(state)).toBe("Active");
    expect(activeComposerThreadName(state, null)).toBe("Active");
    expect(composerPlaceholder("Active")).toBe("Ask Codex to work on “Active”...");
    expect(composerPlaceholder(null)).toBe("Ask Codex to work on this task...");

    state.listedThreads = [threadFixture("thread-1", null)];
    expect(activeComposerThreadName(state, { threadId: "thread-1", title: "Restored", explicitName: "Restored" })).toBe("Restored");
  });
});

function effectiveConfigFixture(config: Record<string, unknown>): ConfigReadResponse {
  return {
    config: config as ConfigReadResponse["config"],
    origins: {},
    layers: null,
  };
}

function threadFixture(id: string, name: string | null): Thread {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns: [],
  };
}

function modelFixture(model: string, fastTierId?: string): Model {
  return {
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
    defaultReasoningEffort: "high",
    inputModalities: [],
    supportsPersonality: false,
    additionalSpeedTiers: fastTierId ? ["fast"] : [],
    serviceTiers: fastTierId ? [{ id: fastTierId, name: "Fast", description: "" }] : [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
