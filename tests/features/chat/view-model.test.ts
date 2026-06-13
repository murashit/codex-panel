import { describe, expect, it } from "vitest";

import { createServerDiagnostics } from "../../../src/domain/server/diagnostics";
import {
  runtimeConfigSnapshotFromAppServerConfig,
  type ConfigReadResult,
  type RuntimeConfigSnapshot,
} from "../../../src/app-server/protocol/runtime-config";
import { createChatState } from "../../../src/features/chat/state/reducer";
import { chatPanelComposerProjection, composerMetaViewModel, composerPlaceholder } from "../../../src/features/chat/panel/surface/composer";
import { effortStatusLines, modelStatusLines, statusSummaryLines } from "../../../src/features/chat/display/status/runtime";
import { runtimeComposerChoices } from "../../../src/features/chat/panel/surface/composer";
import { runtimeSnapshotForChatState } from "../../../src/features/chat/runtime/snapshot";
import { chatPanelToolbarProjection, toolbarStateProjection } from "../../../src/features/chat/panel/surface/toolbar";
import type { ChatState } from "../../../src/features/chat/state/reducer";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { Thread } from "../../../src/domain/threads/model";
import { chatPanelGoalProjection, chatPanelGoalViewModel } from "../../../src/features/chat/panel/surface/goal";
import type { ChatPanelComposerSurface, ChatPanelGoalSurface } from "../../../src/features/chat/panel/surface/model";
import type { ThreadGoal } from "../../../src/domain/threads/goal";
import { setChatStateDisplayItems } from "./support/message-stream";

