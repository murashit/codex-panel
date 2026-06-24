// @vitest-environment jsdom

import { type ComponentChild, h } from "preact";
import { describe, expect, it, vi } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import { createServerDiagnostics } from "../../../../../src/domain/server/diagnostics";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { runtimeSnapshotForChatState } from "../../../../../src/features/chat/application/runtime/snapshot";
import type { ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { ChatPanelShellStateContext, createChatPanelShellState } from "../../../../../src/features/chat/panel/shell-state";
import type { ChatPanelComposerSurface } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { chatPanelComposerProjection } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { ChatPanelGoal, type ChatPanelGoalSurface } from "../../../../../src/features/chat/panel/surface/goal-projection";
import { ChatPanelToolbar } from "../../../../../src/features/chat/panel/surface/toolbar-projection";
import { effortStatusLines, modelStatusLines, statusSummaryLines } from "../../../../../src/features/chat/presentation/runtime/status";
import type { ToolbarActions } from "../../../../../src/features/chat/ui/toolbar";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/ui-root";
import { installObsidianDomShims } from "../../../../support/dom";
import { withChatStateMessageStreamItems } from "../../support/message-stream";
import { composerShellStateFromChatState } from "../../support/shell-state";
import { chatStateFixture, chatStateWith } from "../../support/state";

installObsidianDomShims();

describe("chat panel surface projections", () => {
  it("builds toolbar rows from immutable chat state snapshots", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, {
      threadList: { listedThreads: [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")] },
    });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = chatStateWith(state, { ui: { toolbarPanel: "history" } });
    state = chatStateWith(state, { ui: { archiveConfirmThreadId: "thread-2" } });
    state = chatStateWith(state, { ui: { rename: { kind: "editing", threadId: "thread-1", draft: "Active" } } });
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { serverDiagnostics: createServerDiagnostics() } });

    const parent = renderWithShellState(
      state,
      h(ChatPanelToolbar, { surface: toolbarSurfaceFixture({ archiveExportEnabled: true }), actions: toolbarActionsFixture() }),
    );

    expect(parent.querySelector('[data-codex-panel-toolbar-panel="history"]')).not.toBeNull();
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__new-chat")?.disabled).toBe(true);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__thread-row--selected .codex-panel__thread-rename-input")?.value).toBe(
      "Active",
    );
    expect(parent.querySelector(".codex-panel__thread-row--archive-confirming .codex-panel__toolbar-panel-label")?.textContent).toBe(
      "Other",
    );
    expect(parent.querySelectorAll<HTMLElement>(".codex-panel__thread")[1]?.getAttribute("aria-disabled")).toBe("true");
    unmountUiRoot(parent);
  });

  it("renders raw runtime debug details from toolbar state sources", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-debug", approval_policy: "on-request" }) },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-debug")] } });
    state = chatStateWith(state, { runtime: { pending: { model: { kind: "set", value: "gpt-debug" } } } });

    const copyDebugDetails = vi.fn<(details: string) => void>();
    const parent = renderWithShellState(
      state,
      h(ChatPanelToolbar, { surface: toolbarSurfaceFixture(), actions: toolbarActionsFixture({ copyDebugDetails }) }),
    );

    parent.querySelectorAll<HTMLButtonElement>(".codex-panel__status-panel-item")[2]?.click();
    const debugContent = copyDebugDetails.mock.calls[0]?.[0];
    if (!debugContent) throw new Error("Expected toolbar debug details");
    const debugDetails = JSON.parse(debugContent) as Record<string, unknown>;

    expect(debugDetails["vaultPath"]).toBe("/vault");
    expect(debugDetails["configuredCommand"]).toBe("codex");
    expect(debugDetails["clientVersion"]).toEqual(expect.any(String));
    expect(debugDetails["activeThreadId"]).toBeNull();
    expect(debugDetails["connection"]).toMatchObject({
      connected: true,
      phase: { kind: "idle" },
      statusText: "Idle",
      initializeResponse: null,
      rateLimit: null,
      serverDiagnostics: {
        probes: expect.any(Object),
        mcpServers: [],
      },
    });
    expect(
      (debugDetails["connection"] as { serverDiagnostics?: Record<string, unknown> }).serverDiagnostics?.["toolInventory"],
    ).toBeUndefined();
    expect(debugDetails["runtimeConfig"]).toMatchObject({ model: "gpt-debug" });
    expect(debugDetails["runtime"]).toMatchObject({ pending: { model: { kind: "set", value: "gpt-debug" } } });
    expect(debugDetails["runtimeLayers"]).toBeUndefined();
    expect(debugDetails["runtimeResolution"]).toBeUndefined();
    expect(debugDetails["availableModels"]).toMatchObject([{ model: "gpt-debug" }]);
    unmountUiRoot(parent);
  });

  it("builds composer meta from context and runtime state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, { runtime: { pending: { collaborationMode: "plan" } } });
    state = chatStateWith(state, {
      connection: {
        runtimeConfig: runtimeConfigFixture({
          model: "gpt-5.5",
          model_reasoning_effort: "high",
          approvals_reviewer: "auto_review",
          service_tier: "fast",
        }),
      },
    });
    state = chatStateWith(state, {
      activeThread: {
        tokenUsage: {
          last: { inputTokens: 42, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 44 },
          total: { inputTokens: 40, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0, totalTokens: 42 },
          modelContextWindow: 100,
        },
      },
    });

    expect(composerProjectionFromState(composerSurfaceFixture(), state).meta).toMatchObject({
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
    });
  });

  it("uses a neutral composer context indicator when usage is unavailable", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = withChatStateMessageStreamItems(state, [
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
    state = chatStateWith(state, { connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }) } });

    expect(composerProjectionFromState(composerSurfaceFixture(), state).meta).toMatchObject({
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
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, {
      activeThread: {
        tokenUsage: {
          last: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
          total: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 },
          modelContextWindow: 100,
        },
      },
    });

    expect(composerProjectionFromState(composerSurfaceFixture(), state).meta).toMatchObject({
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
    let state = chatStateFixture();
    state = chatStateWith(state, { connection: { phase: { kind: "failed", message: "Connection failed." } } });

    expect(composerProjectionFromState(composerSurfaceFixture(), state).meta).toMatchObject({
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
    });
  });

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
    const snapshot = runtimeSnapshotFixture(state);

    expect(statusSummaryLines({ activeThreadId: state.activeThread.id, snapshot, nowMs: 0 })[1]).toBe("Thread: thread-1");
    expect(
      modelStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        pendingModel: state.runtime.pending.model,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Model: gpt-5.5");
    expect(
      modelStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        pendingModel: state.runtime.pending.model,
        snapshot,
        collaborationModeLabel: "Default",
      }),
    ).toContain("Mode: Default");
    expect(
      effortStatusLines({
        runtimeConfig: state.connection.runtimeConfig,
        pendingReasoningEffort: state.runtime.pending.reasoningEffort,
        snapshot,
      }),
    ).toContain("Supported: high");
  });

  it("builds runtime composer choices from immutable chat state snapshots", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")] } });
    const selectedModels: string[] = [];
    const selectedEfforts: string[] = [];

    const choices = composerProjectionFromState(
      composerSurfaceFixture({
        runtime: {
          requestModel: async (model) => {
            selectedModels.push(model);
          },
          requestReasoningEffort: async (effort) => {
            selectedEfforts.push(effort);
          },
        },
      }),
      state,
    ).meta;

    const modelChoices = choices.modelChoices ?? [];
    const effortChoices = choices.effortChoices ?? [];

    expect(modelChoices).toMatchObject([
      { label: "gpt-5-mini", selected: false },
      { label: "gpt-5.5", selected: true },
    ]);
    expect(effortChoices).toMatchObject([{ label: "high", selected: true }]);

    modelChoices[0]?.onClick();
    effortChoices[0]?.onClick();
    expect(selectedModels).toEqual(["gpt-5-mini"]);
    expect(selectedEfforts).toEqual(["high"]);
  });

  it("routes goal status actions to the rendered goal thread", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-rendered" } });
    state = chatStateWith(state, { activeThread: { goal: goalFixture("thread-rendered") } });
    const statuses: [string, string][] = [];
    const clears: string[] = [];
    const surface = {
      settings: {
        sendShortcut: () => "enter",
      },
      actions: {
        goal: {
          saveObjective: async () => true,
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

    const parent = renderWithShellState(state, h(ChatPanelGoal, { surface }));
    state = chatStateWith(state, { activeThread: { id: "thread-current" } });
    clickLabeledButton(parent, "Pause goal");
    clickLabeledButton(parent, "Clear goal");

    state = chatStateWith(state, { activeThread: { goal: { ...goalFixture("thread-rendered"), status: "paused" } } });
    const resumeParent = renderWithShellState(state, h(ChatPanelGoal, { surface }));
    clickLabeledButton(resumeParent, "Resume goal");

    expect(statuses).toEqual([
      ["thread-rendered", "paused"],
      ["thread-rendered", "active"],
    ]);
    expect(clears).toEqual(["thread-rendered"]);
    unmountUiRoot(parent);
    unmountUiRoot(resumeParent);
  });

  it("builds composer meta from one captured chat state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5")] } });

    const projection = composerProjectionFromState(composerSurfaceFixture(), state);

    expect(projection).toMatchObject({
      placeholder: "Ask Codex to work on this task...",
      meta: {
        model: "gpt-5.5",
        effort: "high",
        modelChoices: [{ label: "gpt-5.5", selected: true }],
        effortChoices: [{ label: "high", selected: true }],
      },
    });
  });

  it("derives composer placeholders", () => {
    let activeState = chatStateFixture();
    activeState = chatStateWith(activeState, { activeThread: { id: "thread-1" } });
    activeState = chatStateWith(activeState, { threadList: { listedThreads: [threadFixture("thread-1", "Active")] } });

    expect(composerProjectionFromState(composerSurfaceFixture(), activeState).placeholder).toBe("Ask Codex to work on “Active”...");
    expect(composerProjectionFromState(composerSurfaceFixture(), chatStateFixture()).placeholder).toBe("Ask Codex to work on this task...");
  });

  it("uses restored thread names in the composer projection", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, { threadList: { listedThreads: [threadFixture("thread-1", null)] } });

    expect(
      composerProjectionFromState(
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
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { goal: goalFixture("thread-1") } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "thread-1", objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 } },
    });
    state = chatStateWith(state, { ui: { disclosures: { goalObjectiveExpanded: new Set(["thread-1"]) } } });

    const parent = renderWithShellState(state, h(ChatPanelGoal, { surface: goalSurfaceFixture() }));

    expect(parent.querySelector<HTMLTextAreaElement>(".codex-panel__goal-objective-input")?.value).toBe("Draft goal");
    unmountUiRoot(parent);
  });
});

