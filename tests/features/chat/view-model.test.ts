import { describe, expect, it } from "vitest";

import { createAppServerDiagnostics } from "../../../src/app-server/compatibility";
import { createChatState } from "../../../src/features/chat/chat-state";
import {
  activeComposerThreadName,
  activeThreadTitle,
  chatViewDisplayTitle,
  composerMetaViewModel,
  composerPlaceholder,
  effortStatusLines,
  runtimeComposerChoices,
  modelStatusLines,
  runtimeSnapshotForChatSlices,
  statusSummaryLines,
  toolbarViewModel,
} from "../../../src/features/chat/panel/model";
import type { ChatState } from "../../../src/features/chat/chat-state";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import type { ConfigReadResponse } from "../../../src/generated/app-server/v2/ConfigReadResponse";

describe("chat view model", () => {
  it("builds toolbar rows from immutable chat state snapshots", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.threadList.listedThreads = [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")];
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.ui.openDetails = new Set(["history"]);
    state.connection.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.appServerDiagnostics = createAppServerDiagnostics();

    const model = toolbarViewModel({
      state,
      snapshot: runtimeSnapshotFixture(state),
      connected: true,
      turnBusy: true,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveConfirmThreadId: "thread-2",
      archiveExportEnabled: true,
      renameState: (threadId) => (threadId === "thread-1" ? { draft: "Active", generating: false } : null),
    });

    expect(model.openPanel).toBe("history");
    expect(model.newChatDisabled).toBe(true);
    expect(model.threads).toMatchObject([
      { threadId: "thread-1", title: "Active", selected: true, disabled: false, rename: { draft: "Active" } },
      { threadId: "thread-2", title: "Other", selected: false, disabled: true, archiveConfirm: { active: true } },
    ]);
  });

  it("builds composer meta from context and runtime state", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.runtime.selectedCollaborationMode = "plan";
    state.connection.effectiveConfig = effectiveConfigFixture({
      model: "gpt-5.5",
      model_reasoning_effort: "high",
      approvals_reviewer: "auto_review",
      service_tier: "fast",
    });
    state.activeThread.tokenUsage = {
      last: { inputTokens: 42, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 44 },
      total: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 42 },
      modelContextWindow: 100,
    };

    expect(composerMetaViewModel(state, runtimeSnapshotFixture(state))).toEqual({
      fatal: null,
      context: {
        cells: [
          { text: "⣿", placeholder: false },
          { text: "⣶", placeholder: false },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "42%",
      },
      statusSummary: "Context 42%, plan on, auto-review on, fast on, model gpt-5.5, reasoning effort high",
      model: "gpt-5.5",
      effort: "high",
      planActive: true,
      autoReviewActive: true,
      fastActive: true,
    });
  });

  it("uses a neutral composer context indicator when usage is unavailable", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.transcript.displayItems = [
      {
        id: "item",
        turnId: "turn-1",
        kind: "message",
        messageKind: "assistantResponse",
        messageState: "completed",
        text: "Existing turn",
        role: "assistant",
      },
    ];
    state.connection.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5" });

    expect(composerMetaViewModel(state, runtimeSnapshotFixture(state))).toMatchObject({
      fatal: null,
      context: {
        cells: [
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "--%",
      },
      statusSummary: "Context unavailable, plan off, auto-review off, fast off, model gpt-5.5, reasoning effort default",
      model: "gpt-5.5",
      effort: null,
    });
  });

  it("keeps zero percent composer context fixed-width and visible", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.activeThread.tokenUsage = {
      last: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
      total: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
      modelContextWindow: 100,
    };

    expect(composerMetaViewModel(state, runtimeSnapshotFixture(state))).toMatchObject({
      context: {
        cells: [
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: " 0%",
      },
      statusSummary: "Context 0%, plan off, auto-review off, fast off, model default, reasoning effort default",
    });
  });

  it("replaces composer meta with fatal connection state", () => {
    const state = createChatState();
    state.connection.status = "Connection failed.";

    expect(composerMetaViewModel(state, runtimeSnapshotFixture(state))).toEqual({
      fatal: "Codex app-server disconnected",
      context: {
        cells: [
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
          { text: "⣀", placeholder: true },
        ],
        percent: "--%",
      },
      statusSummary: "Codex app-server disconnected",
      model: "",
      effort: null,
      planActive: false,
      autoReviewActive: false,
      fastActive: false,
    });
  });

  it("builds slash-command status lines from chat state", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.connection.effectiveConfig = effectiveConfigFixture({
      model: "gpt-5.5",
      model_provider: "openai",
      model_reasoning_effort: "high",
      service_tier: "fast",
    });
    state.connection.availableModels = [modelFixture("gpt-5.5")];
    const snapshot = runtimeSnapshotFixture(state);

    expect(statusSummaryLines({ activeThreadId: state.activeThread.id, snapshot })[1]).toBe("Thread: thread-1");
    expect(
      modelStatusLines({
        effectiveConfig: state.connection.effectiveConfig,
        requestedModel: state.runtime.requestedModel,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Model: gpt-5.5");
    expect(
      modelStatusLines({
        effectiveConfig: state.connection.effectiveConfig,
        requestedModel: state.runtime.requestedModel,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Mode: Default");
    expect(
      effortStatusLines({
        effectiveConfig: state.connection.effectiveConfig,
        requestedReasoningEffort: state.runtime.requestedReasoningEffort,
        snapshot,
      }),
    ).toContain("Supported: high");
  });

  it("builds runtime composer choices from immutable chat state snapshots", () => {
    const state = createChatState();
    state.connection.effectiveConfig = effectiveConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.availableModels = [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")];
    const selectedModels: (string | null)[] = [];
    const selectedEfforts: string[] = [];

    const choices = runtimeComposerChoices({
      state,
      snapshot: runtimeSnapshotFixture(state),
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
    state.activeThread.id = "thread-1";
    state.threadList.listedThreads = [threadFixture("thread-1", "Active")];

    expect(chatViewDisplayTitle(state, null)).toBe("Codex: Active");
    expect(activeThreadTitle(state)).toBe("Active");
    expect(activeComposerThreadName(state, null)).toBe("Active");
    expect(composerPlaceholder("Active")).toBe("Ask Codex to work on “Active”...");
    expect(composerPlaceholder(null)).toBe("Ask Codex to work on this task...");

    state.threadList.listedThreads = [threadFixture("thread-1", null)];
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

function runtimeSnapshotFixture(state: ChatState) {
  return runtimeSnapshotForChatSlices({
    effectiveConfig: state.connection.effectiveConfig,
    activeThread: state.activeThread,
    runtime: state.runtime,
    rateLimit: state.connection.rateLimit,
    displayItems: state.transcript.displayItems,
    availableModels: state.connection.availableModels,
  });
}

function threadFixture(id: string, name: string | null): Thread & { archived: boolean } {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
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
    archived: false,
    turns: [],
  };
}

function modelFixture(model: string, fastTierId?: string): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: ["high"],
    defaultReasoningEffort: "high",
    inputModalities: [],
    additionalSpeedTiers: fastTierId ? ["fast"] : [],
    serviceTiers: fastTierId ? [{ id: fastTierId, name: "Fast" }] : [],
    defaultServiceTier: null,
    isDefault: true,
  };
}
