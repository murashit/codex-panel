// @vitest-environment jsdom

import { type ComponentChild, h } from "preact";
import { describe, expect, it, vi } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import { createServerDiagnostics } from "../../../../../src/domain/server/diagnostics";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import { type ChatState, chatReducer } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import {
  selectChatPanelComposer,
  selectChatPanelGoal,
  selectChatPanelThreadStream,
  selectChatPanelToolbar,
} from "../../../../../src/features/chat/panel/shell-selectors";
import type { ChatPanelComposerProjectionActions } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { chatPanelComposerProjection } from "../../../../../src/features/chat/panel/surface/composer-projection";
import { ChatPanelGoal, type ChatPanelGoalSurface } from "../../../../../src/features/chat/panel/surface/goal-projection";
import {
  type ChatThreadStreamSurfaceContext,
  threadStreamSurfaceProjectionFromModel,
} from "../../../../../src/features/chat/panel/surface/thread-stream-projection";
import { ChatPanelToolbar } from "../../../../../src/features/chat/panel/surface/toolbar-projection";
import type { ToolbarActions } from "../../../../../src/features/chat/ui/toolbar";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { installObsidianDomShims } from "../../../../support/dom";
import { composerModelFromChatState } from "../../support/shell-selectors";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateThreadStreamItems } from "../../support/thread-stream";

installObsidianDomShims();

