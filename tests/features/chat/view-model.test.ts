import { describe, expect, it, vi } from "vitest";

import { createAppServerDiagnostics } from "../../../src/app-server/diagnostics";
import {
  runtimeConfigSnapshotFromAppServerConfig,
  type AppServerConfigReadResponse,
  type RuntimeConfigSnapshot,
} from "../../../src/app-server/runtime-config";
import { createChatState } from "../../../src/features/chat/state/reducer";
import { composerMetaViewModel, composerPlaceholder } from "../../../src/features/chat/panel/view-model/composer";
import {
  effortStatusLines,
  runtimeComposerChoices,
  modelStatusLines,
  statusSummaryLines,
} from "../../../src/features/chat/panel/view-model/runtime";
import { runtimeSnapshotForChatState } from "../../../src/features/chat/runtime/snapshot";
import {
  activeComposerThreadName,
  activeThreadTitle,
  chatViewDisplayTitle,
} from "../../../src/features/chat/panel/view-model/thread-title";
import { toolbarViewModel } from "../../../src/features/chat/panel/view-model/toolbar";
import type { ChatState } from "../../../src/features/chat/state/reducer";
import type { ModelMetadata } from "../../../src/domain/catalog/metadata";
import type { Thread } from "../../../src/domain/threads/model";
import { chatPanelComposerMetaViewModel, chatPanelGoalProps } from "../../../src/features/chat/ui/region-view-models";
import type { ChatPanelComposerPorts, ChatPanelGoalPorts } from "../../../src/features/chat/panel/ui-ports";
import type { ThreadGoal } from "../../../src/app-server/thread-goal";

describe("chat view model", () => {
  it("builds toolbar rows from immutable chat state snapshots", () => {
    const state = createChatState();
    state.activeThread.id = "thread-1";
    state.threadList.listedThreads = [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")];
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.ui.toolbarPanel = "history";
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
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
    state.connection.runtimeConfig = runtimeConfigFixture({
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
    const ports = {
      state: {
        chat: () => {
          throw new Error("Goal status actions should not reread the active thread.");
        },
      },
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
          setEditingOpen: () => undefined,
        },
      },
    } satisfies ChatPanelGoalPorts;

    const props = chatPanelGoalProps(ports, state);
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

  it("builds composer meta from one captured chat state and runtime snapshot", () => {
    const state = createChatState();
    state.connection.runtimeConfig = runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" });
    state.connection.availableModels = [modelFixture("gpt-5.5")];
    const snapshot = runtimeSnapshotFixture(state);
    const chat = vi.fn(() => state);
    const runtimeSnapshot = vi.fn(() => snapshot);

    const model = chatPanelComposerMetaViewModel({
      state: { chat },
      thread: {
        restoredPlaceholder: () => null,
      },
      runtime: {
        snapshot: runtimeSnapshot,
        requestModel: async () => undefined,
        requestReasoningEffort: async () => undefined,
        resetReasoningEffortToConfig: async () => undefined,
      },
    } satisfies ChatPanelComposerPorts);

    expect(chat).toHaveBeenCalledOnce();
    expect(runtimeSnapshot).toHaveBeenCalledOnce();
    expect(model).toMatchObject({
      model: "gpt-5.5",
      effort: "high",
      modelChoices: [{ label: "gpt-5.5", selected: true }],
      effortChoices: [
        { label: "Codex default", selected: false },
        { label: "high", selected: true },
      ],
    });
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

function runtimeConfigFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as AppServerConfigReadResponse["config"],
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
