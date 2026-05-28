import { describe, expect, it } from "vitest";

import { createAppServerDiagnostics } from "../../../src/app-server/compatibility";
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
    supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
    defaultReasoningEffort: "high",
    inputModalities: [],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