describe("chat panel surface projections", () => {
  it("disables compact context without an active thread", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { ui: { toolbarPanel: "chat-actions" } });
    const compactContext = vi.fn();
    const actions = toolbarActionsFixture();
    actions.chat.compactContext = compactContext;
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, { model: models.toolbar, stateStore: createChatStateStore(state), surface: toolbarSurfaceFixture(), actions }),
    );

    const compact = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")].find(
      (item) => item.textContent === "Compact context",
    );
    expect(compact?.classList.contains("is-disabled")).toBe(true);
    compact?.click();
    expect(compactContext).not.toHaveBeenCalled();
    unmountUiRoot(parent);
  });

  it("disables archive but keeps rename available while the active thread is busy", () => {
    let state = chatStateFixture({
      activeThread: { id: "thread" },
      threadList: { listedThreads: [threadFixture("thread", "Thread"), threadFixture("other", "Other")] },
    });
    state = chatStateWith(state, {
      turn: { lifecycle: { kind: "running", turnId: "turn" } },
      ui: { toolbarPanel: "history" },
    });
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: createChatStateStore(state),
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    const archiveButtons = [...parent.querySelectorAll<HTMLButtonElement>('[aria-label="Archive thread"]')];
    const renameButtons = [...parent.querySelectorAll<HTMLButtonElement>('[aria-label="Rename thread"]')];
    expect(archiveButtons).toHaveLength(2);
    expect(archiveButtons.every((button) => button.disabled)).toBe(true);
    expect(renameButtons).toHaveLength(2);
    expect(renameButtons.every((button) => !button.disabled)).toBe(true);
    unmountUiRoot(parent);
  });

  it("disables other rename actions while a rename save is pending", () => {
    let state = chatStateFixture({
      activeThread: { id: "thread" },
      threadList: { listedThreads: [threadFixture("thread", "Thread"), threadFixture("other", "Other")] },
    });
    state = chatStateWith(state, {
      ui: {
        toolbarPanel: "history",
        rename: {
          kind: "saving",
          threadId: "thread",
          draft: "Thread",
          autoName: { kind: "unavailable" },
          saveToken: 1,
        },
      },
    });
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: createChatStateStore(state),
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    const renameButtons = [...parent.querySelectorAll<HTMLButtonElement>('[aria-label="Rename thread"]')];
    expect(renameButtons).toHaveLength(1);
    expect(renameButtons[0]?.disabled).toBe(true);
    unmountUiRoot(parent);
  });

  it("disables subagent chat actions except starting a new chat", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "child",
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: "Scout",
          agentRole: "explorer",
        },
      },
      turn: { lifecycle: { kind: "running", turnId: "child-turn" } },
      ui: { toolbarPanel: "chat-actions" },
    });
    const actions = toolbarActionsFixture();
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, { model: models.toolbar, stateStore: createChatStateStore(state), surface: toolbarSurfaceFixture(), actions }),
    );

    const items = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")];
    expect(items.map((item) => [item.textContent, item.classList.contains("is-disabled")])).toEqual([
      ["Start new chat", false],
      ["Start side chat", true],
      ["Compact context", true],
      ["Set goal...", true],
    ]);
    unmountUiRoot(parent);
  });

  it("does not project rollback actions for side chats", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "side-thread",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
    });
    state = withChatStateThreadStreamItems(state, [
      { id: "user", kind: "dialogue", dialogueKind: "user", role: "user", text: "Question", turnId: "turn" },
      {
        id: "assistant",
        kind: "dialogue",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
        role: "assistant",
        text: "Answer",
        turnId: "turn",
      },
    ]);

    const projection = threadStreamSurfaceProjectionFromModel(selectChatPanelThreadStream(state), threadStreamSurfaceContext());
    expect(JSON.stringify(projection.blocks)).not.toContain('"rollback":true');
  });

  it("projects the latest direct subagent activity into the live agent summary", () => {
    let state = chatStateFixture({ activeThread: { id: "parent" } });
    state = chatReducer(state, {
      type: "turn/started",
      threadId: "parent",
      turnId: "parent-turn",
      items: [
        {
          id: "agent",
          kind: "agent",
          role: "tool",
          turnId: "parent-turn",
          tool: "wait",
          status: "inProgress",
          senderThreadId: "parent",
          receiverThreadIds: ["child"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "running", executionState: "running", message: null }],
          executionState: "running",
        },
      ],
    });
    state = chatReducer(state, {
      type: "subagent-activity/tracked",
      threadId: "child",
      parentTurnId: "parent-turn",
    });
    state = chatReducer(state, {
      type: "subagent-activity/text-delta-appended",
      threadId: "child",
      childTurnId: "child-turn",
      itemId: "reasoning",
      label: "reasoning",
      delta: "Inspecting notification routing",
      kind: "reasoning",
    });

    const projection = threadStreamSurfaceProjectionFromModel(selectChatPanelThreadStream(state), threadStreamSurfaceContext());
    const summary = projection.blocks.find((block) => block.kind === "liveAgentSummary");

    expect(summary).toMatchObject({
      kind: "liveAgentSummary",
      view: {
        summary: "Agents 1 running",
        rows: [{ threadId: "child", status: "Inspecting notification routing" }],
      },
    });
  });

  it("resolves persisted reference titles from the thread catalog", () => {
    let state = chatStateFixture({
      threadList: {
        listedThreads: [
          {
            id: "thread-reference",
            name: "Readable reference title",
            preview: "",
            archived: false,
            createdAt: 1,
            updatedAt: 1,
            provenance: { kind: "interactive" },
          },
        ],
      },
    });
    state = withChatStateThreadStreamItems(state, [
      {
        id: "user",
        kind: "dialogue",
        dialogueKind: "user",
        role: "user",
        text: "continue",
        referencedThread: {
          threadId: "thread-reference",
          title: "thread-r",
          includedTurns: 2,
          turnLimit: 20,
        },
      },
    ]);

    const projection = threadStreamSurfaceProjectionFromModel(selectChatPanelThreadStream(state), threadStreamSurfaceContext());

    expect(JSON.stringify(projection.blocks)).toContain("Readable reference title");
    expect(JSON.stringify(projection.blocks)).not.toContain('"title":"thread-r"');
  });

  it("keeps compact available but hides goal mutation behind the side-chat policy", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "side",
        lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
      },
      ui: { toolbarPanel: "chat-actions" },
    });
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: createChatStateStore(state),
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    const items = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")];
    expect(items.map((item) => [item.textContent, item.classList.contains("is-disabled")])).toEqual([
      ["Start new chat", false],
      ["Start side chat", true],
      ["Compact context", false],
      ["Set goal...", true],
    ]);
    const composer = selectChatPanelComposer(state);
    expect(composer.submissionBlockedByPanelPolicy).toBe(false);
    expect(composer.runtimeSettingsDisabled).toBe(true);
    unmountUiRoot(parent);
  });

  it("keeps Set goal enabled while a restored thread still needs hydration", () => {
    const store = createChatStateStore(chatStateFixture());
    store.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    store.dispatch({ type: "ui/panel-set", panel: "chat-actions" });
    const restored = store.getState();
    const parent = renderWithShellModels(restored, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: store,
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    const goalAction = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")].find(
      (item) => item.textContent === "Set goal...",
    );
    expect(goalAction?.classList.contains("is-disabled")).toBe(false);
    expect(selectChatPanelGoal(restored).goalMutationsAllowed).toBe(false);
    unmountUiRoot(parent);
  });

  it("builds toolbar rows from immutable chat state snapshots", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, {
      threadList: { listedThreads: [threadFixture("thread-1", "Active"), threadFixture("thread-2", "Other")] },
    });
    state = chatStateWith(state, { turn: { lifecycle: { kind: "running", turnId: "turn" } } });
    state = chatStateWith(state, { ui: { toolbarPanel: "history" } });
    state = chatStateWith(state, { ui: { archiveConfirmThreadId: "thread-2" } });
    state = chatStateWith(state, {
      ui: { rename: { kind: "editing", threadId: "thread-1", draft: "Active", autoName: { kind: "unavailable" } } },
    });
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { serverDiagnostics: createServerDiagnostics() } });

    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: createChatStateStore(state),
        surface: toolbarSurfaceFixture({ archiveExportEnabled: true }),
        actions: toolbarActionsFixture(),
      }),
    );

    expect(parent.querySelector('[data-codex-panel-toolbar-panel="history"]')).not.toBeNull();
    expect(parent.querySelector<HTMLElement>(".codex-panel__new-chat")?.tagName).toBe("DIV");
    expect(parent.querySelector<HTMLElement>(".codex-panel__new-chat")?.classList.contains("is-disabled")).toBe(false);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__thread-row--selected .codex-panel__thread-rename-input")?.value).toBe(
      "Active",
    );
    expect(parent.querySelector(".codex-panel__thread-row--archive-confirming .codex-panel__toolbar-panel-label")?.textContent).toBe(
      "Other",
    );
    const archivedThread = parent.querySelectorAll<HTMLElement>(".codex-panel__thread")[1];
    expect(archivedThread?.tagName).toBe("DIV");
    expect(archivedThread?.classList.contains("is-disabled")).toBe(false);
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
    const stateStore = createChatStateStore(state);

    const copyDebugDetails = vi.fn<(details: string) => void>();
    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore,
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture({ copyDebugDetails }),
      }),
    );
    stateStore.dispatch({ type: "runtime/model-requested", model: "gpt-live" });

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
    expect(debugDetails["runtime"]).toMatchObject({ pending: { model: { kind: "set", value: "gpt-live" } } });
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

    const parent = renderWithShellModels(state, (models) =>
      h(ChatPanelToolbar, {
        model: models.toolbar,
        stateStore: createChatStateStore(state),
        surface: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    expect(parent.textContent).toContain("Permissions & Approvals");
    expect(parent.textContent).toContain("Permissions");
    expect(parent.textContent).toContain("Approvals");
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
    state = withChatStateThreadStreamItems(state, [
      {
        id: "item",
        turnId: "turn-1",
        kind: "dialogue",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
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

    const parent = renderWithShellModels(state, (models) => h(ChatPanelGoal, { model: models.goal, surface }));
    state = chatStateWith(state, { activeThread: { id: "thread-current" } });
    clickLabeledButton(parent, "Pause goal");
    clickLabeledButton(parent, "Clear goal");

    state = chatStateWith(state, { activeThread: { goal: { ...goalFixture("thread-rendered"), status: "paused" } } });
    const resumeParent = renderWithShellModels(state, (models) => h(ChatPanelGoal, { model: models.goal, surface }));
    clickLabeledButton(resumeParent, "Resume goal");

    expect(statuses).toEqual([
      ["thread-rendered", "paused"],
      ["thread-rendered", "active"],
    ]);
    expect(clears).toEqual(["thread-rendered"]);
    unmountUiRoot(parent);
    unmountUiRoot(resumeParent);
  });

  it("renders persistent subagent goals without mutation controls", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      activeThread: {
        id: "child",
        goal: goalFixture("child"),
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: "Scout",
          agentRole: "explorer",
        },
      },
    });

    const parent = renderWithShellModels(state, (models) => h(ChatPanelGoal, { model: models.goal, surface: goalSurfaceFixture() }));

    expect(parent.querySelector('[aria-label="Edit goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Pause goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Clear goal"]')).toBeNull();
    unmountUiRoot(parent);
  });

  it("builds composer meta from one captured chat state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, {
      connection: { runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }) },
    });
    state = chatStateWith(state, { connection: { availableModels: [modelFixture("gpt-5.5")] } });

    const projection = composerProjectionFromState(composerProjectionActionsFixture(), state);

    expect(projection).toMatchObject({
      placeholder: "Ask Codex...",
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState).placeholder).toBe("Ask Codex in “Active”...");
    activeState = chatStateWith(activeState, {
      activeThread: {
        lifetime: { kind: "ephemeral", sourceThreadId: "thread-source", sourceThreadTitle: "Source title" },
      },
    });
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState).placeholder).toBe(
      "Ask in side chat for “Source title”...",
    );
    activeState = chatStateWith(activeState, {
      activeThread: {
        lifetime: { kind: "ephemeral", sourceThreadId: "thread-source", sourceThreadTitle: null },
      },
    });
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState).placeholder).toBe("Ask in side chat...");
    activeState = chatStateWith(activeState, { activeThread: { canAcceptDirectInput: false } });
    expect(selectChatPanelComposer(activeState).submissionBlockedByPanelPolicy).toBe(true);
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState).placeholder).toBe(
      "This thread cannot accept messages.",
    );
    const writableSubagentState = chatStateWith(chatStateFixture(), {
      activeThread: {
        id: "child",
        canAcceptDirectInput: true,
        provenance: {
          kind: "subagent",
          subagentKind: "thread-spawn",
          parentThreadId: "parent",
          sessionId: "session",
          depth: 1,
          agentNickname: "Scout",
          agentRole: "explorer",
        },
      },
    });
    expect(selectChatPanelComposer(writableSubagentState).submissionBlockedByPanelPolicy).toBe(false);
    expect(composerProjectionFromState(composerProjectionActionsFixture(), writableSubagentState).placeholder).toBe("Ask Codex...");
    expect(composerProjectionFromState(composerProjectionActionsFixture(), chatStateFixture()).placeholder).toBe("Ask Codex...");
  });

  it("projects goal editor and disclosure state before action wiring", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1", goal: goalFixture("thread-1") } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "thread-1", objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 } },
    });
    state = chatStateWith(state, { ui: { disclosures: { goalObjectiveExpanded: new Set(["thread-1"]) } } });

    const parent = renderWithShellModels(state, (models) => h(ChatPanelGoal, { model: models.goal, surface: goalSurfaceFixture() }));

    expect(parent.querySelector<HTMLTextAreaElement>(".codex-panel__goal-objective-input")?.value).toBe("Draft goal");
    unmountUiRoot(parent);
  });
});