describe("chat view model", () => {
  it("builds toolbar rows from immutable chat state snapshots", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.threadList.listedThreads = [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")];
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.ui.toolbarPanel = "history";
    state.ui.archiveConfirmThreadId = "thread-2";
    state.ui.rename = { kind: "editing", threadId: "thread-1", draft: "Active" };
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.serverDiagnostics = createServerDiagnostics();

    const input = {
      state,
      snapshot: runtimeSnapshotFixture(state),
      connected: true,
      nowMs: 0,
      turnBusy: true,
      vaultPath: "/vault",
      configuredCommand: "codex",
      archiveExportEnabled: true,
    };
    const model = chatPanelToolbarProjection(input);

    expect(model.openPanel).toBe("history");
    expect(model.newChatDisabled).toBe(true);
    expect(model.threads).toMatchObject([
      { threadId: "thread-1", title: "Active", selected: true, disabled: false, rename: { draft: "Active" } },
      { threadId: "thread-2", title: "Other", selected: false, disabled: true, archiveConfirm: { active: true } },
    ]);
    expect(toolbarStateProjection(input)).toMatchObject({
      newChatDisabled: true,
      historyOpen: true,
      openPanel: "history",
      threads: [
        { threadId: "thread-1", selected: true, disabled: false },
        { threadId: "thread-2", selected: false, disabled: true },
      ],
    });
  });

  it("builds composer meta from context and runtime state", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.runtime.selectedCollaborationMode = "plan";
    state.connection.runtimeConfig = runtimeConfigFixture({
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
    setChatStateDisplayItems(state, [
      {
        id: "item",
        turnId: "turn-1",
        kind: "message",
        messageKind: "assistantResponse",
        messageState: "completed",
        text: "Existing turn",
        role: "assistant",
      },
    ]);
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5" });

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
    state.connection.phase = { kind: "failed", message: "Connection failed." };

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
    state.connection.runtimeConfig = runtimeConfigFixture({
      model: "gpt-5.5",
      model_provider: "openai",
      model_reasoning_effort: "high",
      service_tier: "fast",
    });
    state.connection.availableModels = [modelFixture("gpt-5.5")];
    const snapshot = runtimeSnapshotFixture(state);

    expect(statusSummaryLines({ activeThreadId: state.activeThread.id, snapshot, nowMs: 0 })[1]).toBe("Thread: thread-1");
    expect(
      modelStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        requestedModel: state.runtime.requestedModel,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Model: gpt-5.5");
    expect(
      modelStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        requestedModel: state.runtime.requestedModel,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Mode: Default");
    expect(
      effortStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        requestedReasoningEffort: state.runtime.requestedReasoningEffort,
        snapshot,
      }),
    ).toContain("Supported: high");
  });

  it("builds runtime composer choices from immutable chat state snapshots", () => {
    const state = createChatState();
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.availableModels = [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")];
    const selectedModels: string[] = [];
    const selectedEfforts: string[] = [];
    let resetEffortCount = 0;

    const choices = runtimeComposerChoices({
      state,
      snapshot: runtimeSnapshotFixture(state),
      requestModel: (model) => {
        selectedModels.push(model);
      },
      requestReasoningEffort: (effort) => {
        selectedEfforts.push(effort);
      },
      resetReasoningEffortToConfig: () => {
        resetEffortCount += 1;
      },
    });

    expect(choices.modelChoices).toMatchObject([
      { label: "gpt-5-mini", selected: false },
      { label: "gpt-5.5", selected: true },
    ]);
    expect(choices.effortChoices).toMatchObject([
      { label: "Codex default", selected: false },
      { label: "high", selected: true },
    ]);

    choices.modelChoices[0]?.onClick();
    choices.effortChoices[0]?.onClick();
    choices.effortChoices[1]?.onClick();
    expect(selectedModels).toEqual(["gpt-5-mini"]);
    expect(resetEffortCount).toBe(1);
    expect(selectedEfforts).toEqual(["high"]);
  });

  it("routes goal status actions to the rendered goal thread", () => {
    const state = createChatState();
    state.activeThread.id = "thread-rendered";
    state.activeThread.goal = goalFixture("thread-rendered");
    const statuses: [string, string][] = [];
    const clears: string[] = [];
    const surface = {
      settings: {
        sendShortcut: () => "enter",
      },
      actions: {
        goal: {
          saveObjective: async () => undefined,
          setStatus: async (threadId, status) => {
            statuses.push([threadId, status]);
          },
          clear: async (threadId) => {
            clears.push(threadId);
          },
          startEditing: () => undefined,
          updateObjectiveDraft: () => undefined,
          setObjectiveExpanded: () => undefined,
          closeEditor: () => undefined,
        },
      },
    } satisfies ChatPanelGoalSurface;

    const props = chatPanelGoalViewModel(surface, state);
    state.activeThread.id = "thread-current";
    props.actions.onPause();
    props.actions.onResume();
    props.actions.onClear();

    expect(statuses).toEqual([
      ["thread-rendered", "paused"],
      ["thread-rendered", "active"],
    ]);
    expect(clears).toEqual(["thread-rendered"]);
  });

  it("builds composer meta from one captured chat state", () => {
    const state = createChatState();
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.availableModels = [modelFixture("gpt-5.5")];

    const projection = chatPanelComposerProjection(composerSurfaceFixture(), state);

    expect(projection).toMatchObject({
      placeholder: "Ask Codex to work on this task...",
      meta: {
        model: "gpt-5.5",
        effort: "high",
        modelChoices: [{ label: "gpt-5.5", selected: true }],
        effortChoices: [
          { label: "Codex default", selected: false },
          { label: "high", selected: true },
        ],
      },
    });
  });

  it("derives composer placeholders", () => {
    expect(composerPlaceholder("Active")).toBe("Ask Codex to work on “Active”...");
    expect(composerPlaceholder(null)).toBe("Ask Codex to work on this task...");
  });

  it("uses restored thread names in the composer projection", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.threadList.listedThreads = [threadFixture("thread-1", null)];

    expect(
      chatPanelComposerProjection(
        composerSurfaceFixture({
          thread: {
            restoredPlaceholder: () => ({ threadId: "thread-1", title: "Restored", explicitName: "Restored" }),
          },
        }),
        state,
      ).placeholder,
    ).toBe("Ask Codex to work on “Restored”...");
  });

  it("projects goal editor and disclosure state before action wiring", () => {
    const state = createChatState();
    state.activeThread.goal = goalFixture("thread-1");
    state.ui.goalEditor = { kind: "editing", threadId: "thread-1", objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 };
    state.ui.disclosures.goalObjectiveExpanded = new Set(["thread-1"]);

    expect(chatPanelGoalProjection(state)).toEqual({
      goal: state.activeThread.goal,
      goalThreadId: "thread-1",
      editor: { editing: true, objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 },
      display: { objectiveExpanded: true },
    });
  });
});

function composerSurfaceFixture(overrides: Partial<ChatPanelComposerSurface> = {}): ChatPanelComposerSurface {
  return {
    thread: {
      restoredPlaceholder: () => null,
      ...overrides.thread,
    },
    runtime: {
      requestModel: async () => undefined,
      requestReasoningEffort: async () => undefined,
      resetReasoningEffortToConfig: async () => undefined,
      ...overrides.runtime,
    },
  };
}

function runtimeConfigFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
}

function runtimeSnapshotFixture(state: ChatState) {
  return runtimeSnapshotForChatState(state);
}

function threadFixture(id: string, name: string | null): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name,
    archived: false,
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

function goalFixture(threadId: string): ThreadGoal {
  return {
    threadId,
    objective: "Ship it",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
