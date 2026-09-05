// @vitest-environment jsdom

import { type ComponentChild, h } from "preact";
import { describe, expect, it, vi } from "vitest";
import { type ConfigReadResult, runtimeConfigSnapshotFromAppServerConfig } from "../../../../../src/app-server/protocol/runtime-config";
import type { ModelMetadata } from "../../../../../src/domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../../src/domain/runtime/config";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import type { Thread } from "../../../../../src/domain/threads/model";
import type { ChatState } from "../../../../../src/features/chat/application/state/model";
import { chatReducer } from "../../../../../src/features/chat/application/state/reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ChatPanelComposerRuntimeActions } from "../../../../../src/features/chat/host/composer/view-projection";
import { projectChatPanelComposer } from "../../../../../src/features/chat/host/composer/view-projection";
import { type ChatPanelGoalDependencies, projectChatPanelGoal } from "../../../../../src/features/chat/host/goal/view-projection";
import {
  selectChatPanelComposer as selectChatPanelComposerFromResources,
  selectChatPanelGoal,
  selectChatPanelThreadStream as selectChatPanelThreadStreamFromResources,
  selectChatPanelToolbar as selectChatPanelToolbarFromResources,
} from "../../../../../src/features/chat/host/shell/selectors";
import {
  type ChatThreadStreamDependencies,
  projectThreadStream,
} from "../../../../../src/features/chat/host/thread-stream/view-projection";
import { type ChatPanelToolbarDependencies, projectChatPanelToolbar } from "../../../../../src/features/chat/host/toolbar/view-projection";
import { GoalPanel } from "../../../../../src/features/chat/ui/goal";
import { Toolbar, type ToolbarActions } from "../../../../../src/features/chat/ui/toolbar";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/dom/preact-root.dom";
import { installObsidianDomShims } from "../../../../support/dom";
import {
  type ChatSharedDisplayValues,
  chatSharedResourcesFixture,
  composerSharedValues,
  threadStreamSharedValues,
  toolbarSharedValues,
} from "../../support/shared-display-values";
import { composerModelFromChatState } from "../../support/shell-selectors";
import { chatStateFixture, chatStateWith } from "../../support/state";
import { withChatStateStableThreadStreamItems } from "../../support/thread-stream";

installObsidianDomShims();

const emptySharedResources = chatSharedResourcesFixture();

const selectChatPanelToolbar = (state: ChatState, shared: ChatSharedDisplayValues) =>
  selectChatPanelToolbarFromResources(state, toolbarSharedValues(shared));
const selectChatPanelThreadStream = (state: ChatState, shared: ChatSharedDisplayValues) =>
  selectChatPanelThreadStreamFromResources(state, threadStreamSharedValues(shared));
const selectChatPanelComposer = (state: ChatState, shared: ChatSharedDisplayValues) =>
  selectChatPanelComposerFromResources(state, composerSharedValues(shared));

