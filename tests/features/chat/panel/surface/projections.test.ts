// @vitest-environment jsdom

import { type ComponentChild, h } from "preact";
import { describe, expect, it, vi } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import { createServerDiagnostics } from "../../../../../src/domain/server/diagnostics";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ChatState } from "../../../../../src/features/chat/application/state/root-reducer";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import { createChatPanelShellReadModelBinding } from "../../../../../src/features/chat/panel/shell-read-model";
import type { ChatPanelComposerProjectionActions } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { chatPanelComposerProjection } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { ChatPanelGoal, type ChatPanelGoalSurface } from "../../../../../src/features/chat/panel/surface/goal-projection";
import { ChatPanelToolbar } from "../../../../../src/features/chat/panel/surface/toolbar-projection";
import type { ToolbarActions } from "../../../../../src/features/chat/ui/toolbar";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { installObsidianDomShims } from "../../../../support/dom";
import { withChatStateMessageStreamItems } from "../../support/message-stream";
import { composerReadModelFromChatState } from "../../support/shell-read-model";
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

    const parent = renderWithShellReadModel(state, (readModel) =>
      h(ChatPanelToolbar, {
        model: readModel.toolbar,
        surface: toolbarSurfaceFixture({ archiveExportEnabled: true }),
        actions: toolbarActionsFixture(),
      }),
    );

    expect(parent.querySelector('[data-codex-panel-toolbar-panel="history"]')).not.toBeNull();
    expect(parent.querySelector<HTMLElement>(".codex-panel__new-chat")?.tagName).toBe("DIV");
    expect(parent.querySelector<HTMLElement>(".codex-panel__new-chat")?.classList.contains("is-disabled")).toBe(true);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__thread-row--selected .codex-panel__thread-rename-input")?.value).toBe(
      "Active",
    );
    expect(parent.querySelector(".codex-panel__thread-row--archive-confirming .codex-panel__toolbar-panel-label")?.textContent).toBe(
      "Other",
    );
    const archivedThread = parent.querySelectorAll<HTMLElement>(".codex-panel__thread")[1];
    expect(archivedThread?.tagName).toBe("DIV");
    expect(archivedThread?.classList.contains("is-disabled")).toBe(true);
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
    const parent = renderWithShellReadModel(state, (readModel) =>
      h(ChatPanelToolbar, {
        model: readModel.toolbar,
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture({ copyDebugDetails }),
      }),
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

  it("renders new thread permission baseline in the status panel before a thread is active", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    state = chatStateWith(state, {
      connection: {
        runtimeConfig: runtimeConfigFixture({
          default_permissions: ":workspace",
          approval_policy: "on-request",
          approvals_reviewer: "user",
        }),
      },
    });
    state = chatStateWith(state, {
      runtime: {
        pending: {
          approvalsReviewer: { kind: "set", value: "auto_review" },
          approvalPolicy: { kind: "unchanged" },
          permissionProfile: { kind: "unchanged" },
        },
      },
    });

    const parent = renderWithShellReadModel(state, (readModel) =>
      h(ChatPanelToolbar, {
        model: readModel.toolbar,
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    expect(parent.textContent).toContain("Permissions & Approvals");
    expect(parent.textContent).toContain("Permissions");
    expect(parent.textContent).toContain("Approvals");
    expect([...parent.querySelectorAll(".codex-panel__status-diagnostics-section")].map((section) => section.textContent)).not.toContain(
      "New thread",
    );
    expect(parent.textContent).toContain(":workspace");
    expect(parent.textContent).toContain("on-request");
    expect(parent.textContent).toContain("off");
    expect(parent.textContent).not.toContain("auto_review");
    expect(parent.textContent).not.toContain("user -> auto_review");
    unmountUiRoot(parent);
  });

  it("builds composer meta from context and runtime state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, { runtime: { pending: { collaborationMode: setCollaborationModeIntent("plan") } } });
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state).meta).toMatchObject({
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state).meta).toMatchObject({
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

  it("shows zero percent composer context before a thread starts", () => {
    expect(composerProjectionFromState(composerProjectionActionsFixture(), chatStateFixture()).meta).toMatchObject({
      fatal: null,
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state).meta).toMatchObject({
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state).meta).toMatchObject({
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

  it("builds runtime composer choices from immutable chat state snapshots", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")] } });
    const selectedModels: string[] = [];
    const selectedEfforts: string[] = [];

    const choices = composerProjectionFromState(
      composerProjectionActionsFixture({
        requestModel: async (model) => {
          selectedModels.push(model);
        },
        requestReasoningEffort: async (effort) => {
          selectedEfforts.push(effort);
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
      sendShortcut: () => "enter",
      actions: {
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
    } satisfies ChatPanelGoalSurface;

    const parent = renderWithShellReadModel(state, (readModel) => h(ChatPanelGoal, { model: readModel.goal, surface }));
    state = chatStateWith(state, { activeThread: { id: "thread-current" } });
    clickLabeledButton(parent, "Pause goal");
    clickLabeledButton(parent, "Clear goal");

    state = chatStateWith(state, { activeThread: { goal: { ...goalFixture("thread-rendered"), status: "paused" } } });
    const resumeParent = renderWithShellReadModel(state, (readModel) => h(ChatPanelGoal, { model: readModel.goal, surface }));
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

    const projection = composerProjectionFromState(composerProjectionActionsFixture(), state);

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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState).placeholder).toBe(
      "Ask Codex to work on “Active”...",
    );
    expect(composerProjectionFromState(composerProjectionActionsFixture(), chatStateFixture()).placeholder).toBe(
      "Ask Codex to work on this task...",
    );
  });

  it("projects goal editor and disclosure state before action wiring", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { goal: goalFixture("thread-1") } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "thread-1", objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 } },
    });
    state = chatStateWith(state, { ui: { disclosures: { goalObjectiveExpanded: new Set(["thread-1"]) } } });

    const parent = renderWithShellReadModel(state, (readModel) =>
      h(ChatPanelGoal, { model: readModel.goal, surface: goalSurfaceFixture() }),
    );

    expect(parent.querySelector<HTMLTextAreaElement>(".codex-panel__goal-objective-input")?.value).toBe("Draft goal");
    unmountUiRoot(parent);
  });
});

function renderWithShellReadModel(
  state: ChatState,
  node: (readModel: ReturnType<typeof createChatPanelShellReadModelBinding>["readModel"]) => ComponentChild,
): HTMLElement {
  const parent = document.createElement("div");
  renderUiRoot(parent, node(createChatPanelShellReadModelBinding(state).readModel));
  return parent;
}

function composerProjectionFromState(actions: ChatPanelComposerProjectionActions, state: ChatState) {
  return chatPanelComposerProjection(composerReadModelFromChatState(state), actions);
}

function clickLabeledButton(parent: HTMLElement, label: string): void {
  const button = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Expected button: ${label}`);
  button.click();
}

function toolbarSurfaceFixture(overrides: { archiveExportEnabled?: boolean } = {}) {
  return {
    connection: {
      connected: () => true,
    },
    clock: {
      nowMs: () => 0,
    },
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => overrides.archiveExportEnabled ?? false,
    },
  };
}

interface ToolbarActionOverrides {
  copyDebugDetails?: (details: string) => void;
}

function toolbarActionsFixture(overrides: ToolbarActionOverrides = {}): ToolbarActions {
  return {
    primary: {
      toggleHistory: () => undefined,
      toggleChatActions: () => undefined,
      toggleStatusPanel: () => undefined,
    },
    chat: {
      startNewThread: () => undefined,
      compactConversation: () => undefined,
      setGoal: () => undefined,
    },
    status: {
      connect: () => undefined,
      refreshStatus: () => undefined,
      copyDebugDetails: overrides.copyDebugDetails ?? (() => undefined),
    },
    threads: {
      resume: () => undefined,
      archive: {
        start: () => undefined,
        confirm: () => undefined,
      },
      rename: {
        start: () => undefined,
        updateDraft: () => undefined,
        save: () => undefined,
        cancel: () => undefined,
        autoName: () => undefined,
      },
    },
  };
}

function goalSurfaceFixture(): ChatPanelGoalSurface {
  return {
    sendShortcut: () => "enter",
    actions: {
      saveObjective: async () => true,
      setStatus: async () => undefined,
      clear: async () => undefined,
      startEditing: () => undefined,
      updateObjectiveDraft: () => undefined,
      setObjectiveExpanded: () => undefined,
      closeEditor: () => undefined,
    },
  };
}

function composerProjectionActionsFixture(overrides: Partial<ChatPanelComposerProjectionActions> = {}): ChatPanelComposerProjectionActions {
  return {
    requestModel: async () => undefined,
    requestReasoningEffort: async () => undefined,
    ...overrides,
  };
}

function runtimeConfigFixture(config: Record<string, unknown>): RuntimeConfigSnapshot {
  return runtimeConfigSnapshotFromAppServerConfig({
    config: config as ConfigReadResult["config"],
    origins: {},
    layers: null,
  });
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