function renderWithShellState(state: ChatState, node: ComponentChild): HTMLElement {
  const parent = document.createElement("div");
  renderUiRoot(parent, h(ChatPanelShellStateContext.Provider, { value: createChatPanelShellState(state) }, node));
  return parent;
}

function composerProjectionFromState(surface: ChatPanelComposerSurface, state: ChatState) {
  return chatPanelComposerProjection(surface, composerShellStateFromChatState(state));
}

function clickLabeledButton(parent: HTMLElement, label: string): void {
  const button = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Expected button: ${label}`);
  button.click();
}

function toolbarSurfaceFixture(overrides: { archiveExportEnabled?: boolean } = {}) {
  return {
    state: {
      connected: () => true,
      nowMs: () => 0,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => overrides.archiveExportEnabled ?? false,
    },
  };
}

function toolbarActionsFixture(overrides: Partial<ToolbarActions> = {}): ToolbarActions {
  return {
    startNewThread: () => undefined,
    toggleChatActions: () => undefined,
    compactConversation: () => undefined,
    setGoal: () => undefined,
    toggleHistory: () => undefined,
    toggleStatusPanel: () => undefined,
    connect: () => undefined,
    refreshStatus: () => undefined,
    copyDebugDetails: () => undefined,
    resumeThread: () => undefined,
    startArchiveThread: () => undefined,
    archiveThread: () => undefined,
    startRenameThread: () => undefined,
    updateRenameDraft: () => undefined,
    saveRenameThread: () => undefined,
    cancelRenameThread: () => undefined,
    autoNameThread: () => undefined,
    ...overrides,
  };
}

function goalSurfaceFixture(): ChatPanelGoalSurface {
  return {
    settings: {
      sendShortcut: () => "enter",
    },
    actions: {
      goal: {
        saveObjective: async () => true,
        setStatus: async () => undefined,
        clear: async () => undefined,
        startEditing: () => undefined,
        updateObjectiveDraft: () => undefined,
        setObjectiveExpanded: () => undefined,
        closeEditor: () => undefined,
      },
    },
  };
}

function composerSurfaceFixture(overrides: Partial<ChatPanelComposerSurface> = {}): ChatPanelComposerSurface {
  return {
    thread: {
      restoredPlaceholder: () => null,
      ...overrides.thread,
    },
    runtime: {
      requestModel: async () => undefined,
      requestReasoningEffort: async () => undefined,
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