describe("chat panel projection integration", () => {
  it("uses replacement visibility only for the selected toolbar row", () => {
    let state = chatStateFixture({ activeThread: { id: "replacement" } });
    const shared = chatSharedResourcesFixture({ threads: [threadFixture("source", "Source")] });
    state = chatStateWith(state, {
      activeTurn: { lifecycle: { kind: "running", turnId: "turn" } },
      ui: { toolbarPanel: "history" },
    });
    const parent = renderWithShellModels(state, shared, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture({ visibleThreadId: () => "source" }),
        actions: toolbarActionsFixture(),
      }),
    );

    expect(parent.querySelector(".codex-panel__thread-row--selected")?.textContent).toContain("Source");
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.disabled).toBe(false);
    unmountUiRoot(parent);
  });

  it("disables compact context without an active thread", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { ui: { toolbarPanel: "chat-actions" } });
    const compactContext = vi.fn();
    const actions = toolbarActionsFixture();
    actions.chat.compactContext = compactContext;
    const parent = renderWithShellModels(state, emptySharedResources, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
        actions,
      }),
    );

    const compact = [...parent.querySelectorAll<HTMLElement>(".codex-panel__chat-actions-panel-item")].find(
      (item) => item.textContent === "Compact context",
    );
    expect(compact?.classList.contains("is-disabled")).toBe(true);
    compact?.click();
    expect(compactContext).not.toHaveBeenCalled();
    unmountUiRoot(parent);
  });

  it("disables archive only for the busy target thread", () => {
    let state = chatStateFixture({ activeThread: { id: "thread" } });
    const shared = chatSharedResourcesFixture({
      threads: [threadFixture("thread", "Thread"), threadFixture("other", "Other")],
    });
    state = chatStateWith(state, {
      activeTurn: { lifecycle: { kind: "running", turnId: "turn" } },
      ui: { toolbarPanel: "history" },
    });
    const parent = renderWithShellModels(state, shared, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
        actions: toolbarActionsFixture(),
      }),
    );

    const archiveButtons = [...parent.querySelectorAll<HTMLButtonElement>('[aria-label="Archive thread"]')];
    const renameButtons = [...parent.querySelectorAll<HTMLButtonElement>('[aria-label="Rename thread"]')];
    expect(archiveButtons).toHaveLength(2);
    expect(archiveButtons.map((button) => button.disabled)).toEqual([true, false]);
    expect(renameButtons).toHaveLength(2);
    expect(renameButtons.every((button) => !button.disabled)).toBe(true);
    unmountUiRoot(parent);
  });

  it("disables other rename actions while a rename save is pending", () => {
    let state = chatStateFixture({ activeThread: { id: "thread" } });
    const shared = chatSharedResourcesFixture({
      threads: [threadFixture("thread", "Thread"), threadFixture("other", "Other")],
    });
    state = chatStateWith(state, {
      ui: {
        toolbarPanel: "history",
        rename: {
          kind: "saving",
          threadId: "thread",
          draft: "Thread",
          autoName: { kind: "unavailable" },
        },
      },
    });
    const parent = renderWithShellModels(state, shared, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
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
      activeTurn: { lifecycle: { kind: "running", turnId: "child-turn" } },
      ui: { toolbarPanel: "chat-actions" },
    });
    const actions = toolbarActionsFixture();
    const parent = renderWithShellModels(state, emptySharedResources, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
        actions,
      }),
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
    state = withChatStateStableThreadStreamItems(state, [
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

    const projection = projectThreadStream(selectChatPanelThreadStream(state, emptySharedResources), threadStreamSurfaceContext());
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
          coordinationUpdate: "snapshot",
          turnId: "parent-turn",
          action: "wait",
          status: "inProgress",
          senderThreadId: "parent",
          targets: [{ threadId: "child" }],
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

    const projection = projectThreadStream(selectChatPanelThreadStream(state, emptySharedResources), threadStreamSurfaceContext());
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
    let state = chatStateFixture();
    const shared = chatSharedResourcesFixture({
      threads: [
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
    });
    state = withChatStateStableThreadStreamItems(state, [
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

    const projection = projectThreadStream(selectChatPanelThreadStream(state, shared), threadStreamSurfaceContext());

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
    const parent = renderWithShellModels(state, emptySharedResources, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
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
    const composer = selectChatPanelComposer(state, emptySharedResources);
    expect(composer.submissionBlockedByPanelPolicy).toBe(false);
    expect(composer.runtimeSettingsDisabled).toBe(true);
    unmountUiRoot(parent);
  });

  it("keeps Set goal enabled while a restored thread still needs hydration", () => {
    const store = createChatStateStore(chatStateFixture());
    store.dispatch({ type: "panel/restored-thread-applied", threadId: "restored", fallbackTitle: "Restored" });
    store.dispatch({ type: "ui/panel-set", panel: "chat-actions" });
    const restored = store.getState();
    const parent = renderWithShellModels(restored, emptySharedResources, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
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

  it("renders new thread permission baseline in the status panel before a thread is active", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { ui: { toolbarPanel: "status-panel" } });
    const shared = chatSharedResourcesFixture({
      runtimeConfig: runtimeConfigFixture({
        default_permissions: ":workspace",
        approval_policy: "on-request",
        approvals_reviewer: "user",
      }),
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

    const parent = renderWithShellModels(state, shared, (models) =>
      h(ProjectedToolbar, {
        model: models.toolbar,
        dependencies: toolbarSurfaceFixture(),
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

  it("projects usage-limit reset labels from the supplied current time", () => {
    const state = chatStateFixture();
    const shared = chatSharedResourcesFixture({
      rateLimit: {
        limitId: "codex",
        limitName: "Codex",
        primary: { usedPercent: 72.4, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: null,
        individualLimit: null,
        rateLimitReachedType: null,
      },
    });

    const projection = projectChatPanelToolbar(selectChatPanelToolbar(state, shared), toolbarSurfaceFixture(), 1_799_991_600_000);

    expect(projection.rateLimit?.rows).toEqual([expect.objectContaining({ label: "5h", value: "72%", resetLabel: "reset in 2h 20m" })]);
  });

  it("builds composer meta from context and runtime state", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, { runtime: { pending: { collaborationMode: setCollaborationModeIntent("plan") } } });
    const shared = chatSharedResourcesFixture({
      runtimeConfig: runtimeConfigFixture({
        model: "gpt-5.5",
        model_reasoning_effort: "minimal",
        approvals_reviewer: "auto_review",
        service_tier: "fast",
      }),
      availableModels: [modelFixture("gpt-5.5", "fast")],
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state, shared).meta).toMatchObject({
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
      statusSummary: "Context 42%, plan on, auto-review on, fast on, model gpt-5.5, reasoning effort min",
      model: "gpt-5.5",
      effort: "min",
      planActive: true,
      autoReviewActive: true,
      fastAvailable: true,
      fastActive: true,
    });
  });

  it("uses a neutral composer context indicator when usage is unavailable", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = withChatStateStableThreadStreamItems(state, [
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
    const shared = chatSharedResourcesFixture({ runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5" }) });

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state, shared).meta).toMatchObject({
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
    expect(composerProjectionFromState(composerProjectionActionsFixture(), chatStateFixture(), emptySharedResources).meta).toMatchObject({
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state, emptySharedResources).meta).toMatchObject({
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

    expect(composerProjectionFromState(composerProjectionActionsFixture(), state, emptySharedResources).meta).toMatchObject({
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

  it("builds runtime composer choices from a shared resource snapshot", () => {
    const state = chatStateFixture();
    const shared = chatSharedResourcesFixture({
      runtimeConfig: runtimeConfigFixture({ model: "gpt-5.5", model_reasoning_effort: "high" }),
      availableModels: [modelFixture("gpt-5.5"), modelFixture("gpt-5-mini")],
    });
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
      shared,
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
    } satisfies ChatPanelGoalDependencies;

    const parent = renderWithShellModels(
      state,
      emptySharedResources,
      (models) => h(ProjectedGoal, { model: models.goal, dependencies: surface }),
      goalFixture("thread-rendered"),
    );
    state = chatStateWith(state, { activeThread: { id: "thread-current" } });
    clickLabeledButton(parent, "Pause goal");
    clickLabeledButton(parent, "Clear goal");

    const resumeParent = renderWithShellModels(
      state,
      emptySharedResources,
      (models) => h(ProjectedGoal, { model: models.goal, dependencies: surface }),
      { ...goalFixture("thread-rendered"), status: "paused" },
    );
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

    const parent = renderWithShellModels(
      state,
      emptySharedResources,
      (models) => h(ProjectedGoal, { model: models.goal, dependencies: goalSurfaceFixture() }),
      goalFixture("child"),
    );

    expect(parent.querySelector('[aria-label="Edit goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Pause goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Clear goal"]')).toBeNull();
    unmountUiRoot(parent);
  });

  it("derives composer placeholders", () => {
    let activeState = chatStateFixture();
    activeState = chatStateWith(activeState, { activeThread: { id: "thread-1" } });
    const shared = chatSharedResourcesFixture({ threads: [threadFixture("thread-1", "Active")] });

    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState, shared).placeholder).toBe(
      "Ask Codex in “Active”...",
    );
    activeState = chatStateWith(activeState, {
      activeThread: {
        lifetime: { kind: "ephemeral", sourceThreadId: "thread-source", sourceThreadTitle: "Source title" },
      },
    });
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState, shared).placeholder).toBe(
      "Ask in side chat for “Source title”...",
    );
    activeState = chatStateWith(activeState, {
      activeThread: {
        lifetime: { kind: "ephemeral", sourceThreadId: "thread-source", sourceThreadTitle: null },
      },
    });
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState, shared).placeholder).toBe("Ask in side chat...");
    activeState = chatStateWith(activeState, { activeThread: { canAcceptDirectInput: false } });
    expect(selectChatPanelComposer(activeState, shared).submissionBlockedByPanelPolicy).toBe(true);
    expect(composerProjectionFromState(composerProjectionActionsFixture(), activeState, shared).placeholder).toBe(
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
    expect(selectChatPanelComposer(writableSubagentState, shared).submissionBlockedByPanelPolicy).toBe(false);
    expect(composerProjectionFromState(composerProjectionActionsFixture(), writableSubagentState, shared).placeholder).toBe("Ask Codex...");
    expect(composerProjectionFromState(composerProjectionActionsFixture(), chatStateFixture(), shared).placeholder).toBe("Ask Codex...");
  });

  it("projects goal editor state before action wiring", () => {
    let state = chatStateFixture();
    state = chatStateWith(state, { activeThread: { id: "thread-1" } });
    state = chatStateWith(state, {
      ui: { goalEditor: { kind: "editing", threadId: "thread-1", objectiveDraft: "Draft goal", tokenBudgetDraft: 1234 } },
    });
    const parent = renderWithShellModels(state, emptySharedResources, (models) =>
      h(ProjectedGoal, { model: models.goal, dependencies: goalSurfaceFixture() }),
    );

    expect(parent.querySelector<HTMLTextAreaElement>(".codex-panel__goal-objective-input")?.value).toBe("Draft goal");
    unmountUiRoot(parent);
  });
});

function ProjectedToolbar({
  model,
  dependencies,
  actions,
}: {
  model: ReturnType<typeof selectChatPanelToolbar>;
  dependencies: ChatPanelToolbarDependencies;
  actions: ToolbarActions;
}): ComponentChild {
  return h(Toolbar, { model: projectChatPanelToolbar(model, dependencies, 0), actions });
}

function ProjectedGoal({
  model,
  dependencies,
}: {
  model: ReturnType<typeof selectChatPanelGoal>;
  dependencies: ChatPanelGoalDependencies;
}): ComponentChild {
  return h(GoalPanel, projectChatPanelGoal(model, dependencies));
}

function renderWithShellModels(
  state: ChatState,
  shared: ChatSharedDisplayValues,
  node: (models: ReturnType<typeof shellModelsFromState>) => ComponentChild,
  goal: ThreadGoal | null = null,
): HTMLElement {
  const parent = document.createElement("div");
  renderUiRoot(parent, node(shellModelsFromState(state, shared, goal)));
  return parent;
}

function shellModelsFromState(state: ChatState, shared: ChatSharedDisplayValues, goal: ThreadGoal | null = null) {
  return {
    toolbar: selectChatPanelToolbar(state, shared),
    goal: selectChatPanelGoal(state, goal),
    threadStream: selectChatPanelThreadStream(state, shared),
    composer: selectChatPanelComposer(state, shared),
  };
}

function threadStreamSurfaceContext(): ChatThreadStreamDependencies {
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
      actions: {
        resolveApproval: vi.fn(),
        resolveUserInput: vi.fn(),
        skipUserInput: vi.fn(),
        cancelUserInput: vi.fn(),
        resolveMcpElicitation: vi.fn(),
        setApprovalDetailsExpanded: vi.fn(),
        setUserInputDraft: vi.fn(),
        setMcpElicitationDraft: vi.fn(),
      },
      consumeAutoFocus: () => false,
    },
  };
}

function composerProjectionFromState(actions: ChatPanelComposerRuntimeActions, state: ChatState, shared: ChatSharedDisplayValues) {
  return projectChatPanelComposer(composerModelFromChatState(state, shared), actions);
}

function clickLabeledButton(parent: HTMLElement, label: string): void {
  const button = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Expected button: ${label}`);
  button.click();
}

function toolbarSurfaceFixture(
  overrides: { archiveExportEnabled?: boolean; visibleThreadId?: ChatPanelToolbarDependencies["visibleThreadId"] } = {},
) {
  return {
    connection: {
      connected: () => true,
    },
    visibleThreadId: overrides.visibleThreadId ?? ((_threads: readonly Thread[], threadId: string | null) => threadId),
    settings: {
      vaultPath: () => "/vault",
      configuredCommand: () => "codex",
      archiveExportEnabled: () => overrides.archiveExportEnabled ?? false,
    },
  };
}

interface ToolbarActionOverrides {
  copyDebugDetails?: () => void;
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
      startSideChat: () => undefined,
      compactContext: () => undefined,
      setGoal: () => undefined,
    },
    status: {
      connect: () => undefined,
      refreshStatus: () => undefined,
      copyDebugDetails: overrides.copyDebugDetails ?? (() => undefined),
    },
    threads: {
      loadMore: () => undefined,
      resume: () => undefined,
      setPinned: () => undefined,
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

function goalSurfaceFixture(): ChatPanelGoalDependencies {
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

function composerProjectionActionsFixture(overrides: Partial<ChatPanelComposerRuntimeActions> = {}): ChatPanelComposerRuntimeActions {
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
    supportedReasoningEfforts: ["high"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
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
