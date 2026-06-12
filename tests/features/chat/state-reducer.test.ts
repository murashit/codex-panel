import { describe, expect, it } from "vitest";

import {
  activeTurnId,
  chatReducer,
  chatTurnBusy,
  createChatState,
  createChatStateStore,
  pendingTurnStart,
  transitionChatTurnLifecycleState,
  type ChatState,
} from "../../../src/features/chat/state/reducer";
import { messageStreamDisplayItems } from "../../../src/features/chat/state/message-stream";
import type { ThreadGoal } from "../../../src/domain/threads/goal";
import type { DisplayItem } from "../../../src/features/chat/display/types";
import type { Thread } from "../../../src/domain/threads/model";

describe("chatReducer", () => {
  it("clears active turn and thread-scoped state", () => {
    const state = createChatState();
    state.activeThread.id = "thread";
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.runtime.activeModel = "gpt-5.1";
    state.runtime.activeReasoningEffort = "high";
    state.runtime.activeServiceTier = "fast";
    state.runtime.activeApprovalPolicy = "on-request";
    state.runtime.activeApprovalsReviewer = "auto_review";
    state.runtime.activeCollaborationMode = "plan";
    state.runtime.selectedCollaborationMode = "plan";
    state.activeThread.goal = goal("thread");
    state.messageStream.historyCursor = "cursor";
    state.messageStream.loadingHistory = true;
    state.composer.draft = "keep me";
    state.messageStream.displayItems = [message("m1")];
    state.messageStream.turnDiffs = new Map([["turn", "@@"]]);
    state.requests.approvals = [approval(1)];
    state.requests.pendingUserInputs = [userInput(2)];
    state.requests.userInputDrafts = new Map([["2:note", "draft"]]);
    state.composer.suggestSelected = 1;
    state.composer.suggestions = [suggestion("/plan")];
    state.composer.suggestionsDismissedSignature = "dismissed";
    state.ui.openDetails = new Set(["approval:1:details", "message:previous:details"]);
    let pendingState = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.2" });
    pendingState = chatReducer(pendingState, { type: "runtime/reasoning-effort-requested", effort: "medium" });
    pendingState = chatReducer(pendingState, { type: "runtime/service-tier-requested", serviceTier: "off" });
    pendingState = chatReducer(pendingState, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "user" });

    const next = chatReducer(pendingState, { type: "active-thread/cleared" });

    expect(next).not.toBe(pendingState);
    expect(next.activeThread.id).toBeNull();
    expect(next.activeThread.goal).toBeNull();
    expect(next.runtime.activeModel).toBeNull();
    expect(next.runtime.activeReasoningEffort).toBeNull();
    expect(next.runtime.activeServiceTier).toBeNull();
    expect(next.runtime.activeApprovalPolicy).toBeNull();
    expect(next.runtime.activeApprovalsReviewer).toBeNull();
    expect(next.runtime.activeCollaborationMode).toBeNull();
    expect(next.runtime.requestedModel).toEqual({ kind: "set", value: "gpt-5.2" });
    expect(next.runtime.requestedReasoningEffort).toEqual({ kind: "set", value: "medium" });
    expect(next.runtime.requestedServiceTier).toEqual({ kind: "set", value: "off" });
    expect(next.runtime.requestedApprovalsReviewer).toEqual({ kind: "set", value: "user" });
    expect(next.runtime.selectedCollaborationMode).toBe("plan");
    expect(activeTurnId(next)).toBeNull();
    expect(next.messageStream.displayItems).toEqual([]);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.draft).toBe("");
    expect(next.composer.suggestSelected).toBe(0);
    expect(next.composer.suggestions).toEqual([]);
    expect(next.composer.suggestionsDismissedSignature).toBeNull();
    expect(next.ui.openDetails.size).toBe(0);
  });

  it("resets thread-scoped state when resuming a thread", () => {
    const state = createChatState();
    state.activeThread.id = "previous-thread";
    state.turn.lifecycle = { kind: "running", turnId: "previous-turn" };
    state.messageStream.historyCursor = "cursor";
    state.activeThread.goal = goal("previous-thread");
    state.messageStream.loadingHistory = true;
    state.composer.draft = "previous draft";
    state.messageStream.displayItems = [message("previous-message")];
    state.messageStream.turnDiffs = new Map([["previous-turn", "@@"]]);
    state.requests.approvals = [approval(1)];
    state.requests.pendingUserInputs = [userInput(2)];
    state.requests.userInputDrafts = new Map([["2:note", "draft"]]);
    state.composer.suggestSelected = 1;
    state.composer.suggestions = [suggestion("/plan")];
    state.composer.suggestionsDismissedSignature = "dismissed";
    state.runtime.activeCollaborationMode = "plan";
    state.runtime.selectedCollaborationMode = "plan";
    state.ui.openDetails = new Set(["approval:1:details", "message:previous:details"]);
    const resumedItems = [message("resumed-message")];

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: "gpt-5.1",
      reasoningEffort: "high",
      serviceTier: "fast",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      activePermissionProfile: null,
      displayItems: resumedItems,
    });

    expect(next.activeThread.id).toBe("resumed-thread");
    expect(next.activeThread.goal).toBeNull();
    expect(activeTurnId(next)).toBeNull();
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(next.composer.draft).toBe("");
    expect(next.messageStream.displayItems).toEqual(resumedItems);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.suggestSelected).toBe(0);
    expect(next.composer.suggestions).toEqual([]);
    expect(next.composer.suggestionsDismissedSignature).toBeNull();
    expect(next.runtime.activeCollaborationMode).toBeNull();
    expect(next.runtime.selectedCollaborationMode).toBe("plan");
    expect(next.ui.openDetails.size).toBe(0);
  });

  it("starts resumed threads with empty display state when no history items are supplied", () => {
    const state = createChatState();
    state.messageStream.displayItems = [message("previous-message")];

    const next = chatReducer(state, {
      type: "active-thread/resumed",
      thread: thread("resumed-thread"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });

    expect(next.messageStream.displayItems).toEqual([]);
  });

  it("keeps composer state when restoring a thread placeholder", () => {
    const state = createChatState();
    state.activeThread.id = "previous-thread";
    state.turn.lifecycle = { kind: "running", turnId: "previous-turn" };
    state.runtime.activeModel = "gpt-5.1";
    state.activeThread.goal = goal("previous-thread");
    state.messageStream.historyCursor = "cursor";
    state.messageStream.loadingHistory = true;
    state.composer.draft = "draft in this panel";
    state.composer.suggestSelected = 1;
    state.composer.suggestions = [suggestion("/resume")];
    state.composer.suggestionsDismissedSignature = "dismissed";
    state.messageStream.displayItems = [message("previous-message")];
    state.messageStream.turnDiffs = new Map([["previous-turn", "@@"]]);
    state.requests.approvals = [approval(1)];
    state.requests.pendingUserInputs = [userInput(2)];
    state.requests.userInputDrafts = new Map([["2:note", "answer"]]);

    const next = chatReducer(state, {
      type: "active-thread/restored-placeholder",
      threadId: "restored-thread",
    });

    expect(next.activeThread.id).toBe("restored-thread");
    expect(activeTurnId(next)).toBeNull();
    expect(next.runtime.activeModel).toBeNull();
    expect(next.activeThread.goal).toBeNull();
    expect(next.messageStream.historyCursor).toBeNull();
    expect(next.messageStream.loadingHistory).toBe(false);
    expect(next.messageStream.displayItems).toEqual([]);
    expect(next.messageStream.turnDiffs.size).toBe(0);
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.composer.draft).toBe("draft in this panel");
    expect(next.composer.suggestSelected).toBe(1);
    expect(next.composer.suggestions).toEqual([suggestion("/resume")]);
    expect(next.composer.suggestionsDismissedSignature).toBe("dismissed");
  });

  it("clones map and set backed state when updating turn diffs and open panels", () => {
    const state = createChatState();
    state.messageStream.turnDiffs = new Map([["turn", "old"]]);
    state.ui.toolbarPanel = "status-panel";

    const withDiff = chatReducer(state, { type: "message-stream/turn-diff-updated", turnId: "turn", diff: "new" });
    const withHistoryPanel = chatReducer(withDiff, { type: "ui/panel-set", panel: "history" });

    expect(withDiff.messageStream.turnDiffs).not.toBe(state.messageStream.turnDiffs);
    expect(withDiff.messageStream.turnDiffs.get("turn")).toBe("new");
    expect(withHistoryPanel.ui).not.toBe(withDiff.ui);
    expect(withHistoryPanel.ui.toolbarPanel).toBe("history");
    expect(withHistoryPanel.ui.openDetails).toBe(withDiff.ui.openDetails);
  });

  it("deduplicates reported logs while keeping reported log state immutable", () => {
    const state = createChatState();
    const item = { id: "log", kind: "system", role: "system", text: "once" } satisfies DisplayItem;

    const first = chatReducer(state, { type: "message-stream/deduped-log-added", text: "once", item });
    const second = chatReducer(first, { type: "message-stream/deduped-log-added", text: "once", item });

    expect(first.messageStream.reportedLogs).not.toBe(state.messageStream.reportedLogs);
    expect(first.messageStream.displayItems).toEqual([item]);
    expect(second).toBe(first);
  });

  it("keeps turn lifecycle fields synchronized through start and completion", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: [] };
    const optimisticItem = { id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello" } satisfies DisplayItem;
    const acknowledgedItem = { ...optimisticItem, turnId: "turn" } satisfies DisplayItem;

    const optimistic = chatReducer(createChatState(), {
      type: "turn/optimistic-started",
      item: optimisticItem,
      pendingTurnStart: pending,
    });
    expect(chatTurnBusy(optimistic)).toBe(true);
    expect(activeTurnId(optimistic)).toBeNull();
    expect(pendingTurnStart(optimistic)).toEqual(pending);

    const running = chatReducer(optimistic, {
      type: "turn/start-acknowledged",
      turnId: "turn",
      displayItems: [acknowledgedItem],
    });
    expect(chatTurnBusy(running)).toBe(true);
    expect(activeTurnId(running)).toBe("turn");
    expect(pendingTurnStart(running)).toBeNull();

    const completed = chatReducer(running, {
      type: "turn/completed",
      turnId: "turn",
      status: "completed",
      displayItems: [acknowledgedItem],
    });
    expect(chatTurnBusy(completed)).toBe(false);
    expect(activeTurnId(completed)).toBeNull();
    expect(pendingTurnStart(completed)).toBeNull();
  });

  it("keeps turn lifecycle transition rules explicit", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    const optimistic = transitionChatTurnLifecycleState({ kind: "idle" }, { type: "optimistic-started", pendingTurnStart: pending });
    const running = transitionChatTurnLifecycleState(optimistic, { type: "start-acknowledged", turnId: "turn" });

    expect(optimistic).toEqual({ kind: "starting", pendingTurnStart: pending });
    expect(running).toEqual({ kind: "running", turnId: "turn" });
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "stale-turn" })).toBe(running);
    expect(transitionChatTurnLifecycleState({ kind: "idle" }, { type: "start-acknowledged", turnId: "turn" })).toEqual({
      kind: "idle",
    });
    expect(transitionChatTurnLifecycleState(running, { type: "completed", turnId: "turn" })).toEqual({ kind: "idle" });
  });

  it("appends streaming assistant deltas into the active segment without replacing stable history", () => {
    const state = createChatState();
    state.messageStream.displayItems = [message("history")];
    const running = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });

    const next = chatReducer(running, {
      type: "message-stream/assistant-delta-appended",
      itemId: "assistant",
      turnId: "turn",
      delta: "hello",
    });

    expect(next.messageStream.stableItems).toBe(running.messageStream.stableItems);
    expect(next.messageStream.activeSegment?.items).toEqual([expect.objectContaining({ id: "assistant", text: "hello", turnId: "turn" })]);
    expect(messageStreamDisplayItems(next.messageStream)).toEqual([
      message("history"),
      expect.objectContaining({ id: "assistant", text: "hello" }),
    ]);
  });

  it("updates repeated streaming output through the active source-item index", () => {
    let state = createChatState();
    state = chatReducer(state, { type: "turn/started", threadId: "thread", turnId: "turn" });
    state = chatReducer(state, {
      type: "message-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "one",
      kind: "command",
      fallbackText: "Command running",
    });

    const firstActiveItems = state.messageStream.activeSegment?.items;
    const next = chatReducer(state, {
      type: "message-stream/item-output-appended",
      itemId: "cmd",
      turnId: "turn",
      delta: "two",
      kind: "command",
      fallbackText: "Command running",
    });

    expect(next.messageStream.activeSegment?.items).toHaveLength(1);
    expect(next.messageStream.activeSegment?.indexBySourceItemId.get("cmd")).toBe(0);
    expect(next.messageStream.activeSegment?.items).not.toBe(firstActiveItems);
    expect(next.messageStream.activeSegment?.items[0]).toMatchObject({ id: "cmd", output: "onetwo" });
  });

  it("clears running state when a turn start fails", () => {
    const state = createChatState();
    state.turn.lifecycle = { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] } };

    const next = chatReducer(state, { type: "turn/start-failed", displayItems: [] });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
    expect(pendingTurnStart(next)).toBeNull();
  });

  it("ignores stale turn start failures after the turn is already running", () => {
    const state = createChatState();
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.messageStream.displayItems = [message("existing")];

    const next = chatReducer(state, { type: "turn/start-failed", displayItems: [] });

    expect(next).toBe(state);
    expect(chatTurnBusy(next)).toBe(true);
    expect(activeTurnId(next)).toBe("turn");
    expect(next.messageStream.displayItems).toBe(state.messageStream.displayItems);
  });

  it("clears turn-scoped requests when clearing the local turn scope", () => {
    const state = createChatState();
    state.turn.lifecycle = { kind: "running", turnId: "turn" };
    state.requests.approvals = [approval(1)];
    state.requests.pendingUserInputs = [userInput(2)];
    state.requests.userInputDrafts = new Map([["2:note", "draft"]]);
    state.messageStream.displayItems = [message("kept")];
    state.ui.openDetails = new Set(["approval:1:details", "request:2", "message:kept:details"]);

    const next = chatReducer(state, { type: "turn/scoped-cleared" });

    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
    expect(next.requests.approvals).toEqual([]);
    expect(next.requests.pendingUserInputs).toEqual([]);
    expect(next.requests.userInputDrafts.size).toBe(0);
    expect(next.messageStream.displayItems).toBe(state.messageStream.displayItems);
    expect([...next.ui.openDetails]).toEqual(["message:kept:details"]);
  });

  it("resolves requests while optionally appending a result item", () => {
    const state = createChatState();
    state.requests.approvals = [approval(1)];
    state.requests.pendingUserInputs = [userInput(2)];
    state.requests.userInputDrafts = new Map([
      ["2:note", "draft"],
      ["2:note:other", "other draft"],
    ]);
    state.messageStream.displayItems = [message("existing")];
    state.ui.openDetails = new Set(["approval:1:details", "request:2", "request:2:other", "message:existing:details"]);

    const withoutResult = chatReducer(state, { type: "request/resolved", requestId: 1 });
    expect(withoutResult.requests.approvals).toEqual([]);
    expect(withoutResult.requests.pendingUserInputs).toEqual([userInput(2)]);
    expect(withoutResult.messageStream.displayItems).toBe(state.messageStream.displayItems);
    expect([...withoutResult.ui.openDetails]).toEqual(["request:2", "request:2:other", "message:existing:details"]);

    const resultItem = message("result");
    const withResult = chatReducer(withoutResult, { type: "request/resolved", requestId: 2, resultItem });
    expect(withResult.requests.pendingUserInputs).toEqual([]);
    expect(withResult.requests.userInputDrafts.size).toBe(0);
    expect(withResult.messageStream.displayItems).toEqual([message("existing"), resultItem]);
    expect([...withResult.ui.openDetails]).toEqual(["message:existing:details"]);
  });

  it("ignores stale request resolutions without appending result items", () => {
    const state = createChatState();
    state.messageStream.displayItems = [message("existing")];
    state.ui.openDetails = new Set(["request:99", "message:existing:details"]);

    const next = chatReducer(state, { type: "request/resolved", requestId: 99, resultItem: message("stale result") });

    expect(next).toBe(state);
    expect(next.messageStream.displayItems).toBe(state.messageStream.displayItems);
    expect([...next.ui.openDetails]).toEqual(["request:99", "message:existing:details"]);
  });

  it("ignores turn start acknowledgements after the turn has already gone idle", () => {
    const state = createChatState();
    state.turn.lifecycle = { kind: "idle" };

    const next = chatReducer(state, {
      type: "turn/start-acknowledged",
      turnId: "completed-turn",
      displayItems: [{ id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello", turnId: "completed-turn" }],
    });

    expect(next).toBe(state);
    expect(chatTurnBusy(next)).toBe(false);
    expect(activeTurnId(next)).toBeNull();
  });

  it("ignores completed turns while a new turn is still starting", () => {
    const pending = { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook"] };
    const state = createChatState();
    state.turn.lifecycle = { kind: "starting", pendingTurnStart: pending };
    state.messageStream.displayItems = [{ id: "local-user", kind: "message", messageKind: "user", role: "user", text: "hello" }];

    const next = chatReducer(state, {
      type: "turn/completed",
      turnId: "stale-turn",
      status: "completed",
      displayItems: [],
    });

    expect(next).toBe(state);
    expect(chatTurnBusy(next)).toBe(true);
    expect(pendingTurnStart(next)).toEqual(pending);
    expect(next.messageStream.displayItems).toEqual(state.messageStream.displayItems);
  });

  it("keeps toolbar panels mutually exclusive", () => {
    let state = createChatState();

    state = chatReducer(state, { type: "ui/panel-set", panel: "history" });
    expect(state.ui.toolbarPanel).toBe("history");

    state = chatReducer(state, { type: "ui/panel-set", panel: "chat-actions" });
    expect(state.ui.toolbarPanel).toBe("chat-actions");

    state = chatReducer(state, { type: "ui/panel-set", panel: "status-panel" });
    expect(state.ui.toolbarPanel).toBe("status-panel");
  });

  it("updates remembered details and user input drafts through typed UI actions", () => {
    let state = createChatState();

    state = chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: true });
    expect(state.ui.openDetails.has("request:1")).toBe(true);
    expect(chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: true })).toBe(state);

    state = chatReducer(state, { type: "request/user-input-draft-set", key: "1:note", value: "answer" });
    expect(state.requests.userInputDrafts.get("1:note")).toBe("answer");
    expect(chatReducer(state, { type: "request/user-input-draft-set", key: "1:note", value: "answer" })).toBe(state);

    state = chatReducer(state, { type: "ui/detail-open-set", key: "request:1", open: false });
    expect(state.ui.openDetails.has("request:1")).toBe(false);
  });

  it("commits pending runtime settings and resets applied overrides", () => {
    let state = createChatState();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    const next = chatReducer(state, {
      type: "runtime/pending-thread-settings-committed",
      update: {
        model: "gpt-5.1",
        effort: "high",
        serviceTier: "fast",
        approvalsReviewer: "auto_review",
        collaborationMode: { mode: "plan", settings: { model: "gpt-5.1", reasoningEffort: "high", developerInstructions: null } },
      },
    });

    expect(next.runtime.activeModel).toBe("gpt-5.1");
    expect(next.runtime.requestedModel).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeReasoningEffort).toBe("high");
    expect(next.runtime.requestedReasoningEffort).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeServiceTier).toBe("fast");
    expect(next.runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeApprovalsReviewer).toBe("auto_review");
    expect(next.runtime.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
    expect(next.runtime.activeCollaborationMode).toBe("plan");
  });

  it("keeps requested policy toggles pending until app-server settings commit", () => {
    let state = createChatState();
    state.runtime.activeServiceTier = "flex";
    state.runtime.activeApprovalsReviewer = "user";

    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    expect(state.runtime.requestedServiceTier).toEqual({ kind: "set", value: "fast" });
    expect(state.runtime.activeServiceTier).toBe("flex");
    expect(state.runtime.requestedApprovalsReviewer).toEqual({ kind: "set", value: "auto_review" });
    expect(state.runtime.activeApprovalsReviewer).toBe("user");
  });

  it("keeps reset and unset runtime request semantics explicit", () => {
    let state = createChatState();
    state = chatReducer(state, { type: "runtime/model-requested", model: "gpt-5.1" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-requested", effort: "high" });
    state = chatReducer(state, { type: "runtime/service-tier-requested", serviceTier: "fast" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-requested", approvalsReviewer: "auto_review" });

    state = chatReducer(state, { type: "runtime/model-reset-to-config" });
    state = chatReducer(state, { type: "runtime/reasoning-effort-reset-to-config" });
    state = chatReducer(state, { type: "runtime/service-tier-request-cleared" });
    state = chatReducer(state, { type: "runtime/approvals-reviewer-request-cleared" });

    expect(state.runtime.requestedModel).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.requestedReasoningEffort).toEqual({ kind: "resetToConfig" });
    expect(state.runtime.requestedServiceTier).toEqual({ kind: "unchanged" });
    expect(state.runtime.requestedApprovalsReviewer).toEqual({ kind: "unchanged" });
  });

  it("stores updates through ChatStateStore without mutating the initial snapshot", () => {
    const initial = createChatState();
    initial.messageStream.displayItems = [message("initial")];
    const store = createChatStateStore(initial);

    store.dispatch({ type: "message-stream/item-upserted", item: message("next") });

    expect(initial.messageStream.displayItems).toEqual([message("initial")]);
    expect(store.getState().messageStream.displayItems).toEqual([message("initial"), message("next")]);
  });

  it("keeps panel-local thread, request, and composer state isolated across stores", () => {
    const panelA = createChatStateStore();
    const panelB = createChatStateStore();

    panelA.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread-a"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    panelA.dispatch({ type: "composer/draft-set", draft: "panel A draft" });
    panelA.dispatch({ type: "request/user-input-queued", input: userInput(1) });
    panelA.dispatch({ type: "request/user-input-draft-set", key: "1:note", value: "panel A answer" });

    panelB.dispatch({
      type: "active-thread/resumed",
      thread: thread("thread-b"),
      cwd: "/vault",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      approvalPolicy: null,
      approvalsReviewer: null,
      activePermissionProfile: null,
    });
    panelB.dispatch({ type: "composer/draft-set", draft: "panel B draft" });
    panelB.dispatch({ type: "request/user-input-queued", input: userInput(2) });
    panelB.dispatch({ type: "request/user-input-draft-set", key: "2:note", value: "panel B answer" });

    panelA.dispatch({ type: "request/resolved", requestId: 1 });
    panelA.dispatch({ type: "active-thread/cleared" });

    expect(panelA.getState()).toMatchObject({
      activeThread: { id: null },
      composer: { draft: "" },
      requests: { pendingUserInputs: [] },
    });
    expect(panelA.getState().requests.userInputDrafts.size).toBe(0);

    expect(panelB.getState()).toMatchObject({
      activeThread: { id: "thread-b" },
      composer: { draft: "panel B draft" },
      requests: { pendingUserInputs: [expect.objectContaining({ requestId: 2 })] },
    });
    expect(panelB.getState().requests.userInputDrafts.get("2:note")).toBe("panel B answer");
  });
});

function message(id: string): DisplayItem {
  return { id, kind: "message", role: "assistant", text: id, messageKind: "assistantResponse", messageState: "completed" };
}

function suggestion(display: string): ChatState["composer"]["suggestions"][number] {
  return { display, detail: "Plan mode", replacement: display, start: 0, appendSpaceOnInsert: true };
}

function approval(requestId: number): ChatState["requests"]["approvals"][number] {
  return {
    requestId,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread", turnId: "turn", itemId: "item", command: "pwd", cwd: "/tmp", reason: "Need access", startedAtMs: 1 },
  };
}

function userInput(requestId: number): ChatState["requests"]["pendingUserInputs"][number] {
  return {
    requestId,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [{ id: "note", header: "Note", question: "What now?", isOther: false, isSecret: false, options: null }],
    },
  };
}

function goal(threadId: string): ThreadGoal {
  return {
    threadId,
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

export function thread(id: string): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
  };
}