function renderWithShellModels(state: ChatState, node: (models: ReturnType<typeof shellModelsFromState>) => ComponentChild): HTMLElement {
  const parent = document.createElement("div");
  renderUiRoot(parent, node(shellModelsFromState(state)));
  return parent;
}

function shellModelsFromState(state: ChatState) {
  return {
    toolbar: selectChatPanelToolbar(state),
    goal: selectChatPanelGoal(state),
    threadStream: selectChatPanelThreadStream(state),
    composer: selectChatPanelComposer(state),
  };
}

function threadStreamSurfaceContext(): ChatThreadStreamSurfaceContext {
  return {
    panelId: "test-panel",
    vaultPath: "/vault",
    setDisclosureOpen: vi.fn(),
    setForkMenuItem: vi.fn(),
    loadOlderTurns: vi.fn(),
    renderObsidianMarkdown: vi.fn(),
    renderStreamMarkdown: vi.fn(),
    copyDialogueText: vi.fn(),
    actions: {
      rollbackThread: vi.fn(),
      forkThreadFromTurn: vi.fn(),
      implementPlan: vi.fn(),
      openThreadInAvailableView: vi.fn(),
      openThreadInNewView: vi.fn(),
      openTurnDiff: vi.fn(),
    },
    requests: {
      pendingActions: () => ({
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
        setUserInputDraft: vi.fn(),
        setMcpElicitationDraft: vi.fn(),
      }),
      consumePendingAutoFocus: () => false,
    },
  };
}

function composerProjectionFromState(actions: ChatPanelComposerProjectionActions, state: ChatState) {
  return chatPanelComposerProjection(composerModelFromChatState(state), actions);
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
      compactContext: () => undefined,
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
        cancelAutoName: () => undefined,
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
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
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
